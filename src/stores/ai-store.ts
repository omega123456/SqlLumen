import { create } from 'zustand'
import { logFrontend } from '../lib/app-log-commands'
import { sendAiChat, cancelAiStream, listenToAiStream, aiQueryExpand } from '../lib/ai-commands'
import type { AiMessage as IpcAiMessage } from '../lib/ai-commands'
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
  /** DDL retrieved from vector search for the current retrieval. */
  retrievedSchemaDdl: string
  /** Timestamp of the last successful schema retrieval. */
  lastRetrievalTimestamp: number
  /** Schema-index build timestamp that produced the currently cached DDL. */
  schemaContextBuildTimestamp: number
  /** Stable key derived from the semantic-retrieval query set. */
  schemaContextQueryKey: string
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
  onStreamChunk: (tabId: string, streamId: string, content: string) => void
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

You have access to the current database schema below. Always write SQL that is compatible with MySQL/MariaDB syntax.

Use ONLY tables that appear in the retrieved schema context. Never invent, infer, assume, or reference tables that were not retrieved by semantic search.

Whenever you reference a table in generated SQL, always use its full database-qualified name (for example, \`database_name\`.\`table_name\`).

When writing SQL, prefer clear, readable queries. Format your SQL code in markdown code blocks with the sql language tag.`

/** Note appended when schema DDL is provided to inform the AI about row count availability. */
const SCHEMA_METADATA_NOTE =
  'Note: Approximate row counts are included in the schema metadata where available.'

/** Query expansion system prompt for generating semantic search queries with HyDE and entity decomposition. */
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

const SCHEMA_USAGE_INSTRUCTION = `Retrieved tables only:\n- Use only tables that are present in the retrieved schema below.\n- Never make up or reference any table that is not in the retrieved schema.\n- Always use database-qualified table names in generated SQL (\`db\`.\`table\`).`

function buildSystemPrompt(schemaDdl: string): string {
  if (!schemaDdl) {
    return AI_SYSTEM_PROMPT
  }

  return `${AI_SYSTEM_PROMPT}\n\n${SCHEMA_USAGE_INSTRUCTION}\n\n${SCHEMA_METADATA_NOTE}\n\nDatabase schema:\n${schemaDdl}`
}

function normaliseSchemaQueryKey(queries: string[]): string {
  return JSON.stringify(
    Array.from(
      new Set(queries.map((query) => query.trim()).filter((query) => query.length > 0))
    ).sort()
  )
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

/** LRU cache of expansion results, keyed by tab ID. Uses Map insertion order. */
const expansionCaches = new Map<string, Map<string, string[]>>()
const EXPANSION_CACHE_SIZE = 16

function getExpansionCacheKey(
  model: string,
  userMessage: string,
  conversationContext: string,
  attachedSql: string
): string {
  // FNV-1a hash for a compact, collision-resistant cache key
  const raw = `${model}|${userMessage}|${conversationContext}|${attachedSql}`
  let hash = 2166136261
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function lookupExpansionCache(tabId: string, key: string): string[] | null {
  const cache = expansionCaches.get(tabId)
  if (!cache) return null
  const value = cache.get(key)
  if (value === undefined) return null
  // Move to end (most recently used)
  cache.delete(key)
  cache.set(key, value)
  return value
}

function storeExpansionCache(tabId: string, key: string, queries: string[]): void {
  let cache = expansionCaches.get(tabId)
  if (!cache) {
    cache = new Map()
    expansionCaches.set(tabId, cache)
  }
  // Delete first to refresh insertion order if key already exists
  cache.delete(key)
  cache.set(key, queries)
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
): string[] {
  try {
    const parsed = JSON.parse(text)
    const allQueries: string[] = [userMessage]

    // Extract queries array
    if (parsed && Array.isArray(parsed.queries) && parsed.queries.length > 0) {
      for (const q of parsed.queries) {
        if (typeof q === 'string') {
          const trimmed = q.trim()
          if (trimmed.length > 0) allQueries.push(trimmed)
        }
      }
    }

    // HyDE: add hypothetical SQL fragment as another search query
    if (
      hydeEnabled &&
      typeof parsed.hypotheticalSql === 'string' &&
      parsed.hypotheticalSql.trim().length > 0
    ) {
      allQueries.push(parsed.hypotheticalSql.trim())
    }

    // Entity + relationship decomposition: flatten into additional search strings
    if (Array.isArray(parsed.entities) && parsed.entities.length > 0) {
      const entityStr = parsed.entities.filter((e: unknown) => typeof e === 'string').join(' ')
      if (entityStr.trim().length > 0) allQueries.push(entityStr.trim())
    }

    if (Array.isArray(parsed.joins) && parsed.joins.length > 0) {
      const joinStr = parsed.joins.filter((j: unknown) => typeof j === 'string').join(' ')
      if (joinStr.trim().length > 0) allQueries.push(joinStr.trim())
    }

    if (Array.isArray(parsed.metrics) && parsed.metrics.length > 0) {
      const metricsStr = parsed.metrics.filter((m: unknown) => typeof m === 'string').join(' ')
      if (metricsStr.trim().length > 0) allQueries.push(metricsStr.trim())
    }

    // Dedup and cap
    return Array.from(new Set(allQueries)).slice(0, maxQueries)
  } catch {
    // JSON parse failed — return original message only
    logFrontend(
      'debug',
      `[ai-store] expansion response JSON parse failed — falling back to original query`
    )
    return [userMessage]
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
   * Replace or insert the system message in the tab's conversation.
   * If a system message already exists, update its content.
   * If not, prepend a new one.
   */
  function upsertSystemMessage(tabId: string, systemContent: string): void {
    const currentTab = get().tabs[tabId]
    if (!currentTab) return

    const existingIdx = currentTab.messages.findIndex((m) => m.role === 'system')
    if (existingIdx >= 0) {
      // Update existing system message content (replace, not stack)
      const updatedMessages = [...currentTab.messages]
      updatedMessages[existingIdx] = {
        ...updatedMessages[existingIdx],
        content: systemContent,
        timestamp: Date.now(),
      }
      patchTab(tabId, { messages: updatedMessages })
    } else {
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
  }

  function getCurrentSystemPrompt(tabId: string): string {
    return get().tabs[tabId]?.messages.find((message) => message.role === 'system')?.content ?? ''
  }

  function resetResponseChain(tabId: string): void {
    if (!get().tabs[tabId]) return

    patchTab(tabId, {
      previousResponseId: null,
      lastCompletedSystemPrompt: '',
      lastCompletedTransport: null,
      lastCompletedEndpoint: '',
      lastCompletedModel: '',
    })
  }

  /**
   * Retrieve schema context via the vector retrieval pipeline.
   *
   * 1. Wait for schema index if building
   * 2. Expand user query via aiQueryExpand (HyDE + entity decomposition + conversation context)
   * 3. Perform semantic search
   * 4. Assemble DDL context from results
   */
  async function retrieveSchemaContext(
    tabId: string,
    sessionId: string,
    userMessage: string
  ): Promise<string> {
    try {
      logFrontend(
        'debug',
        `[ai-store] retrieveSchemaContext start — tabId=${tabId} sessionId=${sessionId} userQuery="${userMessage}"`
      )

      let schemaQueryKey = ''

      const getCachedSchemaContext = (queryKey: string) => {
        const indexStatus = useSchemaIndexStore.getState().getStatusForSession(sessionId)
        const currentTab = get().tabs[tabId]
        const cachedDdl = currentTab?.retrievedSchemaDdl
        const cachedTimestamp = currentTab?.lastRetrievalTimestamp ?? 0

        if (
          indexStatus?.status === 'ready' &&
          cachedDdl &&
          cachedTimestamp > 0 &&
          indexStatus.lastBuildTimestamp > 0 &&
          currentTab.schemaContextBuildTimestamp === indexStatus.lastBuildTimestamp &&
          currentTab.schemaContextQueryKey === queryKey &&
          currentTab?.connectionId === sessionId &&
          currentTab.messages.some((message) => message.role === 'assistant')
        ) {
          logFrontend(
            'debug',
            `[ai-store] reusing tab schema context — tabId=${tabId} sessionId=${sessionId} buildTs=${indexStatus.lastBuildTimestamp} ddlChars=${cachedDdl.length}`
          )

          return cachedDdl
        }

        return null
      }

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
        if (!get().tabs[tabId]) return ''
      }

      // Build conversation context from last ~4 turns
      const tabState = get().tabs[tabId]
      let conversationContext = ''
      if (tabState) {
        const recentMessages = tabState.messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .slice(-8) // last 4 turns = 8 messages max
          .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
        if (recentMessages.length > 0) {
          conversationContext = recentMessages.join('\n')
        }
      }

      // Include attached SQL context if present
      const attachedSql = tabState?.attachedContext?.sql ?? ''

      // Query expansion — get search queries with HyDE and entity decomposition
      let queries: string[] = [userMessage]
      try {
        const getSetting = useSettingsStore.getState().getSetting
        const endpoint = getSetting('ai.endpoint')
        const model = getSetting('ai.model')
        const hydeEnabled = getSetting('ai.retrieval.hydeEnabled') !== 'false'
        const maxQueries = parseInt(getSetting('ai.retrieval.expansionMaxQueries') || '8', 10)
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
            model,
            userMessage,
            conversationContext,
            attachedSql
          )
          const cached = lookupExpansionCache(tabId, cacheKey)

          if (cached) {
            queries = cached
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
            queries = parseExpansionResponse(
              result.text,
              userMessage,
              hydeEnabled,
              effectiveMaxQueries
            )

            logFrontend(
              'debug',
              `[ai-store] query expansion succeeded — transformedQueries=${JSON.stringify(queries)}`
            )

            // Cache the result
            storeExpansionCache(tabId, cacheKey, queries)
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

      schemaQueryKey = normaliseSchemaQueryKey(queries)

      const cachedSchemaDdl = getCachedSchemaContext(schemaQueryKey)
      if (cachedSchemaDdl != null) {
        return cachedSchemaDdl
      }

      logFrontend(
        'debug',
        `[ai-store] invoking semantic search — sessionId=${sessionId} queryCount=${queries.length} queries=${JSON.stringify(queries)}`
      )

      // ── Assemble retrieval hints ──────────────────────────────────────
      const hints: RetrievalHints = {
        recentTables: [],
        editorTables: [],
        acceptedTables: [],
      }

      try {
        const recentQueryWindow = parseInt(
          useSettingsStore.getState().getSetting('ai.retrieval.recentQueryWindow') || '20',
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
      const tokenBudget = parseInt(
        useSettingsStore.getState().getSetting('ai.retrieval.tokenBudget') || '6000',
        10
      )
      const effectiveBudget = isNaN(tokenBudget) || tokenBudget <= 0 ? 6000 : tokenBudget

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
      let runningTokens = 0
      let droppedCount = 0

      for (const result of sortedResults) {
        if (seen.has(result.chunkKey)) continue
        seen.add(result.chunkKey)

        // Build per-chunk header
        const typeLabel =
          result.chunkType === 'view'
            ? 'View'
            : result.chunkType === 'procedure'
              ? 'Procedure'
              : result.chunkType === 'function'
                ? 'Function'
                : result.chunkType === 'fk'
                  ? 'FK'
                  : 'Table'
        const header = `## ${typeLabel} \`${result.dbName}\`.\`${result.tableName}\`  (score: ${result.score.toFixed(2)})`
        const block = `${header}\n${result.ddlText}`
        const blockTokens = Math.ceil(block.length / 4)

        if (runningTokens + blockTokens > effectiveBudget) {
          droppedCount++
          break
        }

        runningTokens += blockTokens
        ddlParts.push(block)
      }

      if (droppedCount > 0) {
        logFrontend(
          'debug',
          `[ai-store] token budget: dropped ${droppedCount} chunk(s) exceeding budget of ${effectiveBudget} tokens`
        )
      }

      const ddl = ddlParts.join('\n\n')

      logFrontend(
        'debug',
        `[ai-store] DDL assembly complete — uniqueChunks=${ddlParts.length} totalCharsInDdl=${ddl.length}`
      )

      // Update tab state (only if tab still exists — it may have been cleaned up)
      const retrievalTimestamp = Date.now()
      const latestIndexState = useSchemaIndexStore.getState().getStatusForSession(sessionId)
      const schemaContextBuildTimestamp = latestIndexState?.lastBuildTimestamp ?? 0
      if (get().tabs[tabId]) {
        patchTab(tabId, {
          retrievedSchemaDdl: ddl,
          lastRetrievalTimestamp: retrievalTimestamp,
          schemaContextBuildTimestamp,
          schemaContextQueryKey: schemaQueryKey,
        })
      }

      if (ddl) {
        logFrontend(
          'debug',
          `[ai-store] cached schema context on tab — tabId=${tabId} sessionId=${sessionId} buildTs=${schemaContextBuildTimestamp} ddlChars=${ddl.length}`
        )
      }

      logFrontend(
        'debug',
        `[ai-store] retrieveSchemaContext complete — ddl ${ddl.length > 0 ? `injected (${ddl.length} chars)` : 'empty (no schema context)'}`
      )

      return ddl
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logFrontend('error', `[ai-store] Schema retrieval failed: ${msg}`)
      showErrorToast('Schema retrieval failed', msg)
      if (get().tabs[tabId]) {
        patchTab(tabId, { isWaitingForIndex: false })
      }
      return ''
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
          // Retrieve schema context via the vector pipeline
          const schemaDdl = await retrieveSchemaContext(tabId, connectionId, message)
          if (!get().tabs[tabId]) return // tab was cleaned up while waiting

          // Guard: schema retrieval is async; abort if stream was cancelled before we got here
          if (get().tabs[tabId]?.activeStreamId !== streamId || !get().tabs[tabId]?.isGenerating) {
            return
          }

          // Build and upsert system message with retrieved schema
          const previousSystemPrompt = getCurrentSystemPrompt(tabId)
          const nextSystemPrompt = buildSystemPrompt(schemaDdl)

          if (previousSystemPrompt && previousSystemPrompt !== nextSystemPrompt) {
            resetResponseChain(tabId)
          }

          upsertSystemMessage(tabId, nextSystemPrompt)

          if (!get().tabs[tabId]) return // tab was cleaned up

          // Set up event listeners for this stream
          const unlisten = await listenToAiStream(streamId, {
            onChunk: (content) => get().onStreamChunk(tabId, streamId, content),
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

          // Read AI settings from the settings store
          const getSetting = useSettingsStore.getState().getSetting
          const endpoint = getSetting('ai.endpoint')
          const model = settings.model ?? getSetting('ai.model')
          const temperature = settings.temperature ?? parseFloat(getSetting('ai.temperature'))
          const maxTokens = settings.maxTokens ?? parseInt(getSetting('ai.maxTokens'), 10)

          patchTab(tabId, {
            activeRequestEndpoint: endpoint,
            activeRequestModel: model,
          })

          // Build IPC messages from the current conversation
          const currentMessages = get().tabs[tabId]?.messages ?? []
          const currentSystemPrompt = getCurrentSystemPrompt(tabId)

          const ipcMessages: IpcAiMessage[] = currentMessages.map((m) => ({
            role: m.role,
            content: m.content,
          }))

          // Inject attached SQL context as a separate message before the user's prompt
          if (attachedContext) {
            const contextMessage: IpcAiMessage = {
              role: 'user',
              content: `The following SQL statement is the context for this conversation:\n\n\`\`\`sql\n${attachedContext.sql}\n\`\`\``,
            }
            // Insert the context message just before the last user message
            const lastUserIdx = ipcMessages.length - 1
            ipcMessages.splice(lastUserIdx, 0, contextMessage)
          }

          // Start the stream
          await sendAiChat({
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
            preferResponsesApi: true,
          })
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          logFrontend('error', `[ai-store] AI chat failed: ${errorMsg}`)

          if (get().tabs[tabId]) {
            // Clean up orphaned event listeners before resetting state
            callUnlistenSafely(tabId, get().tabs[tabId])

            patchTab(tabId, {
              isGenerating: false,
              activeStreamId: null,
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
        isGenerating: false,
        activeStreamId: null,
        previousResponseId: null,
        lastCompletedSystemPrompt: '',
        lastCompletedTransport: null,
        lastCompletedEndpoint: '',
        lastCompletedModel: '',
        activeRequestEndpoint: '',
        activeRequestModel: '',
        activeStreamHasAssistantOutput: false,
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
      const lastUserMessage = [...tab.messages].reverse().find((m) => m.role === 'user')
      if (!lastUserMessage) return

      // Remove the last user message and any assistant messages after it
      const lastUserIndex = tab.messages.lastIndexOf(lastUserMessage)
      const messagesUpToLastUser = tab.messages.slice(0, lastUserIndex)

      patchTab(tabId, {
        messages: messagesUpToLastUser,
        error: null,
        previousResponseId: null,
        lastCompletedSystemPrompt: '',
        lastCompletedTransport: null,
        lastCompletedEndpoint: '',
        lastCompletedModel: '',
        activeRequestEndpoint: '',
        activeRequestModel: '',
        activeStreamHasAssistantOutput: false,
      })

      // Re-send the message
      get().sendMessage(tabId, connectionId, lastUserMessage.content, settings)
    },

    // ------ onStreamChunk ------

    onStreamChunk: (tabId, streamId, content) => {
      // Stale-stream guard: ignore events from a previous stream that was superseded
      const tab = get().tabs[tabId]
      if (!tab || tab.activeStreamId !== streamId) return

      const messages = [...tab.messages]
      const lastMessage = messages[messages.length - 1]

      if (lastMessage && lastMessage.role === 'assistant') {
        // Append to existing assistant message
        messages[messages.length - 1] = {
          ...lastMessage,
          content: lastMessage.content + content,
        }
      } else {
        // Create a new assistant message
        messages.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content,
          timestamp: Date.now(),
        })
      }

      patchTab(tabId, {
        messages,
        isGenerating: true,
        activeStreamId: streamId,
        activeStreamHasAssistantOutput: true,
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
        isGenerating: false,
        activeStreamId: null,
        previousResponseId: canReuseResponsesChain ? (info.responseId ?? null) : null,
        lastCompletedSystemPrompt: canReuseResponsesChain
          ? (tab.messages.find((message) => message.role === 'system')?.content ?? '')
          : '',
        lastCompletedTransport: info.transport ?? null,
        lastCompletedEndpoint: canReuseResponsesChain ? tab.activeRequestEndpoint : '',
        lastCompletedModel: canReuseResponsesChain ? tab.activeRequestModel : '',
        activeRequestEndpoint: '',
        activeRequestModel: '',
        activeStreamHasAssistantOutput: false,
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
        isGenerating: false,
        error,
        activeStreamId: null,
        previousResponseId: null,
        lastCompletedSystemPrompt: '',
        lastCompletedTransport: null,
        lastCompletedEndpoint: '',
        lastCompletedModel: '',
        activeRequestEndpoint: '',
        activeRequestModel: '',
        activeStreamHasAssistantOutput: false,
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
    },

    // ------ clearAttachedContext ------

    clearAttachedContext: (tabId) => {
      ensureTab(tabId)
      patchTab(tabId, { attachedContext: null })
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
        messages: [],
        error: null,
        isGenerating: false,
        activeStreamId: null,
        previousResponseId: null,
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
