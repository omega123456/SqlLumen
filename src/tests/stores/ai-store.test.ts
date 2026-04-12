import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import { useAiStore } from '../../stores/ai-store'
import type { TabAiState } from '../../stores/ai-store'
import { useQueryStore } from '../../stores/query-store'
import type { TabStatus } from '../../stores/query-store'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../components/query-editor/schema-metadata-cache', () => ({
  loadCache: vi.fn().mockResolvedValue(undefined),
  getCache: vi.fn().mockReturnValue({
    status: 'ready',
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
    foreignKeys: {},
    indexes: {},
  }),
}))

vi.mock('../../lib/app-log-commands', () => ({
  logFrontend: vi.fn(),
}))

const mockSendAiChat = vi.fn().mockResolvedValue(undefined)
const mockCancelAiStream = vi.fn().mockResolvedValue(undefined)
const mockListenToAiStream = vi.fn().mockResolvedValue(vi.fn())

vi.mock('../../lib/ai-commands', () => ({
  sendAiChat: (...args: unknown[]) => mockSendAiChat(...args),
  cancelAiStream: (...args: unknown[]) => mockCancelAiStream(...args),
  listenToAiStream: (...args: unknown[]) => mockListenToAiStream(...args),
}))

vi.mock('../../stores/settings-store', () => ({
  useSettingsStore: {
    getState: () => ({
      getSetting: (key: string) => {
        const defaults: Record<string, string> = {
          'ai.endpoint': 'http://localhost:11434/v1/chat/completions',
          'ai.model': 'llama3',
          'ai.temperature': '0.3',
          'ai.maxTokens': '2048',
        }
        return defaults[key] ?? ''
      },
    }),
  },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INITIAL_STATE = { tabs: {} as Record<string, TabAiState> }

function getTab(tabId: string): TabAiState | undefined {
  return useAiStore.getState().tabs[tabId]
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  useAiStore.setState(INITIAL_STATE)
  useQueryStore.setState({ tabs: {} })
  vi.clearAllMocks()
  mockSendAiChat.mockResolvedValue(undefined)
  mockCancelAiStream.mockResolvedValue(undefined)
  mockListenToAiStream.mockResolvedValue(vi.fn())

  mockIPC((cmd) => {
    if (cmd === 'log_frontend') return undefined
    if (cmd === 'plugin:event|listen') return () => {}
    if (cmd === 'plugin:event|unlisten') return undefined
    if (cmd === 'get_setting') return null
    if (cmd === 'set_setting') return undefined
    if (cmd === 'get_all_settings') return {}
    throw new Error(`[vitest] Unmocked Tauri IPC command: ${cmd}`)
  })
})

afterEach(() => {
  consoleSpy?.mockRestore()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAiStore', () => {
  describe('sendMessage', () => {
    it('adds a user message to the conversation', () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello AI', {})
      const tab = getTab('tab-1')!
      expect(tab.messages).toHaveLength(1)
      expect(tab.messages[0].role).toBe('user')
      expect(tab.messages[0].content).toBe('Hello AI')
      expect(tab.messages[0].id).toBeTruthy()
      expect(tab.messages[0].timestamp).toBeGreaterThan(0)
    })

    it('sets isGenerating and activeStreamId immediately', () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})
      const tab = getTab('tab-1')!
      expect(tab.isGenerating).toBe(true)
      expect(tab.activeStreamId).toBeTruthy()
    })

    it('clears error when sending a message', () => {
      useAiStore.getState().setError('tab-1', 'some error')
      expect(getTab('tab-1')!.error).toBe('some error')

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'retry', {})
      expect(getTab('tab-1')!.error).toBeNull()
    })

    it('calls listenToAiStream and sendAiChat', async () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})

      await vi.waitFor(() => {
        expect(mockListenToAiStream).toHaveBeenCalledTimes(1)
      })

      expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      const params = mockSendAiChat.mock.calls[0][0]
      expect(params.endpoint).toBe('http://localhost:11434/v1/chat/completions')
      expect(params.model).toBe('llama3')
      expect(params.temperature).toBe(0.3)
      expect(params.maxTokens).toBe(2048)
      expect(params.streamId).toBeTruthy()
      expect(params.messages).toEqual(
        expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'Hello' })])
      )
    })

    it('passes override settings when provided', async () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {
        model: 'gpt-4',
        temperature: 0.7,
        maxTokens: 4096,
      })

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      const params = mockSendAiChat.mock.calls[0][0]
      expect(params.model).toBe('gpt-4')
      expect(params.temperature).toBe(0.7)
      expect(params.maxTokens).toBe(4096)
    })

    it('stores the unlisten function from listenToAiStream', async () => {
      const mockUnlisten = vi.fn()
      mockListenToAiStream.mockResolvedValueOnce(mockUnlisten)

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})

      await vi.waitFor(() => {
        expect(getTab('tab-1')!._unlisten).toBe(mockUnlisten)
      })
    })

    it('prepends system message with capability prompt and schema DDL on first send', async () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'First message', {})

      // Wait for the async schema loading to complete
      await vi.waitFor(() => {
        const tab = getTab('tab-1')!
        expect(tab.messages.length).toBe(2)
      })

      const tab = getTab('tab-1')!
      expect(tab.messages[0].role).toBe('system')
      expect(tab.messages[0].content).toContain(
        'You are an expert SQL assistant integrated into a database client'
      )
      expect(tab.messages[0].content).toContain('Database schema:')
      expect(tab.messages[0].content).toContain('CREATE TABLE `testdb`.`users`')
      expect(tab.messages[1].role).toBe('user')
      expect(tab.messages[1].content).toBe('First message')
    })

    it('sets schema context fields after first message', async () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'First message', {})

      await vi.waitFor(() => {
        const tab = getTab('tab-1')!
        expect(tab.schemaDdl).not.toBeNull()
      })

      const tab = getTab('tab-1')!
      expect(tab.schemaDdl).toContain('CREATE TABLE `testdb`.`users`')
      expect(tab.schemaTokenCount).toBeGreaterThan(0)
      expect(tab.schemaWarning).toBe(false)
    })

    it('does not prepend system message on subsequent sends', async () => {
      // First message — triggers system message
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'First', {})
      await vi.waitFor(() => {
        expect(getTab('tab-1')!.messages.length).toBe(2)
      })

      // Second message — should not add another system message
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Second', {})

      // Small delay to ensure no async system message is added
      await new Promise((r) => setTimeout(r, 50))

      const tab = getTab('tab-1')!
      expect(tab.messages).toHaveLength(3)
      expect(tab.messages[0].role).toBe('system')
      expect(tab.messages[1].role).toBe('user')
      expect(tab.messages[2].role).toBe('user')
    })

    it('sends system prompt without schema when cache is not ready', async () => {
      const { getCache } = await import('../../components/query-editor/schema-metadata-cache')
      vi.mocked(getCache).mockReturnValueOnce({
        status: 'error',
        databases: [],
        tables: {},
        columns: {},
        routines: {},
        foreignKeys: {},
        indexes: {},
        error: 'load failed',
      })

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})

      // Wait for the async path to complete — system prompt without schema is still added
      await vi.waitFor(() => {
        const tab = getTab('tab-1')!
        expect(tab.messages.length).toBe(2)
      })

      const tab = getTab('tab-1')!
      expect(tab.messages[0].role).toBe('system')
      expect(tab.messages[0].content).toContain(
        'You are an expert SQL assistant integrated into a database client'
      )
      // No schema DDL section
      expect(tab.messages[0].content).not.toContain('Database schema:')
      expect(tab.messages[1].role).toBe('user')
    })

    it('sets error state when sendAiChat fails', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockSendAiChat.mockRejectedValueOnce(new Error('Network error'))

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})

      await vi.waitFor(() => {
        const tab = getTab('tab-1')!
        expect(tab.error).toBe('Network error')
      })

      const tab = getTab('tab-1')!
      expect(tab.isGenerating).toBe(false)
      expect(tab.activeStreamId).toBeNull()
    })

    it('calls unlisten and clears it when sendAiChat fails', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const mockUnlisten = vi.fn()
      mockListenToAiStream.mockResolvedValueOnce(mockUnlisten)
      mockSendAiChat.mockRejectedValueOnce(new Error('Network error'))

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})

      // Wait for the error state to be set (async path completes)
      await vi.waitFor(() => {
        const tab = getTab('tab-1')!
        expect(tab.error).toBe('Network error')
      })

      // unlisten should have been called to clean up orphaned listeners
      expect(mockUnlisten).toHaveBeenCalledTimes(1)
      // _unlisten should be cleared
      expect(getTab('tab-1')!._unlisten).toBeNull()
    })

    it('stream listeners call store onStreamChunk/onDone/onError', async () => {
      let capturedCallbacks: {
        onChunk: (content: string) => void
        onDone: () => void
        onError: (error: string) => void
      } | null = null

      mockListenToAiStream.mockImplementation(
        (_streamId: string, callbacks: typeof capturedCallbacks) => {
          capturedCallbacks = callbacks
          return Promise.resolve(vi.fn())
        }
      )

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})

      await vi.waitFor(() => {
        expect(capturedCallbacks).not.toBeNull()
      })

      // Simulate streaming chunks
      capturedCallbacks!.onChunk('Hello ')
      capturedCallbacks!.onChunk('world!')

      const tab1 = getTab('tab-1')!
      const assistantMsg = tab1.messages.find((m) => m.role === 'assistant')
      expect(assistantMsg).toBeDefined()
      expect(assistantMsg!.content).toBe('Hello world!')
      expect(tab1.isGenerating).toBe(true)

      // Simulate done
      capturedCallbacks!.onDone()
      const tab2 = getTab('tab-1')!
      expect(tab2.isGenerating).toBe(false)
    })

    it('stream listeners continue to accumulate tokens when no UI is subscribed (store ownership)', async () => {
      let capturedCallbacks: {
        onChunk: (content: string) => void
        onDone: () => void
        onError: (error: string) => void
      } | null = null

      mockListenToAiStream.mockImplementation(
        (_streamId: string, callbacks: typeof capturedCallbacks) => {
          capturedCallbacks = callbacks
          return Promise.resolve(vi.fn())
        }
      )

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})

      await vi.waitFor(() => {
        expect(capturedCallbacks).not.toBeNull()
      })

      // No UI subscription — just the store's internal callbacks
      // Simulate streaming several chunks
      capturedCallbacks!.onChunk('Token1 ')
      capturedCallbacks!.onChunk('Token2 ')
      capturedCallbacks!.onChunk('Token3')

      // Read state directly (no React subscriber needed)
      const tab = getTab('tab-1')!
      const assistantMsg = tab.messages.find((m) => m.role === 'assistant')
      expect(assistantMsg).toBeDefined()
      expect(assistantMsg!.content).toBe('Token1 Token2 Token3')
    })

    it('includes attached context SQL in the IPC messages', async () => {
      const context = {
        sql: 'SELECT * FROM users WHERE id = 1',
        range: { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 34 },
      }
      useAiStore.getState().setAttachedContext('tab-1', context)

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Explain this query', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      const params = mockSendAiChat.mock.calls[0][0]
      // Should have: system, context-user, user messages
      const contextMsg = params.messages.find(
        (m: { role: string; content: string }) =>
          m.role === 'user' && m.content.includes('SELECT * FROM users WHERE id = 1')
      )
      expect(contextMsg).toBeDefined()
      expect(contextMsg.content).toContain('The following SQL statement is the context')
      expect(contextMsg.content).toContain('```sql')
    })

    it('preserves attached context after sending a message (not cleared prematurely)', () => {
      const context = {
        sql: 'SELECT 1',
        range: { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 8 },
      }
      useAiStore.getState().setAttachedContext('tab-1', context)
      expect(getTab('tab-1')!.attachedContext).not.toBeNull()

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Explain', {})
      // attachedContext must remain set so the "Review Diff" button stays
      // visible when the streaming response arrives.
      expect(getTab('tab-1')!.attachedContext).toEqual(context)
    })

    it('attachedContext is cleared by clearAttachedContext', () => {
      const context = {
        sql: 'SELECT 1',
        range: { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 8 },
      }
      useAiStore.getState().setAttachedContext('tab-1', context)
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Explain', {})
      // Still set after sendMessage
      expect(getTab('tab-1')!.attachedContext).not.toBeNull()

      // Explicitly cleared via user action
      useAiStore.getState().clearAttachedContext('tab-1')
      expect(getTab('tab-1')!.attachedContext).toBeNull()
    })

    it('does not inject context message when no context is attached', async () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'General question', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      const params = mockSendAiChat.mock.calls[0][0]
      const contextMsg = params.messages.find(
        (m: { role: string; content: string }) =>
          m.role === 'user' && m.content.includes('The following SQL statement is the context')
      )
      expect(contextMsg).toBeUndefined()
    })

    it('aborts stream setup if cancelled during schema loading', async () => {
      // Make buildSchemaSystemMessage take a bit of time
      const { loadCache } = await import('../../components/query-editor/schema-metadata-cache')
      vi.mocked(loadCache).mockImplementationOnce(() => new Promise((r) => setTimeout(r, 50)))

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})

      // Cancel immediately while schema is loading
      useAiStore.getState().cancelStream('tab-1')

      // Wait for the async path to try to complete
      await new Promise((r) => setTimeout(r, 100))

      // sendAiChat should NOT have been called because the stream was cancelled
      expect(mockSendAiChat).not.toHaveBeenCalled()
    })
  })

  describe('cancelStream', () => {
    it('sets isGenerating to false and clears activeStreamId', () => {
      // Set up generating state via sendMessage
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})
      expect(getTab('tab-1')!.isGenerating).toBe(true)

      useAiStore.getState().cancelStream('tab-1')
      const tab = getTab('tab-1')!
      expect(tab.isGenerating).toBe(false)
      expect(tab.activeStreamId).toBeNull()
    })

    it('calls cancelAiStream IPC with the active streamId', async () => {
      // Set up generating state via sendMessage
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})
      const streamId = getTab('tab-1')!.activeStreamId!

      useAiStore.getState().cancelStream('tab-1')

      // Give the fire-and-forget promise a tick
      await new Promise((r) => setTimeout(r, 10))

      expect(mockCancelAiStream).toHaveBeenCalledWith(streamId)
    })

    it('calls and clears the unlisten function', () => {
      const unlisten = vi.fn()
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})
      useAiStore.getState().setUnlisten('tab-1', unlisten)

      useAiStore.getState().cancelStream('tab-1')

      expect(unlisten).toHaveBeenCalledTimes(1)
      expect(getTab('tab-1')!._unlisten).toBeNull()
    })

    it('does nothing when no active stream exists', async () => {
      useAiStore.getState().openPanel('tab-1')
      useAiStore.getState().cancelStream('tab-1')

      await new Promise((r) => setTimeout(r, 10))
      expect(mockCancelAiStream).not.toHaveBeenCalled()
    })

    it('handles cancelAiStream IPC failure gracefully', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockCancelAiStream.mockRejectedValueOnce(new Error('Cancel failed'))

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})
      useAiStore.getState().cancelStream('tab-1')

      // Give the fire-and-forget promise a tick
      await new Promise((r) => setTimeout(r, 10))

      // Should not throw, just log
      expect(consoleSpy).toHaveBeenCalledWith(
        '[ai-store] Failed to cancel AI stream:',
        'Cancel failed'
      )
      // State should still be updated
      expect(getTab('tab-1')!.isGenerating).toBe(false)
    })
  })

  describe('onStreamChunk', () => {
    it('creates a new assistant message when no assistant message exists', () => {
      // Set up a tab with an active stream so the chunk is not rejected
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hi', {})
      const streamId = getTab('tab-1')!.activeStreamId!
      useAiStore.getState().onStreamChunk('tab-1', streamId, 'Hello')
      const tab = getTab('tab-1')!
      const assistantMsg = tab.messages.find((m) => m.role === 'assistant')
      expect(assistantMsg).toBeDefined()
      expect(assistantMsg!.content).toBe('Hello')
      expect(tab.isGenerating).toBe(true)
      expect(tab.activeStreamId).toBe(streamId)
    })

    it('appends to existing assistant message', () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hi', {})
      const streamId = getTab('tab-1')!.activeStreamId!
      useAiStore.getState().onStreamChunk('tab-1', streamId, 'Hello')
      useAiStore.getState().onStreamChunk('tab-1', streamId, ' world')
      const tab = getTab('tab-1')!
      const assistantMsgs = tab.messages.filter((m) => m.role === 'assistant')
      expect(assistantMsgs).toHaveLength(1)
      expect(assistantMsgs[0].content).toBe('Hello world')
    })

    it('creates new assistant message after a user message', () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hi', {})
      const streamId = getTab('tab-1')!.activeStreamId!
      useAiStore.getState().onStreamChunk('tab-1', streamId, 'Response')
      const tab = getTab('tab-1')!
      const userMsg = tab.messages.find((m) => m.role === 'user')
      const assistantMsg = tab.messages.find((m) => m.role === 'assistant')
      expect(userMsg).toBeDefined()
      expect(assistantMsg).toBeDefined()
      expect(assistantMsg!.content).toBe('Response')
    })

    it('ignores chunks with a stale streamId', () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hi', {})
      useAiStore.getState().onStreamChunk('tab-1', 'stale-stream-id', 'Should be ignored')
      const tab = getTab('tab-1')!
      const assistantMsg = tab.messages.find((m) => m.role === 'assistant')
      expect(assistantMsg).toBeUndefined()
    })

    it('ignores chunks for non-existent tab', () => {
      // Should not throw
      useAiStore.getState().onStreamChunk('nonexistent', 'stream-1', 'chunk')
      expect(getTab('nonexistent')).toBeUndefined()
    })
  })

  describe('onStreamDone', () => {
    it('sets isGenerating to false and clears activeStreamId', () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hi', {})
      const streamId = getTab('tab-1')!.activeStreamId!
      useAiStore.getState().onStreamChunk('tab-1', streamId, 'chunk')
      useAiStore.getState().onStreamDone('tab-1', streamId)
      const tab = getTab('tab-1')!
      expect(tab.isGenerating).toBe(false)
      expect(tab.activeStreamId).toBeNull()
    })

    it('calls and clears _unlisten on stream done', () => {
      const unlisten = vi.fn()
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hi', {})
      const streamId = getTab('tab-1')!.activeStreamId!
      useAiStore.getState().setUnlisten('tab-1', unlisten)

      useAiStore.getState().onStreamDone('tab-1', streamId)
      expect(unlisten).toHaveBeenCalledTimes(1)
      expect(getTab('tab-1')!._unlisten).toBeNull()
    })

    it('ignores done event with stale streamId', () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hi', {})
      const streamId = getTab('tab-1')!.activeStreamId!

      // Call with a stale streamId
      useAiStore.getState().onStreamDone('tab-1', 'stale-stream-id')

      // State should not change — still generating
      const tab = getTab('tab-1')!
      expect(tab.isGenerating).toBe(true)
      expect(tab.activeStreamId).toBe(streamId)
    })
  })

  describe('onStreamError', () => {
    it('sets isGenerating to false, sets error, clears activeStreamId', () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hi', {})
      const streamId = getTab('tab-1')!.activeStreamId!
      useAiStore.getState().onStreamChunk('tab-1', streamId, 'chunk')
      useAiStore.getState().onStreamError('tab-1', streamId, 'Connection failed')
      const tab = getTab('tab-1')!
      expect(tab.isGenerating).toBe(false)
      expect(tab.error).toBe('Connection failed')
      expect(tab.activeStreamId).toBeNull()
    })

    it('calls and clears _unlisten on stream error', () => {
      const unlisten = vi.fn()
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hi', {})
      const streamId = getTab('tab-1')!.activeStreamId!
      useAiStore.getState().setUnlisten('tab-1', unlisten)

      useAiStore.getState().onStreamError('tab-1', streamId, 'Error')
      expect(unlisten).toHaveBeenCalledTimes(1)
      expect(getTab('tab-1')!._unlisten).toBeNull()
    })

    it('ignores error event with stale streamId', () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hi', {})
      const streamId = getTab('tab-1')!.activeStreamId!

      useAiStore.getState().onStreamError('tab-1', 'stale-stream-id', 'Should be ignored')

      const tab = getTab('tab-1')!
      expect(tab.isGenerating).toBe(true)
      expect(tab.activeStreamId).toBe(streamId)
      expect(tab.error).toBeNull()
    })
  })

  describe('setUnlisten', () => {
    it('stores the unlisten function for a tab', () => {
      const unlisten = vi.fn()
      useAiStore.getState().setUnlisten('tab-1', unlisten)
      expect(getTab('tab-1')!._unlisten).toBe(unlisten)
    })
  })

  describe('panel actions', () => {
    it('togglePanel opens a closed panel', () => {
      useAiStore.getState().togglePanel('tab-1')
      expect(getTab('tab-1')!.isPanelOpen).toBe(true)
    })

    it('togglePanel closes an open panel', () => {
      useAiStore.getState().openPanel('tab-1')
      useAiStore.getState().togglePanel('tab-1')
      expect(getTab('tab-1')!.isPanelOpen).toBe(false)
    })

    it('openPanel sets isPanelOpen to true', () => {
      useAiStore.getState().openPanel('tab-1')
      expect(getTab('tab-1')!.isPanelOpen).toBe(true)
    })

    it('closePanel sets isPanelOpen to false', () => {
      useAiStore.getState().openPanel('tab-1')
      useAiStore.getState().closePanel('tab-1')
      expect(getTab('tab-1')!.isPanelOpen).toBe(false)
    })
  })

  describe('attached context', () => {
    it('setAttachedContext stores the SQL context', () => {
      const context = {
        sql: 'SELECT * FROM users',
        range: { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 20 },
      }
      useAiStore.getState().setAttachedContext('tab-1', context)
      expect(getTab('tab-1')!.attachedContext).toEqual(context)
    })

    it('clearAttachedContext removes the context', () => {
      const context = {
        sql: 'SELECT 1',
        range: { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 8 },
      }
      useAiStore.getState().setAttachedContext('tab-1', context)
      useAiStore.getState().clearAttachedContext('tab-1')
      expect(getTab('tab-1')!.attachedContext).toBeNull()
    })
  })

  describe('clearConversation', () => {
    it('clears messages but preserves panel state', () => {
      useAiStore.getState().openPanel('tab-1')
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})
      useAiStore.getState().setError('tab-1', 'some error')

      useAiStore.getState().clearConversation('tab-1')

      const tab = getTab('tab-1')!
      expect(tab.messages).toHaveLength(0)
      expect(tab.error).toBeNull()
      expect(tab.isPanelOpen).toBe(true) // preserved
    })
  })

  describe('error management', () => {
    it('setError sets the error string', () => {
      useAiStore.getState().setError('tab-1', 'Something went wrong')
      expect(getTab('tab-1')!.error).toBe('Something went wrong')
    })

    it('clearError removes the error', () => {
      useAiStore.getState().setError('tab-1', 'Error')
      useAiStore.getState().clearError('tab-1')
      expect(getTab('tab-1')!.error).toBeNull()
    })
  })

  describe('setSchemaContext', () => {
    it('stores schema DDL and token information', () => {
      useAiStore.getState().setSchemaContext('tab-1', 'CREATE TABLE foo (id INT);', 10, false)
      const tab = getTab('tab-1')!
      expect(tab.schemaDdl).toBe('CREATE TABLE foo (id INT);')
      expect(tab.schemaTokenCount).toBe(10)
      expect(tab.schemaWarning).toBe(false)
    })

    it('stores schema with warning flag', () => {
      useAiStore.getState().setSchemaContext('tab-1', 'long ddl', 9000, true)
      const tab = getTab('tab-1')!
      expect(tab.schemaWarning).toBe(true)
      expect(tab.schemaTokenCount).toBe(9000)
    })
  })

  describe('preloadSchemaContext', () => {
    it('populates schema token count asynchronously', async () => {
      useAiStore.getState().preloadSchemaContext('tab-1', 'conn-1')

      await vi.waitFor(() => {
        const tab = getTab('tab-1')!
        expect(tab.schemaTokenCount).toBeGreaterThan(0)
      })

      const tab = getTab('tab-1')!
      expect(tab.schemaDdl).toContain('CREATE TABLE `testdb`.`users`')
      expect(tab.schemaWarning).toBe(false)
    })

    it('skips loading if schema is already populated', async () => {
      useAiStore.getState().setSchemaContext('tab-1', 'existing ddl', 42, false)

      const { loadCache } = await import('../../components/query-editor/schema-metadata-cache')
      vi.mocked(loadCache).mockClear()

      useAiStore.getState().preloadSchemaContext('tab-1', 'conn-1')

      // loadCache should not be called since token count is already > 0
      await new Promise((r) => setTimeout(r, 50))
      expect(vi.mocked(loadCache)).not.toHaveBeenCalled()

      // Original values should be preserved
      const tab = getTab('tab-1')!
      expect(tab.schemaDdl).toBe('existing ddl')
      expect(tab.schemaTokenCount).toBe(42)
    })

    it('handles schema loading failure gracefully', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { loadCache } = await import('../../components/query-editor/schema-metadata-cache')
      vi.mocked(loadCache).mockRejectedValueOnce(new Error('Network error'))

      useAiStore.getState().preloadSchemaContext('tab-1', 'conn-1')

      await vi.waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          '[ai-store] Failed to build schema system message:',
          'Network error'
        )
      })

      // Token count should remain at 0
      const tab = getTab('tab-1')!
      expect(tab.schemaTokenCount).toBe(0)
    })

    it('does not overwrite schema populated by sendMessage', async () => {
      // Start a sendMessage which populates schema
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})
      await vi.waitFor(() => {
        const tab = getTab('tab-1')!
        expect(tab.schemaTokenCount).toBeGreaterThan(0)
      })

      const originalCount = getTab('tab-1')!.schemaTokenCount

      // Now try preloading — should be a no-op since already populated
      useAiStore.getState().preloadSchemaContext('tab-1', 'conn-1')
      await new Promise((r) => setTimeout(r, 50))

      expect(getTab('tab-1')!.schemaTokenCount).toBe(originalCount)
    })

    it('includes FK and index data in the DDL when cache has them', async () => {
      const { getCache } = await import('../../components/query-editor/schema-metadata-cache')
      vi.mocked(getCache).mockReturnValue({
        status: 'ready',
        databases: ['testdb'],
        tables: {
          testdb: [
            { name: 'orders', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 10, dataSize: 1024 },
          ],
        },
        columns: {
          'testdb.orders': [
            { name: 'id', dataType: 'INT' },
            { name: 'user_id', dataType: 'INT' },
          ],
        },
        routines: {},
        foreignKeys: {
          'testdb.orders': [
            {
              name: 'fk_user',
              columnName: 'user_id',
              referencedDatabase: 'testdb',
              referencedTable: 'users',
              referencedColumn: 'id',
              onDelete: 'CASCADE',
              onUpdate: 'NO ACTION',
            },
          ],
        },
        indexes: {
          'testdb.orders': [
            {
              name: 'idx_user_id',
              indexType: 'BTREE',
              cardinality: null,
              columns: ['user_id'],
              isVisible: true,
              isUnique: false,
            },
          ],
        },
      })

      useAiStore.getState().preloadSchemaContext('tab-fk-idx', 'conn-1')

      await vi.waitFor(() => {
        const tab = getTab('tab-fk-idx')!
        expect(tab.schemaTokenCount).toBeGreaterThan(0)
      })

      const tab = getTab('tab-fk-idx')!
      expect(tab.schemaDdl).toContain('INDEX `idx_user_id` (`user_id`)')
      expect(tab.schemaDdl).toContain(
        'CONSTRAINT `fk_user` FOREIGN KEY (`user_id`) REFERENCES `testdb`.`users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION'
      )
    })
  })

  describe('retryLastMessage', () => {
    it('re-sends the last user message', () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'World', {})

      // Simulate an error response after "World"
      const streamId = getTab('tab-1')!.activeStreamId!
      useAiStore.getState().onStreamError('tab-1', streamId, 'Failed')

      useAiStore.getState().retryLastMessage('tab-1', 'conn-1', {})

      const tab = getTab('tab-1')!
      // The last user message ("World") should be removed and re-added
      const userMessages = tab.messages.filter((m) => m.role === 'user')
      expect(userMessages[userMessages.length - 1].content).toBe('World')
    })

    it('does nothing if no user messages exist', () => {
      useAiStore.getState().togglePanel('tab-1') // ensure tab exists
      useAiStore.getState().retryLastMessage('tab-1', 'conn-1', {})
      const tab = getTab('tab-1')!
      expect(tab.messages).toHaveLength(0)
    })

    it('clears error when retrying', () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Msg', {})
      useAiStore.getState().setError('tab-1', 'Network error')

      useAiStore.getState().retryLastMessage('tab-1', 'conn-1', {})
      expect(getTab('tab-1')!.error).toBeNull()
    })

    it('does nothing for non-existent tab', () => {
      useAiStore.getState().retryLastMessage('nonexistent', 'conn-1', {})
      expect(getTab('nonexistent')).toBeUndefined()
    })
  })

  describe('cleanupTab', () => {
    it('removes all state for the tab', () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})
      useAiStore.getState().openPanel('tab-1')

      useAiStore.getState().cleanupTab('tab-1')
      expect(getTab('tab-1')).toBeUndefined()
    })

    it('calls stored unlisten function on cleanup', () => {
      const unlisten = vi.fn()
      useAiStore.getState().setUnlisten('tab-1', unlisten)

      useAiStore.getState().cleanupTab('tab-1')
      expect(unlisten).toHaveBeenCalledTimes(1)
      expect(getTab('tab-1')).toBeUndefined()
    })

    it('handles cleanup when no unlisten is stored', () => {
      useAiStore.getState().openPanel('tab-1')
      useAiStore.getState().cleanupTab('tab-1')
      expect(getTab('tab-1')).toBeUndefined()
    })

    it('handles cleanup for non-existent tab', () => {
      // Should not throw
      useAiStore.getState().cleanupTab('nonexistent')
      expect(getTab('nonexistent')).toBeUndefined()
    })

    it('handles unlisten function that throws', () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const unlisten = vi.fn(() => {
        throw new Error('unlisten failed')
      })
      useAiStore.getState().setUnlisten('tab-1', unlisten)

      useAiStore.getState().cleanupTab('tab-1')

      expect(unlisten).toHaveBeenCalledTimes(1)
      expect(getTab('tab-1')).toBeUndefined()
      expect(consoleSpy).toHaveBeenCalledWith(
        '[ai-store] Error calling unlisten during cleanup:',
        expect.any(Error)
      )
    })

    it('cancels in-flight AI request on cleanup', async () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})
      const streamId = getTab('tab-1')!.activeStreamId!
      expect(streamId).toBeTruthy()

      useAiStore.getState().cleanupTab('tab-1')

      // Give the fire-and-forget promise a tick
      await new Promise((r) => setTimeout(r, 10))

      expect(mockCancelAiStream).toHaveBeenCalledWith(streamId)
      expect(getTab('tab-1')).toBeUndefined()
    })

    it('does not call cancelAiStream when no active stream', async () => {
      useAiStore.getState().openPanel('tab-1')
      useAiStore.getState().cleanupTab('tab-1')

      await new Promise((r) => setTimeout(r, 10))

      expect(mockCancelAiStream).not.toHaveBeenCalled()
      expect(getTab('tab-1')).toBeUndefined()
    })

    it('handles cancelAiStream failure during cleanup gracefully', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockCancelAiStream.mockRejectedValueOnce(new Error('Cancel failed'))

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})
      useAiStore.getState().cleanupTab('tab-1')

      await new Promise((r) => setTimeout(r, 10))

      // Should not throw, just log
      expect(consoleSpy).toHaveBeenCalledWith(
        '[ai-store] Failed to cancel AI stream during cleanup:',
        'Cancel failed'
      )
      expect(getTab('tab-1')).toBeUndefined()
    })
  })

  describe('attachedContext staleness after diff accept', () => {
    it('followup sendMessage uses updated SQL after setAttachedContext is called with new SQL', async () => {
      // Simulate the flow:
      // 1. User clicks "Ask AI" — attachedContext is set with original SQL
      const originalRange = { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 20 }
      useAiStore.getState().setAttachedContext('tab-1', {
        sql: 'SELECT * FROM users',
        range: originalRange,
      })

      // 2. AI responds, user accepts diff — handleDiffAccept SHOULD update
      //    attachedContext.sql to the accepted SQL. Simulate the fix:
      useAiStore.getState().setAttachedContext('tab-1', {
        sql: 'SELECT id, name FROM users WHERE active = 1',
        range: originalRange,
      })

      // 3. User sends a followup message
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Now add ORDER BY', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      // The IPC messages should contain the UPDATED SQL, not the original
      const params = mockSendAiChat.mock.calls[0][0]
      const contextMsg = params.messages.find(
        (m: { role: string; content: string }) =>
          m.role === 'user' && m.content.includes('The following SQL statement is the context')
      )
      expect(contextMsg).toBeDefined()
      expect(contextMsg.content).toContain('SELECT id, name FROM users WHERE active = 1')
      expect(contextMsg.content).not.toContain('SELECT * FROM users')
    })

    it('proves stale context: without re-calling setAttachedContext, sendMessage injects original SQL', async () => {
      // This test documents the current (buggy) behavior:
      // After the diff is accepted, if handleDiffAccept does NOT update
      // attachedContext, the store still holds the original SQL.

      // 1. Set context with original SQL
      const originalRange = { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 20 }
      useAiStore.getState().setAttachedContext('tab-1', {
        sql: 'SELECT * FROM users',
        range: originalRange,
      })

      // 2. Diff is accepted — but handleDiffAccept does NOT call setAttachedContext
      //    (this is the bug). The attachedContext.sql still holds 'SELECT * FROM users'.

      // 3. User sends a followup message
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Now add ORDER BY', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      // BUG PROOF: The IPC messages contain the STALE SQL
      const params = mockSendAiChat.mock.calls[0][0]
      const contextMsg = params.messages.find(
        (m: { role: string; content: string }) =>
          m.role === 'user' && m.content.includes('The following SQL statement is the context')
      )
      expect(contextMsg).toBeDefined()
      // This passes because the bug means the original SQL is preserved (stale)
      expect(contextMsg.content).toContain('SELECT * FROM users')
    })
  })

  describe('lazy initialization', () => {
    it('creates tab state on first access via actions', () => {
      expect(getTab('tab-new')).toBeUndefined()
      useAiStore.getState().openPanel('tab-new')
      const tab = getTab('tab-new')!
      expect(tab.isPanelOpen).toBe(true)
      expect(tab.messages).toHaveLength(0)
      expect(tab.isGenerating).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Editor lock — AI status management
  // -------------------------------------------------------------------------

  describe('editor lock — AI status management', () => {
    /**
     * Set up a query-store tab so that setTabStatus / restoreTabStatus
     * calls actually affect it.
     */
    function ensureQueryTab(tabId: string, initialTabStatus: TabStatus = 'idle') {
      useQueryStore.getState().setContent(tabId, 'SELECT 1')
      if (initialTabStatus !== 'idle') {
        useQueryStore.getState().setTabStatus(tabId, initialTabStatus)
      }
    }

    it('sendMessage stores connectionId in the AI tab state', () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})
      const tab = getTab('tab-1')!
      expect(tab.connectionId).toBe('conn-1')
    })

    it('sendMessage locks the editor with ai-pending', () => {
      ensureQueryTab('tab-lock')
      useAiStore.getState().sendMessage('tab-lock', 'conn-1', 'Hello', {})
      const queryTab = useQueryStore.getState().getTabState('tab-lock')
      expect(queryTab.tabStatus).toBe('ai-pending')
      expect(queryTab.prevTabStatus).toBe('idle')
    })

    it('sendMessage preserves prevTabStatus from success', () => {
      ensureQueryTab('tab-lock2', 'success')
      useAiStore.getState().sendMessage('tab-lock2', 'conn-1', 'Hello', {})
      const queryTab = useQueryStore.getState().getTabState('tab-lock2')
      expect(queryTab.tabStatus).toBe('ai-pending')
      expect(queryTab.prevTabStatus).toBe('success')
    })

    it('onStreamDone restores the editor status', () => {
      ensureQueryTab('tab-done')
      useAiStore.getState().sendMessage('tab-done', 'conn-1', 'Hello', {})
      expect(useQueryStore.getState().getTabState('tab-done').tabStatus).toBe('ai-pending')

      const streamId = getTab('tab-done')!.activeStreamId!
      useAiStore.getState().onStreamDone('tab-done', streamId)
      expect(useQueryStore.getState().getTabState('tab-done').tabStatus).toBe('idle')
    })

    it('onStreamError restores the editor status', () => {
      ensureQueryTab('tab-err')
      useAiStore.getState().sendMessage('tab-err', 'conn-1', 'Hello', {})
      expect(useQueryStore.getState().getTabState('tab-err').tabStatus).toBe('ai-pending')

      const streamId = getTab('tab-err')!.activeStreamId!
      useAiStore.getState().onStreamError('tab-err', streamId, 'Network error')
      expect(useQueryStore.getState().getTabState('tab-err').tabStatus).toBe('idle')
    })

    it('cancelStream restores the editor status', () => {
      ensureQueryTab('tab-cancel')
      useAiStore.getState().sendMessage('tab-cancel', 'conn-1', 'Hello', {})
      expect(useQueryStore.getState().getTabState('tab-cancel').tabStatus).toBe('ai-pending')

      useAiStore.getState().cancelStream('tab-cancel')
      expect(useQueryStore.getState().getTabState('tab-cancel').tabStatus).toBe('idle')
    })

    it('setAiReviewing locks the editor with ai-reviewing', () => {
      ensureQueryTab('tab-review')
      useAiStore.getState().setAiReviewing('tab-review')
      const queryTab = useQueryStore.getState().getTabState('tab-review')
      expect(queryTab.tabStatus).toBe('ai-reviewing')
      expect(queryTab.prevTabStatus).toBe('idle')
    })

    it('restoreTabStatus restores from ai-reviewing', () => {
      ensureQueryTab('tab-restore', 'success')
      useAiStore.getState().setAiReviewing('tab-restore')
      expect(useQueryStore.getState().getTabState('tab-restore').tabStatus).toBe('ai-reviewing')

      useAiStore.getState().restoreTabStatus('tab-restore')
      expect(useQueryStore.getState().getTabState('tab-restore').tabStatus).toBe('success')
    })

    it('restoreTabStatus no-ops when tab is not in AI state', () => {
      ensureQueryTab('tab-noop', 'success')
      useAiStore.getState().restoreTabStatus('tab-noop')
      // Should remain 'success' — not changed
      expect(useQueryStore.getState().getTabState('tab-noop').tabStatus).toBe('success')
    })

    it('restoreTabStatus no-ops for non-existent query tab', () => {
      // Should not throw
      useAiStore.getState().restoreTabStatus('nonexistent')
    })

    it('sendAiChat failure restores editor status', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      ensureQueryTab('tab-fail')
      mockSendAiChat.mockRejectedValueOnce(new Error('Network error'))

      useAiStore.getState().sendMessage('tab-fail', 'conn-1', 'Hello', {})
      expect(useQueryStore.getState().getTabState('tab-fail').tabStatus).toBe('ai-pending')

      await vi.waitFor(() => {
        expect(getTab('tab-fail')!.error).toBe('Network error')
      })

      expect(useQueryStore.getState().getTabState('tab-fail').tabStatus).toBe('idle')
    })
  })
})
