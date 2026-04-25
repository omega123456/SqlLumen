import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import { useAiStore } from '../../stores/ai-store'
import type { TabAiState } from '../../stores/ai-store'
import { useQueryStore } from '../../stores/query-store'
import type { TabStatus } from '../../stores/query-store'
import { useAiFeedbackStore } from '../../stores/ai-feedback-store'
import { logFrontend } from '../../lib/app-log-commands'

const defaultSettings: Record<string, string> = {
  'ai.endpoint': 'http://localhost:11434/v1',
  'ai.model': 'llama3',
  'ai.temperature': '0.3',
  'ai.maxTokens': '2048',
  'ai.enableReasoning': 'true',
  'ai.preferResponsesApi': 'false',
  'ai.embeddingModel': '',
  'ai.retrieval.hydeEnabled': 'true',
  'ai.retrieval.expansionMaxQueries': '8',
}

let mockSettings: Record<string, string> = { ...defaultSettings }
let mockPendingChanges: Record<string, string> = {}

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

const mockSearchMemories = vi.fn().mockResolvedValue([])

vi.mock('../../lib/ai-memory-commands', () => ({
  searchMemories: (...args: unknown[]) => mockSearchMemories(...args),
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
      getEffectiveSetting: (key: string) => mockPendingChanges[key] ?? mockSettings[key] ?? '',
      pendingChanges: mockPendingChanges,
      settings: mockSettings,
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
  mockPendingChanges = {}
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
  mockSearchMemories.mockResolvedValue([])

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
    if (cmd === 'search_memories') return []
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
      expect(params.preferResponsesApi).toBe(false)
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

    it('uses pending reasoning setting when building AI requests', async () => {
      mockSettings['ai.enableReasoning'] = 'true'
      mockPendingChanges['ai.enableReasoning'] = 'false'

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      const params = mockSendAiChat.mock.calls[0][0]
      expect(params.enableReasoning).toBe(false)
    })

    it('uses pending responses transport setting when building AI requests', async () => {
      mockSettings['ai.preferResponsesApi'] = 'false'
      mockPendingChanges['ai.preferResponsesApi'] = 'true'

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      const params = mockSendAiChat.mock.calls[0][0]
      expect(params.preferResponsesApi).toBe(true)
    })

    it('uses pending endpoint and model settings when building AI requests', async () => {
      mockPendingChanges['ai.endpoint'] = 'http://pending.example/v1'
      mockPendingChanges['ai.model'] = 'gemma-pending'

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      const params = mockSendAiChat.mock.calls[0][0]
      expect(params.endpoint).toBe('http://pending.example/v1')
      expect(params.model).toBe('gemma-pending')
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
        expect(tab.messages.length).toBe(3) // base system + schema context + user
      })

      const tab = getTab('tab-1')!
      expect(tab.messages[0].role).toBe('system')
      const baseSystemMessage = tab.messages.find(
        (message) => message.role === 'system' && !message.kind
      )
      const schemaContextMessage = tab.messages.find((message) => message.kind === 'schema-context')

      expect(baseSystemMessage).toBeDefined()
      expect(baseSystemMessage!.content).toContain(
        'You are an expert SQL assistant integrated into a database client'
      )
      expect(baseSystemMessage!.content).toContain(
        'additional hidden system messages containing relevant schema or SQL context'
      )
      expect(baseSystemMessage!.content).toContain('database-qualified name')
      expect(schemaContextMessage).toBeDefined()
      expect(schemaContextMessage!.content).toContain('CREATE TABLE `testdb`.`users`')
      expect(schemaContextMessage!.content).toContain('CREATE TABLE `testdb`.`users`')
      const userMessages = tab.messages.filter((message) => message.role === 'user')
      expect(userMessages).toHaveLength(1)
      expect(userMessages[0].content).toBe('First message')
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

    it('updates providedChunkKeys on the tab after retrieval', async () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'First message', {})

      await vi.waitFor(() => {
        const tab = getTab('tab-1')!
        expect(Object.keys(tab.providedChunkKeys).length).toBeGreaterThan(0)
      })

      const tab = getTab('tab-1')!
      expect(tab.providedChunkKeys['testdb.users:table']).toBe(true)
      expect(tab.cumulativeSchemaTokens).toBeGreaterThan(0)
    })

    it('deduplicates schema context on second turn with same chunk keys', async () => {
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

      useAiStore
        .getState()
        .onStreamChunk('tab-1', getTab('tab-1')!.activeStreamId!, 'Answer', 'content')
      useAiStore.getState().onStreamDone('tab-1', getTab('tab-1')!.activeStreamId!, {
        transport: 'chat_completions',
      })

      // Second turn with same results — should still search but no new schema-context
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'First message', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(2)
      })

      // Semantic search runs every turn
      expect(mockSemanticSearch).toHaveBeenCalledTimes(2)
      // Only 1 schema-context message (from first turn) — second turn's results are all dupes
      const schemaContextMessages = getTab('tab-1')!.messages.filter(
        (m) => m.kind === 'schema-context'
      )
      expect(schemaContextMessages).toHaveLength(1)
    })

    it('appends a new schema-context message when second turn retrieves different tables', async () => {
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

      useAiStore
        .getState()
        .onStreamChunk('tab-1', getTab('tab-1')!.activeStreamId!, 'Answer', 'content')
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
      // Should have 2 schema-context messages — one from each turn
      const schemaContextMessages = getTab('tab-1')!.messages.filter(
        (m) => m.kind === 'schema-context'
      )
      expect(schemaContextMessages).toHaveLength(2)
      expect(schemaContextMessages[1].content).toContain('CREATE TABLE `testdb`.`orders`')
    })

    it('appends schema-context when retrieval hints change for the same prompt', async () => {
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

      useAiStore
        .getState()
        .onStreamChunk('tab-1', getTab('tab-1')!.activeStreamId!, 'Answer', 'content')
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
      const schemaContextMessages = getTab('tab-1')!.messages.filter(
        (m) => m.kind === 'schema-context'
      )
      expect(schemaContextMessages).toHaveLength(2)
      expect(schemaContextMessages[1].content).toContain('CREATE TABLE `testdb`.`orders`')
    })

    it('always runs semantic search on each turn even across tabs', async () => {
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

      useAiStore
        .getState()
        .onStreamChunk('tab-1', getTab('tab-1')!.activeStreamId!, 'Answer', 'content')
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
      useAiStore.getState().onStreamChunk('tab-1', firstStreamId, 'Hello back', 'content')
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

    it('keeps the leading prompt prefix stable across follow-up messages with unchanged context', async () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      const firstMessages = mockSendAiChat.mock.calls[0][0].messages as Array<{
        role: string
        content: string
      }>

      const firstStreamId = getTab('tab-1')!.activeStreamId!
      useAiStore.getState().onStreamChunk('tab-1', firstStreamId, 'Hello back', 'content')
      useAiStore.getState().onStreamDone('tab-1', firstStreamId, {
        responseId: 'resp_cache',
        transport: 'responses',
      })

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Follow up', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(2)
      })

      const secondMessages = mockSendAiChat.mock.calls[1][0].messages as Array<{
        role: string
        content: string
      }>

      expect(secondMessages.slice(0, firstMessages.length)).toEqual(firstMessages)
      expect(secondMessages[secondMessages.length - 1]).toEqual({
        role: 'user',
        content: 'Follow up',
      })
      expect(mockSendAiChat.mock.calls[1][0].previousResponseId).toBe('resp_cache')
    })

    it('reuses previousResponseId when new schema context is appended (cumulative model)', async () => {
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

      useAiStore
        .getState()
        .onStreamChunk('tab-1', getTab('tab-1')!.activeStreamId!, 'Hello back', 'content')
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
      // With cumulative schema context, response chain IS reused (only append, no mutation)
      expect(mockSendAiChat.mock.calls[1][0].previousResponseId).toBe('resp_abc')
    })

    it('does not reuse previousResponseId when the model changes', async () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      useAiStore
        .getState()
        .onStreamChunk('tab-1', getTab('tab-1')!.activeStreamId!, 'Hello back', 'content')
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

      useAiStore
        .getState()
        .onStreamChunk('tab-1', getTab('tab-1')!.activeStreamId!, 'Hello back', 'content')
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

      useAiStore
        .getState()
        .onStreamChunk('tab-1', getTab('tab-1')!.activeStreamId!, 'Hello back', 'content')
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

    it('system prompt is immutable — same content on turn 1 and turn 2', async () => {
      // First message
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'First', {})
      await vi.waitFor(() => {
        expect(getTab('tab-1')!.messages.length).toBe(3) // base system + schema context + user
      })

      // Second message — system message should never be modified after first turn
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Second', {})
      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(2)
      })

      const tab = getTab('tab-1')!
      const systemMessages = tab.messages.filter((m) => m.role === 'system' && !m.kind)
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
      const baseSystemMessage = tab.messages.find(
        (message) => message.role === 'system' && !message.kind
      )
      expect(baseSystemMessage).toBeDefined()
      expect(baseSystemMessage!.content).toContain(
        'You are an expert SQL assistant integrated into a database client'
      )
      // No schema DDL section
      expect(baseSystemMessage!.content).not.toContain('Database schema:')
      expect(tab.messages[1].role).toBe('user')
    })

    it('preserves old schema context and reuses response chain when follow-up retrieval returns empty', async () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      const firstStreamId = getTab('tab-1')!.activeStreamId!
      useAiStore.getState().onStreamChunk('tab-1', firstStreamId, 'Hello back', 'content')
      useAiStore.getState().onStreamDone('tab-1', firstStreamId, {
        responseId: 'resp_schema_clear',
        transport: 'responses',
      })

      mockSemanticSearch.mockResolvedValueOnce([])

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Unrelated follow up', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(2)
      })

      const secondMessages = mockSendAiChat.mock.calls[1][0].messages as Array<{
        role: string
        content: string
      }>

      // Old schema context from turn 1 is preserved (cumulative)
      expect(
        secondMessages.some((message) => message.content.includes('CREATE TABLE `testdb`.`users`'))
      ).toBe(true)
      // Response chain is reused since messages are only appended
      expect(mockSendAiChat.mock.calls[1][0].previousResponseId).toBe('resp_schema_clear')
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
        onChunk: (content: string, kind: string) => void
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
      capturedCallbacks!.onChunk('Hello ', 'content')
      capturedCallbacks!.onChunk('world!', 'content')

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
        onChunk: (content: string, kind: string) => void
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
      capturedCallbacks!.onChunk('Token1 ', 'content')
      capturedCallbacks!.onChunk('Token2 ', 'content')
      capturedCallbacks!.onChunk('Token3', 'content')

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
      // Should have: base system, schema context, attached context, user messages
      const contextMsg = params.messages.find(
        (m: { role: string; content: string }) =>
          m.role === 'system' && m.content.includes('SELECT * FROM users WHERE id = 1')
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

    it('clearing attached context removes hidden attached-context prompt messages and resets reuse', async () => {
      const context = {
        sql: 'SELECT * FROM users',
        range: { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 20 },
      }
      useAiStore.getState().setAttachedContext('tab-1', context)

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Explain this query', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      const firstStreamId = getTab('tab-1')!.activeStreamId!
      useAiStore.getState().onStreamChunk('tab-1', firstStreamId, 'Sure', 'content')
      useAiStore.getState().onStreamDone('tab-1', firstStreamId, {
        responseId: 'resp_attached_clear',
        transport: 'responses',
      })

      useAiStore.getState().clearAttachedContext('tab-1')
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Follow up', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(2)
      })

      const secondMessages = mockSendAiChat.mock.calls[1][0].messages as Array<{
        role: string
        content: string
      }>

      expect(
        secondMessages.some((message) =>
          message.content.includes('The following SQL statement is the context')
        )
      ).toBe(false)
      expect(mockSendAiChat.mock.calls[1][0].previousResponseId).toBeNull()
    })

    it('does not inject context message when no context is attached', async () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'General question', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      const params = mockSendAiChat.mock.calls[0][0]
      const contextMsg = params.messages.find(
        (m: { role: string; content: string }) =>
          m.role === 'system' && m.content.includes('The following SQL statement is the context')
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
      expect(tab.messages.find((message) => message.kind === 'schema-context')).toBeUndefined()
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
      useAiStore
        .getState()
        .onStreamChunk('tab-1', getTab('tab-1')!.activeStreamId!, 'Response', 'content')
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
      useAiStore.getState().onStreamChunk('tab-1', streamId, 'Hello', 'content')
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
      useAiStore.getState().onStreamChunk('tab-1', streamId, 'Hello', 'content')
      useAiStore.getState().onStreamChunk('tab-1', streamId, ' world', 'content')
      const tab = getTab('tab-1')!
      const assistantMsgs = tab.messages.filter((m) => m.role === 'assistant')
      expect(assistantMsgs).toHaveLength(1)
      expect(assistantMsgs[0].content).toBe('Hello world')
    })

    it('creates new assistant message after a user message', () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hi', {})
      const streamId = getTab('tab-1')!.activeStreamId!
      useAiStore.getState().onStreamChunk('tab-1', streamId, 'Response', 'content')
      const tab = getTab('tab-1')!
      const userMsg = tab.messages.find((m) => m.role === 'user')
      const assistantMsg = tab.messages.find((m) => m.role === 'assistant')
      expect(userMsg).toBeDefined()
      expect(assistantMsg).toBeDefined()
      expect(assistantMsg!.content).toBe('Response')
    })

    it('ignores chunks with a stale streamId', () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hi', {})
      useAiStore
        .getState()
        .onStreamChunk('tab-1', 'stale-stream-id', 'Should be ignored', 'content')
      const tab = getTab('tab-1')!
      const assistantMsg = tab.messages.find((m) => m.role === 'assistant')
      expect(assistantMsg).toBeUndefined()
    })

    it('ignores chunks for non-existent tab', () => {
      // Should not throw
      useAiStore.getState().onStreamChunk('nonexistent', 'stream-1', 'chunk', 'content')
      expect(getTab('nonexistent')).toBeUndefined()
    })

    it('routes thinking chunks to thinkingContent, not content', () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hi', {})
      const streamId = getTab('tab-1')!.activeStreamId!
      useAiStore.getState().onStreamChunk('tab-1', streamId, 'reasoning...', 'thinking')
      const tab = getTab('tab-1')!
      const assistantMsg = tab.messages.find((m) => m.role === 'assistant')
      expect(assistantMsg).toBeDefined()
      expect(assistantMsg!.thinkingContent).toBe('reasoning...')
      expect(assistantMsg!.content).toBe('')
    })

    it('appends thinking chunks to thinkingContent without affecting content', () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hi', {})
      const streamId = getTab('tab-1')!.activeStreamId!
      useAiStore.getState().onStreamChunk('tab-1', streamId, 'think1', 'thinking')
      useAiStore.getState().onStreamChunk('tab-1', streamId, 'think2', 'thinking')
      useAiStore.getState().onStreamChunk('tab-1', streamId, 'visible', 'content')
      const tab = getTab('tab-1')!
      const assistantMsg = tab.messages.find((m) => m.role === 'assistant')
      expect(assistantMsg!.thinkingContent).toBe('think1think2')
      expect(assistantMsg!.content).toBe('visible')
    })

    it('content chunks do not affect thinkingContent', () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hi', {})
      const streamId = getTab('tab-1')!.activeStreamId!
      useAiStore.getState().onStreamChunk('tab-1', streamId, 'hello', 'content')
      useAiStore.getState().onStreamChunk('tab-1', streamId, ' world', 'content')
      const tab = getTab('tab-1')!
      const assistantMsg = tab.messages.find((m) => m.role === 'assistant')
      expect(assistantMsg!.content).toBe('hello world')
      expect(assistantMsg!.thinkingContent).toBeUndefined()
    })

    it('thinking chunk before any content creates assistant message with empty content and non-empty thinkingContent', () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hi', {})
      const streamId = getTab('tab-1')!.activeStreamId!
      useAiStore.getState().onStreamChunk('tab-1', streamId, 'let me think', 'thinking')
      const tab = getTab('tab-1')!
      const assistantMsg = tab.messages.find((m) => m.role === 'assistant')
      expect(assistantMsg).toBeDefined()
      expect(assistantMsg!.content).toBe('')
      expect(assistantMsg!.thinkingContent).toBe('let me think')
    })
  })

  describe('onStreamDone', () => {
    it('sets isGenerating to false and clears activeStreamId', () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hi', {})
      const streamId = getTab('tab-1')!.activeStreamId!
      useAiStore.getState().onStreamChunk('tab-1', streamId, 'chunk', 'content')
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

      useAiStore.getState().onStreamChunk('tab-1', streamId, 'Answer', 'content')

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

      useAiStore.getState().onStreamChunk('tab-1', firstStreamId, 'Answer', 'content')
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
      useAiStore.getState().onStreamChunk('tab-1', streamId, 'chunk', 'content')
      useAiStore.getState().onStreamError('tab-1', streamId, 'Connection failed')
      const tab = getTab('tab-1')!
      expect(tab.isGenerating).toBe(false)
      expect(tab.error).toBe('Connection failed')
      expect(tab.activeStreamId).toBeNull()
    })

    it('clears previousResponseId on stream error', () => {
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hi', {})
      useAiStore
        .getState()
        .onStreamChunk('tab-1', getTab('tab-1')!.activeStreamId!, 'Answer', 'content')
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

    it('restores tab status and logs when active stream cancel fails', async () => {
      mockCancelAiStream.mockRejectedValueOnce(new Error('cancel failed'))
      useQueryStore.getState().setContent('tab-1', 'SELECT 1')
      useQueryStore.getState().setTabStatus('tab-1', 'running')
      useAiStore.getState().setAiReviewing('tab-1')

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})
      useAiStore.getState().clearConversation('tab-1')
      await Promise.resolve()

      expect(mockCancelAiStream).toHaveBeenCalledTimes(1)
      expect(logFrontend).toHaveBeenCalledWith(
        'warn',
        expect.stringContaining('AI cancel during clearConversation failed:')
      )
      expect(useQueryStore.getState().tabs['tab-1']?.tabStatus).toBe('running')
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
          m.role === 'system' && m.content.includes('The following SQL statement is the context')
      )
      expect(contextMsg).toBeDefined()
      expect(contextMsg.content).toContain('SELECT id, name FROM users WHERE active = 1')
      expect(contextMsg.content).not.toContain('SELECT * FROM users')
    })

    it('uses the current attached context SQL when sending a message', async () => {
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
          m.role === 'system' && m.content.includes('The following SQL statement is the context')
      )
      expect(contextMsg).toBeDefined()
      expect(contextMsg.content).toContain('SELECT * FROM users')
    })

    it('reuses the same attached-context prompt prefix on follow-up messages until the context changes', async () => {
      const range = { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 20 }
      useAiStore.getState().setAttachedContext('tab-1', {
        sql: 'SELECT * FROM users',
        range,
      })

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Explain this query', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      const firstMessages = mockSendAiChat.mock.calls[0][0].messages as Array<{
        role: string
        content: string
      }>

      const firstStreamId = getTab('tab-1')!.activeStreamId!
      useAiStore.getState().onStreamChunk('tab-1', firstStreamId, 'Sure', 'content')
      useAiStore.getState().onStreamDone('tab-1', firstStreamId, {
        responseId: 'resp_attached',
        transport: 'responses',
      })

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Add an ORDER BY', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(2)
      })

      const secondMessages = mockSendAiChat.mock.calls[1][0].messages as Array<{
        role: string
        content: string
      }>
      expect(secondMessages.slice(0, firstMessages.length)).toEqual(firstMessages)

      const attachedContextMessages = secondMessages.filter(
        (message) =>
          message.role === 'system' &&
          message.content.includes('The following SQL statement is the context')
      )
      expect(attachedContextMessages).toHaveLength(1)
      expect(attachedContextMessages[0].content).toContain('SELECT * FROM users')
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
    it('formats DDL as raw DDL without per-chunk headers or scores', async () => {
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
        const schemaMsg = getTab('tab-hdr')?.messages.find((m) => m.kind === 'schema-context')
        expect(schemaMsg).toBeDefined()
      })

      const schemaMsg = getTab('tab-hdr')!.messages.find((m) => m.kind === 'schema-context')!
      // Raw DDL only — no headers, no scores, no "Database schema:" wrapper
      expect(schemaMsg.content).not.toContain('## Table')
      expect(schemaMsg.content).not.toContain('## View')
      expect(schemaMsg.content).not.toContain('score:')
      expect(schemaMsg.content).not.toContain('Database schema:')
      expect(schemaMsg.content).toContain('CREATE TABLE `testdb`.`users` (id INT);')
      expect(schemaMsg.content).toContain('CREATE VIEW orders_view AS SELECT 1;')
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
        const schemaMsg = getTab('tab-budget')?.messages.find((m) => m.kind === 'schema-context')
        expect(schemaMsg).toBeDefined()
      })

      const ddl = getTab('tab-budget')!.messages.find((m) => m.kind === 'schema-context')!.content
      expect(ddl).toContain('X')
      // Both chunks should be present (both fit in budget)
      const parts = ddl.split('\n\n')
      expect(parts.length).toBeGreaterThanOrEqual(2)
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
        const schemaMsg = getTab('tab-sort')?.messages.find((m) => m.kind === 'schema-context')
        expect(schemaMsg).toBeDefined()
      })

      const ddl = getTab('tab-sort')!.messages.find((m) => m.kind === 'schema-context')!.content
      const tableIdx = ddl.indexOf('TABLE users')
      const viewIdx = ddl.indexOf('VIEW vw')
      const procIdx = ddl.indexOf('PROCEDURE proc1')

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
      useAiStore.getState().onStreamChunk('tab-ctx', streamId, 'Hi there!', 'content')
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

  describe('memory retrieval integration', () => {
    it('calls searchMemories before query expansion', async () => {
      mockSearchMemories.mockResolvedValueOnce([
        {
          id: 1,
          connectionId: 'conn-1',
          content: 'Users table has email column',
          createdAt: 1000,
          source: 'manual',
        },
      ])

      useAiStore.getState().sendMessage('tab-mem', 'conn-1', 'Show users', {})

      await vi.waitFor(() => {
        expect(mockSearchMemories).toHaveBeenCalledTimes(1)
      })

      expect(mockSearchMemories).toHaveBeenCalledWith({
        sessionId: 'conn-1',
        query: 'Show users',
        k: 5,
      })

      await vi.waitFor(() => {
        expect(mockAiQueryExpand).toHaveBeenCalledTimes(1)
      })

      // Memory should be called before expansion
      const memoryCallOrder = mockSearchMemories.mock.invocationCallOrder[0]
      const expandCallOrder = mockAiQueryExpand.mock.invocationCallOrder[0]
      expect(memoryCallOrder).toBeLessThan(expandCallOrder)
    })

    it('includes memory content in a separate memory-context message', async () => {
      mockSearchMemories.mockResolvedValueOnce([
        {
          id: 1,
          connectionId: 'conn-1',
          content: 'The users table stores customer data',
          createdAt: 1000,
          source: 'manual',
        },
        {
          id: 2,
          connectionId: 'conn-1',
          content: 'Orders use soft deletes',
          createdAt: 2000,
          source: 'manual',
        },
      ])

      useAiStore.getState().sendMessage('tab-mem-prompt', 'conn-1', 'Show users', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      const tab = getTab('tab-mem-prompt')!
      const memMsg = tab.messages.find((m) => m.kind === 'memory-context')
      expect(memMsg).toBeDefined()
      expect(memMsg!.content).toContain('## User Notes (from memory)')
      expect(memMsg!.content).toContain('- The users table stores customer data')
      expect(memMsg!.content).toContain('- Orders use soft deletes')
      // Base system prompt should NOT contain memory
      const baseSystem = tab.messages.find((m) => m.role === 'system' && !m.kind)
      expect(baseSystem!.content).not.toContain('User Notes')
    })

    it('schema-context appears before memory-context in message list', async () => {
      mockSearchMemories.mockResolvedValueOnce([
        {
          id: 1,
          connectionId: 'conn-1',
          content: 'Note about users',
          createdAt: 1000,
          source: 'manual',
        },
      ])

      useAiStore.getState().sendMessage('tab-mem-order', 'conn-1', 'Show users', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      const tab = getTab('tab-mem-order')!
      const schemaContext = tab.messages.find((m) => m.kind === 'schema-context')!
      const memContext = tab.messages.find((m) => m.kind === 'memory-context')!
      expect(schemaContext.content).toContain('CREATE TABLE')
      expect(memContext.content).toContain('User Notes')
      expect(tab.messages.indexOf(schemaContext)).toBeLessThan(tab.messages.indexOf(memContext))
    })

    it('failed memory retrieval does not prevent message sending', async () => {
      mockSearchMemories.mockRejectedValueOnce(new Error('Memory search failed'))

      useAiStore.getState().sendMessage('tab-mem-fail', 'conn-1', 'Show users', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      // Should still work, just without memory-context
      const tab = getTab('tab-mem-fail')!
      const memMsg = tab.messages.find((m) => m.kind === 'memory-context')
      expect(memMsg).toBeUndefined()
    })

    it('no memory-context message when no memories exist', async () => {
      mockSearchMemories.mockResolvedValueOnce([])

      useAiStore.getState().sendMessage('tab-mem-empty', 'conn-1', 'Show users', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      const tab = getTab('tab-mem-empty')!
      const memMsg = tab.messages.find((m) => m.kind === 'memory-context')
      expect(memMsg).toBeUndefined()
    })

    it('memory content is in memory-context message, not in schema-context', async () => {
      mockSearchMemories.mockResolvedValueOnce([
        {
          id: 1,
          connectionId: 'conn-1',
          content: 'Important note',
          createdAt: 1000,
          source: 'manual',
        },
      ])

      useAiStore.getState().sendMessage('tab-mem-cache', 'conn-1', 'Show users', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      const tab = getTab('tab-mem-cache')!
      const schemaMsg = tab.messages.find((m) => m.kind === 'schema-context')
      if (schemaMsg) {
        expect(schemaMsg.content).not.toContain('User Notes')
        expect(schemaMsg.content).not.toContain('Important note')
      }
      const memMsg = tab.messages.find((m) => m.kind === 'memory-context')
      expect(memMsg).toBeDefined()
      expect(memMsg!.content).toContain('Important note')
    })

    it('augments query expansion context with memory content', async () => {
      mockSearchMemories.mockResolvedValueOnce([
        {
          id: 1,
          connectionId: 'conn-1',
          content: 'Customers are in the crm database',
          createdAt: 1000,
          source: 'manual',
        },
      ])

      useAiStore.getState().sendMessage('tab-mem-expand', 'conn-1', 'Show customers', {})

      await vi.waitFor(() => {
        expect(mockAiQueryExpand).toHaveBeenCalledTimes(1)
      })

      const expandCall = mockAiQueryExpand.mock.calls[0][0]
      expect(expandCall.conversationContext).toContain('User notes:')
      expect(expandCall.conversationContext).toContain('Customers are in the crm database')
    })
  })

  describe('cross-turn cumulative token budget enforcement', () => {
    it('stops appending schema-context once cumulative budget is exhausted across turns', async () => {
      const largeDdl = 'X'.repeat(50000) // ~12500 tokens per chunk

      mockSemanticSearch.mockResolvedValueOnce([
        {
          chunkId: 1,
          chunkKey: 'db.a:table',
          dbName: 'db',
          tableName: 'a',
          chunkType: 'table',
          ddlText: largeDdl,
          refDbName: null,
          refTableName: null,
          score: 0.9,
        },
      ])

      useAiStore.getState().sendMessage('tab-cum', 'conn-1', 'Turn 1', {})
      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      const tab1 = getTab('tab-cum')!
      expect(tab1.cumulativeSchemaTokens).toBeGreaterThan(0)
      expect(tab1.messages.filter((m) => m.kind === 'schema-context')).toHaveLength(1)

      useAiStore.getState().onStreamChunk('tab-cum', tab1.activeStreamId!, 'Answer', 'content')
      useAiStore.getState().onStreamDone('tab-cum', tab1.activeStreamId!, {
        transport: 'chat_completions',
      })

      mockSemanticSearch.mockResolvedValueOnce([
        {
          chunkId: 2,
          chunkKey: 'db.b:table',
          dbName: 'db',
          tableName: 'b',
          chunkType: 'table',
          ddlText: largeDdl,
          refDbName: null,
          refTableName: null,
          score: 0.85,
        },
      ])

      useAiStore.getState().sendMessage('tab-cum', 'conn-1', 'Turn 2', {})
      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(2)
      })

      useAiStore
        .getState()
        .onStreamChunk('tab-cum', getTab('tab-cum')!.activeStreamId!, 'Answer', 'content')
      useAiStore.getState().onStreamDone('tab-cum', getTab('tab-cum')!.activeStreamId!, {
        transport: 'chat_completions',
      })

      mockSemanticSearch.mockResolvedValueOnce([
        {
          chunkId: 3,
          chunkKey: 'db.c:table',
          dbName: 'db',
          tableName: 'c',
          chunkType: 'table',
          ddlText: largeDdl,
          refDbName: null,
          refTableName: null,
          score: 0.8,
        },
      ])

      useAiStore.getState().sendMessage('tab-cum', 'conn-1', 'Turn 3', {})
      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(3)
      })

      const tabFinal = getTab('tab-cum')!
      const allSchemaContexts = tabFinal.messages.filter((m) => m.kind === 'schema-context')
      expect(allSchemaContexts.length).toBeLessThanOrEqual(2)
      expect(tabFinal.cumulativeSchemaTokens).toBeLessThanOrEqual(30000)
    })
  })

  describe('clearConversation resets all dedup indices', () => {
    it('resets providedChunkKeys, providedMemoryIds, and cumulativeSchemaTokens', async () => {
      mockSearchMemories.mockResolvedValueOnce([
        {
          id: 1,
          connectionId: 'conn-1',
          content: 'A memory',
          createdAt: 1000,
          source: 'manual',
        },
      ])

      useAiStore.getState().sendMessage('tab-clr', 'conn-1', 'Hello', {})
      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      const tabBefore = getTab('tab-clr')!
      expect(Object.keys(tabBefore.providedChunkKeys).length).toBeGreaterThan(0)
      expect(tabBefore.cumulativeSchemaTokens).toBeGreaterThan(0)
      expect(Object.keys(tabBefore.providedMemoryIds).length).toBeGreaterThan(0)

      useAiStore.getState().clearConversation('tab-clr')

      const tabAfter = getTab('tab-clr')!
      expect(tabAfter.providedChunkKeys).toEqual({})
      expect(tabAfter.providedMemoryIds).toEqual({})
      expect(tabAfter.cumulativeSchemaTokens).toBe(0)
    })
  })

  describe('retryLastMessage removes contiguous context and adjusts dedup indices', () => {
    it('removes turn 2 context and preserves turn 1 indices', async () => {
      mockSearchMemories.mockResolvedValueOnce([
        {
          id: 1,
          connectionId: 'conn-1',
          content: 'Memory turn 1',
          createdAt: 1000,
          source: 'manual',
        },
      ])
      mockSemanticSearch.mockResolvedValueOnce([
        {
          chunkId: 1,
          chunkKey: 'db.t1:table',
          dbName: 'db',
          tableName: 't1',
          chunkType: 'table',
          ddlText: 'CREATE TABLE t1 (id INT);',
          refDbName: null,
          refTableName: null,
          score: 0.9,
        },
      ])

      useAiStore.getState().sendMessage('tab-retry2', 'conn-1', 'Turn 1', {})
      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      useAiStore
        .getState()
        .onStreamChunk('tab-retry2', getTab('tab-retry2')!.activeStreamId!, 'A1', 'content')
      useAiStore.getState().onStreamDone('tab-retry2', getTab('tab-retry2')!.activeStreamId!, {
        transport: 'chat_completions',
      })

      const tokenAfterTurn1 = getTab('tab-retry2')!.cumulativeSchemaTokens
      expect(tokenAfterTurn1).toBeGreaterThan(0)

      mockSearchMemories.mockResolvedValueOnce([
        {
          id: 2,
          connectionId: 'conn-1',
          content: 'Memory turn 2',
          createdAt: 2000,
          source: 'manual',
        },
      ])
      mockSemanticSearch.mockResolvedValueOnce([
        {
          chunkId: 2,
          chunkKey: 'db.t2:table',
          dbName: 'db',
          tableName: 't2',
          chunkType: 'table',
          ddlText: 'CREATE TABLE t2 (id INT);',
          refDbName: null,
          refTableName: null,
          score: 0.85,
        },
      ])

      useAiStore.getState().sendMessage('tab-retry2', 'conn-1', 'Turn 2', {})
      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(2)
      })

      const tabBefore = getTab('tab-retry2')!
      expect(tabBefore.providedChunkKeys['db.t2:table']).toBe(true)
      expect(tabBefore.providedMemoryIds['2']).toBe(true)
      const tokenAfterTurn2 = tabBefore.cumulativeSchemaTokens
      expect(tokenAfterTurn2).toBeGreaterThan(tokenAfterTurn1)

      // Mock empty results for the retry's sendMessage call so no new context is added
      mockSemanticSearch.mockResolvedValueOnce([])
      mockSearchMemories.mockResolvedValueOnce([])

      useAiStore.getState().retryLastMessage('tab-retry2', 'conn-1', {})
      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(3)
      })

      const tabAfter = getTab('tab-retry2')!

      // === Turn-1 keys/IDs still present ===
      expect(tabAfter.providedChunkKeys['db.t1:table']).toBe(true)
      expect(tabAfter.providedMemoryIds['1']).toBe(true)

      // === Turn-2 chunk keys ABSENT from providedChunkKeys ===
      expect(tabAfter.providedChunkKeys['db.t2:table']).toBeUndefined()

      // === Turn-2 memory IDs ABSENT from providedMemoryIds ===
      expect(tabAfter.providedMemoryIds['2']).toBeUndefined()

      // Verify via the messages sent to sendAiChat on call 3 (the retry)
      const retryParams = mockSendAiChat.mock.calls[2][0]
      const retryMessages = retryParams.messages as Array<{
        role: string
        content: string
      }>

      // Messages before the retry's user message should not contain turn-2 context
      const lastUserIdx = retryMessages.map((m) => m.role).lastIndexOf('user')
      const historyBeforeRetryUser = retryMessages.slice(0, lastUserIdx)

      // === Turn-2 schema-context message ABSENT ===
      const turn2SchemaInHistory = historyBeforeRetryUser.filter((m) =>
        m.content.includes('CREATE TABLE t2')
      )
      expect(turn2SchemaInHistory).toHaveLength(0)

      // === Turn-2 memory-context message ABSENT ===
      const turn2MemoryInHistory = historyBeforeRetryUser.filter((m) =>
        m.content.includes('Memory turn 2')
      )
      expect(turn2MemoryInHistory).toHaveLength(0)

      // === Turn-1 context still present in history ===
      const turn1SchemaInHistory = historyBeforeRetryUser.filter((m) =>
        m.content.includes('CREATE TABLE t1')
      )
      expect(turn1SchemaInHistory.length).toBeGreaterThan(0)

      const turn1MemoryInHistory = historyBeforeRetryUser.filter((m) =>
        m.content.includes('Memory turn 1')
      )
      expect(turn1MemoryInHistory.length).toBeGreaterThan(0)
      expect(turn1MemoryInHistory.length).toBeGreaterThan(0)

      // === cumulativeSchemaTokens dropped from turn-2 level ===
      // After rollback (before retry re-adds), tokens should equal turn-1 level.
      // === cumulativeSchemaTokens dropped after rollback ===
      // With empty semantic search results for the retry, no new schema tokens are added,
      // so cumulativeSchemaTokens should be back to turn-1 level (less than after turn 2).
      expect(tabAfter.cumulativeSchemaTokens).toBeLessThan(tokenAfterTurn2)
    })
  })

  describe('memory-context append-only with ID-based dedup', () => {
    it('deduplicates memories by ID across turns and only appends novel ones', async () => {
      const memories = [
        { id: 1, connectionId: 'conn-1', content: 'Note 1', createdAt: 1000, source: 'manual' },
        { id: 2, connectionId: 'conn-1', content: 'Note 2', createdAt: 2000, source: 'manual' },
        { id: 3, connectionId: 'conn-1', content: 'Note 3', createdAt: 3000, source: 'manual' },
      ]

      mockSearchMemories.mockResolvedValueOnce(memories)
      useAiStore.getState().sendMessage('tab-md', 'conn-1', 'Turn 1', {})
      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      useAiStore
        .getState()
        .onStreamChunk('tab-md', getTab('tab-md')!.activeStreamId!, 'A1', 'content')
      useAiStore.getState().onStreamDone('tab-md', getTab('tab-md')!.activeStreamId!, {
        transport: 'chat_completions',
      })

      const mc1 = getTab('tab-md')!.messages.filter((m) => m.kind === 'memory-context')
      expect(mc1).toHaveLength(1)
      expect(mc1[0].memoryIds).toEqual([1, 2, 3])

      // Turn 2: same IDs — no new memory-context
      mockSearchMemories.mockResolvedValueOnce(memories)
      useAiStore.getState().sendMessage('tab-md', 'conn-1', 'Turn 2', {})
      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(2)
      })

      expect(getTab('tab-md')!.messages.filter((m) => m.kind === 'memory-context')).toHaveLength(1)

      useAiStore
        .getState()
        .onStreamChunk('tab-md', getTab('tab-md')!.activeStreamId!, 'A2', 'content')
      useAiStore.getState().onStreamDone('tab-md', getTab('tab-md')!.activeStreamId!, {
        transport: 'chat_completions',
      })

      // Turn 3: novel ID 4
      mockSearchMemories.mockResolvedValueOnce([
        ...memories,
        { id: 4, connectionId: 'conn-1', content: 'Note 4', createdAt: 4000, source: 'manual' },
      ])
      useAiStore.getState().sendMessage('tab-md', 'conn-1', 'Turn 3', {})
      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(3)
      })

      const mc3 = getTab('tab-md')!.messages.filter((m) => m.kind === 'memory-context')
      expect(mc3).toHaveLength(2)
      expect(mc3[1].memoryIds).toEqual([4])
    })
  })

  describe('chat-completions prompt prefix stability', () => {
    /**
     * Helper: complete the current stream for a tab using chat_completions transport.
     */
    function completeCurrentStream(
      tabId: string,
      content = 'Answer',
      transport: 'chat_completions' | 'responses' = 'chat_completions'
    ): void {
      const tab = getTab(tabId)!
      const streamId = tab.activeStreamId!
      useAiStore.getState().onStreamChunk(tabId, streamId, content, 'content')
      useAiStore.getState().onStreamDone(tabId, streamId, { transport })
    }

    it('preserves first request as exact prefix when second turn has unchanged retrieval', async () => {
      mockIndexStatus = {
        status: 'ready',
        tablesDone: 1,
        tablesTotal: 1,
        lastBuildTimestamp: 1234,
      }

      // ── Turn 1 ──
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      const firstMessages = mockSendAiChat.mock.calls[0][0].messages as Array<{
        role: string
        content: string
      }>

      completeCurrentStream('tab-1', 'First answer')

      // ── Turn 2: same chunk key returned by semantic search ──
      // Default mock already returns testdb.users:table (same as turn 1)
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Follow up', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(2)
      })

      const secondMessages = mockSendAiChat.mock.calls[1][0].messages as Array<{
        role: string
        content: string
      }>

      // The first request's messages must be an exact prefix of the second request
      expect(secondMessages.slice(0, firstMessages.length)).toEqual(firstMessages)

      // No new schema-context message should be added (dedup — same chunk key)
      const schemaContextMessages = getTab('tab-1')!.messages.filter(
        (m) => m.kind === 'schema-context'
      )
      expect(schemaContextMessages).toHaveLength(1)

      // After the prefix: assistant message, then new user message
      expect(secondMessages[firstMessages.length]).toEqual({
        role: 'assistant',
        content: 'First answer',
      })
      expect(secondMessages[secondMessages.length - 1]).toEqual({
        role: 'user',
        content: 'Follow up',
      })
    })

    it('preserves first request as exact prefix when second turn retrieves a new schema chunk', async () => {
      mockIndexStatus = {
        status: 'ready',
        tablesDone: 1,
        tablesTotal: 1,
        lastBuildTimestamp: 1234,
      }

      // ── Turn 1 ──
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      const firstMessages = mockSendAiChat.mock.calls[0][0].messages as Array<{
        role: string
        content: string
      }>

      completeCurrentStream('tab-1', 'First answer')

      // ── Turn 2: different chunk key ──
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

      const secondMessages = mockSendAiChat.mock.calls[1][0].messages as Array<{
        role: string
        content: string
      }>

      // First request messages must be an exact prefix of the second request
      expect(secondMessages.slice(0, firstMessages.length)).toEqual(firstMessages)

      // After the prefix: assistant message at index firstMessages.length
      expect(secondMessages[firstMessages.length]).toEqual({
        role: 'assistant',
        content: 'First answer',
      })

      // New orders schema-context message appears after the assistant and before the second user message
      const afterPrefix = secondMessages.slice(firstMessages.length)
      const ordersContextIdx = afterPrefix.findIndex(
        (m) => m.role === 'system' && m.content.includes('CREATE TABLE `testdb`.`orders`')
      )
      expect(ordersContextIdx).toBeGreaterThan(0) // after assistant

      // The final message is the second user message
      expect(secondMessages[secondMessages.length - 1]).toEqual({
        role: 'user',
        content: 'Show me orders',
      })

      // The old users schema-context content is still present and unchanged
      expect(secondMessages.some((m) => m.content.includes('CREATE TABLE `testdb`.`users`'))).toBe(
        true
      )
    })

    it('preserves first request as exact prefix when second turn appends novel memory context', async () => {
      mockIndexStatus = {
        status: 'ready',
        tablesDone: 1,
        tablesTotal: 1,
        lastBuildTimestamp: 1234,
      }

      // ── Turn 1: no memories ──
      mockSearchMemories.mockResolvedValueOnce([])
      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Hello', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      const firstMessages = mockSendAiChat.mock.calls[0][0].messages as Array<{
        role: string
        content: string
      }>

      completeCurrentStream('tab-1', 'First answer')

      // ── Turn 2: novel memory returned ──
      mockSearchMemories.mockResolvedValueOnce([
        {
          id: 99,
          connectionId: 'conn-1',
          content: 'The users table stores customer data',
          createdAt: 1000,
          source: 'manual',
        },
      ])

      useAiStore.getState().sendMessage('tab-1', 'conn-1', 'Follow up', {})

      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(2)
      })

      const secondMessages = mockSendAiChat.mock.calls[1][0].messages as Array<{
        role: string
        content: string
      }>

      // First request messages must be an exact prefix of the second request
      expect(secondMessages.slice(0, firstMessages.length)).toEqual(firstMessages)

      // Memory-context message appears after the assistant ('First answer') and before the second user message
      const afterPrefix = secondMessages.slice(firstMessages.length)
      const assistantIdx = afterPrefix.findIndex(
        (m) => m.role === 'assistant' && m.content === 'First answer'
      )
      const memoryIdx = afterPrefix.findIndex(
        (m) => m.role === 'system' && m.content.includes('User Notes')
      )
      const userIdx = afterPrefix.findIndex((m) => m.role === 'user' && m.content === 'Follow up')

      expect(assistantIdx).toBeGreaterThanOrEqual(0)
      expect(memoryIdx).toBeGreaterThan(assistantIdx)
      expect(userIdx).toBeGreaterThan(memoryIdx)
    })
  })

  describe('system prompt immutability across turns', () => {
    it('system prompt is byte-for-byte identical and never duplicated across 3 turns', async () => {
      useAiStore.getState().sendMessage('tab-spi', 'conn-1', 'Turn 1', {})
      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(1)
      })

      const sysContent = getTab('tab-spi')!.messages.filter((m) => m.role === 'system' && !m.kind)
      expect(sysContent).toHaveLength(1)
      const content1 = sysContent[0].content

      useAiStore
        .getState()
        .onStreamChunk('tab-spi', getTab('tab-spi')!.activeStreamId!, 'A', 'content')
      useAiStore.getState().onStreamDone('tab-spi', getTab('tab-spi')!.activeStreamId!, {
        transport: 'chat_completions',
      })

      useAiStore.getState().sendMessage('tab-spi', 'conn-1', 'Turn 2', {})
      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(2)
      })

      const sys2 = getTab('tab-spi')!.messages.filter((m) => m.role === 'system' && !m.kind)
      expect(sys2).toHaveLength(1)
      expect(sys2[0].content).toBe(content1)

      useAiStore
        .getState()
        .onStreamChunk('tab-spi', getTab('tab-spi')!.activeStreamId!, 'B', 'content')
      useAiStore.getState().onStreamDone('tab-spi', getTab('tab-spi')!.activeStreamId!, {
        transport: 'chat_completions',
      })

      useAiStore.getState().sendMessage('tab-spi', 'conn-1', 'Turn 3', {})
      await vi.waitFor(() => {
        expect(mockSendAiChat).toHaveBeenCalledTimes(3)
      })

      const sys3 = getTab('tab-spi')!.messages.filter((m) => m.role === 'system' && !m.kind)
      // System prompt should never be modified after first turn
      expect(sys3).toHaveLength(1)
      expect(sys3[0].content).toBe(content1)
    })
  })
})
