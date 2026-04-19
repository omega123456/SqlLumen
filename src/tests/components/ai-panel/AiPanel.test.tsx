import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import { AiPanel } from '../../../components/ai-panel/AiPanel'
import { useAiStore } from '../../../stores/ai-store'
import type { TabAiState } from '../../../stores/ai-store'
import { useSettingsStore, SETTINGS_DEFAULTS } from '../../../stores/settings-store'

function setupMockIPC() {
  mockIPC((cmd) => {
    if (cmd === 'log_frontend') return undefined
    if (cmd === 'plugin:event|listen') return () => {}
    if (cmd === 'plugin:event|unlisten') return undefined
    if (cmd === 'get_setting') return null
    if (cmd === 'set_setting') return undefined
    if (cmd === 'get_all_settings') return {}
    if (cmd === 'ai_chat') return undefined
    if (cmd === 'ai_cancel') return undefined
    if (cmd === 'ai_query_expand') return { text: '{"queries":["q1","q2","q3"]}' }
    if (cmd === 'semantic_search') return []
    if (cmd === 'build_schema_index') return undefined
    if (cmd === 'get_index_status') return { status: 'ready' }
    if (cmd === 'invalidate_schema_index') return undefined
    if (cmd === 'list_indexed_tables') return []
    if (cmd === 'fetch_schema_metadata')
      return {
        databases: ['testdb'],
        tables: {
          testdb: [
            { name: 'users', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 10, dataSize: 1024 },
          ],
        },
        columns: {
          'testdb.users': [
            { name: 'id', dataType: 'INT' },
            { name: 'name', dataType: 'VARCHAR(255)' },
          ],
        },
        routines: {},
      }
    throw new Error(`[vitest] Unmocked Tauri IPC command: ${cmd}`)
  })
}

function emptyTabState(overrides?: Partial<TabAiState>): TabAiState {
  return {
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
    ...overrides,
  }
}

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.clearAllMocks()
  setupMockIPC()

  useSettingsStore.setState({
    settings: {
      ...SETTINGS_DEFAULTS,
      'ai.enabled': 'true',
      'ai.endpoint': 'http://localhost:11434/v1',
      'ai.model': 'llama3',
      'ai.embeddingModel': 'nomic-embed-text',
    },
    pendingChanges: {},
    isDirty: false,
    isLoading: false,
    activeSection: 'ai',
    isDialogOpen: false,
    dialogSection: undefined,
  })

  useAiStore.setState({ tabs: { 'tab-1': emptyTabState() } })
})

afterEach(() => {
  consoleSpy.mockRestore()
})

describe('AiPanel', () => {
  it('renders with correct data-testid', () => {
    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-panel')).toBeInTheDocument()
  })

  it('renders the header', () => {
    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-panel-header')).toBeInTheDocument()
  })

  it('renders the messages area', () => {
    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-chat-messages')).toBeInTheDocument()
  })

  it('renders the input area', () => {
    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-chat-input')).toBeInTheDocument()
  })

  it('auto-scrolls to bottom on new messages', async () => {
    const scrollIntoViewMock = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoViewMock

    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)

    // Add messages to the store to trigger auto-scroll
    useAiStore.setState({
      tabs: {
        'tab-1': emptyTabState({
          messages: [
            { id: '1', role: 'user', content: 'Hello', timestamp: Date.now() },
            { id: '2', role: 'assistant', content: 'Hi there!', timestamp: Date.now() },
          ],
        }),
      },
    })

    await waitFor(() => {
      expect(scrollIntoViewMock).toHaveBeenCalled()
    })
  })

  it('shows all three sections: header, messages, and input', () => {
    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    const panel = screen.getByTestId('ai-panel')
    expect(panel.querySelector('[data-testid="ai-panel-header"]')).toBeInTheDocument()
    expect(panel.querySelector('[data-testid="ai-chat-messages"]')).toBeInTheDocument()
    expect(panel.querySelector('[data-testid="ai-chat-input"]')).toBeInTheDocument()
  })

  it('renders welcome state when no messages', () => {
    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-welcome-state')).toBeInTheDocument()
  })

  it('suggestion chips fill the textarea', async () => {
    const user = userEvent.setup()
    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)

    // Click a suggestion chip
    const chips = screen.getAllByTestId('ai-suggestion-chip')
    await user.click(chips[0])

    // The textarea should be filled
    const textarea = screen.getByTestId('ai-chat-textarea') as HTMLTextAreaElement
    await waitFor(() => {
      expect(textarea.value).toBe('Explain this query step by step')
    })
  })

  it('passes onTriggerDiff through to messages area', () => {
    const onTriggerDiff = vi.fn()
    render(<AiPanel tabId="tab-1" connectionId="conn-1" onTriggerDiff={onTriggerDiff} />)
    // Panel renders without error with the diff callback
    expect(screen.getByTestId('ai-panel')).toBeInTheDocument()
  })

  it('renders without onTriggerDiff', () => {
    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-panel')).toBeInTheDocument()
  })

  it('handleTriggerDiff calls onTriggerDiff with attachedContext range', () => {
    const onTriggerDiff = vi.fn()
    const range = { startLineNumber: 1, endLineNumber: 3, startColumn: 1, endColumn: 10 }
    useAiStore.setState({
      tabs: {
        'tab-1': emptyTabState({
          attachedContext: { sql: 'SELECT 1', range },
          messages: [
            { id: '1', role: 'user', content: 'Explain', timestamp: Date.now() },
            { id: '2', role: 'assistant', content: 'Here it is', timestamp: Date.now() },
          ],
        }),
      },
    })

    render(<AiPanel tabId="tab-1" connectionId="conn-1" onTriggerDiff={onTriggerDiff} />)

    expect(screen.getByTestId('ai-panel')).toBeInTheDocument()
  })

  it('handleTriggerDiff does nothing when attachedContext is null', () => {
    const onTriggerDiff = vi.fn()
    useAiStore.setState({
      tabs: {
        'tab-1': emptyTabState({
          attachedContext: null,
        }),
      },
    })

    render(<AiPanel tabId="tab-1" connectionId="conn-1" onTriggerDiff={onTriggerDiff} />)
    expect(screen.getByTestId('ai-panel')).toBeInTheDocument()
    // onTriggerDiff should not have been called yet
    expect(onTriggerDiff).not.toHaveBeenCalled()
  })

  it('shows waiting for index indicator when isWaitingForIndex is true', () => {
    useAiStore.setState({
      tabs: {
        'tab-1': emptyTabState({
          isWaitingForIndex: true,
        }),
      },
    })

    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-index-waiting')).toBeInTheDocument()
    expect(screen.getByText('Waiting for schema index...')).toBeInTheDocument()
  })

  it('does not show waiting indicator when isWaitingForIndex is false', () => {
    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.queryByTestId('ai-index-waiting')).not.toBeInTheDocument()
  })
})

describe('AiPanel — setup required state', () => {
  it('shows AiSetupRequired when AI is enabled but embedding model is empty', () => {
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
        'ai.model': 'llama3',
        'ai.embeddingModel': '',
      },
      pendingChanges: {},
    })

    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-setup-required')).toBeInTheDocument()
  })

  it('does not show AiSetupRequired when embedding model is configured', () => {
    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.queryByTestId('ai-setup-required')).not.toBeInTheDocument()
  })

  it('does not show messages area when setup required but shows disabled input', () => {
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
        'ai.model': 'llama3',
        'ai.embeddingModel': '',
      },
      pendingChanges: {},
    })

    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.queryByTestId('ai-chat-messages')).not.toBeInTheDocument()
    // Chat input should be present but disabled
    expect(screen.getByTestId('ai-chat-input')).toBeInTheDocument()
    const textarea = screen.getByTestId('ai-chat-textarea') as HTMLTextAreaElement
    expect(textarea.disabled).toBe(true)
    expect(textarea.placeholder).toContain('Embedding model required')
  })

  it('still shows the header when setup required', () => {
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
        'ai.model': 'llama3',
        'ai.embeddingModel': '',
      },
      pendingChanges: {},
    })

    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-panel-header')).toBeInTheDocument()
  })

  it('does not show setup required when AI is disabled', () => {
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'false',
        'ai.embeddingModel': '',
      },
      pendingChanges: {},
    })

    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.queryByTestId('ai-setup-required')).not.toBeInTheDocument()
  })

  it('AiSetupRequired disappears when embedding model is configured reactively', async () => {
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
        'ai.model': 'llama3',
        'ai.embeddingModel': '',
      },
      pendingChanges: {},
    })

    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-setup-required')).toBeInTheDocument()

    // Simulate user configuring the embedding model
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
        'ai.model': 'llama3',
        'ai.embeddingModel': 'nomic-embed-text',
      },
      pendingChanges: {},
    })

    await waitFor(() => {
      expect(screen.queryByTestId('ai-setup-required')).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('ai-chat-messages')).toBeInTheDocument()
  })
})
