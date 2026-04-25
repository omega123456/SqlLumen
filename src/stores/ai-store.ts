import { create } from 'zustand'
import { logFrontend } from '../lib/app-log-commands'
import { sendAiChat, cancelAiStream, listenToAiStream, aiQueryExpand } from '../lib/ai-commands'
import { searchMemories } from '../lib/ai-memory-commands'
import type { AiMessage as IpcAiMessage, AiChunkKind } from '../lib/ai-commands'
import { semanticSearch } from '../lib/schema-index-commands'
import type { RetrievalHints } from '../lib/schema-index-commands'
import { useSchemaIndexStore } from './schema-index-store'
import { useSettingsStore } from './settings-store'
import { useQueryStore } from './query-store'
import { useAiFeedbackStore } from './ai-feedback-store'
import { showErrorToast } from './toast-store'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AiMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  kind?: 'schema-context' | 'attached-context' | 'memory-context'
  thinkingContent?: string
  chunkKeys?: string[]
  memoryIds?: number[]
}

interface AiMemory {
  id: number
  content: string
}

export interface AttachedContext {
  sql: string
  range: {
    startLineNumber: number
    endLineNumber: number
    startColumn: number
    endColumn: number
  }
}

export interface TabAiState {
  messages: AiMessage[]
  isGenerating: boolean
  activeStreamId: string | null
  previousResponseId?: string | null
  attachedContext: AttachedContext | null
  isPanelOpen: boolean
  error: string | null
  /** Dedup index: chunk keys already provided in schema-context messages. */
  providedChunkKeys: Record<string, true>
  /** Running token count for cumulative schema budget. */
  cumulativeSchemaTokens: number
  /** Dedup index: memory IDs already provided in memory-context messages. */
  providedMemoryIds: Record<string, true>
  /** System prompt used for the last successfully completed response chain. */
  lastCompletedSystemPrompt: string
  /** Transport that produced the last reusable response chain. */
  lastCompletedTransport: 'chat_completions' | 'responses' | null
  /** Endpoint used for the last reusable response chain. */
  lastCompletedEndpoint: string
  /** Model used for the last reusable response chain. */
  lastCompletedModel: string
  /** Endpoint used by the currently active AI request. */
  activeRequestEndpoint: string
  /** Model used by the currently active AI request. */
  activeRequestModel: string
  /** True once the current stream has produced visible assistant output. */
  activeStreamHasAssistantOutput: boolean
  /** True while waiting for the schema index to finish building. */
  isWaitingForIndex: boolean
  /** Connection ID associated with this tab — needed for cross-store status management. */
  connectionId: string | null
  _unlisten: (() => void) | null
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function createDefaultTabAiState(): TabAiState {
  return {
    messages: [],
    isGenerating: false,
    activeStreamId: null,
    previousResponseId: null,
    attachedContext: null,
    isPanelOpen: false,
    error: null,
    providedChunkKeys: {},
    cumulativeSchemaTokens: 0,
    providedMemoryIds: {},
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
  }
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface AiState {
  tabs: Record<string, TabAiState>

  // Message actions
  sendMessage: (
    tabId: string,
    connectionId: string,
    message: string,
    settings: { temperature?: number; maxTokens?: number; model?: string }
  ) => void
  cancelStream: (tabId: string) => void
  retryLastMessage: (
    tabId: string,
    connectionId: string,
    settings: { temperature?: number; maxTokens?: number; model?: string }
  ) => void

  // Stream lifecycle
  onStreamChunk: (tabId: string, streamId: string, content: string, kind: AiChunkKind) => void
  onStreamDone: (
    tabId: string,
    streamId: string,
    info: { responseId?: string | null; transport?: 'chat_completions' | 'responses' }
  ) => void
  onStreamError: (tabId: string, streamId: string, error: string) => void
  setUnlisten: (tabId: string, unlisten: () => void) => void

  // Panel actions
  togglePanel: (tabId: string) => void
  openPanel: (tabId: string) => void
  closePanel: (tabId: string) => void

  // Context actions
  setAttachedContext: (tabId: string, context: AttachedContext) => void
  clearAttachedContext: (tabId: string) => void

  // Conversation management
  clearConversation: (tabId: string) => void
  setError: (tabId: string, error: string) => void
  clearError: (tabId: string) => void

  // Editor lock — AI status management
  /** Lock the editor in 'ai-reviewing' state (e.g. while a diff overlay is open). */
  setAiReviewing: (tabId: string) => void
  /** Restore the query tab status from prevTabStatus after an AI lock. */
  restoreTabStatus: (tabId: string) => void

  // Cleanup
  cleanupTab: (tabId: string) => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fixed system prompt describing the AI assistant's capabilities. */
const AI_SYSTEM_PROMPT = `You are an expert SQL assistant integrated into a database client. You help users:
- Write SQL queries from natural language descriptions
- Explain what existing SQL queries do
- Optimize queries for better performance
- Debug SQL issues and suggest fixes
- Answer general SQL and database questions

The application may inject additional hidden system messages containing relevant schema or SQL context.

Schema context is cumulative across the conversation: all schema-context messages in this conversation are authoritative and should be used together. When the same table appears in multiple schema-context messages, the most recent version takes precedence.

Retrieved tables only:
- Use only tables that are present in the retrieved schema context.
- Never make up or reference any table that is not in the retrieved schema.
- Always use database-qualified table names in generated SQL (\`db\`.\`table\`).

Note: Approximate row counts are included in the schema metadata where available.

User notes (memories) may also appear in separate memory-context messages throughout the conversation. Use them to inform your responses.

Always write SQL that is compatible with MySQL/MariaDB syntax.

Whenever you reference a table in generated SQL, always use its full database-qualified name (for example, \`database_name\`.\`table_name\`).

When writing SQL, prefer clear, readable queries. Format your SQL code in markdown code blocks with the sql language tag.`

/** Cumulative token budget default for all schema-context messages in a conversation. */
const CUMULATIVE_SCHEMA_TOKEN_BUDGET_DEFAULT = 30000

function buildAttachedContextMessage(sql: string): string {
  return `The following SQL statement is the context for this conversation:\n\n\`\`\`sql\n${sql}\n\`\`\``
}

function shouldReuseResponseChain(
  tab: TabAiState | undefined,
  systemPrompt: string | undefined,
  endpoint: string,
  model: string
): boolean {
  if (!tab?.previousResponseId || !systemPrompt) {
    return false
  }

  return (
    tab.lastCompletedTransport === 'responses' &&
    tab.lastCompletedSystemPrompt === systemPrompt &&
    tab.lastCompletedEndpoint === endpoint &&
    tab.lastCompletedModel === model
  )
}

function isPromptOnlyContextMessage(message: AiMessage): boolean {
  return (
    message.kind === 'schema-context' ||
    message.kind === 'attached-context' ||
    message.kind === 'memory-context'
  )
}
const QUERY_EXPANSION_SYSTEM_PROMPT = `You are a SQL schema search assistant. Given a user's natural language question about a database, generate search queries and analysis to find the most relevant database tables. Output strictly as JSON with no explanation.

When table names are mentioned or implied, prefer database-qualified names when possible so retrieval preserves the database prefix.

Required JSON format:
{
  "queries": ["...", "...", "..."],
  "hypotheticalSql": "SELECT ... FROM \`db\`.\`table\` ...",
  "entities": ["table1", "table2"],
  "joins": ["table1 → table2"],
  "metrics": ["revenue", "count"]
}

Fields:
- queries: 2–3 short search phrases using SQL vocabulary (table names, column names, SQL keywords, JOIN patterns)
- hypotheticalSql: A hypothetical SQL fragment that would answer the question (used for embedding search, not execution)
- entities: Table/object names referenced or implied
- joins: Relationships between entities (use → notation)
- metrics: Aggregation metrics or computed values referenced

Examples:
User: "Show me all customers who haven't ordered anything in the last 6 months"
Output: {"queries":["customers orders LEFT JOIN last_order_date","customers table id name email","orders customer_id created_at date"],"hypotheticalSql":"SELECT c.* FROM \`db\`.\`customers\` c LEFT JOIN \`db\`.\`orders\` o ON c.id = o.customer_id WHERE o.created_at < DATE_SUB(NOW(), INTERVAL 6 MONTH) OR o.id IS NULL","entities":["customers","orders"],"joins":["customers → orders"],"metrics":["count"]}

User: "What's the total revenue by product category?"
Output: {"queries":["products categories revenue SUM price","product_categories category_name JOIN products","orders order_items products price quantity amount"],"hypotheticalSql":"SELECT pc.name, SUM(oi.price * oi.quantity) as revenue FROM \`db\`.\`product_categories\` pc JOIN \`db\`.\`products\` p ON pc.id = p.category_id JOIN \`db\`.\`order_items\` oi ON p.id = oi.product_id GROUP BY pc.name","entities":["products","product_categories","order_items","orders"],"joins":["product_categories → products","products → order_items"],"metrics":["revenue","sum","price","quantity"]}`

// ---------------------------------------------------------------------------
// Table extraction helper (shared by hint assembly)
// ---------------------------------------------------------------------------

const TABLE_NAME_REGEX =
  /(?:from|join|into|update|table|references)\s+((?:`[^`]+`|[a-z_]\w*)(?:\.(?:`[^`]+`|[a-z_]\w*))?)/gi

/**
 * Extract `{dbName, tableName}` pairs from a SQL string using a simple regex.
 * Returns unqualified tables with dbName = '' (best-effort).
 */
export function extractTablesFromSql(sql: string): Array<{ dbName: string; tableName: string }> {
  const results: Array<{ dbName: string; tableName: string }> = []
  const seen = new Set<string>()
  let match: RegExpExecArray | null
  TABLE_NAME_REGEX.lastIndex = 0
  while ((match = TABLE_NAME_REGEX.exec(sql)) !== null) {
    const raw = match[1]
    const parts = raw.split('.').map((p) => p.replace(/`/g, '').trim())
    let dbName = ''
    let tableName = ''
    if (parts.length === 2) {
      dbName = parts[0]
      tableName = parts[1]
    } else if (parts.length === 1) {
      tableName = parts[0]
    }
    if (!tableName) continue
    const key = `${dbName}.${tableName}`.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      results.push({ dbName, tableName })
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// Expansion cache — small Map-based LRU per tab
// ---------------------------------------------------------------------------

interface ExpansionCacheEntry {
  responseText: string
}

/** LRU cache of expansion results, keyed by tab ID. Uses Map insertion order. */
const expansionCaches = new Map<string, Map<string, ExpansionCacheEntry>>()
const EXPANSION_CACHE_SIZE = 16
const MEMORY_TOKEN_BUDGET = 500 // reserved tokens for memories in prompt

function getExpansionCacheKey(
  sessionId: string,
  endpoint: string,
  model: string,
  userMessage: string,
  conversationContext: string,
  attachedSql: string
): string {
  return JSON.stringify({
    sessionId,
    endpoint,
    model,
    userMessage,
    conversationContext,
    attachedSql,
  })
}

function lookupExpansionCache(tabId: string, key: string): ExpansionCacheEntry | null {
  const cache = expansionCaches.get(tabId)
  if (!cache) return null
  const value = cache.get(key)
  if (value === undefined) return null
  // Move to end (most recently used)
  cache.delete(key)
  cache.set(key, value)
  return value
}

function deleteExpansionCacheEntry(tabId: string, key: string): void {
  const cache = expansionCaches.get(tabId)
  if (!cache) return
  cache.delete(key)
  if (cache.size === 0) {
    expansionCaches.delete(tabId)
  }
}

function storeExpansionCache(tabId: string, key: string, responseText: string): void {
  let cache = expansionCaches.get(tabId)
  if (!cache) {
    cache = new Map()
    expansionCaches.set(tabId, cache)
  }
  // Delete first to refresh insertion order if key already exists
  cache.delete(key)
  cache.set(key, { responseText })
  // Evict oldest (first entry) if over capacity
  if (cache.size > EXPANSION_CACHE_SIZE) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

function clearExpansionCache(tabId: string): void {
  expansionCaches.delete(tabId)
}

/**
 * Parse the structured expansion response with a multi-level fallback chain:
 * 1. Full structured (queries + hypotheticalSql + entities/joins/metrics)
 * 2. Flat queries-only
 * 3. Original user message
 */
function parseExpansionResponse(
  text: string,
  userMessage: string,
  hydeEnabled: boolean,
  maxQueries: number
): { queries: string[]; isCacheable: boolean } {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      logFrontend(
        'debug',
        `[ai-store] expansion response had invalid JSON shape — falling back to original query`
      )
      return {
        queries: [userMessage],
        isCacheable: false,
      }
    }

    const payload = parsed as Record<string, unknown>
    const hasRecognisedField = ['queries', 'hypotheticalSql', 'entities', 'joins', 'metrics'].some(
      (field) => field in payload
    )

    if (!hasRecognisedField) {
      logFrontend(
        'debug',
        `[ai-store] expansion response missing structured fields — falling back to original query`
      )
      return {
        queries: [userMessage],
        isCacheable: false,
      }
    }

    const allQueries: string[] = [userMessage]
    const appendTrimmedQuery = (value: unknown): void => {
      if (typeof value !== 'string') return
      const trimmed = value.trim()
      if (trimmed.length > 0) {
        allQueries.push(trimmed)
      }
    }

    const appendJoinedField = (value: unknown): void => {
      if (!Array.isArray(value)) return
      const joined = value
        .filter((item: unknown): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .join(' ')
      if (joined.length > 0) {
        allQueries.push(joined)
      }
    }

    // Extract queries array
    if (Array.isArray(payload.queries) && payload.queries.length > 0) {
      for (const q of payload.queries) {
        appendTrimmedQuery(q)
      }
    }

    // HyDE: add hypothetical SQL fragment as another search query
    if (
      hydeEnabled &&
      typeof payload.hypotheticalSql === 'string' &&
      payload.hypotheticalSql.trim().length > 0
    ) {
      appendTrimmedQuery(payload.hypotheticalSql)
    }

    // Entity + relationship decomposition: flatten into additional search strings
    appendJoinedField(payload.entities)
    appendJoinedField(payload.joins)
    appendJoinedField(payload.metrics)

    // Dedup and cap
    const dedupedQueries = Array.from(new Set(allQueries)).slice(0, maxQueries)
    const trimmedUserMessage = userMessage.trim()
    const hasDerivedExpansion = dedupedQueries.some((query) => query.trim() !== trimmedUserMessage)

    if (!hasDerivedExpansion) {
      logFrontend(
        'debug',
        `[ai-store] expansion response produced no usable derived queries — falling back to original query`
      )
      return {
        queries: [userMessage],
        isCacheable: false,
      }
    }

    return {
      queries: dedupedQueries,
      isCacheable: true,
    }
  } catch {
    // JSON parse failed — return original message only
    logFrontend(
      'debug',
      `[ai-store] expansion response JSON parse failed — falling back to original query`
    )
    return {
      queries: [userMessage],
      isCacheable: false,
    }
  }
}

function getAiSetting(key: string): string {
  const settingsState = useSettingsStore.getState() as {
    getEffectiveSetting?: (settingKey: string) => string
    getSetting?: (settingKey: string) => string
  }

  if (typeof settingsState.getEffectiveSetting === 'function') {
    return settingsState.getEffectiveSetting(key)
  }

  if (typeof settingsState.getSetting === 'function') {
    return settingsState.getSetting(key)
  }

  return ''
}

// ---------------------------------------------------------------------------
// Reusable state-reset fragments (reduce patchTab duplication)
// ---------------------------------------------------------------------------

/** Fields to clear when an active request/stream finishes or is abandoned. */
function activeRequestResetFragment(): Partial<TabAiState> {
  return {
    isGenerating: false,
    activeStreamId: null,
    activeRequestEndpoint: '',
    activeRequestModel: '',
    activeStreamHasAssistantOutput: false,
  }
}

/** Fields to clear when the response chain is invalidated. */
function responseChainResetFragment(): Partial<TabAiState> {
  return {
    previousResponseId: null,
    lastCompletedSystemPrompt: '',
    lastCompletedTransport: null,
    lastCompletedEndpoint: '',
    lastCompletedModel: '',
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAiStore = create<AiState>()((set, get) => {
  /** Get or lazily initialize tab state. */
  const ensureTab = (tabId: string): TabAiState => {
    const existing = get().tabs[tabId]
    if (existing) return existing
    const fresh = createDefaultTabAiState()
    set((state) => ({
      tabs: { ...state.tabs, [tabId]: fresh },
    }))
    // Clear stale expansion cache when a tab is freshly created
    clearExpansionCache(tabId)
    return fresh
  }

  /** Merge a partial update into a single tab's AI state. */
  const patchTab = (tabId: string, partial: Partial<TabAiState>) => {
    set((state) => ({
      tabs: {
        ...state.tabs,
        [tabId]: { ...(state.tabs[tabId] ?? createDefaultTabAiState()), ...partial },
      },
    }))
  }

  /** Safely invoke and clear the unlisten callback for a tab's event listener. */
  function callUnlistenSafely(tabId: string, tab: TabAiState | undefined): void {
    if (tab?._unlisten) {
      try {
        tab._unlisten()
      } catch {
        // Swallow — listener cleanup is best-effort
      }
      patchTab(tabId, { _unlisten: null })
    }
  }

  /**
   * Insert the base system prompt once. No-op if a system prompt already exists.
   */
  function ensureBaseSystemPrompt(tabId: string, systemContent: string): void {
    const currentTab = get().tabs[tabId]
    if (!currentTab) return

    const existingIdx = currentTab.messages.findIndex(
      (m) => m.role === 'system' && !isPromptOnlyContextMessage(m)
    )
    if (existingIdx >= 0) {
      // System prompt already exists — do nothing (immutable)
      return
    }

    // Prepend new system message
    const systemMessage: AiMessage = {
      id: crypto.randomUUID(),
      role: 'system',
      content: systemContent,
      timestamp: Date.now(),
    }
    patchTab(tabId, {
      messages: [systemMessage, ...currentTab.messages],
    })
  }

  /**
   * Append a context message before the user message at the given ID.
   * Always inserts; never searches/replaces.
   */
  function appendContextMessage(tabId: string, userMessageId: string, message: AiMessage): void {
    const currentTab = get().tabs[tabId]
    if (!currentTab) return

    const nextMessages = [...currentTab.messages]
    const userIndex = nextMessages.findIndex((m) => m.id === userMessageId)
    if (userIndex < 0) return

    nextMessages.splice(userIndex, 0, message)
    patchTab(tabId, { messages: nextMessages })
  }

  function getCurrentSystemPrompt(tabId: string): string {
    return (
      get().tabs[tabId]?.messages.find(
        (message) => message.role === 'system' && !isPromptOnlyContextMessage(message)
      )?.content ?? ''
    )
  }

  function upsertPromptOnlyContextMessages(
    tabId: string,
    userMessageId: string,
    contextMessages: Array<Pick<AiMessage, 'role' | 'content' | 'kind'>>
  ): void {
    const currentTab = get().tabs[tabId]
    if (!currentTab || contextMessages.length === 0) return

    const nextMessages = [...currentTab.messages]
    const userIndex = nextMessages.findIndex((message) => message.id === userMessageId)
    if (userIndex < 0) return

    let changed = false

    for (const contextMessage of contextMessages) {
      if (!contextMessage.kind) continue

      const matchingIndices = nextMessages.reduce<number[]>((indices, message, index) => {
        if (message.kind === contextMessage.kind) {
          indices.push(index)
        }
        return indices
      }, [])

      const [primaryIndex, ...duplicateIndices] = matchingIndices

      for (const duplicateIndex of duplicateIndices.reverse()) {
        nextMessages.splice(duplicateIndex, 1)
        changed = true
      }

      if (primaryIndex !== undefined) {
        const existingMessage = nextMessages[primaryIndex]
        if (
          existingMessage.role === contextMessage.role &&
          existingMessage.content === contextMessage.content
        ) {
          continue
        }

        nextMessages[primaryIndex] = {
          ...existingMessage,
          role: contextMessage.role,
          content: contextMessage.content,
          timestamp: Date.now(),
          kind: contextMessage.kind,
        }
        changed = true
        continue
      }

      nextMessages.splice(userIndex, 0, {
        id: crypto.randomUUID(),
        role: contextMessage.role,
        content: contextMessage.content,
        timestamp: Date.now(),
        kind: contextMessage.kind,
      })
      changed = true
    }

    if (changed) {
      patchTab(tabId, { messages: nextMessages })
    }
  }

  function removePromptOnlyContextMessages(
    tabId: string,
    kinds: Array<NonNullable<AiMessage['kind']>>
  ): void {
    const currentTab = get().tabs[tabId]
    if (!currentTab || kinds.length === 0) return

    const kindSet = new Set(kinds)
    const nextMessages = currentTab.messages.filter(
      (message) => !(message.kind && kindSet.has(message.kind))
    )

    if (nextMessages.length !== currentTab.messages.length) {
      patchTab(tabId, { messages: nextMessages })
    }
  }

  function resetResponseChain(tabId: string): void {
    if (!get().tabs[tabId]) return
    patchTab(tabId, responseChainResetFragment())
  }

  /**
   * Retrieve schema context via the vector retrieval pipeline.
   *
   * 1. Wait for schema index if building
   * 2. Retrieve memories (all used for query expansion; only novel IDs for context)
   * 3. Expand user query via aiQueryExpand
   * 4. Perform semantic search
   * 5. Cross-turn dedup + cumulative budget enforcement
   * 6. Return novel DDL + novel memory data
   */
  async function retrieveSchemaContext(
    tabId: string,
    sessionId: string,
    userMessage: string
  ): Promise<{
    schemaDdl: string
    novelChunkKeys: string[]
    novelDdlTokens: number
    novelMemories: AiMemory[]
    novelMemoryText: string | null
  }> {
    try {
      logFrontend(
        'debug',
        `[ai-store] retrieveSchemaContext start — tabId=${tabId} sessionId=${sessionId} userQuery="${userMessage}"`
      )

      // Check index status — if building, wait for it
      const indexState = useSchemaIndexStore.getState().getStatusForSession(sessionId)
      logFrontend(
        'debug',
        `[ai-store] schema index status for session=${sessionId}: ${indexState?.status ?? 'unknown'}`
      )

      if (indexState?.status === 'building') {
        logFrontend('debug', `[ai-store] index is building — waiting (tabId=${tabId})`)
        if (get().tabs[tabId]) {
          patchTab(tabId, { isWaitingForIndex: true })
        }

        // Poll until index is no longer building (max ~30s)
        const maxWaitMs = 30000
        const pollIntervalMs = 500
        let waited = 0
        while (waited < maxWaitMs) {
          await new Promise((r) => setTimeout(r, pollIntervalMs))
          waited += pollIntervalMs
          const current = useSchemaIndexStore.getState().getStatusForSession(sessionId)
          if (!current || current.status !== 'building') break
        }

        const postWaitStatus = useSchemaIndexStore.getState().getStatusForSession(sessionId)
        logFrontend(
          'debug',
          `[ai-store] done waiting for index — waited=${waited}ms finalStatus=${postWaitStatus?.status ?? 'unknown'}`
        )
        patchTab(tabId, { isWaitingForIndex: false })
        if (!get().tabs[tabId])
          return {
            schemaDdl: '',
            novelChunkKeys: [],
            novelDdlTokens: 0,
            novelMemories: [],
            novelMemoryText: null,
          }
      }

      // ── Retrieve memories ─────────────────────────────────────────────
      let allMemories: AiMemory[] = []
      try {
        logFrontend(
          'debug',
          `[ai-store] searching memories for context — sessionId=${sessionId} query="${userMessage}"`
        )
        const memoryResults = await searchMemories({
          sessionId,
          query: userMessage,
          k: 5,
        })
        allMemories = memoryResults
        logFrontend(
          'debug',
          `[ai-store] memory search returned ${allMemories.length} result(s) — sessionId=${sessionId}`
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logFrontend('debug', `[ai-store] memory retrieval failed (non-fatal) — error="${msg}"`)
        logFrontend('warn', `[ai-store] Memory retrieval failed (non-fatal): ${msg}`)
      }

      // Dedup memories by ID (only novel ones produce memory-context messages)
      const currentTab = get().tabs[tabId]
      const existingMemoryIds = currentTab?.providedMemoryIds ?? {}
      const novelMemories = allMemories.filter((mem) => !existingMemoryIds[String(mem.id)])

      // Build novel memory text
      let novelMemoryText: string | null = null
      const includedMemories: AiMemory[] = []
      if (novelMemories.length > 0) {
        const memLines: string[] = []
        let usedTokens = 0
        const headerTokens = Math.ceil('## User Notes (from memory)\n'.length / 4)
        usedTokens += headerTokens
        for (const mem of novelMemories) {
          const line = `- ${mem.content}`
          const lineTokens = Math.ceil(line.length / 4)
          if (usedTokens + lineTokens > MEMORY_TOKEN_BUDGET) break
          memLines.push(line)
          includedMemories.push(mem)
          usedTokens += lineTokens
        }
        novelMemoryText =
          memLines.length > 0 ? `## User Notes (from memory)\n${memLines.join('\n')}` : null
        logFrontend(
          'debug',
          `[ai-store] memory retrieval complete — total=${allMemories.length} novel=${novelMemories.length} included=${memLines.length} budgetTokens=${MEMORY_TOKEN_BUDGET}`
        )
      }

      // Build conversation context from last ~4 turns
      const tabState = get().tabs[tabId]
      let conversationContext = ''
      if (tabState) {
        const recentMessages = tabState.messages
          .filter(
            (m) => (m.role === 'user' || m.role === 'assistant') && !isPromptOnlyContextMessage(m)
          )
          .slice(-8) // last 4 turns = 8 messages max
          .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
        if (recentMessages.length > 0) {
          conversationContext = recentMessages.join('\n')
        }
        // Augment with ALL memory content for better query expansion (not just novel)
        if (allMemories.length > 0) {
          const memoryNotes = allMemories.map((m) => m.content).join('\n')
          conversationContext += `\n\nUser notes:\n${memoryNotes}`
          logFrontend(
            'debug',
            `[ai-store] query expansion augmented with ${allMemories.length} memory note(s) — notes="${memoryNotes.replace(/\n/g, ' | ')}"`
          )
        }
      }

      // Include attached SQL context if present
      const attachedSql = tabState?.attachedContext?.sql ?? ''

      // Query expansion — get search queries with HyDE and entity decomposition
      let queries: string[] = [userMessage]
      try {
        const endpoint = getAiSetting('ai.endpoint')
        const model = getAiSetting('ai.model')
        const hydeEnabled = getAiSetting('ai.retrieval.hydeEnabled') !== 'false'
        const maxQueries = parseInt(getAiSetting('ai.retrieval.expansionMaxQueries') || '8', 10)
        const effectiveMaxQueries = Math.min(
          isNaN(maxQueries) || maxQueries <= 0 ? 8 : maxQueries,
          10
        )

        logFrontend(
          'debug',
          `[ai-store] query expansion — endpoint=${endpoint ? '[set]' : '[unset]'} model=${model || '[unset]'} hyde=${hydeEnabled}`
        )

        if (endpoint && model) {
          // Check expansion cache first
          const cacheKey = getExpansionCacheKey(
            sessionId,
            endpoint,
            model,
            userMessage,
            conversationContext,
            attachedSql
          )
          const cached = lookupExpansionCache(tabId, cacheKey)

          if (cached) {
            const cachedParse = parseExpansionResponse(
              cached.responseText,
              userMessage,
              hydeEnabled,
              effectiveMaxQueries
            )

            if (cachedParse.isCacheable) {
              queries = cachedParse.queries
            } else {
              deleteExpansionCacheEntry(tabId, cacheKey)
              queries = [userMessage]
              logFrontend(
                'warn',
                `[ai-store] query expansion cache entry was invalid and has been evicted`
              )
            }

            logFrontend('debug', `[ai-store] query expansion cache hit — ${queries.length} queries`)
          } else {
            // Build the user message for expansion, including attached SQL
            let expandUserMessage = userMessage
            if (attachedSql) {
              expandUserMessage = `Context SQL:\n\`\`\`sql\n${attachedSql}\n\`\`\`\n\nQuestion: ${userMessage}`
            }

            const result = await aiQueryExpand({
              endpoint,
              model,
              systemPrompt: QUERY_EXPANSION_SYSTEM_PROMPT,
              userMessage: expandUserMessage,
              conversationContext: conversationContext || undefined,
            })

            logFrontend('debug', `[ai-store] query expansion raw response: ${result.text}`)

            // Parse structured JSON response with fallback chain
            const parsedExpansion = parseExpansionResponse(
              result.text,
              userMessage,
              hydeEnabled,
              effectiveMaxQueries
            )
            queries = parsedExpansion.queries

            logFrontend(
              'debug',
              `[ai-store] query expansion succeeded — transformedQueries=${JSON.stringify(queries)}`
            )

            // Cache only successfully parsed structured responses so malformed output
            // does not poison follow-up retrieval.
            if (parsedExpansion.isCacheable) {
              storeExpansionCache(tabId, cacheKey, result.text)
            } else {
              logFrontend(
                'debug',
                `[ai-store] query expansion cache skipped — malformed expansion response`
              )
            }
          }
        } else {
          logFrontend(
            'debug',
            `[ai-store] query expansion skipped — missing endpoint or model, using original user query`
          )
        }
      } catch (err) {
        // Query expansion failed — fall back to original message
        const msg = err instanceof Error ? err.message : String(err)
        logFrontend('warn', `[ai-store] Query expansion fallback: ${msg}`)
        logFrontend('debug', `[ai-store] falling back to original query: "${userMessage}"`)
      }

      // ── Assemble retrieval hints ──────────────────────────────────────
      const hints: RetrievalHints = {
        recentTables: [],
        editorTables: [],
        acceptedTables: [],
      }

      try {
        const recentQueryWindow = parseInt(
          getAiSetting('ai.retrieval.recentQueryWindow') || '20',
          10
        )
        const effectiveWindow =
          isNaN(recentQueryWindow) || recentQueryWindow <= 0 ? 20 : recentQueryWindow

        // Editor tables — from attached SQL context
        if (attachedSql) {
          const editorTables = extractTablesFromSql(attachedSql)
          hints.editorTables = editorTables
        }

        // Accepted tables — from feedback store
        const feedbackEntries = useAiFeedbackStore.getState().getAcceptedTables(sessionId)
        hints.acceptedTables = feedbackEntries.map((e) => ({
          dbName: e.dbName,
          tableName: e.tableName,
          weight: e.weight,
        }))

        // Recent tables — placeholder: scan last N queries from query store history
        // We use a simple regex to find table names from recent queries
        const queryTab = useQueryStore.getState().tabs
        const allQueries: string[] = []
        for (const tab of Object.values(queryTab)) {
          if (tab.content && tab.content.trim()) {
            allQueries.push(tab.content)
          }
        }
        const recentSlice = allQueries.slice(0, effectiveWindow)
        const recentTableSet = new Map<string, number>()
        for (let i = 0; i < recentSlice.length; i++) {
          const tables = extractTablesFromSql(recentSlice[i])
          const weight = 1.0 - (i / effectiveWindow) * 0.95 // decay from 1.0 to ~0.05
          for (const t of tables) {
            const key = `${t.dbName}.${t.tableName}`
            if (!recentTableSet.has(key) || (recentTableSet.get(key) ?? 0) < weight) {
              recentTableSet.set(key, weight)
            }
          }
        }
        for (const [key, weight] of recentTableSet) {
          const [dbName, tableName] = key.split('.')
          if (dbName && tableName) {
            hints.recentTables.push({ dbName, tableName, weight })
          }
        }

        logFrontend(
          'debug',
          `[ai-store] assembled hints — recent=${hints.recentTables.length} editor=${hints.editorTables.length} accepted=${hints.acceptedTables.length}`
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logFrontend('warn', `[ai-store] hint assembly failed (non-fatal): ${msg}`)
      }

      logFrontend(
        'debug',
        `[ai-store] invoking semantic search — sessionId=${sessionId} queryCount=${queries.length} queries=${JSON.stringify(queries)}`
      )

      // Semantic search
      const results = await semanticSearch(sessionId, queries, hints)

      logFrontend(
        'debug',
        `[ai-store] semantic search returned ${results.length} result(s): ${JSON.stringify(
          results.map((r) => ({
            chunkKey: r.chunkKey,
            dbName: r.dbName,
            tableName: r.tableName,
            chunkType: r.chunkType,
            score: r.score,
          }))
        )}`
      )

      // Assemble DDL from results with headers, ordering, and token budget
      const tokenBudget = parseInt(getAiSetting('ai.retrieval.tokenBudget') || '6000', 10)
      const effectiveBudget = isNaN(tokenBudget) || tokenBudget <= 0 ? 6000 : tokenBudget

      // Deduct fixed memory token reserve from the per-turn schema token budget
      const perTurnSchemaBudget = Math.max(effectiveBudget - MEMORY_TOKEN_BUDGET, 0)

      // Cumulative budget
      const cumulativeBudget = Math.max(CUMULATIVE_SCHEMA_TOKEN_BUDGET_DEFAULT, effectiveBudget)
      const existingCumulativeTokens = get().tabs[tabId]?.cumulativeSchemaTokens ?? 0
      const remainingCumulativeBudget = Math.max(cumulativeBudget - existingCumulativeTokens, 0)

      // Cross-turn dedup: filter out already-provided chunk keys
      const existingChunkKeys = get().tabs[tabId]?.providedChunkKeys ?? {}

      // Deterministic order: tables first, then views, then routines, by score desc
      const sortedResults = [...results].sort((a, b) => {
        const typeOrder = (ct: string) =>
          ct === 'table' ? 0 : ct === 'view' ? 1 : ct === 'fk' ? 3 : 2
        const aOrder = typeOrder(a.chunkType)
        const bOrder = typeOrder(b.chunkType)
        if (aOrder !== bOrder) return aOrder - bOrder
        return b.score - a.score
      })

      const seen = new Set<string>()
      const ddlParts: string[] = []
      const novelChunkKeys: string[] = []
      let runningTokens = 0
      let droppedCount = 0

      for (const result of sortedResults) {
        // Intra-turn dedup (existing)
        if (seen.has(result.chunkKey)) continue
        seen.add(result.chunkKey)

        // Cross-turn dedup
        if (existingChunkKeys[result.chunkKey]) continue

        // Raw DDL only — no per-chunk headers or score annotations
        const block = result.ddlText
        const blockTokens = Math.ceil(block.length / 4)

        // Per-turn budget
        if (runningTokens + blockTokens > perTurnSchemaBudget && runningTokens > 0) {
          droppedCount++
          break
        }

        // Cumulative budget
        if (runningTokens + blockTokens > remainingCumulativeBudget) {
          droppedCount++
          break
        }

        runningTokens += blockTokens
        ddlParts.push(block)
        novelChunkKeys.push(result.chunkKey)
      }

      if (droppedCount > 0) {
        logFrontend(
          'debug',
          `[ai-store] token budget: dropped ${droppedCount} chunk(s) exceeding budget`
        )
      }

      const ddl = ddlParts.join('\n\n')

      logFrontend(
        'debug',
        `[ai-store] DDL assembly complete — novelChunks=${ddlParts.length} totalCharsInDdl=${ddl.length}`
      )

      logFrontend(
        'debug',
        `[ai-store] retrieveSchemaContext complete — ddl ${ddl.length > 0 ? `injected (${ddl.length} chars)` : 'empty (no schema context)'}`
      )

      return {
        schemaDdl: ddl,
        novelChunkKeys,
        novelDdlTokens: runningTokens,
        novelMemories: includedMemories,
        novelMemoryText,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logFrontend('error', `[ai-store] Schema retrieval failed: ${msg}`)
      showErrorToast('Schema retrieval failed', msg)
      if (get().tabs[tabId]) {
        patchTab(tabId, { isWaitingForIndex: false })
      }
      return {
        schemaDdl: '',
        novelChunkKeys: [],
        novelDdlTokens: 0,
        novelMemories: [],
        novelMemoryText: null,
      }
    }
  }

  function applyChunkToMessages(
    messages: AiMessage[],
    content: string,
    kind: AiChunkKind
  ): AiMessage[] {
    const updated = [...messages]
    const last = updated[updated.length - 1]

    if (kind === 'thinking') {
      if (last?.role === 'assistant') {
        updated[updated.length - 1] = {
          ...last,
          thinkingContent: (last.thinkingContent ?? '') + content,
        }
      } else {
        updated.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '',
          thinkingContent: content,
          timestamp: Date.now(),
        })
      }
    } else {
      if (last?.role === 'assistant') {
        updated[updated.length - 1] = {
          ...last,
          content: last.content + content,
        }
      } else {
        updated.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content,
          timestamp: Date.now(),
        })
      }
    }

    return updated
  }

  /**
   * Apply current-turn context messages: retrieve schema/memory, insert context
   * messages before the user message, and update dedup indices.
   */
  async function applyCurrentTurnContext(
    tabId: string,
    connectionId: string,
    userMessage: string,
    userMessageId: string,
    attachedContext: AttachedContext | null
  ): Promise<void> {
    const { schemaDdl, novelChunkKeys, novelDdlTokens, novelMemories, novelMemoryText } =
      await retrieveSchemaContext(tabId, connectionId, userMessage)
    if (!get().tabs[tabId]) return

    // Insert base system prompt (first turn only — no-op on subsequent turns)
    ensureBaseSystemPrompt(tabId, AI_SYSTEM_PROMPT)

    // Append schema-context message if novel chunks exist
    if (schemaDdl && novelChunkKeys.length > 0) {
      appendContextMessage(tabId, userMessageId, {
        id: crypto.randomUUID(),
        role: 'system',
        content: schemaDdl,
        timestamp: Date.now(),
        kind: 'schema-context',
        chunkKeys: novelChunkKeys,
      })
    }

    // Append memory-context message if novel memories exist
    if (novelMemoryText && novelMemories.length > 0) {
      appendContextMessage(tabId, userMessageId, {
        id: crypto.randomUUID(),
        role: 'system',
        content: novelMemoryText,
        timestamp: Date.now(),
        kind: 'memory-context',
        memoryIds: novelMemories.map((m) => m.id),
      })
    }

    // Attached-context (mutable, unchanged behavior)
    if (!attachedContext) {
      removePromptOnlyContextMessages(tabId, ['attached-context'])
    }

    if (attachedContext) {
      upsertPromptOnlyContextMessages(tabId, userMessageId, [
        {
          role: 'system' as const,
          content: buildAttachedContextMessage(attachedContext.sql),
          kind: 'attached-context' as const,
        },
      ])
    }

    // Update dedup indices
    if (novelChunkKeys.length > 0 || novelMemories.length > 0) {
      const currentTabState = get().tabs[tabId]
      if (currentTabState) {
        const newChunkKeys = { ...currentTabState.providedChunkKeys }
        for (const key of novelChunkKeys) {
          newChunkKeys[key] = true
        }
        const newMemoryIds = { ...currentTabState.providedMemoryIds }
        for (const mem of novelMemories) {
          newMemoryIds[String(mem.id)] = true
        }
        patchTab(tabId, {
          providedChunkKeys: newChunkKeys,
          cumulativeSchemaTokens: currentTabState.cumulativeSchemaTokens + novelDdlTokens,
          providedMemoryIds: newMemoryIds,
        })
      }
    }
  }

  /**
   * Build the `sendAiChat` payload from current tab state and settings.
   */
  function buildSendAiChatPayload(
    tabId: string,
    streamId: string,
    settings: { temperature?: number; maxTokens?: number; model?: string }
  ): Parameters<typeof sendAiChat>[0] {
    const endpoint = getAiSetting('ai.endpoint')
    const model = settings.model ?? getAiSetting('ai.model')
    const temperature = settings.temperature ?? parseFloat(getAiSetting('ai.temperature'))
    const maxTokens = settings.maxTokens ?? parseInt(getAiSetting('ai.maxTokens'), 10)
    const enableReasoning = getAiSetting('ai.enableReasoning') !== 'false'
    const preferResponsesApi = getAiSetting('ai.preferResponsesApi') === 'true'

    patchTab(tabId, {
      activeRequestEndpoint: endpoint,
      activeRequestModel: model,
    })

    const currentMessages = get().tabs[tabId]?.messages ?? []
    const currentSystemPrompt = getCurrentSystemPrompt(tabId)
    const ipcMessages: IpcAiMessage[] = currentMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }))

    return {
      messages: ipcMessages,
      endpoint,
      model,
      temperature: isNaN(temperature) ? 0.3 : temperature,
      maxTokens: isNaN(maxTokens) ? 2048 : maxTokens,
      streamId,
      previousResponseId: shouldReuseResponseChain(
        get().tabs[tabId],
        currentSystemPrompt,
        endpoint,
        model
      )
        ? (get().tabs[tabId]?.previousResponseId ?? null)
        : null,
      preferResponsesApi,
      enableReasoning,
    }
  }

  return {
    tabs: {},

    // ------ sendMessage ------

    sendMessage: (tabId, connectionId, message, settings) => {
      ensureTab(tabId)

      const tab = get().tabs[tabId]!
      const streamId = crypto.randomUUID()
      const trimmedMessage = message.trim()
      const lastMessage = tab.messages[tab.messages.length - 1]
      const shouldReplaceTrailingFailedUserMessage =
        !tab.isGenerating &&
        !!tab.error &&
        lastMessage?.role === 'user' &&
        lastMessage.content.trim() === trimmedMessage

      const userMessage: AiMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: message,
        timestamp: Date.now(),
      }

      // Capture attached context before async work begins
      const attachedContext = tab.attachedContext

      // Add the user message immediately and store connectionId
      patchTab(tabId, {
        messages: shouldReplaceTrailingFailedUserMessage
          ? [...tab.messages.slice(0, -1), userMessage]
          : [...tab.messages, userMessage],
        error: null,
        isGenerating: true,
        activeStreamId: streamId,
        connectionId,
        previousResponseId: tab.previousResponseId,
        activeRequestEndpoint: '',
        activeRequestModel: '',
        activeStreamHasAssistantOutput: false,
      })

      // NOTE: Do NOT clear attachedContext here. It must remain set so that
      // the "Review Diff" button in AI code blocks stays visible when the
      // streaming response arrives. It is cleared explicitly by the user
      // (clearAttachedContext) or when the diff overlay is dismissed.

      // Lock the editor while AI is generating
      useQueryStore.getState().setTabStatus(tabId, 'ai-pending')

      // Async IPC flow — fire-and-forget from the synchronous action
      const startStream = async () => {
        try {
          // Retrieve schema context and insert context messages
          await applyCurrentTurnContext(
            tabId,
            connectionId,
            message,
            userMessage.id,
            attachedContext
          )
          if (!get().tabs[tabId]) return

          // Guard: schema retrieval is async; abort if stream was cancelled before we got here
          if (get().tabs[tabId]?.activeStreamId !== streamId || !get().tabs[tabId]?.isGenerating) {
            return
          }

          if (!get().tabs[tabId]) return // tab was cleaned up

          // Set up event listeners for this stream
          const unlisten = await listenToAiStream(streamId, {
            onChunk: (content, kind) => get().onStreamChunk(tabId, streamId, content, kind),
            onDone: (info) => get().onStreamDone(tabId, streamId, info),
            onError: (error) => get().onStreamError(tabId, streamId, error),
          })

          if (!get().tabs[tabId]) {
            unlisten()
            return
          }

          // Guard: listener setup is async; abort if stream was cancelled in the meantime
          if (get().tabs[tabId]?.activeStreamId !== streamId || !get().tabs[tabId]?.isGenerating) {
            unlisten()
            return
          }

          get().setUnlisten(tabId, unlisten)

          // Build and send the AI chat payload
          const payload = buildSendAiChatPayload(tabId, streamId, settings)
          await sendAiChat(payload)
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          logFrontend('error', `[ai-store] AI chat failed: ${errorMsg}`)

          if (get().tabs[tabId]) {
            // Clean up orphaned event listeners before resetting state
            callUnlistenSafely(tabId, get().tabs[tabId])

            patchTab(tabId, {
              ...activeRequestResetFragment(),
              error: errorMsg,
            })
            // Restore the editor lock on failure
            get().restoreTabStatus(tabId)
          }
        }
      }

      startStream()
    },

    // ------ cancelStream ------

    cancelStream: (tabId) => {
      ensureTab(tabId)
      const tab = get().tabs[tabId]!
      const streamId = tab.activeStreamId
      if (!streamId) return

      // Update state immediately
      patchTab(tabId, {
        ...activeRequestResetFragment(),
        ...responseChainResetFragment(),
      })

      // Restore the editor lock
      get().restoreTabStatus(tabId)

      // Clean up event listeners
      callUnlistenSafely(tabId, tab)

      // Cancel the backend stream (fire-and-forget)
      cancelAiStream(streamId).catch((err) => {
        const errorMsg = err instanceof Error ? err.message : String(err)
        logFrontend('warn', `[ai-store] AI cancel failed: ${errorMsg}`)
      })
    },

    // ------ retryLastMessage ------

    retryLastMessage: (tabId, connectionId, settings) => {
      const tab = get().tabs[tabId]
      if (!tab) return

      // Find the last user message
      const lastUserMessage = [...tab.messages]
        .reverse()
        .find((m) => m.role === 'user' && !isPromptOnlyContextMessage(m))
      if (!lastUserMessage) return

      const lastUserIndex = tab.messages.lastIndexOf(lastUserMessage)

      // Scan backwards from the user message to find contiguous context messages
      // from the same turn (schema-context, memory-context). Skip attached-context.
      const contextKinds = new Set<string>(['schema-context', 'memory-context', 'attached-context'])
      let scanIdx = lastUserIndex - 1
      const indicesToRemove: number[] = []
      while (scanIdx >= 0) {
        const msg = tab.messages[scanIdx]
        if (msg.kind && contextKinds.has(msg.kind)) {
          if (msg.kind === 'schema-context' || msg.kind === 'memory-context') {
            indicesToRemove.push(scanIdx)
          }
          // Skip attached-context without removing or stopping
          scanIdx--
        } else {
          break // hit a non-context message (user or assistant)
        }
      }

      // Collect chunk keys and memory IDs from removed context messages
      const removedChunkKeys: string[] = []
      const removedMemoryIds: number[] = []
      for (const idx of indicesToRemove) {
        const msg = tab.messages[idx]
        if (msg.kind === 'schema-context' && msg.chunkKeys) {
          removedChunkKeys.push(...msg.chunkKeys)
        }
        if (msg.kind === 'memory-context' && msg.memoryIds) {
          removedMemoryIds.push(...msg.memoryIds)
        }
      }

      // Remove: context messages + user message + everything after
      const removeSet = new Set(indicesToRemove)
      const remainingMessages = tab.messages.filter(
        (_, idx) => !removeSet.has(idx) && idx < lastUserIndex
      )

      // Update dedup indices
      const newChunkKeys = { ...tab.providedChunkKeys }
      for (const key of removedChunkKeys) {
        delete newChunkKeys[key]
      }
      const newMemoryIds = { ...tab.providedMemoryIds }
      for (const memId of removedMemoryIds) {
        delete newMemoryIds[String(memId)]
      }

      // Recompute cumulativeSchemaTokens from remaining schema-context messages
      let newCumulativeTokens = 0
      for (const msg of remainingMessages) {
        if (msg.kind === 'schema-context') {
          newCumulativeTokens += Math.ceil(msg.content.length / 4)
        }
      }

      patchTab(tabId, {
        ...activeRequestResetFragment(),
        ...responseChainResetFragment(),
        messages: remainingMessages,
        error: null,
        providedChunkKeys: newChunkKeys,
        providedMemoryIds: newMemoryIds,
        cumulativeSchemaTokens: newCumulativeTokens,
      })

      // Re-send the message
      get().sendMessage(tabId, connectionId, lastUserMessage.content, settings)
    },

    // ------ onStreamChunk ------

    onStreamChunk: (tabId, streamId, content, kind) => {
      // Stale-stream guard: ignore events from a previous stream that was superseded
      const tab = get().tabs[tabId]
      if (!tab || tab.activeStreamId !== streamId) return

      const messages = applyChunkToMessages(tab.messages, content, kind)

      patchTab(tabId, {
        messages,
        isGenerating: true,
        activeStreamId: streamId,
        ...(kind !== 'thinking' && { activeStreamHasAssistantOutput: true }),
      })
    },

    // ------ onStreamDone ------

    onStreamDone: (tabId, streamId, info) => {
      // Stale-stream guard: ignore events from a previous stream that was superseded
      const tab = get().tabs[tabId]
      if (!tab || tab.activeStreamId !== streamId) return

      const canReuseResponsesChain =
        info.transport === 'responses' &&
        tab.activeStreamHasAssistantOutput &&
        (info.responseId?.trim().length ?? 0) > 0

      patchTab(tabId, {
        ...activeRequestResetFragment(),
        previousResponseId: canReuseResponsesChain ? (info.responseId ?? null) : null,
        lastCompletedSystemPrompt: canReuseResponsesChain
          ? (tab.messages.find(
              (message) => message.role === 'system' && !isPromptOnlyContextMessage(message)
            )?.content ?? '')
          : '',
        lastCompletedTransport: info.transport ?? null,
        lastCompletedEndpoint: canReuseResponsesChain ? tab.activeRequestEndpoint : '',
        lastCompletedModel: canReuseResponsesChain ? tab.activeRequestModel : '',
      })

      // Tear down event listeners now that the stream is complete
      callUnlistenSafely(tabId, tab)

      // Restore the editor — generation is complete
      get().restoreTabStatus(tabId)
    },

    // ------ onStreamError ------

    onStreamError: (tabId, streamId, error) => {
      // Stale-stream guard: ignore events from a previous stream that was superseded
      const tab = get().tabs[tabId]
      if (!tab || tab.activeStreamId !== streamId) return

      patchTab(tabId, {
        ...activeRequestResetFragment(),
        ...responseChainResetFragment(),
        error,
      })

      // Tear down event listeners now that the stream has errored
      callUnlistenSafely(tabId, tab)

      // Restore the editor — generation failed
      get().restoreTabStatus(tabId)
    },

    // ------ setUnlisten ------

    setUnlisten: (tabId, unlisten) => {
      ensureTab(tabId)
      patchTab(tabId, { _unlisten: unlisten })
    },

    // ------ togglePanel ------

    togglePanel: (tabId) => {
      ensureTab(tabId)
      const tab = get().tabs[tabId]!
      patchTab(tabId, { isPanelOpen: !tab.isPanelOpen })
    },

    // ------ openPanel ------

    openPanel: (tabId) => {
      ensureTab(tabId)
      patchTab(tabId, { isPanelOpen: true })
    },

    // ------ closePanel ------

    closePanel: (tabId) => {
      ensureTab(tabId)
      patchTab(tabId, { isPanelOpen: false })
    },

    // ------ setAttachedContext ------

    setAttachedContext: (tabId, context) => {
      ensureTab(tabId)
      patchTab(tabId, { attachedContext: context })

      const currentTab = get().tabs[tabId]
      const currentAttachedMessage = currentTab?.messages.find(
        (message) => message.kind === 'attached-context'
      )

      if (currentAttachedMessage?.content !== buildAttachedContextMessage(context.sql)) {
        resetResponseChain(tabId)
      }

      removePromptOnlyContextMessages(tabId, ['attached-context'])
    },

    // ------ clearAttachedContext ------

    clearAttachedContext: (tabId) => {
      ensureTab(tabId)
      patchTab(tabId, { attachedContext: null })
      removePromptOnlyContextMessages(tabId, ['attached-context'])
      resetResponseChain(tabId)
    },

    // ------ clearConversation ------

    clearConversation: (tabId) => {
      ensureTab(tabId)
      const tab = get().tabs[tabId]
      const hadActiveStream = !!tab?.activeStreamId

      if (tab?._unlisten) {
        callUnlistenSafely(tabId, tab)
      }

      if (tab?.activeStreamId) {
        cancelAiStream(tab.activeStreamId).catch((err) => {
          const errorMsg = err instanceof Error ? err.message : String(err)
          logFrontend('warn', `[ai-store] AI cancel during clearConversation failed: ${errorMsg}`)
        })
      }

      patchTab(tabId, {
        ...activeRequestResetFragment(),
        ...responseChainResetFragment(),
        messages: [],
        error: null,
        providedChunkKeys: {},
        cumulativeSchemaTokens: 0,
        providedMemoryIds: {},
      })

      if (hadActiveStream) {
        get().restoreTabStatus(tabId)
      }
    },

    // ------ setError ------

    setError: (tabId, error) => {
      ensureTab(tabId)
      patchTab(tabId, { error })
    },

    // ------ clearError ------

    clearError: (tabId) => {
      ensureTab(tabId)
      patchTab(tabId, { error: null })
    },

    // ------ setAiReviewing ------

    setAiReviewing: (tabId) => {
      useQueryStore.getState().setTabStatus(tabId, 'ai-reviewing')
    },

    // ------ restoreTabStatus ------

    restoreTabStatus: (tabId) => {
      const queryTab = useQueryStore.getState().tabs[tabId]
      if (!queryTab) return

      // Only restore if the tab is currently in an AI lock state
      const { tabStatus, prevTabStatus } = queryTab
      if (tabStatus === 'ai-pending' || tabStatus === 'ai-reviewing') {
        useQueryStore.getState().setTabStatus(tabId, prevTabStatus)
      }
    },

    // ------ cleanupTab ------

    cleanupTab: (tabId) => {
      const tab = get().tabs[tabId]

      // Clear expansion cache for this tab
      clearExpansionCache(tabId)

      // Cancel any in-flight AI request before tearing down the tab
      if (tab?.activeStreamId) {
        cancelAiStream(tab.activeStreamId).catch((err) => {
          const errorMsg = err instanceof Error ? err.message : String(err)
          logFrontend(
            'warn',
            `[ai-store] AI cancel during cleanup for tab ${tabId} failed: ${errorMsg}`
          )
        })
      }

      if (tab?._unlisten) {
        try {
          tab._unlisten()
        } catch (err) {
          logFrontend(
            'warn',
            `[ai-store] Error calling unlisten for tab ${tabId}: ${err instanceof Error ? err.message : String(err)}`
          )
        }
      }

      set((state) => {
        const newTabs = { ...state.tabs }
        delete newTabs[tabId]
        return { tabs: newTabs }
      })
    },
  }
})
