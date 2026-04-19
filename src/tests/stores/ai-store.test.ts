import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import { useAiStore } from '../../stores/ai-store'
import type { TabAiState } from '../../stores/ai-store'
import { useQueryStore } from '../../stores/query-store'
import type { TabStatus } from '../../stores/query-store'
import { useAiFeedbackStore } from '../../stores/ai-feedback-store'

const defaultSettings: Record<string, string> = {
  'ai.endpoint': 'http://localhost:11434/v1',
  'ai.model': 'llama3',
  'ai.temperature': '0.3',
  'ai.maxTokens': '2048',
  'ai.embeddingModel': '',
  'ai.retrieval.hydeEnabled': 'true',
  'ai.retrieval.expansionMaxQueries': '8',
}

let mockSettings: Record<string, string> = { ...defaultSettings }

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../lib/app-log-commands', () => ({
  logFrontend: vi.fn(),
}))

const mockSendAiChat = vi.fn().mockResolvedValue(undefined)
const mockCancelAiStream = vi.fn().mockResolvedValue(undefined)
const mockListenToAiStream = vi.fn().mockResolvedValue(vi.fn())
const mockAiQueryExpand = vi.fn().mockResolvedValue({
  text: '{"queries":["search query 1","search query 2","search query 3"],"hypotheticalSql":"SELECT * FROM users","entities":["users","orders"],"joins":["users → orders"],"metrics":["count"]}',
})

vi.mock('../../lib/ai-commands', () => ({
  sendAiChat: (...args: unknown[]) => mockSendAiChat(...args),
  cancelAiStream: (...args: unknown[]) => mockCancelAiStream(...args),
  listenToAiStream: (...args: unknown[]) => mockListenToAiStream(...args),
  aiQueryExpand: (...args: unknown[]) => mockAiQueryExpand(...args),
}))

const mockSemanticSearch = vi.fn().mockResolvedValue([
  {
    chunkId: 1,
    chunkKey: 'testdb.users:table',
    dbName: 'testdb',
    tableName: 'users',
    chunkType: 'table',
    ddlText: 'CREATE TABLE `testdb`.`users` (`id` INT, `name` VARCHAR(255));',
    refDbName: null,
    refTableName: null,
    score: 0.9,
  },
])

vi.mock('../../lib/schema-index-commands', () => ({
  semanticSearch: (...args: unknown[]) => mockSemanticSearch(...args),
  buildSchemaIndex: vi.fn().mockResolvedValue(undefined),
  getIndexStatus: vi.fn().mockResolvedValue({ status: 'ready' }),
  invalidateSchemaIndex: vi.fn().mockResolvedValue(undefined),
  listIndexedTables: vi.fn().mockResolvedValue([]),
}))

let mockIndexStatus: {
  status: string
  tablesDone: number
  tablesTotal: number
  lastBuildTimestamp: number
} = {
  status: 'ready',
  tablesDone: 0,
  tablesTotal: 0,
  lastBuildTimestamp: Date.now(),
}

vi.mock('../../stores/schema-index-store', () => ({
  useSchemaIndexStore: {
    getState: () => ({
      getStatusForSession: () => mockIndexStatus,
      registerSession: vi.fn(),
      unregisterSession: vi.fn(),
      triggerBuild: vi.fn().mockResolvedValue(undefined),
    }),
  },
}))

vi.mock('../../stores/toast-store', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
  showWarningToast: vi.fn(),
}))

vi.mock('../../stores/settings-store', () => ({
  useSettingsStore: {
    getState: () => ({
      getSetting: (key: string) => mockSettings[key] ?? '',
    }),
    subscribe: vi.fn(),
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

beforeEach(() => {
  useAiStore.setState(INITIAL_STATE)
  useAiFeedbackStore.setState({ entries: [] })
  useQueryStore.setState({ tabs: {} })
  mockSettings = { ...defaultSettings }
  vi.clearAllMocks()
  mockSendAiChat.mockResolvedValue(undefined)
  mockCancelAiStream.mockResolvedValue(undefined)
  mockListenToAiStream.mockResolvedValue(vi.fn())
  mockAiQueryExpand.mockResolvedValue({
    text: '{"queries":["search query 1","search query 2","search query 3"],"hypotheticalSql":"SELECT * FROM users","entities":["users","orders"],"joins":["users → orders"],"metrics":["count"]}',
  })
  mockSemanticSearch.mockResolvedValue([
    {
      chunkId: 1,
      chunkKey: 'testdb.users:table',
      dbName: 'testdb',
      tableName: 'users',
      chunkType: 'table',
      ddlText: 'CREATE TABLE `testdb`.`users` (`id` INT, `name` VARCHAR(255));',
      refDbName: null,
      refTableName: null,
      score: 0.9,
    },
  ])
  mockIndexStatus = {
    status: 'ready',
    tablesDone: 0,
    tablesTotal: 0,
    lastBuildTimestamp: Date.now(),
  }

  mockIPC((cmd) => {
    if (cmd === 'log_frontend') return undefined
    if (cmd === 'plugin:event|listen') return () => {}
    if (cmd === 'plugin:event|unlisten') return undefined
    if (cmd === 'get_setting') return null
    if (cmd === 'set_setting') return undefined
    if (cmd === 'get_all_settings') return {}
    if (cmd === 'build_schema_index') return undefined
    if (cmd === 'semantic_search') return []
    if (cmd === 'get_index_status') return { status: 'ready' }
    if (cmd === 'invalidate_schema_index') return undefined
    if (cmd === 'list_indexed_tables') return []
    if (cmd === 'ai_query_expand')
      return {
        text: '{"queries":["search query 1","search query 2","search query 3"],"hypotheticalSql":"SELECT * FROM users","entities":["users","orders"],"joins":["users → orders"],"metrics":["count"]}',
      }
    throw new Error(`[vitest] Unmocked Tauri IPC command: ${cmd}`)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
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

    it('replaces a trailing failed user message instead of duplicating it on resend', () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello AI', {})
      const streamId = getTab('tab-1')!.activeStreamId!

      useAiStore.getState().onStreamError('tab-1', streamId, 'Request failed')
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello AI', {})

      const userMessages = getTab('tab-1')!.messages.filter((message) => message.role === 'user')
      expect(userMessages).toHaveLength(1)
      expect(userMessages[0].content).toBe('Hello AI')
    })

    it('calls listenToAiStream and sendAiChat', async () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})

      await vi.waitFor(() => {
        expect(mockListenToAiStream).toHaveBeenCalledTimes(1)
      })

      expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      const params = mockSendAiChat.mock.calls[0][0]
      expect(params.endpoint).toBe('http://localhost:11434/v1')
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

    it('calls aiQueryExpand for query expansion before semantic search', async () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Show me all users', {})

      await vi.waitFor(() => {
        expect(mockAiQueryExpand).toHaveBeenCalledTimes(1)
      })

      const expandCall = mockAiQueryExpand.mock.calls[0][0]
      expect(expandCall.userMessage).toContain('Show me all users')
      expect(expandCall.systemPrompt).toContain('SQL schema search assistant')
      expect(expandCall.systemPrompt).toContain('prefer database-qualified names')
    })

    it('calls semanticSearch with expanded queries including HyDE and entities', async () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Show me all users', {})

      await vi.waitFor(() => {
        expect(mockSemanticSearch).toHaveBeenCalledTimes(1)
      })

      const searchCall = mockSemanticSearch.mock.calls[0]
      expect(searchCall[0]).toBe('conn-1') // sessionId
      // Should include: original message, 3 queries, hypotheticalSql, entities, joins, metrics
      const queries = searchCall[1] as string[]
      expect(queries[0]).toBe('Show me all users')
      expect(queries).toContain('search query 1')
      expect(queries).toContain('search query 2')
      expect(queries).toContain('search query 3')
      expect(queries).toContain('SELECT * FROM users') // HyDE
      expect(queries.some((q: string) => q.includes('users') && q.includes('orders'))).toBe(true) // entities
      expect(queries.length).toBeLessThanOrEqual(8) // max queries default
    })

    it('passes retrieval hints including editor tables when attached context is set', async () => {
      // Set attached SQL context with table references
      useAiStore.getState().setAttachedContext('tab-1', {
        sql: 'SELECT * FROM `ecommerce_db`.`orders`',
        range: { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 40 },
      })

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Explain this query', {})

      await vi.waitFor(() => {
        expect(mockSemanticSearch).toHaveBeenCalledTimes(1)
      })

      const searchCall = mockSemanticSearch.mock.calls[0]
      // Third argument should be the hints object
      const hints = searchCall[2]
      expect(hints).toBeDefined()
      expect(hints.editorTables).toBeDefined()
      expect(Array.isArray(hints.editorTables)).toBe(true)
      // Should contain orders table extracted from the attached SQL
      expect(hints.editorTables.some((t: { tableName: string }) => t.tableName === 'orders')).toBe(
        true
      )
      expect(hints.recentTables).toBeDefined()
      expect(hints.acceptedTables).toBeDefined()
    })

    it('assembles recentTables hints from query store tab content', async () => {
      // Set up a query tab with SQL content
      useQueryStore.getState().setTabStatus('tab-1', 'idle')
      useQueryStore.setState((state) => ({
        tabs: {
          ...state.tabs,
          'tab-1': {
            ...state.tabs['tab-1'],
            content: 'SELECT * FROM `mydb`.`customers` WHERE active = 1',
          },
        },
      }))

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Query about customers', {})

      await vi.waitFor(() => {
        expect(mockSemanticSearch).toHaveBeenCalledTimes(1)
      })

      const hints = mockSemanticSearch.mock.calls[0][2]
      expect(hints).toBeDefined()
      expect(
        hints.recentTables.some((t: { tableName: string }) => t.tableName === 'customers')
      ).toBe(true)
    })

    it('dedupes and trims expanded queries while preserving the original message', async () => {
      mockAiQueryExpand.mockResolvedValueOnce({
        text: '{"queries":["  Show me all users  ","search query 1","search query 1","   "],"hypotheticalSql":"","entities":[],"joins":[],"metrics":[]}',
      })

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Show me all users', {})

      await vi.waitFor(() => {
        expect(mockSemanticSearch).toHaveBeenCalledTimes(1)
      })

      const searchCall = mockSemanticSearch.mock.calls[0]
      expect(searchCall[1]).toEqual(['Show me all users', 'search query 1'])
    })

    it('falls back to original message when aiQueryExpand parse fails', async () => {
      mockAiQueryExpand.mockResolvedValueOnce({ text: 'not valid json' })

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Show me users', {})

      await vi.waitFor(() => {
        expect(mockSemanticSearch).toHaveBeenCalledTimes(1)
      })

      const searchCall = mockSemanticSearch.mock.calls[0]
      expect(searchCall[1]).toEqual(['Show me users'])
    })

    it('injects system message with retrieved DDL from semantic search', async () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'First message', {})

      await vi.waitFor(() => {
        const tab = getTab('tab-1')!
        expect(tab.messages.length).toBe(2) // system + user
      })

      const tab = getTab('tab-1')!
      expect(tab.messages[0].role).toBe('system')
      expect(tab.messages[0].content).toContain(
        'You are an expert SQL assistant integrated into a database client'
      )
      expect(tab.messages[0].content).toContain(
        'Use ONLY tables that appear in the retrieved schema context'
      )
      expect(tab.messages[0].content).toContain('Always use database-qualified table names')
      expect(tab.messages[0].content).toContain('Database schema:')
      expect(tab.messages[0].content).toContain('CREATE TABLE `testdb`.`users`')
      expect(tab.messages[1].role).toBe('user')
      expect(tab.messages[1].content).toBe('First message')
    })

    it('includes dbName in semantic search debug logging payload', async () => {
      const { logFrontend } = await import('../../lib/app-log-commands')

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'First message', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      expect(logFrontend).toHaveBeenCalledWith(
        'debug',
        expect.stringContaining('"dbName":"testdb"')
      )
    })

    it('updates retrievedSchemaDdl on the tab after retrieval', async () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'First message', {})

      await vi.waitFor(() => {
        const tab = getTab('tab-1')!
        expect(tab.retrievedSchemaDdl).toBeTruthy()
      })

      const tab = getTab('tab-1')!
      expect(tab.retrievedSchemaDdl).toContain('CREATE TABLE `testdb`.`users`')
      expect(tab.lastRetrievalTimestamp).toBeGreaterThan(0)
    })

    it('reuses cached schema context within the same tab when the retrieval query set matches', async () => {
      mockIndexStatus = {
        status: 'ready',
        tablesDone: 1,
        tablesTotal: 1,
        lastBuildTimestamp: 1234,
      }

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'First message', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      expect(mockSemanticSearch).toHaveBeenCalledTimes(1)

      useAiStore.getState().onStreamChunk('tab-1', getTab('tab-1')!.activeStreamId!, 'Answer')
      useAiStore.getState().onStreamDone('tab-1', getTab('tab-1')!.activeStreamId!, {
        transport: 'chat_completions',
      })

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'First message', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(2)
      })

      expect(mockSemanticSearch).toHaveBeenCalledTimes(1)
      expect(getTab('tab-1')!.retrievedSchemaDdl).toContain('CREATE TABLE `testdb`.`users`')
    })

    it('does not reuse schema context for an unrelated later prompt in the same tab', async () => {
      mockIndexStatus = {
        status: 'ready',
        tablesDone: 1,
        tablesTotal: 1,
        lastBuildTimestamp: 1234,
      }

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'First message', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      useAiStore.getState().onStreamChunk('tab-1', getTab('tab-1')!.activeStreamId!, 'Answer')
      useAiStore.getState().onStreamDone('tab-1', getTab('tab-1')!.activeStreamId!, {
        transport: 'chat_completions',
      })

      mockSemanticSearch.mockResolvedValueOnce([
        {
          chunkId: 2,
          chunkKey: 'testdb.orders:table',
          dbName: 'testdb',
          tableName: 'orders',
          chunkType: 'table',
          ddlText: 'CREATE TABLE `testdb`.`orders` (`id` INT, `user_id` INT);',
          refDbName: null,
          refTableName: null,
          score: 0.91,
        },
      ])

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Show me orders', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(2)
      })

      expect(mockSemanticSearch).toHaveBeenCalledTimes(2)
      expect(getTab('tab-1')!.retrievedSchemaDdl).toContain('CREATE TABLE `testdb`.`orders`')
    })

    it('does not reuse schema context when retrieval hints change for the same prompt', async () => {
      mockIndexStatus = {
        status: 'ready',
        tablesDone: 1,
        tablesTotal: 1,
        lastBuildTimestamp: 1234,
      }

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'First message', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      expect(mockSemanticSearch).toHaveBeenCalledTimes(1)

      useAiStore.getState().onStreamChunk('tab-1', getTab('tab-1')!.activeStreamId!, 'Answer')
      useAiStore.getState().onStreamDone('tab-1', getTab('tab-1')!.activeStreamId!, {
        transport: 'chat_completions',
      })

      useAiFeedbackStore
        .getState()
        .recordAccepted('conn-1', [{ dbName: 'testdb', tableName: 'orders' }])

      mockSemanticSearch.mockResolvedValueOnce([
        {
          chunkId: 2,
          chunkKey: 'testdb.orders:table',
          dbName: 'testdb',
          tableName: 'orders',
          chunkType: 'table',
          ddlText: 'CREATE TABLE `testdb`.`orders` (`id` INT, `user_id` INT);',
          refDbName: null,
          refTableName: null,
          score: 0.99,
        },
      ])

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'First message', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(2)
      })

      expect(mockSemanticSearch).toHaveBeenCalledTimes(2)
      expect(getTab('tab-1')!.retrievedSchemaDdl).toContain('CREATE TABLE `testdb`.`orders`')
    })

    it('does not reuse schema context across tabs on the same connection', async () => {
      mockIndexStatus = {
        status: 'ready',
        tablesDone: 1,
        tablesTotal: 1,
        lastBuildTimestamp: 1234,
      }

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'First message', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      expect(mockSemanticSearch).toHaveBeenCalledTimes(1)

      useAiStore.getState().onStreamChunk('tab-1', getTab('tab-1')!.activeStreamId!, 'Answer')
      useAiStore.getState().onStreamDone('tab-1', getTab('tab-1')!.activeStreamId!, {
        transport: 'chat_completions',
      })

      useAiStore.getState().sendMessage('tab-2', 'conn-1', 'Different request', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(2)
      })

      expect(mockSemanticSearch).toHaveBeenCalledTimes(2)
    })

    it('passes previousResponseId on follow-up messages after a responses-api completion', async () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      const firstStreamId = getTab('tab-1')!.activeStreamId!
      useAiStore.getState().onStreamChunk('tab-1', firstStreamId, 'Hello back')
      useAiStore.getState().onStreamDone('tab-1', firstStreamId, {
        responseId: 'resp_abc',
        transport: 'responses',
      })

      expect(getTab('tab-1')!.previousResponseId).toBe('resp_abc')

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Follow up', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(2)
      })

      expect(mockSendAiChat.mock.calls[1][0].previousResponseId).toBe('resp_abc')
    })

    it('does not reuse previousResponseId when schema context changes for a new prompt', async () => {
      mockIndexStatus = {
        status: 'ready',
        tablesDone: 1,
        tablesTotal: 1,
        lastBuildTimestamp: 1234,
      }

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      useAiStore.getState().onStreamChunk('tab-1', getTab('tab-1')!.activeStreamId!, 'Hello back')
      useAiStore.getState().onStreamDone('tab-1', getTab('tab-1')!.activeStreamId!, {
        responseId: 'resp_abc',
        transport: 'responses',
      })

      mockSemanticSearch.mockResolvedValueOnce([
        {
          chunkId: 2,
          chunkKey: 'testdb.orders:table',
          dbName: 'testdb',
          tableName: 'orders',
          chunkType: 'table',
          ddlText: 'CREATE TABLE `testdb`.`orders` (`id` INT, `user_id` INT);',
          refDbName: null,
          refTableName: null,
          score: 0.95,
        },
      ])

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Show me orders', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(2)
      })

      expect(mockSemanticSearch).toHaveBeenCalledTimes(2)
      expect(mockSendAiChat.mock.calls[1][0].previousResponseId).toBeNull()
      expect(getTab('tab-1')!.retrievedSchemaDdl).toContain('CREATE TABLE `testdb`.`orders`')
    })

    it('does not reuse previousResponseId when the model changes', async () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      useAiStore.getState().onStreamChunk('tab-1', getTab('tab-1')!.activeStreamId!, 'Hello back')
      useAiStore.getState().onStreamDone('tab-1', getTab('tab-1')!.activeStreamId!, {
        responseId: 'resp_abc',
        transport: 'responses',
      })

      useAiStore
        .getState()
        .sendMessage('tab-1', 'conn-1', 'Follow up', { model: 'different-model' })

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(2)
      })

      expect(mockSendAiChat.mock.calls[1][0].previousResponseId).toBeNull()
    })

    it('does not reuse previousResponseId when the endpoint changes', async () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      useAiStore.getState().onStreamChunk('tab-1', getTab('tab-1')!.activeStreamId!, 'Hello back')
      useAiStore.getState().onStreamDone('tab-1', getTab('tab-1')!.activeStreamId!, {
        responseId: 'resp_abc',
        transport: 'responses',
      })

      mockSettings['ai.endpoint'] = 'http://localhost:8080/v1'

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Follow up', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(2)
      })

      expect(mockSendAiChat.mock.calls[1][0].previousResponseId).toBeNull()
    })

    it('clears previousResponseId when a new conversation is started', async () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      useAiStore.getState().onStreamChunk('tab-1', getTab('tab-1')!.activeStreamId!, 'Hello back')
      useAiStore.getState().onStreamDone('tab-1', getTab('tab-1')!.activeStreamId!, {
        responseId: 'resp_conversation',
        transport: 'responses',
      })

      useAiStore.getState().clearConversation('tab-1')
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Fresh start', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(2)
      })

      expect(mockSendAiChat.mock.calls[1][0].previousResponseId).toBeNull()
    })

    it('replaces system message on subsequent sends (does not stack)', async () => {
      // First message
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'First', {})
      await vi.waitFor(() => {
        expect(getTab('tab-1')!.messages.length).toBe(2) // system + user
      })

      // Second message — system message should be updated, not duplicated
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Second', {})
      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(2)
      })

      const tab = getTab('tab-1')!
      const systemMessages = tab.messages.filter((m) => m.role === 'system')
      expect(systemMessages).toHaveLength(1) // Only one system message
    })

    it('sends system prompt without schema when semantic search returns empty', async () => {
      mockSemanticSearch.mockResolvedValueOnce([])

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})

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
        onDone: (info: {
          responseId?: string | null
          transport?: 'chat_completions' | 'responses'
        }) => void
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
      capturedCallbacks!.onDone({ transport: 'chat_completions' })
      const tab2 = getTab('tab-1')!
      expect(tab2.isGenerating).toBe(false)
    })

    it('stream listeners continue to accumulate tokens when no UI is subscribed (store ownership)', async () => {
      let capturedCallbacks: {
        onChunk: (content: string) => void
        onDone: (info: {
          responseId?: string | null
          transport?: 'chat_completions' | 'responses'
        }) => void
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

    it('aborts stream setup if cancelled during schema retrieval', async () => {
      // Make semantic search take a bit of time
      mockSemanticSearch.mockImplementationOnce(
        () => new Promise((r) => setTimeout(() => r([]), 50))
      )

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})

      // Cancel immediately while schema is being retrieved
      useAiStore.getState().cancelStream('tab-1')

      // Wait for the async path to try to complete
      await new Promise((r) => setTimeout(r, 100))

      // sendAiChat should NOT have been called because the stream was cancelled
      expect(mockSendAiChat).not.toHaveBeenCalled()
    })

    it('waits for schema index when status is building then proceeds', async () => {
      // Start with building status, then switch to ready after a short delay
      mockIndexStatus = {
        status: 'building',
        tablesDone: 0,
        tablesTotal: 5,
        lastBuildTimestamp: 0,
      }

      // Switch to ready after ~600ms (the poll interval is 500ms)
      setTimeout(() => {
        mockIndexStatus = {
          status: 'ready',
          tablesDone: 5,
          tablesTotal: 5,
          lastBuildTimestamp: Date.now(),
        }
      }, 600)

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})

      // The tab should initially be waiting for index
      await vi.waitFor(() => {
        expect(getTab('tab-1')!.isWaitingForIndex).toBe(true)
      })

      // Eventually it should proceed and call sendAiChat
      await vi.waitFor(
        () => {
          expect(mockSendAiChat).toHaveBeenCalled()
        },
        { timeout: 5000 }
      )

      // isWaitingForIndex should be cleared
      expect(getTab('tab-1')!.isWaitingForIndex).toBe(false)
    })

    it('handles schema retrieval error gracefully', async () => {
      // Make semantic search throw an error
      mockSemanticSearch.mockRejectedValueOnce(new Error('Search engine unavailable'))

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})

      // Should still proceed with sendAiChat (with empty schema context)
      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalled()
      })

      // The system message should not contain any schema DDL
      const tab = getTab('tab-1')!
      const systemMsg = tab.messages.find((m) => m.role === 'system')
      expect(systemMsg).toBeDefined()
      // Since retrieval failed, schema DDL should be empty
      expect(systemMsg!.content).not.toContain('Database schema:')
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

    it('clears previousResponseId when cancelling an in-flight stream', () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})
      useAiStore.getState().onStreamChunk('tab-1', getTab('tab-1')!.activeStreamId!, 'Response')
      useAiStore.getState().onStreamDone('tab-1', getTab('tab-1')!.activeStreamId!, {
        responseId: 'resp_keep',
        transport: 'responses',
      })

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Follow up', {})
      useAiStore.getState().cancelStream('tab-1')

      expect(getTab('tab-1')!.previousResponseId).toBeNull()
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
      mockCancelAiStream.mockRejectedValueOnce(new Error('Cancel failed'))

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})
      useAiStore.getState().cancelStream('tab-1')

      // Give the fire-and-forget promise a tick
      await new Promise((r) => setTimeout(r, 10))

      // Should not throw, just log
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
      useAiStore.getState().onStreamDone('tab-1', streamId, { transport: 'chat_completions' })
      const tab = getTab('tab-1')!
      expect(tab.isGenerating).toBe(false)
      expect(tab.activeStreamId).toBeNull()
    })

    it('calls and clears _unlisten on stream done', () => {
      const unlisten = vi.fn()
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hi', {})
      const streamId = getTab('tab-1')!.activeStreamId!
      useAiStore.getState().setUnlisten('tab-1', unlisten)

      useAiStore.getState().onStreamDone('tab-1', streamId, { transport: 'chat_completions' })
      expect(unlisten).toHaveBeenCalledTimes(1)
      expect(getTab('tab-1')!._unlisten).toBeNull()
    })

    it('stores previousResponseId from responses transport', () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hi', {})
      const streamId = getTab('tab-1')!.activeStreamId!

      useAiStore.getState().onStreamChunk('tab-1', streamId, 'Answer')

      useAiStore.getState().onStreamDone('tab-1', streamId, {
        responseId: 'resp_999',
        transport: 'responses',
      })

      expect(getTab('tab-1')!.previousResponseId).toBe('resp_999')
    })

    it('does not store previousResponseId for a responses completion without assistant output', () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hi', {})
      const streamId = getTab('tab-1')!.activeStreamId!

      useAiStore.getState().onStreamDone('tab-1', streamId, {
        responseId: 'resp_empty',
        transport: 'responses',
      })

      expect(getTab('tab-1')!.previousResponseId).toBeNull()
      expect(getTab('tab-1')!.lastCompletedSystemPrompt).toBe('')
      expect(getTab('tab-1')!.lastCompletedEndpoint).toBe('')
      expect(getTab('tab-1')!.lastCompletedModel).toBe('')
    })

    it('clears previousResponseId after a non-responses completion', () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hi', {})
      const firstStreamId = getTab('tab-1')!.activeStreamId!

      useAiStore.getState().onStreamChunk('tab-1', firstStreamId, 'Answer')
      useAiStore.getState().onStreamDone('tab-1', firstStreamId, {
        responseId: 'resp_999',
        transport: 'responses',
      })

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Second turn', {})
      const secondStreamId = getTab('tab-1')!.activeStreamId!

      useAiStore.getState().onStreamDone('tab-1', secondStreamId, {
        transport: 'chat_completions',
      })

      expect(getTab('tab-1')!.previousResponseId).toBeNull()
      expect(getTab('tab-1')!.lastCompletedTransport).toBe('chat_completions')
    })

    it('ignores done event with stale streamId', () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hi', {})
      const streamId = getTab('tab-1')!.activeStreamId!

      // Call with a stale streamId
      useAiStore.getState().onStreamDone('tab-1', 'stale-stream-id', {
        transport: 'chat_completions',
      })

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

    it('clears previousResponseId on stream error', () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hi', {})
      useAiStore.getState().onStreamChunk('tab-1', getTab('tab-1')!.activeStreamId!, 'Answer')
      useAiStore.getState().onStreamDone('tab-1', getTab('tab-1')!.activeStreamId!, {
        responseId: 'resp_previous',
        transport: 'responses',
      })

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Second turn', {})
      const streamId = getTab('tab-1')!.activeStreamId!
      useAiStore.getState().onStreamError('tab-1', streamId, 'Connection failed')

      expect(getTab('tab-1')!.previousResponseId).toBeNull()
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
      useAiStore.getState().onStreamDone('tab-1', getTab('tab-1')!.activeStreamId!, {
        responseId: 'resp_clear',
        transport: 'responses',
      })

      useAiStore.getState().clearConversation('tab-1')

      const tab = getTab('tab-1')!
      expect(tab.messages).toHaveLength(0)
      expect(tab.error).toBeNull()
      expect(tab.previousResponseId).toBeNull()
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
      const unlisten = vi.fn(() => {
        throw new Error('unlisten failed')
      })
      useAiStore.getState().setUnlisten('tab-1', unlisten)

      useAiStore.getState().cleanupTab('tab-1')

      expect(unlisten).toHaveBeenCalledTimes(1)
      expect(getTab('tab-1')).toBeUndefined()
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
      mockCancelAiStream.mockRejectedValueOnce(new Error('Cancel failed'))

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})
      useAiStore.getState().cleanupTab('tab-1')

      await new Promise((r) => setTimeout(r, 10))

      // Should not throw, just log
      expect(getTab('tab-1')).toBeUndefined()
    })
  })

  describe('attachedContext staleness after diff accept', () => {
    it('followup sendMessage uses updated SQL after setAttachedContext is called with new SQL', async () => {
      const originalRange = { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 20 }
      useAiStore.getState().setAttachedContext('tab-1', {
        sql: 'SELECT * FROM users',
        range: originalRange,
      })

      useAiStore.getState().setAttachedContext('tab-1', {
        sql: 'SELECT id, name FROM users WHERE active = 1',
        range: originalRange,
      })

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Now add ORDER BY', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

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
      const originalRange = { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 20 }
      useAiStore.getState().setAttachedContext('tab-1', {
        sql: 'SELECT * FROM users',
        range: originalRange,
      })

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Now add ORDER BY', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      const params = mockSendAiChat.mock.calls[0][0]
      const contextMsg = params.messages.find(
        (m: { role: string; content: string }) =>
          m.role === 'user' && m.content.includes('The following SQL statement is the context')
      )
      expect(contextMsg).toBeDefined()
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
      useAiStore.getState().onStreamDone('tab-done', streamId, { transport: 'chat_completions' })
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

  describe('context assembly — headers and token budget', () => {
    it('formats DDL with per-chunk headers including db.table and score', async () => {
      mockSemanticSearch.mockResolvedValueOnce([
        {
          chunkId: 1,
          chunkKey: 'testdb.users:table',
          dbName: 'testdb',
          tableName: 'users',
          chunkType: 'table',
          ddlText: 'CREATE TABLE `testdb`.`users` (id INT);',
          refDbName: null,
          refTableName: null,
          score: 0.91,
        },
        {
          chunkId: 2,
          chunkKey: 'testdb.orders_view:view',
          dbName: 'testdb',
          tableName: 'orders_view',
          chunkType: 'view',
          ddlText: 'CREATE VIEW orders_view AS SELECT 1;',
          refDbName: null,
          refTableName: null,
          score: 0.72,
        },
      ])

      useAiStore.getState().sendMessage('tab-hdr', 'conn-1', 'show tables', {})

      await vi.waitFor(() => {
        expect(getTab('tab-hdr')?.retrievedSchemaDdl?.length).toBeGreaterThan(0)
      })

      const ddl = getTab('tab-hdr')!.retrievedSchemaDdl
      expect(ddl).toContain('## Table `testdb`.`users`  (score: 0.91)')
      expect(ddl).toContain('## View `testdb`.`orders_view`  (score: 0.72)')
      expect(ddl).toContain('CREATE TABLE `testdb`.`users` (id INT);')
    })

    it('enforces token budget — all chunks fit under default budget', async () => {
      const bigDdl = 'X'.repeat(400)
      mockSemanticSearch.mockResolvedValueOnce([
        {
          chunkId: 1,
          chunkKey: 'db.a:table',
          dbName: 'db',
          tableName: 'a',
          chunkType: 'table',
          ddlText: bigDdl,
          refDbName: null,
          refTableName: null,
          score: 0.9,
        },
        {
          chunkId: 2,
          chunkKey: 'db.b:table',
          dbName: 'db',
          tableName: 'b',
          chunkType: 'table',
          ddlText: bigDdl,
          refDbName: null,
          refTableName: null,
          score: 0.8,
        },
      ])

      useAiStore.getState().sendMessage('tab-budget', 'conn-1', 'show all', {})

      await vi.waitFor(() => {
        expect(getTab('tab-budget')?.retrievedSchemaDdl?.length).toBeGreaterThan(0)
      })

      const ddl = getTab('tab-budget')!.retrievedSchemaDdl
      expect(ddl).toContain('`db`.`a`')
      expect(ddl).toContain('`db`.`b`')
    })

    it('sorts results: tables first, then views, then routines', async () => {
      mockSemanticSearch.mockResolvedValueOnce([
        {
          chunkId: 3,
          chunkKey: 'db.proc1:procedure',
          dbName: 'db',
          tableName: 'proc1',
          chunkType: 'procedure',
          ddlText: 'PROCEDURE proc1',
          refDbName: null,
          refTableName: null,
          score: 0.95,
        },
        {
          chunkId: 1,
          chunkKey: 'db.users:table',
          dbName: 'db',
          tableName: 'users',
          chunkType: 'table',
          ddlText: 'TABLE users',
          refDbName: null,
          refTableName: null,
          score: 0.7,
        },
        {
          chunkId: 2,
          chunkKey: 'db.vw:view',
          dbName: 'db',
          tableName: 'vw',
          chunkType: 'view',
          ddlText: 'VIEW vw',
          refDbName: null,
          refTableName: null,
          score: 0.99,
        },
      ])

      useAiStore.getState().sendMessage('tab-sort', 'conn-1', 'show', {})

      await vi.waitFor(() => {
        expect(getTab('tab-sort')?.retrievedSchemaDdl?.length).toBeGreaterThan(0)
      })

      const ddl = getTab('tab-sort')!.retrievedSchemaDdl
      const tableIdx = ddl.indexOf('Table `db`.`users`')
      const viewIdx = ddl.indexOf('View `db`.`vw`')
      const procIdx = ddl.indexOf('Procedure `db`.`proc1`')

      expect(tableIdx).toBeLessThan(viewIdx)
      expect(viewIdx).toBeLessThan(procIdx)
    })
  })

  describe('query expansion — structured JSON parsing', () => {
    it('parses full structured response with HyDE, entities, joins, metrics', async () => {
      mockAiQueryExpand.mockResolvedValueOnce({
        text: JSON.stringify({
          queries: ['q1', 'q2'],
          hypotheticalSql: 'SELECT u.* FROM users u JOIN orders o ON u.id = o.user_id',
          entities: ['users', 'orders'],
          joins: ['users → orders'],
          metrics: ['revenue'],
        }),
      })

      useAiStore.getState().sendMessage('tab-struct', 'conn-1', 'revenue by user', {})

      await vi.waitFor(() => {
        expect(mockSemanticSearch).toHaveBeenCalledTimes(1)
      })

      const queries = mockSemanticSearch.mock.calls[0][1] as string[]
      expect(queries[0]).toBe('revenue by user') // original always first
      expect(queries).toContain('q1')
      expect(queries).toContain('q2')
      expect(queries).toContain('SELECT u.* FROM users u JOIN orders o ON u.id = o.user_id')
      expect(queries.some((q: string) => q.includes('users') && q.includes('orders'))).toBe(true)
      expect(queries.some((q: string) => q.includes('revenue'))).toBe(true)
    })

    it('parses flat queries-only response (no HyDE/entities)', async () => {
      mockAiQueryExpand.mockResolvedValueOnce({
        text: '{"queries":["flat query 1","flat query 2"]}',
      })

      useAiStore.getState().sendMessage('tab-flat', 'conn-1', 'test', {})

      await vi.waitFor(() => {
        expect(mockSemanticSearch).toHaveBeenCalledTimes(1)
      })

      const queries = mockSemanticSearch.mock.calls[0][1] as string[]
      expect(queries[0]).toBe('test')
      expect(queries).toContain('flat query 1')
      expect(queries).toContain('flat query 2')
    })

    it('falls back to original message on malformed JSON', async () => {
      mockAiQueryExpand.mockResolvedValueOnce({ text: '{broken json' })

      useAiStore.getState().sendMessage('tab-bad', 'conn-1', 'my question', {})

      await vi.waitFor(() => {
        expect(mockSemanticSearch).toHaveBeenCalledTimes(1)
      })

      const queries = mockSemanticSearch.mock.calls[0][1] as string[]
      expect(queries).toEqual(['my question'])
    })

    it('re-parses cached expansion responses with the current HyDE setting on cache hit', async () => {
      mockAiQueryExpand.mockResolvedValueOnce({
        text: JSON.stringify({
          queries: ['flat query 1'],
          hypotheticalSql: 'SELECT * FROM cached_hyde_table',
          entities: ['cached_hyde_table'],
          joins: [],
          metrics: [],
        }),
      })

      useAiStore.getState().sendMessage('tab-hyde-cache', 'conn-1', 'cacheable prompt', {})

      await vi.waitFor(() => {
        expect(mockSemanticSearch).toHaveBeenCalledTimes(1)
      })

      expect(mockSemanticSearch.mock.calls[0][1]).toContain('SELECT * FROM cached_hyde_table')

      useAiStore
        .getState()
        .onStreamDone('tab-hyde-cache', getTab('tab-hyde-cache')!.activeStreamId!, {
          transport: 'chat_completions',
        })
      useAiStore.getState().clearConversation('tab-hyde-cache')

      mockAiQueryExpand.mockClear()
      mockSemanticSearch.mockClear()

      mockSettings['ai.retrieval.hydeEnabled'] = 'false'

      useAiStore.getState().sendMessage('tab-hyde-cache', 'conn-1', 'cacheable prompt', {})

      await vi.waitFor(() => {
        expect(mockSemanticSearch).toHaveBeenCalledTimes(1)
      })

      expect(mockAiQueryExpand).not.toHaveBeenCalled()
      expect(mockSemanticSearch.mock.calls[0][1]).not.toContain('SELECT * FROM cached_hyde_table')
    })
  })

  describe('conversation history threading', () => {
    it('threads conversation context into expansion request', async () => {
      // First send to create a conversation
      useAiStore.getState().sendMessage('tab-ctx', 'conn-1', 'Hello', {})
      await vi.waitFor(() => {
        expect(mockAiQueryExpand).toHaveBeenCalledTimes(1)
      })

      // Simulate an assistant response
      const streamId = getTab('tab-ctx')!.activeStreamId!
      useAiStore.getState().onStreamChunk('tab-ctx', streamId, 'Hi there!')
      useAiStore.getState().onStreamDone('tab-ctx', streamId, {
        transport: 'chat_completions',
      })

      // Clear the mock and send a follow-up
      mockAiQueryExpand.mockClear()
      mockSemanticSearch.mockClear()

      useAiStore.getState().sendMessage('tab-ctx', 'conn-1', 'Now show me orders', {})

      await vi.waitFor(() => {
        expect(mockAiQueryExpand).toHaveBeenCalledTimes(1)
      })

      const expandCall = mockAiQueryExpand.mock.calls[0][0]
      expect(expandCall.conversationContext).toBeDefined()
      expect(expandCall.conversationContext).toContain('Hello')
    })

    it('includes attached SQL in expansion request', async () => {
      useAiStore.getState().setAttachedContext('tab-sql', {
        sql: 'SELECT id FROM customers',
        range: { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 26 },
      })

      useAiStore.getState().sendMessage('tab-sql', 'conn-1', 'Explain this', {})

      await vi.waitFor(() => {
        expect(mockAiQueryExpand).toHaveBeenCalledTimes(1)
      })

      const expandCall = mockAiQueryExpand.mock.calls[0][0]
      expect(expandCall.userMessage).toContain('SELECT id FROM customers')
    })
  })

  describe('expansion cache', () => {
    it('cache hit skips the IPC call on second identical message with same context', async () => {
      // First call — should invoke aiQueryExpand
      useAiStore.getState().sendMessage('tab-cache', 'conn-1', 'cache test', {})
      await vi.waitFor(() => {
        expect(mockAiQueryExpand).toHaveBeenCalledTimes(1)
      })

      // Wait for stream setup
      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      // Simulate stream done
      const streamId = getTab('tab-cache')!.activeStreamId!
      useAiStore.getState().onStreamDone('tab-cache', streamId, {
        transport: 'chat_completions',
      })

      // Clear conversation so context is the same on second call
      useAiStore.getState().clearConversation('tab-cache')

      // Reset mocks
      mockAiQueryExpand.mockClear()
      mockSemanticSearch.mockClear()
      mockSendAiChat.mockClear()

      // Second call with same message and same (empty) context — should skip aiQueryExpand (cache hit)
      useAiStore.getState().sendMessage('tab-cache', 'conn-1', 'cache test', {})

      await vi.waitFor(() => {
        expect(mockSemanticSearch).toHaveBeenCalledTimes(1)
      })

      // aiQueryExpand should NOT have been called (cache hit)
      expect(mockAiQueryExpand).not.toHaveBeenCalled()
    })

    it('cache is cleared on cleanupTab', async () => {
      useAiStore.getState().sendMessage('tab-cleanup-cache', 'conn-1', 'test', {})
      await vi.waitFor(() => {
        expect(mockAiQueryExpand).toHaveBeenCalledTimes(1)
      })

      useAiStore.getState().cleanupTab('tab-cleanup-cache')

      // Re-create the tab and send same message — should call aiQueryExpand again
      mockAiQueryExpand.mockClear()
      useAiStore.getState().sendMessage('tab-cleanup-cache', 'conn-1', 'test', {})
      await vi.waitFor(() => {
        expect(mockAiQueryExpand).toHaveBeenCalledTimes(1)
      })
    })

    it('does not cache malformed expansion fallbacks and retries expansion on the next identical prompt', async () => {
      mockAiQueryExpand.mockResolvedValueOnce({ text: '{broken json' })

      useAiStore.getState().sendMessage('tab-bad-cache', 'conn-1', 'same prompt', {})

      await vi.waitFor(() => {
        expect(mockSemanticSearch).toHaveBeenCalledTimes(1)
      })

      expect(mockSemanticSearch.mock.calls[0][1]).toEqual(['same prompt'])

      useAiStore
        .getState()
        .onStreamDone('tab-bad-cache', getTab('tab-bad-cache')!.activeStreamId!, {
          transport: 'chat_completions',
        })
      useAiStore.getState().clearConversation('tab-bad-cache')

      mockAiQueryExpand.mockClear()
      mockSemanticSearch.mockClear()

      mockAiQueryExpand.mockResolvedValueOnce({
        text: JSON.stringify({
          queries: ['better expansion'],
          hypotheticalSql: '',
          entities: [],
          joins: [],
          metrics: [],
        }),
      })

      useAiStore.getState().sendMessage('tab-bad-cache', 'conn-1', 'same prompt', {})

      await vi.waitFor(() => {
        expect(mockSemanticSearch).toHaveBeenCalledTimes(1)
      })

      expect(mockAiQueryExpand).toHaveBeenCalledTimes(1)
      expect(mockSemanticSearch.mock.calls[0][1]).toEqual(['same prompt', 'better expansion'])
    })

    it('does not cache JSON-valid but invalid-shaped expansion responses', async () => {
      mockAiQueryExpand.mockResolvedValueOnce({ text: '{}' })

      useAiStore.getState().sendMessage('tab-invalid-shape-cache', 'conn-1', 'same prompt', {})

      await vi.waitFor(() => {
        expect(mockSemanticSearch).toHaveBeenCalledTimes(1)
      })

      expect(mockSemanticSearch.mock.calls[0][1]).toEqual(['same prompt'])

      useAiStore
        .getState()
        .onStreamDone(
          'tab-invalid-shape-cache',
          getTab('tab-invalid-shape-cache')!.activeStreamId!,
          {
            transport: 'chat_completions',
          }
        )
      useAiStore.getState().clearConversation('tab-invalid-shape-cache')

      mockAiQueryExpand.mockClear()
      mockSemanticSearch.mockClear()

      mockAiQueryExpand.mockResolvedValueOnce({
        text: JSON.stringify({
          queries: ['recovered expansion'],
          hypotheticalSql: '',
          entities: [],
          joins: [],
          metrics: [],
        }),
      })

      useAiStore.getState().sendMessage('tab-invalid-shape-cache', 'conn-1', 'same prompt', {})

      await vi.waitFor(() => {
        expect(mockSemanticSearch).toHaveBeenCalledTimes(1)
      })

      expect(mockAiQueryExpand).toHaveBeenCalledTimes(1)
      expect(mockSemanticSearch.mock.calls[0][1]).toEqual(['same prompt', 'recovered expansion'])
    })

    it('treats endpoint changes as a cache miss', async () => {
      useAiStore.getState().sendMessage('tab-endpoint-cache', 'conn-1', 'cache test', {})

      await vi.waitFor(() => {
        expect(mockAiQueryExpand).toHaveBeenCalledTimes(1)
      })

      useAiStore
        .getState()
        .onStreamDone('tab-endpoint-cache', getTab('tab-endpoint-cache')!.activeStreamId!, {
          transport: 'chat_completions',
        })
      useAiStore.getState().clearConversation('tab-endpoint-cache')

      mockSettings['ai.endpoint'] = 'http://localhost:8080/v1'

      mockAiQueryExpand.mockClear()
      mockSemanticSearch.mockClear()

      useAiStore.getState().sendMessage('tab-endpoint-cache', 'conn-1', 'cache test', {})

      await vi.waitFor(() => {
        expect(mockSemanticSearch).toHaveBeenCalledTimes(1)
      })

      expect(mockAiQueryExpand).toHaveBeenCalledTimes(1)
    })
  })
})
