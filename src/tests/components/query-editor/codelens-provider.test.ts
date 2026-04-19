/**
 * Tests for codelens-provider — CodeLens provider for Run and Ask AI actions.
 *
 * The module-level side effects (registerCodeLensProvider, registerCommand,
 * subscribe) run in the global monaco mock. We test the exported pure functions
 * and command handlers directly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import {
  offsetToLineNumber,
  offsetToColumn,
  handleRunStatement,
  handleAskAi,
  provideCodeLenses,
  onDidChangeEmitter,
  triggerCodeLensRefresh,
} from '../../../components/query-editor/codelens-provider'
import { useQueryStore } from '../../../stores/query-store'
import { useAiStore } from '../../../stores/ai-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { getModelContext } from '../../../components/query-editor/completion-service'
import type { CancellationToken, editor } from 'monaco-editor'

// Mock the codelens-provider's dependency on completion-service
vi.mock('../../../components/query-editor/completion-service', () => ({
  getModelContext: vi.fn(),
  registerModelConnection: vi.fn(),
  unregisterModelConnection: vi.fn(),
  getModelConnectionId: vi.fn(),
  resetModelConnections: vi.fn(),
  completionService: vi.fn(async () => []),
}))

const mockGetModelContext = vi.mocked(getModelContext)

/** Build a minimal mock text model that supports getPositionAt for codelens tests. */
function makeMockModel(content: string): editor.ITextModel {
  return {
    uri: { toString: () => 'inmemory://model/1' },
    getValue: () => content,
    getPositionAt: (offset: number) => {
      const clamped = Math.min(offset, content.length)
      let line = 1
      let lastNewline = -1
      for (let i = 0; i < clamped; i++) {
        if (content[i] === '\n') {
          line++
          lastNewline = i
        }
      }
      return { lineNumber: line, column: offset - lastNewline }
    },
  } as unknown as editor.ITextModel
}

function setupMockIPC() {
  mockIPC((cmd) => {
    if (cmd === 'log_frontend') return undefined
    if (cmd === 'plugin:event|listen') return () => {}
    if (cmd === 'plugin:event|unlisten') return undefined
    if (cmd === 'get_setting') return null
    if (cmd === 'set_setting') return undefined
    if (cmd === 'get_all_settings') return {}
    if (cmd === 'execute_query')
      return {
        queryId: 'q1',
        columns: [],
        totalRows: 0,
        executionTimeMs: 1,
        affectedRows: 0,
        firstPage: [],
        totalPages: 0,
        autoLimitApplied: false,
      }
    if (cmd === 'execute_call_query') return { results: [] }
    if (cmd === 'execute_multi_query') return { results: [] }
    throw new Error(`[vitest] Unmocked Tauri IPC command: ${cmd}`)
  })
}

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  setupMockIPC()
  useQueryStore.setState({ tabs: {} })
  useAiStore.setState({ tabs: {} })
})

afterEach(() => {
  consoleSpy.mockRestore()
})

// ---------------------------------------------------------------------------
// offsetToLineNumber
// ---------------------------------------------------------------------------

describe('offsetToLineNumber', () => {
  it('returns 1 for offset 0', () => {
    expect(offsetToLineNumber('abc', 0)).toBe(1)
  })

  it('counts newlines', () => {
    const text = 'a\nb\nc'
    expect(offsetToLineNumber(text, 0)).toBe(1)
    expect(offsetToLineNumber(text, 2)).toBe(2) // after first \n
    expect(offsetToLineNumber(text, 4)).toBe(3) // after second \n
  })

  it('returns 1 for empty text', () => {
    expect(offsetToLineNumber('', 0)).toBe(1)
  })

  it('clamps offset to text length', () => {
    expect(offsetToLineNumber('a\nb', 100)).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// offsetToColumn
// ---------------------------------------------------------------------------

describe('offsetToColumn', () => {
  it('returns 1 for offset 0', () => {
    expect(offsetToColumn('abc', 0)).toBe(1) // offset - (-1) = 1
  })

  it('returns column after newline', () => {
    const text = 'abc\ndef'
    expect(offsetToColumn(text, 4)).toBe(1) // 'd' is column 1 after \n at index 3
    expect(offsetToColumn(text, 5)).toBe(2) // 'e' is column 2
  })

  it('handles multiple lines', () => {
    const text = 'ab\ncd\nef'
    expect(offsetToColumn(text, 6)).toBe(1) // 'e' after second \n
  })
})

// ---------------------------------------------------------------------------
// handleRunStatement
// ---------------------------------------------------------------------------

describe('handleRunStatement', () => {
  it('does nothing when tab status is running', () => {
    // Create tab first, then set status
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    useQueryStore.getState().setTabStatus('tab-1', 'running')
    handleRunStatement('conn-1', 'tab-1', { sql: 'SELECT 1', start: 0, end: 8 })
    // Status should remain running — no query was dispatched
    expect(useQueryStore.getState().tabs['tab-1']?.tabStatus).toBe('running')
  })

  it('does nothing when tab status is ai-pending', () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    useQueryStore.getState().setTabStatus('tab-1', 'ai-pending')
    handleRunStatement('conn-1', 'tab-1', { sql: 'SELECT 1', start: 0, end: 8 })
    expect(useQueryStore.getState().tabs['tab-1']?.tabStatus).toBe('ai-pending')
  })

  it('does nothing when tab status is ai-reviewing', () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    useQueryStore.getState().setTabStatus('tab-1', 'ai-reviewing')
    handleRunStatement('conn-1', 'tab-1', { sql: 'SELECT 1', start: 0, end: 8 })
    expect(useQueryStore.getState().tabs['tab-1']?.tabStatus).toBe('ai-reviewing')
  })

  it('does nothing when sql is whitespace-only', () => {
    handleRunStatement('conn-1', 'tab-1', { sql: '   ', start: 0, end: 3 })
    // No tab state should have been created
    expect(useQueryStore.getState().tabs['tab-1']).toBeUndefined()
  })

  it('executes query for valid sql', async () => {
    handleRunStatement('conn-1', 'tab-1', { sql: 'SELECT 1', start: 0, end: 8 })
    // Wait for async execution
    await vi.waitFor(() => {
      const tabState = useQueryStore.getState().tabs['tab-1']
      expect(tabState?.tabStatus).toBe('success')
    })
  })
})

// ---------------------------------------------------------------------------
// handleAskAi
// ---------------------------------------------------------------------------

describe('handleAskAi', () => {
  it('opens the AI panel if not already open', () => {
    useAiStore.setState({
      tabs: {
        'tab-1': {
          messages: [],
          isGenerating: false,
          activeStreamId: null,
          previousResponseId: null,
          attachedContext: null,
          isPanelOpen: false,
          error: null,
          retrievedSchemaDdl: '',
          lastRetrievalTimestamp: 0,
          schemaContextBuildTimestamp: 0,
          schemaContextQueryKey: '',
          lastCompletedSystemPrompt: '',
          lastCompletedTransport: null,
          lastCompletedEndpoint: '',
          lastCompletedModel: '',
          activeRequestEndpoint: '',
          activeRequestModel: '',
          activeStreamHasAssistantOutput: false,
          isWaitingForIndex: false,
          connectionId: null,
          _unlisten: null,
        },
      },
    })

    handleAskAi('conn-1', 'tab-1', { sql: 'SELECT 1', start: 0, end: 8 }, 'SELECT 1')

    expect(useAiStore.getState().tabs['tab-1']?.isPanelOpen).toBe(true)
  })

  it('sets attached context with correct range', () => {
    const text = 'SELECT 1\nFROM users'
    const stmt = { sql: 'SELECT 1\nFROM users', start: 0, end: 19 }

    handleAskAi('conn-1', 'tab-1', stmt, text)

    const ctx = useAiStore.getState().tabs['tab-1']?.attachedContext
    expect(ctx).not.toBeNull()
    expect(ctx?.sql).toBe('SELECT 1\nFROM users')
    expect(ctx?.range.startLineNumber).toBe(1)
    expect(ctx?.range.endLineNumber).toBe(2)
  })

  it('computes range covering exactly stmt.sql (excludes trailing semicolon)', () => {
    // "SELECT * FROM users;" — splitStatements produces sql="SELECT * FROM users", end=20
    const text = 'SELECT * FROM users;'
    const stmt = { sql: 'SELECT * FROM users', start: 0, end: 20 }

    handleAskAi('conn-1', 'tab-1', stmt, text)

    const ctx = useAiStore.getState().tabs['tab-1']?.attachedContext
    expect(ctx).not.toBeNull()
    // Range should cover exactly "SELECT * FROM users" (19 chars), not include ";"
    expect(ctx?.range).toEqual({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 20, // column after 's' in "users", not after ';'
    })
  })

  it('computes range correctly for multi-line statement with delimiter', () => {
    const text = 'SELECT *\nFROM users;'
    // stmt.sql is trimmed without semicolon; start=0, end=20 (past the ';')
    const stmt = { sql: 'SELECT *\nFROM users', start: 0, end: 20 }

    handleAskAi('conn-1', 'tab-1', stmt, text)

    const ctx = useAiStore.getState().tabs['tab-1']?.attachedContext
    expect(ctx).not.toBeNull()
    // "SELECT *\nFROM users" = 19 chars. Line 2 = "FROM users" (10 chars)
    expect(ctx?.range).toEqual({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 2,
      endColumn: 11, // column after 's' in "users"
    })
  })

  it('computes range correctly with leading whitespace in raw segment', () => {
    const text = '  SELECT 1;'
    // splitStatements: stmtStart=2 (after whitespace), end=11, sql="SELECT 1"
    const stmt = { sql: 'SELECT 1', start: 2, end: 11 }

    handleAskAi('conn-1', 'tab-1', stmt, text)

    const ctx = useAiStore.getState().tabs['tab-1']?.attachedContext
    expect(ctx).not.toBeNull()
    expect(ctx?.range).toEqual({
      startLineNumber: 1,
      startColumn: 3, // starts at column 3 (after 2 spaces)
      endLineNumber: 1,
      endColumn: 11, // column after '1'
    })
  })

  it('does not re-open panel if already open', () => {
    useAiStore.setState({
      tabs: {
        'tab-1': {
          messages: [],
          isGenerating: false,
          activeStreamId: null,
          previousResponseId: null,
          attachedContext: null,
          isPanelOpen: true,
          error: null,
          retrievedSchemaDdl: '',
          lastRetrievalTimestamp: 0,
          schemaContextBuildTimestamp: 0,
          schemaContextQueryKey: '',
          lastCompletedSystemPrompt: '',
          lastCompletedTransport: null,
          lastCompletedEndpoint: '',
          lastCompletedModel: '',
          activeRequestEndpoint: '',
          activeRequestModel: '',
          activeStreamHasAssistantOutput: false,
          isWaitingForIndex: false,
          connectionId: null,
          _unlisten: null,
        },
      },
    })

    const spy = vi.spyOn(useAiStore.getState(), 'openPanel')
    handleAskAi('conn-1', 'tab-1', { sql: 'SELECT 1', start: 0, end: 8 }, 'SELECT 1')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// provideCodeLenses
// ---------------------------------------------------------------------------

describe('provideCodeLenses', () => {
  it('returns empty lenses when getModelContext returns null', () => {
    mockGetModelContext.mockReturnValue(null as unknown as undefined)

    const result = provideCodeLenses(
      makeMockModel('SELECT 1'),
      null as unknown as CancellationToken
    )
    expect(result.lenses).toHaveLength(0)
  })

  it('returns empty lenses when tabType is not query-editor', () => {
    mockGetModelContext.mockReturnValue({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      tabType: 'object-editor',
    })

    const result = provideCodeLenses(
      makeMockModel('SELECT 1'),
      null as unknown as CancellationToken
    )
    expect(result.lenses).toHaveLength(0)
  })

  it('returns empty lenses when text is empty', () => {
    mockGetModelContext.mockReturnValue({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      tabType: 'query-editor',
    })

    const result = provideCodeLenses(makeMockModel('   '), null as unknown as CancellationToken)
    expect(result.lenses).toHaveLength(0)
  })

  it('returns Run lens for a single statement when AI is disabled', () => {
    mockGetModelContext.mockReturnValue({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      tabType: 'query-editor',
    })
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, 'ai.enabled': 'false' },
    })

    const result = provideCodeLenses(
      makeMockModel('SELECT 1'),
      null as unknown as CancellationToken
    )
    expect(result.lenses.length).toBeGreaterThanOrEqual(1)
    expect(result.lenses[0].command?.title).toContain('Run')
  })

  it('returns Run and Ask AI lenses when AI is enabled', () => {
    mockGetModelContext.mockReturnValue({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      tabType: 'query-editor',
    })
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, 'ai.enabled': 'true' },
    })

    const result = provideCodeLenses(
      makeMockModel('SELECT 1'),
      null as unknown as CancellationToken
    )
    expect(result.lenses.length).toBe(2)
    expect(result.lenses[0].command?.title).toContain('Run')
    expect(result.lenses[1].command?.title).toContain('Ask AI')
  })

  it('returns lenses for multiple statements', () => {
    mockGetModelContext.mockReturnValue({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      tabType: 'query-editor',
    })
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, 'ai.enabled': 'false' },
    })

    const result = provideCodeLenses(
      makeMockModel('SELECT 1;\nSELECT 2;'),
      null as unknown as CancellationToken
    )
    // 2 statements, 1 Run lens each = 2 lenses
    expect(result.lenses.length).toBe(2)
  })

  it('lenses have a dispose function', () => {
    mockGetModelContext.mockReturnValue({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      tabType: 'query-editor',
    })

    const result = provideCodeLenses(
      makeMockModel('SELECT 1'),
      null as unknown as CancellationToken
    )
    expect(typeof result.dispose).toBe('function')
    // Should not throw
    result.dispose?.()
  })
})

// ---------------------------------------------------------------------------
// Global command registration (registerCommand)
// ---------------------------------------------------------------------------

describe('global command registration', () => {
  it('registers Run and Ask AI commands via monaco.editor.registerCommand', async () => {
    const monaco = await import('monaco-editor')
    const registerCommand = vi.mocked(monaco.editor.registerCommand)

    // The module side-effect should have called registerCommand for both commands
    expect(registerCommand).toHaveBeenCalledWith('sqllumen.codelens.run', expect.any(Function))
    expect(registerCommand).toHaveBeenCalledWith('sqllumen.codelens.askAi', expect.any(Function))
  })
})

// ---------------------------------------------------------------------------
// triggerCodeLensRefresh
// ---------------------------------------------------------------------------

describe('triggerCodeLensRefresh', () => {
  it('fires the onDidChangeEmitter', () => {
    triggerCodeLensRefresh()
    expect(onDidChangeEmitter.fire).toHaveBeenCalled()
  })
})
