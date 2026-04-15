/**
 * Tests for diff-overlay-utils — pure-logic helpers for the diff overlay.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import {
  buildDiffState,
  applyDiff,
  restoreTabAfterDiff,
  DIFF_OVERLAY_INITIAL,
} from '../../../components/query-editor/diff-overlay-utils'
import type { DiffOverlayState } from '../../../components/query-editor/diff-overlay-utils'
import { useAiStore } from '../../../stores/ai-store'
import { useQueryStore } from '../../../stores/query-store'
import { useToastStore } from '../../../stores/toast-store'
import { _resetToastTimeoutsForTests } from '../../../stores/toast-store'
import type * as MonacoType from 'monaco-editor'

function setupMockIPC() {
  mockIPC((cmd) => {
    if (cmd === 'log_frontend') return undefined
    if (cmd === 'plugin:event|listen') return () => {}
    if (cmd === 'plugin:event|unlisten') return undefined
    if (cmd === 'get_setting') return null
    if (cmd === 'set_setting') return undefined
    if (cmd === 'get_all_settings') return {}
    throw new Error(`[vitest] Unmocked Tauri IPC command: ${cmd}`)
  })
}

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  setupMockIPC()
  useToastStore.setState({ toasts: [] })
})

afterEach(() => {
  consoleSpy.mockRestore()
  _resetToastTimeoutsForTests()
})

function makeMockEditor(
  getValueInRange: (range: unknown) => string = () => 'SELECT * FROM users'
): MonacoType.editor.IStandaloneCodeEditor & {
  _mockModel: { pushEditOperations: ReturnType<typeof vi.fn> }
} {
  const mockModel = {
    getValueInRange: vi.fn(getValueInRange),
    pushEditOperations: vi.fn(),
  }
  return {
    getModel: vi.fn(() => mockModel),
    executeEdits: vi.fn(),
    _mockModel: mockModel,
  } as unknown as MonacoType.editor.IStandaloneCodeEditor & {
    _mockModel: { pushEditOperations: ReturnType<typeof vi.fn> }
  }
}

const DEFAULT_RANGE = {
  startLineNumber: 1,
  endLineNumber: 1,
  startColumn: 1,
  endColumn: 20,
}

describe('DIFF_OVERLAY_INITIAL', () => {
  it('has visible=false, empty strings, and default range', () => {
    expect(DIFF_OVERLAY_INITIAL).toEqual({
      visible: false,
      originalSql: '',
      proposedSql: '',
      originalRange: { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 1 },
    })
  })
})

describe('buildDiffState', () => {
  it('returns null when editor is null', () => {
    const result = buildDiffState(null, 'SELECT 1', DEFAULT_RANGE)
    expect(result).toBeNull()
    expect(consoleSpy).toHaveBeenCalledWith('[query-editor] Cannot open diff: no editor model')
  })

  it('returns null when editor model is null', () => {
    const editor = {
      getModel: vi.fn(() => null),
    } as unknown as MonacoType.editor.IStandaloneCodeEditor
    const result = buildDiffState(editor, 'SELECT 1', DEFAULT_RANGE)
    expect(result).toBeNull()
  })

  it('builds diff state from editor model', () => {
    const editor = makeMockEditor(() => 'SELECT * FROM users')
    const result = buildDiffState(editor, 'SELECT id FROM users', DEFAULT_RANGE)

    expect(result).not.toBeNull()
    expect(result!.visible).toBe(true)
    expect(result!.originalSql).toBe('SELECT * FROM users')
    expect(result!.proposedSql).toBe('SELECT id FROM users')
    expect(result!.originalRange).toEqual(DEFAULT_RANGE)
  })

  it('calls getModel on the editor', () => {
    const editor = makeMockEditor()
    buildDiffState(editor, 'SELECT 1', DEFAULT_RANGE)
    expect(editor.getModel).toHaveBeenCalled()
  })
})

describe('applyDiff', () => {
  it('returns false and shows error toast when editor is null', () => {
    const state: DiffOverlayState = {
      visible: true,
      originalSql: 'SELECT * FROM users',
      proposedSql: 'SELECT id FROM users',
      originalRange: DEFAULT_RANGE,
    }

    const result = applyDiff(null, state, 'SELECT id FROM users')
    expect(result).toBe(false)

    const toasts = useToastStore.getState().toasts
    expect(toasts.length).toBe(1)
    expect(toasts[0].variant).toBe('error')
    expect(toasts[0].title).toBe('Could not apply changes')
  })

  it('returns false and shows error toast when editor model is null', () => {
    const editor = {
      getModel: vi.fn(() => null),
    } as unknown as MonacoType.editor.IStandaloneCodeEditor

    const state: DiffOverlayState = {
      visible: true,
      originalSql: 'SELECT * FROM users',
      proposedSql: 'SELECT id FROM users',
      originalRange: DEFAULT_RANGE,
    }

    const result = applyDiff(editor, state, 'SELECT id FROM users')
    expect(result).toBe(false)
  })

  it('returns true and calls model.pushEditOperations with the provided finalSql', () => {
    const editor = makeMockEditor(() => 'SELECT * FROM users')
    const state: DiffOverlayState = {
      visible: true,
      originalSql: 'SELECT * FROM users',
      proposedSql: 'SELECT id FROM users',
      originalRange: DEFAULT_RANGE,
    }

    const result = applyDiff(editor, state, 'SELECT id, name FROM users WHERE active = 1')
    expect(result).toBe(true)
    // Uses model.pushEditOperations to bypass readOnly (editor is locked during ai-reviewing)
    expect(editor._mockModel.pushEditOperations).toHaveBeenCalledWith(
      [],
      [expect.objectContaining({ text: 'SELECT id, name FROM users WHERE active = 1' })],
      expect.any(Function)
    )
  })

  it('applies edit even when editor content differs from originalSql', () => {
    // The editor content differs from state.originalSql, but applyDiff
    // no longer checks for staleness — the editor is read-only during
    // ai-reviewing status, so this should succeed.
    const editor = makeMockEditor(() => 'DIFFERENT SQL')
    const state: DiffOverlayState = {
      visible: true,
      originalSql: 'SELECT * FROM users',
      proposedSql: 'SELECT id FROM users',
      originalRange: DEFAULT_RANGE,
    }

    const result = applyDiff(editor, state, 'SELECT id FROM users')
    expect(result).toBe(true)
    expect(editor._mockModel.pushEditOperations).toHaveBeenCalledWith(
      [],
      [expect.objectContaining({ text: 'SELECT id FROM users' })],
      expect.any(Function)
    )
  })

  it('uses finalSql parameter, not state.proposedSql', () => {
    const editor = makeMockEditor(() => 'SELECT * FROM users')
    const state: DiffOverlayState = {
      visible: true,
      originalSql: 'SELECT * FROM users',
      proposedSql: 'SELECT id FROM users',
      originalRange: DEFAULT_RANGE,
    }

    applyDiff(editor, state, 'CUSTOM FINAL SQL')
    expect(editor._mockModel.pushEditOperations).toHaveBeenCalledWith(
      [],
      [expect.objectContaining({ text: 'CUSTOM FINAL SQL' })],
      expect.any(Function)
    )
  })
})

describe('restoreTabAfterDiff', () => {
  it('calls useAiStore restoreTabStatus', () => {
    // Set up query store tab in ai-reviewing state
    useQueryStore.getState().setTabStatus('test-tab', 'ai-reviewing')

    const spy = vi.spyOn(useAiStore.getState(), 'restoreTabStatus')
    restoreTabAfterDiff('test-tab')
    expect(spy).toHaveBeenCalledWith('test-tab')
    spy.mockRestore()
  })
})

describe('handleDiffAccept flow — attachedContext staleness', () => {
  it('updates attachedContext.sql to finalSql after applyDiff + restoreTabAfterDiff', () => {
    // Simulate the full handleDiffAccept flow:
    // 1. User clicks "Ask AI" which sets attachedContext with the original SQL
    const originalSql = 'SELECT * FROM users'
    const range = { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 20 }

    useAiStore.getState().setAttachedContext('tab-1', { sql: originalSql, range })
    expect(useAiStore.getState().tabs['tab-1']?.attachedContext?.sql).toBe(originalSql)

    // 2. AI proposes a change, user accepts — handleDiffAccept calls applyDiff + restoreTabAfterDiff
    const finalSql = 'SELECT id, name FROM users WHERE active = 1'
    const editor = makeMockEditor(() => originalSql)
    const state: DiffOverlayState = {
      visible: true,
      originalSql,
      proposedSql: 'SELECT id, name FROM users WHERE active = 1',
      originalRange: range,
    }

    // Set up query store tab so restoreTabAfterDiff works
    useQueryStore.getState().setTabStatus('tab-1', 'ai-reviewing')

    const applied = applyDiff(editor, state, finalSql, 'tab-1')
    expect(applied).toBe(true)

    restoreTabAfterDiff('tab-1')

    // After the diff is accepted, the attachedContext.sql should be updated
    // to the finalSql so that followup AI messages reference the current SQL.
    // BUG: This assertion will FAIL because neither applyDiff nor
    // restoreTabAfterDiff updates attachedContext.sql — it retains the
    // original snapshot from the "Ask AI" click.
    expect(useAiStore.getState().tabs['tab-1']?.attachedContext?.sql).toBe(finalSql)
  })
})

// ---------------------------------------------------------------------------
// computeUpdatedRange — additional coverage
// ---------------------------------------------------------------------------

import { computeUpdatedRange } from '../../../components/query-editor/diff-overlay-utils'

describe('computeUpdatedRange', () => {
  it('handles single-line replacement: end col = startColumn + sql.length', () => {
    const range = { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 20 }
    const result = computeUpdatedRange(range, 'SELECT 1')
    expect(result.startLineNumber).toBe(1)
    expect(result.startColumn).toBe(1)
    expect(result.endLineNumber).toBe(1)
    expect(result.endColumn).toBe(1 + 'SELECT 1'.length)
  })

  it('handles multi-line replacement: end line advances, end col = last line length + 1', () => {
    const range = { startLineNumber: 2, endLineNumber: 2, startColumn: 1, endColumn: 10 }
    const multiLineSql = 'SELECT\n  id,\n  name\nFROM users'
    const result = computeUpdatedRange(range, multiLineSql)
    const lines = multiLineSql.split('\n')
    expect(result.endLineNumber).toBe(2 + lines.length - 1)
    expect(result.endColumn).toBe(lines[lines.length - 1].length + 1)
    // startLineNumber and startColumn are preserved
    expect(result.startLineNumber).toBe(2)
    expect(result.startColumn).toBe(1)
  })
})

describe('applyDiff — attachedContext sync edge cases', () => {
  it('does NOT update attachedContext when tabId is omitted', () => {
    const range = { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 20 }
    useAiStore.getState().setAttachedContext('tab-no-id', { sql: 'SELECT * FROM users', range })

    const editor = makeMockEditor()
    const state: DiffOverlayState = {
      visible: true,
      originalSql: 'SELECT * FROM users',
      proposedSql: 'SELECT id FROM users',
      originalRange: range,
    }

    applyDiff(editor, state, 'SELECT id FROM users')
    // Without tabId, context should remain unchanged
    expect(useAiStore.getState().tabs['tab-no-id']?.attachedContext?.sql).toBe(
      'SELECT * FROM users'
    )
  })

  it('does NOT update attachedContext when tab has no context set', () => {
    const range = { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 20 }
    // tab-empty has no attachedContext
    const editor = makeMockEditor()
    const state: DiffOverlayState = {
      visible: true,
      originalSql: 'SELECT * FROM users',
      proposedSql: 'SELECT id FROM users',
      originalRange: range,
    }

    // Should not throw
    applyDiff(editor, state, 'SELECT id FROM users', 'tab-empty')
    expect(useAiStore.getState().tabs['tab-empty']?.attachedContext).toBeUndefined()
  })

  it('updates attachedContext range for multi-line finalSql', () => {
    const range = { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 20 }
    useAiStore.getState().setAttachedContext('tab-multi', { sql: 'SELECT * FROM users', range })

    const editor = makeMockEditor()
    const state: DiffOverlayState = {
      visible: true,
      originalSql: 'SELECT * FROM users',
      proposedSql: 'SELECT\n  id\nFROM users',
      originalRange: range,
    }

    useQueryStore.getState().setTabStatus('tab-multi', 'ai-reviewing')
    applyDiff(editor, state, 'SELECT\n  id\nFROM users', 'tab-multi')

    const ctx = useAiStore.getState().tabs['tab-multi']?.attachedContext
    expect(ctx?.sql).toBe('SELECT\n  id\nFROM users')
    expect(ctx?.range.endLineNumber).toBe(3) // startLine=1 + 3 lines - 1
    expect(ctx?.range.endColumn).toBe('FROM users'.length + 1)
  })
})
