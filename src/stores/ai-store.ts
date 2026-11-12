import { create } from 'zustand'
import { sendAiChat, cancelAiStream, listenToAiStream, aiQueryExpand } from '../lib/ai-commands'
import { searchMemories } from '../lib/ai-memory-commands'
import type { AiMemory, MemoryScope } from '../lib/ai-memory-commands'
import type { AiMessage as IpcAiMessage, AiChunkKind } from '../lib/ai-commands'
import { semanticSearch } from '../lib/schema-index-commands'
import type { RetrievalHints } from '../lib/schema-index-commands'
import { useSchemaIndexStore } from './schema-index-store'
import { useSettingsStore } from './settings-store'
import { useQueryStore } from './query-store'
import { useAiFeedbackStore } from './ai-feedback-store'
import { showErrorToast } from './toast-store'

import { logFrontend } from '../lib/app-log-commands'
import { estimateTokenCount } from '../lib/schema-ddl-compactor'
import { toErrorMessage } from '../lib/error-message'
import { isAiLockStatus } from '../lib/query-tab-status'
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
  /**
   * Composite dedup keys (`${scope}-${id}`) for memories injected by this
   * memory-context message. Composite because ids are only unique within a
   * level (three separate autoincrement tables).
   */
  memoryIds?: string[]
}

/**
 * Order memories Global → Group → Connection. Within a scope the input order is
 * preserved (callers pass relevance-ordered results).
 */
const MEMORY_SCOPE_ORDER: Record<MemoryScope, number> = {
  global: 0,
  group: 1,
  connection: 2,
}

/** Composite dedup key for a memory — unique across levels. */
function memoryKey(memory: Pick<AiMemory, 'scope' | 'id'>): string {
  return `${memory.scope ?? 'connection'}-${memory.id}`
}

/** Stable sort merged memories by scope specificity (Global → Group → Connection). */
function sortMemoriesByScope(memories: AiMemory[]): AiMemory[] {
  return memories
    .map((memory, index) => ({ memory, index }))
    .sort((left, right) => {
      const scopeDiff =
        (MEMORY_SCOPE_ORDER[left.memory.scope] ?? MEMORY_SCOPE_ORDER.connection) -
        (MEMORY_SCOPE_ORDER[right.memory.scope] ?? MEMORY_SCOPE_ORDER.connection)
      if (scopeDiff !== 0) return scopeDiff
      return left.index - right.index
    })
    .map((entry) => entry.memory)
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

The application may inject additional context messages containing relevant schema, SQL, or user-note context.

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

const DATABASE_AND_TABLE_PART_COUNT = 2
const RECENT_CONVERSATION_MESSAGE_LIMIT = 8
const CONVERSATION_SNIPPET_MAX_CHARS = 200
const DEFAULT_EXPANSION_MAX_QUERIES = 8
const EXPANSION_MAX_QUERIES_CAP = 10
const DEFAULT_RECENT_QUERY_WINDOW = 20
const RECENCY_WEIGHT_DECAY_RANGE = 0.95
const DEFAULT_RETRIEVAL_TOKEN_BUDGET = 6000
const DEFAULT_TEMPERATURE = 0.3
const DEFAULT_MAX_TOKENS = 2048
const CHUNK_TYPE_SORT_ORDER: Record<string, number> = { table: 0, view: 1, fk: 3 }
const OTHER_CHUNK_TYPE_SORT_ORDER = 2

function chunkTypeSortOrder(chunkType: string): number {
  return CHUNK_TYPE_SORT_ORDER[chunkType] ?? OTHER_CHUNK_TYPE_SORT_ORDER
}

function buildAttachedContextMessage(sql: string): string {
  return `The following SQL statement is the context for this conversation:\n\n\`\`\`sql\n${sql}\n\`\`\``
}

function shouldReuseResponseChain(
  tab: TabAiState | undefined,
  systemPrompt: string | undefined,
  endpoint: string,
  model: string
): boolean {
  if (!tab?.previousResponseId) return false
  if (!systemPrompt) return false

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

function splitQualifiedTableName(qualifiedName: string): { dbName: string; tableName: string } {
  const parts = qualifiedName.split('.').map((part) => part.replace(/`/g, '').trim())
  if (parts.length === DATABASE_AND_TABLE_PART_COUNT) {
    return { dbName: parts[0], tableName: parts[1] }
  }
  if (parts.length === 1) {
    return { dbName: '', tableName: parts[0] }
  }
  return { dbName: '', tableName: '' }
}

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
    const { dbName, tableName } = splitQualifiedTableName(match[1])
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

interface ExpansionParseOptions {
  userMessage: string
  hydeEnabled: boolean
  maxQueries: number
}

interface ExpansionParse {
  queries: string[]
  isCacheable: boolean
}

const RECOGNISED_EXPANSION_FIELDS = ['queries', 'hypotheticalSql', 'entities', 'joins', 'metrics']

function fallbackExpansion(userMessage: string, reason: string): ExpansionParse {
  logFrontend('debug', `[ai-store] ${reason} — falling back to original query`)
  return {
    queries: [userMessage],
    isCacheable: false,
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && !Array.isArray(value) && typeof value === 'object'
}

function hasRecognisedExpansionField(payload: Record<string, unknown>): boolean {
  return RECOGNISED_EXPANSION_FIELDS.some((field) => field in payload)
}

function appendTrimmedQuery(queries: string[], value: unknown): void {
  if (typeof value !== 'string') return
  const trimmed = value.trim()
  if (trimmed.length > 0) {
    queries.push(trimmed)
  }
}

function appendJoinedField(queries: string[], value: unknown): void {
  if (!Array.isArray(value)) return
  const joined = value
    .filter((item: unknown): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .join(' ')
  if (joined.length > 0) {
    queries.push(joined)
  }
}

function collectExpansionQueries(
  payload: Record<string, unknown>,
  options: ExpansionParseOptions
): string[] {
  const allQueries: string[] = [options.userMessage]
  const listedQueries: unknown[] = Array.isArray(payload.queries) ? payload.queries : []
  for (const query of listedQueries) {
    appendTrimmedQuery(allQueries, query)
  }
  if (options.hydeEnabled) {
    appendTrimmedQuery(allQueries, payload.hypotheticalSql)
  }
  appendJoinedField(allQueries, payload.entities)
  appendJoinedField(allQueries, payload.joins)
  appendJoinedField(allQueries, payload.metrics)
  return Array.from(new Set(allQueries)).slice(0, options.maxQueries)
}

function hasDerivedExpansion(queries: string[], userMessage: string): boolean {
  const trimmedUserMessage = userMessage.trim()
  return queries.some((query) => query.trim() !== trimmedUserMessage)
}

/**
 * Parse the structured expansion response with a multi-level fallback chain:
 * 1. Full structured (queries + hypotheticalSql + entities/joins/metrics)
 * 2. Flat queries-only
 * 3. Original user message
 */
function parseExpansionResponse(text: string, options: ExpansionParseOptions): ExpansionParse {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return fallbackExpansion(options.userMessage, 'expansion response JSON parse failed')
  }
  if (!isJsonObject(parsed)) {
    return fallbackExpansion(options.userMessage, 'expansion response had invalid JSON shape')
  }
  if (!hasRecognisedExpansionField(parsed)) {
    return fallbackExpansion(options.userMessage, 'expansion response missing structured fields')
  }
  const dedupedQueries = collectExpansionQueries(parsed, options)
  if (!hasDerivedExpansion(dedupedQueries, options.userMessage)) {
    return fallbackExpansion(
      options.userMessage,
      'expansion response produced no usable derived queries'
    )
  }
  return {
    queries: dedupedQueries,
    isCacheable: true,
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

type SemanticSearchResult = Awaited<ReturnType<typeof semanticSearch>>[number]

interface SchemaContext {
  schemaDdl: string
  novelChunkKeys: string[]
  novelDdlTokens: number
  novelMemories: AiMemory[]
  novelMemoryText: string | null
}

const SCHEMA_INDEX_WAIT_MAX_MS = 30000
const SCHEMA_INDEX_POLL_INTERVAL_MS = 500
const MEMORY_SEARCH_RESULT_LIMIT = 5
const MEMORY_SECTION_HEADER = '## User Notes (from memory)\n'

function emptySchemaContext(): SchemaContext {
  return {
    schemaDdl: '',
    novelChunkKeys: [],
    novelDdlTokens: 0,
    novelMemories: [],
    novelMemoryText: null,
  }
}

function readPositiveIntegerSetting(key: string, fallback: number): number {
  const value = parseInt(getAiSetting(key) || String(fallback), 10)
  const isUsable = !isNaN(value) && value > 0
  return isUsable ? value : fallback
}

function isSchemaIndexBuilding(sessionId: string): boolean {
  return useSchemaIndexStore.getState().getStatusForSession(sessionId)?.status === 'building'
}

async function pollWhileSchemaIndexBuilds(sessionId: string): Promise<number> {
  let waited = 0
  while (waited < SCHEMA_INDEX_WAIT_MAX_MS) {
    await new Promise((resolve) => setTimeout(resolve, SCHEMA_INDEX_POLL_INTERVAL_MS))
    waited += SCHEMA_INDEX_POLL_INTERVAL_MS
    if (!isSchemaIndexBuilding(sessionId)) break
  }
  return waited
}

async function retrieveMemories(sessionId: string, userMessage: string): Promise<AiMemory[]> {
  try {
    logFrontend(
      'debug',
      `[ai-store] searching memories for context — sessionId=${sessionId} query="${userMessage}"`
    )
    const memoryResults = await searchMemories({
      sessionId: sessionId,
      query: userMessage,
      k: MEMORY_SEARCH_RESULT_LIMIT,
    })
    const memories = sortMemoriesByScope(memoryResults)
    logFrontend(
      'debug',
      `[ai-store] memory search returned ${memories.length} result(s) — sessionId=${sessionId}`
    )
    return memories
  } catch (error) {
    const message = toErrorMessage(error)
    logFrontend('debug', `[ai-store] memory retrieval failed (non-fatal) — error="${message}"`)
    logFrontend('warn', `[ai-store] Memory retrieval failed (non-fatal): ${message}`)
    return []
  }
}

interface MemoryContext {
  text: string | null
  includedMemories: AiMemory[]
}

function buildNovelMemoryContext(novelMemories: AiMemory[]): MemoryContext {
  const memoryLines: string[] = []
  const includedMemories: AiMemory[] = []
  let usedTokens = estimateTokenCount(MEMORY_SECTION_HEADER)
  for (const memory of novelMemories) {
    const line = `- ${memory.content}`
    const lineTokens = estimateTokenCount(line)
    if (usedTokens + lineTokens > MEMORY_TOKEN_BUDGET) break
    memoryLines.push(line)
    includedMemories.push(memory)
    usedTokens += lineTokens
  }
  const text = memoryLines.length > 0 ? `${MEMORY_SECTION_HEADER}${memoryLines.join('\n')}` : null
  return { text: text, includedMemories: includedMemories }
}

function isConversationMessage(message: AiMessage): boolean {
  const isChatRole = message.role === 'user' || message.role === 'assistant'
  return isChatRole && !isPromptOnlyContextMessage(message)
}

function buildExpansionConversationContext(
  tabState: TabAiState | undefined,
  allMemories: AiMemory[]
): string {
  if (!tabState) return ''
  const conversation = tabState.messages
    .filter(isConversationMessage)
    .slice(-RECENT_CONVERSATION_MESSAGE_LIMIT)
    .map(
      (message) => `${message.role}: ${message.content.slice(0, CONVERSATION_SNIPPET_MAX_CHARS)}`
    )
    .join('\n')
  if (allMemories.length === 0) return conversation
  const memoryNotes = allMemories.map((memory) => memory.content).join('\n')
  logFrontend(
    'debug',
    `[ai-store] query expansion augmented with ${allMemories.length} memory note(s) — notes="${memoryNotes.replace(/\n/g, ' | ')}"`
  )
  return `${conversation}\n\nUser notes:\n${memoryNotes}`
}

interface QueryExpansionRequest {
  tabId: string
  sessionId: string
  userMessage: string
  conversationContext: string
  attachedSql: string
}

interface QueryExpansionTarget {
  endpoint: string
  model: string
  cacheKey: string
  parseOptions: ExpansionParseOptions
}

function evictInvalidCachedExpansion(tabId: string, cacheKey: string): void {
  deleteExpansionCacheEntry(tabId, cacheKey)
  logFrontend('warn', `[ai-store] query expansion cache entry was invalid and has been evicted`)
}

function queriesFromCachedExpansion(
  request: QueryExpansionRequest,
  target: QueryExpansionTarget,
  cachedResponseText: string
): string[] {
  const cachedParse = parseExpansionResponse(cachedResponseText, target.parseOptions)
  if (!cachedParse.isCacheable) {
    evictInvalidCachedExpansion(request.tabId, target.cacheKey)
  }
  const queries = cachedParse.isCacheable ? cachedParse.queries : [request.userMessage]
  logFrontend('debug', `[ai-store] query expansion cache hit — ${queries.length} queries`)
  return queries
}

function expansionUserMessage(request: QueryExpansionRequest): string {
  if (!request.attachedSql) return request.userMessage
  return `Context SQL:\n\`\`\`sql\n${request.attachedSql}\n\`\`\`\n\nQuestion: ${request.userMessage}`
}

async function fetchExpansionQueries(
  request: QueryExpansionRequest,
  target: QueryExpansionTarget
): Promise<string[]> {
  const result = await aiQueryExpand({
    endpoint: target.endpoint,
    model: target.model,
    systemPrompt: QUERY_EXPANSION_SYSTEM_PROMPT,
    userMessage: expansionUserMessage(request),
    conversationContext: request.conversationContext || undefined,
  })
  logFrontend('debug', `[ai-store] query expansion raw response: ${result.text}`)
  const parsedExpansion = parseExpansionResponse(result.text, target.parseOptions)
  logFrontend(
    'debug',
    `[ai-store] query expansion succeeded — transformedQueries=${JSON.stringify(parsedExpansion.queries)}`
  )
  // Only well-formed responses are cached so malformed output cannot poison follow-up retrieval.
  if (!parsedExpansion.isCacheable) {
    logFrontend('debug', `[ai-store] query expansion cache skipped — malformed expansion response`)
    return parsedExpansion.queries
  }
  storeExpansionCache(request.tabId, target.cacheKey, result.text)
  return parsedExpansion.queries
}

async function expandSearchQueriesWithModel(request: QueryExpansionRequest): Promise<string[]> {
  const endpoint = getAiSetting('ai.endpoint')
  const model = getAiSetting('ai.model')
  const options: ExpansionParseOptions = {
    userMessage: request.userMessage,
    hydeEnabled: getAiSetting('ai.retrieval.hydeEnabled') !== 'false',
    maxQueries: Math.min(
      readPositiveIntegerSetting('ai.retrieval.expansionMaxQueries', DEFAULT_EXPANSION_MAX_QUERIES),
      EXPANSION_MAX_QUERIES_CAP
    ),
  }
  const endpointState = endpoint ? '[set]' : '[unset]'
  logFrontend(
    'debug',
    `[ai-store] query expansion — endpoint=${endpointState} model=${model || '[unset]'} hyde=${options.hydeEnabled}`
  )
  const isMissingEndpointOrModel = !endpoint || !model
  if (isMissingEndpointOrModel) {
    logFrontend(
      'debug',
      `[ai-store] query expansion skipped — missing endpoint or model, using original user query`
    )
    return [request.userMessage]
  }
  const target: QueryExpansionTarget = {
    endpoint: endpoint,
    model: model,
    cacheKey: getExpansionCacheKey(
      request.sessionId,
      endpoint,
      model,
      request.userMessage,
      request.conversationContext,
      request.attachedSql
    ),
    parseOptions: options,
  }
  const cached = lookupExpansionCache(request.tabId, target.cacheKey)
  if (cached) {
    return queriesFromCachedExpansion(request, target, cached.responseText)
  }
  return fetchExpansionQueries(request, target)
}

async function expandSearchQueries(request: QueryExpansionRequest): Promise<string[]> {
  try {
    return await expandSearchQueriesWithModel(request)
  } catch (error) {
    const message = toErrorMessage(error)
    logFrontend('warn', `[ai-store] Query expansion fallback: ${message}`)
    logFrontend('debug', `[ai-store] falling back to original query: "${request.userMessage}"`)
    return [request.userMessage]
  }
}

function isNonBlankText(text: string | undefined): text is string {
  return Boolean(text?.trim())
}

function keepHeavierWeight(weights: Map<string, number>, key: string, weight: number): void {
  const existingWeight = weights.get(key)
  const isExistingWeightHeavier = existingWeight !== undefined && existingWeight >= weight
  if (isExistingWeightHeavier) return
  weights.set(key, weight)
}

function recentTableHints(recentQueryWindow: number): RetrievalHints['recentTables'] {
  const recentQueries = Object.values(useQueryStore.getState().tabs)
    .map((tab) => tab.content)
    .filter(isNonBlankText)
    .slice(0, recentQueryWindow)
  const tableWeights = new Map<string, number>()
  recentQueries.forEach((sql, index) => {
    const weight = 1.0 - (index / recentQueryWindow) * RECENCY_WEIGHT_DECAY_RANGE
    for (const table of extractTablesFromSql(sql)) {
      keepHeavierWeight(tableWeights, `${table.dbName}.${table.tableName}`, weight)
    }
  })
  const hints: RetrievalHints['recentTables'] = []
  for (const [key, weight] of tableWeights) {
    const [dbName, tableName] = key.split('.')
    if (dbName && tableName) {
      hints.push({ dbName, tableName, weight })
    }
  }
  return hints
}

function acceptedTableHints(sessionId: string): RetrievalHints['acceptedTables'] {
  const feedbackEntries = useAiFeedbackStore.getState().getAcceptedTables(sessionId)
  return feedbackEntries.map((entry) => ({
    dbName: entry.dbName,
    tableName: entry.tableName,
    weight: entry.weight,
  }))
}

function assembleRetrievalHints(sessionId: string, attachedSql: string): RetrievalHints {
  const hints: RetrievalHints = {
    recentTables: [],
    editorTables: [],
    acceptedTables: [],
  }
  try {
    const recentQueryWindow = readPositiveIntegerSetting(
      'ai.retrieval.recentQueryWindow',
      DEFAULT_RECENT_QUERY_WINDOW
    )
    if (attachedSql) {
      hints.editorTables = extractTablesFromSql(attachedSql)
    }
    hints.acceptedTables = acceptedTableHints(sessionId)
    hints.recentTables = recentTableHints(recentQueryWindow)
    logFrontend(
      'debug',
      `[ai-store] assembled hints — recent=${hints.recentTables.length} editor=${hints.editorTables.length} accepted=${hints.acceptedTables.length}`
    )
  } catch (error) {
    const message = toErrorMessage(error)
    logFrontend('warn', `[ai-store] hint assembly failed (non-fatal): ${message}`)
  }
  return hints
}

function logSemanticSearchResults(results: SemanticSearchResult[]): void {
  const summary = results.map((result) => ({
    chunkKey: result.chunkKey,
    dbName: result.dbName,
    tableName: result.tableName,
    chunkType: result.chunkType,
    score: result.score,
  }))
  logFrontend(
    'debug',
    `[ai-store] semantic search returned ${results.length} result(s): ${JSON.stringify(summary)}`
  )
}

interface DdlBudget {
  perTurnTokens: number
  remainingCumulativeTokens: number
  providedChunkKeys: Record<string, boolean>
}

function resolveDdlBudget(tab: TabAiState | undefined): DdlBudget {
  const tokenBudget = readPositiveIntegerSetting(
    'ai.retrieval.tokenBudget',
    DEFAULT_RETRIEVAL_TOKEN_BUDGET
  )
  const cumulativeBudget = Math.max(CUMULATIVE_SCHEMA_TOKEN_BUDGET_DEFAULT, tokenBudget)
  const usedCumulativeTokens = tab?.cumulativeSchemaTokens ?? 0
  return {
    perTurnTokens: Math.max(tokenBudget - MEMORY_TOKEN_BUDGET, 0),
    remainingCumulativeTokens: Math.max(cumulativeBudget - usedCumulativeTokens, 0),
    providedChunkKeys: tab?.providedChunkKeys ?? {},
  }
}

function compareSearchResults(left: SemanticSearchResult, right: SemanticSearchResult): number {
  const leftOrder = chunkTypeSortOrder(left.chunkType)
  const rightOrder = chunkTypeSortOrder(right.chunkType)
  if (leftOrder !== rightOrder) return leftOrder - rightOrder
  return right.score - left.score
}

function exceedsDdlBudget(runningTokens: number, blockTokens: number, budget: DdlBudget): boolean {
  const nextTokens = runningTokens + blockTokens
  const exceedsPerTurnBudget = nextTokens > budget.perTurnTokens && runningTokens > 0
  return exceedsPerTurnBudget || nextTokens > budget.remainingCumulativeTokens
}

interface DdlSelection {
  ddlParts: string[]
  novelChunkKeys: string[]
  tokens: number
  droppedCount: number
}

function selectNovelDdlChunks(results: SemanticSearchResult[], budget: DdlBudget): DdlSelection {
  const sortedResults = [...results].sort(compareSearchResults)
  const seen = new Set<string>()
  const selection: DdlSelection = { ddlParts: [], novelChunkKeys: [], tokens: 0, droppedCount: 0 }
  for (const result of sortedResults) {
    if (seen.has(result.chunkKey)) continue
    seen.add(result.chunkKey)
    if (budget.providedChunkKeys[result.chunkKey]) continue
    const blockTokens = estimateTokenCount(result.ddlText)
    if (exceedsDdlBudget(selection.tokens, blockTokens, budget)) {
      selection.droppedCount++
      break
    }
    selection.tokens += blockTokens
    selection.ddlParts.push(result.ddlText)
    selection.novelChunkKeys.push(result.chunkKey)
  }
  return selection
}

function logDdlSelection(selection: DdlSelection, ddl: string): void {
  if (selection.droppedCount > 0) {
    logFrontend(
      'debug',
      `[ai-store] token budget: dropped ${selection.droppedCount} chunk(s) exceeding budget`
    )
  }
  logFrontend(
    'debug',
    `[ai-store] DDL assembly complete — novelChunks=${selection.ddlParts.length} totalCharsInDdl=${ddl.length}`
  )
  const ddlState = ddl.length > 0 ? `injected (${ddl.length} chars)` : 'empty (no schema context)'
  logFrontend('debug', `[ai-store] retrieveSchemaContext complete — ddl ${ddlState}`)
}

type AiStreamDone = Parameters<AiState['onStreamDone']>[2]
type ContextMessageDraft = Pick<AiMessage, 'role' | 'content' | 'kind'>

const TURN_CONTEXT_KINDS = new Set<string>(['schema-context', 'memory-context', 'attached-context'])
const REMOVABLE_TURN_CONTEXT_KINDS = new Set<string>(['schema-context', 'memory-context'])

function findBaseSystemPrompt(messages: AiMessage[]): string {
  const systemMessage = messages.find(
    (message) => message.role === 'system' && !isPromptOnlyContextMessage(message)
  )
  return systemMessage?.content ?? ''
}

function indicesOfKind(messages: AiMessage[], kind: AiMessage['kind']): number[] {
  const indices: number[] = []
  messages.forEach((message, index) => {
    if (message.kind === kind) indices.push(index)
  })
  return indices
}

function isSameContextMessage(existing: AiMessage, draft: ContextMessageDraft): boolean {
  return existing.role === draft.role && existing.content === draft.content
}

function upsertContextMessage(
  messages: AiMessage[],
  userIndex: number,
  draft: ContextMessageDraft
): boolean {
  if (!draft.kind) return false
  const [primaryIndex, ...duplicateIndices] = indicesOfKind(messages, draft.kind)
  for (const duplicateIndex of duplicateIndices.reverse()) {
    messages.splice(duplicateIndex, 1)
  }
  const removedDuplicates = duplicateIndices.length > 0

  if (primaryIndex === undefined) {
    messages.splice(userIndex, 0, {
      id: crypto.randomUUID(),
      role: draft.role,
      content: draft.content,
      timestamp: Date.now(),
      kind: draft.kind,
    })
    return true
  }

  const existingMessage = messages[primaryIndex]
  if (isSameContextMessage(existingMessage, draft)) return removedDuplicates
  messages[primaryIndex] = {
    ...existingMessage,
    role: draft.role,
    content: draft.content,
    timestamp: Date.now(),
    kind: draft.kind,
  }
  return true
}

function mergeChunkIntoAssistantMessage(
  message: AiMessage,
  content: string,
  kind: AiChunkKind
): AiMessage {
  if (kind === 'thinking') {
    return { ...message, thinkingContent: (message.thinkingContent ?? '') + content }
  }
  return { ...message, content: message.content + content }
}

function assistantMessageFromChunk(content: string, kind: AiChunkKind): AiMessage {
  const message: AiMessage = {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: content,
    timestamp: Date.now(),
  }
  if (kind === 'thinking') {
    return { ...message, content: '', thinkingContent: content }
  }
  return message
}

function applyChunkToMessages(
  messages: AiMessage[],
  content: string,
  kind: AiChunkKind
): AiMessage[] {
  const updated = [...messages]
  const last = updated[updated.length - 1]
  if (last?.role === 'assistant') {
    updated[updated.length - 1] = mergeChunkIntoAssistantMessage(last, content, kind)
    return updated
  }
  updated.push(assistantMessageFromChunk(content, kind))
  return updated
}

function resolveTemperature(override: number | undefined): number {
  const temperature = override ?? parseFloat(getAiSetting('ai.temperature'))
  return isNaN(temperature) ? DEFAULT_TEMPERATURE : temperature
}

function resolveMaxTokens(override: number | undefined): number {
  const maxTokens = override ?? parseInt(getAiSetting('ai.maxTokens'), 10)
  return isNaN(maxTokens) ? DEFAULT_MAX_TOKENS : maxTokens
}

function findLastUserMessage(messages: AiMessage[]): AiMessage | undefined {
  return [...messages]
    .reverse()
    .find((message) => message.role === 'user' && !isPromptOnlyContextMessage(message))
}

function isTurnContextMessage(message: AiMessage): boolean {
  return message.kind !== undefined && TURN_CONTEXT_KINDS.has(message.kind)
}

function findRemovableTurnContextIndices(messages: AiMessage[], userIndex: number): number[] {
  const indices: number[] = []
  for (let scanIndex = userIndex - 1; scanIndex >= 0; scanIndex--) {
    const message = messages[scanIndex]
    if (!isTurnContextMessage(message)) break
    if (REMOVABLE_TURN_CONTEXT_KINDS.has(message.kind ?? '')) {
      indices.push(scanIndex)
    }
  }
  return indices
}

interface RemovedContextIds {
  chunkKeys: string[]
  memoryIds: string[]
}

function collectRemovedContextIds(messages: AiMessage[], indices: number[]): RemovedContextIds {
  const removed: RemovedContextIds = { chunkKeys: [], memoryIds: [] }
  for (const index of indices) {
    const message = messages[index]
    if (message.kind === 'schema-context') {
      removed.chunkKeys.push(...(message.chunkKeys ?? []))
    }
    if (message.kind === 'memory-context') {
      removed.memoryIds.push(...(message.memoryIds ?? []))
    }
  }
  return removed
}

function withoutKeys(record: Record<string, true>, keys: string[]): Record<string, true> {
  const remaining = { ...record }
  for (const key of keys) {
    delete remaining[key]
  }
  return remaining
}

function withKeys(record: Record<string, true>, keys: string[]): Record<string, true> {
  const extended = { ...record }
  for (const key of keys) {
    extended[key] = true
  }
  return extended
}

function sumSchemaContextTokens(messages: AiMessage[]): number {
  return messages
    .filter((message) => message.kind === 'schema-context')
    .reduce((total, message) => total + estimateTokenCount(message.content), 0)
}

function canReuseResponsesChain(tab: TabAiState, info: AiStreamDone): boolean {
  const hasResponseId = (info.responseId?.trim().length ?? 0) > 0
  return info.transport === 'responses' && tab.activeStreamHasAssistantOutput && hasResponseId
}

function completedResponseChainFragment(tab: TabAiState, info: AiStreamDone): Partial<TabAiState> {
  const lastCompletedTransport = info.transport ?? null
  if (!canReuseResponsesChain(tab, info)) {
    return {
      previousResponseId: null,
      lastCompletedSystemPrompt: '',
      lastCompletedTransport: lastCompletedTransport,
      lastCompletedEndpoint: '',
      lastCompletedModel: '',
    }
  }
  return {
    previousResponseId: info.responseId ?? null,
    lastCompletedSystemPrompt: findBaseSystemPrompt(tab.messages),
    lastCompletedTransport: lastCompletedTransport,
    lastCompletedEndpoint: tab.activeRequestEndpoint,
    lastCompletedModel: tab.activeRequestModel,
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
  const tabForActiveStream = (tabId: string, streamId: string): TabAiState | undefined => {
    const tab = get().tabs[tabId]
    if (tab?.activeStreamId !== streamId) return undefined
    return tab
  }

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
      } catch (error) {
        logFrontend('warn', `[ai-store] Removing the stream listener failed: ${String(error)}`)
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

    const existingIndex = currentTab.messages.findIndex(
      (message) => message.role === 'system' && !isPromptOnlyContextMessage(message)
    )
    if (existingIndex >= 0) {
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
    const userIndex = nextMessages.findIndex((message) => message.id === userMessageId)
    if (userIndex < 0) return

    nextMessages.splice(userIndex, 0, message)
    patchTab(tabId, { messages: nextMessages })
  }

  function getCurrentSystemPrompt(tabId: string): string {
    return findBaseSystemPrompt(get().tabs[tabId]?.messages ?? [])
  }

  function upsertPromptOnlyContextMessages(
    tabId: string,
    userMessageId: string,
    contextMessages: ContextMessageDraft[]
  ): void {
    const currentTab = get().tabs[tabId]
    if (!currentTab) return
    if (contextMessages.length === 0) return

    const nextMessages = [...currentTab.messages]
    const userIndex = nextMessages.findIndex((message) => message.id === userMessageId)
    if (userIndex < 0) return

    let changed = false
    for (const contextMessage of contextMessages) {
      if (upsertContextMessage(nextMessages, userIndex, contextMessage)) {
        changed = true
      }
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
    if (!currentTab) return
    if (kinds.length === 0) return

    const kindSet = new Set(kinds)
    const nextMessages = currentTab.messages.filter(
      (message) => !(message.kind && kindSet.has(message.kind))
    )

    const hasRemovedMessages = nextMessages.length !== currentTab.messages.length
    if (hasRemovedMessages) {
      patchTab(tabId, { messages: nextMessages })
    }
  }

  function resetResponseChain(tabId: string): void {
    if (!get().tabs[tabId]) return
    patchTab(tabId, responseChainResetFragment())
  }

  async function waitForBuildingSchemaIndex(tabId: string, sessionId: string): Promise<boolean> {
    const indexState = useSchemaIndexStore.getState().getStatusForSession(sessionId)
    logFrontend(
      'debug',
      `[ai-store] schema index status for session=${sessionId}: ${indexState?.status ?? 'unknown'}`
    )
    if (indexState?.status !== 'building') return true

    logFrontend('debug', `[ai-store] index is building — waiting (tabId=${tabId})`)
    if (get().tabs[tabId]) {
      patchTab(tabId, { isWaitingForIndex: true })
    }
    const waited = await pollWhileSchemaIndexBuilds(sessionId)
    const postWaitStatus = useSchemaIndexStore.getState().getStatusForSession(sessionId)
    logFrontend(
      'debug',
      `[ai-store] done waiting for index — waited=${waited}ms finalStatus=${postWaitStatus?.status ?? 'unknown'}`
    )
    patchTab(tabId, { isWaitingForIndex: false })
    return Boolean(get().tabs[tabId])
  }

  function selectNovelMemories(tabId: string, allMemories: AiMemory[]): MemoryContext {
    const existingMemoryIds = get().tabs[tabId]?.providedMemoryIds ?? {}
    const novelMemories = allMemories.filter((memory) => !existingMemoryIds[memoryKey(memory)])
    const memoryContext = buildNovelMemoryContext(novelMemories)
    if (novelMemories.length > 0) {
      logFrontend(
        'debug',
        `[ai-store] memory retrieval complete — total=${allMemories.length} novel=${novelMemories.length} included=${memoryContext.includedMemories.length} budgetTokens=${MEMORY_TOKEN_BUDGET}`
      )
    }
    return memoryContext
  }

  async function retrieveSchemaContextUnsafe(
    tabId: string,
    sessionId: string,
    userMessage: string
  ): Promise<SchemaContext> {
    logFrontend(
      'debug',
      `[ai-store] retrieveSchemaContext start — tabId=${tabId} sessionId=${sessionId} userQuery="${userMessage}"`
    )
    const isTabStillOpen = await waitForBuildingSchemaIndex(tabId, sessionId)
    if (!isTabStillOpen) return emptySchemaContext()

    const allMemories = await retrieveMemories(sessionId, userMessage)
    const memoryContext = selectNovelMemories(tabId, allMemories)
    const tabState = get().tabs[tabId]
    const attachedSql = tabState?.attachedContext?.sql ?? ''
    const queries = await expandSearchQueries({
      tabId: tabId,
      sessionId: sessionId,
      userMessage: userMessage,
      conversationContext: buildExpansionConversationContext(tabState, allMemories),
      attachedSql: attachedSql,
    })
    const hints = assembleRetrievalHints(sessionId, attachedSql)

    logFrontend(
      'debug',
      `[ai-store] invoking semantic search — sessionId=${sessionId} queryCount=${queries.length} queries=${JSON.stringify(queries)}`
    )
    const results = await semanticSearch(sessionId, queries, hints)
    logSemanticSearchResults(results)

    const selection = selectNovelDdlChunks(results, resolveDdlBudget(get().tabs[tabId]))
    const ddl = selection.ddlParts.join('\n\n')
    logDdlSelection(selection, ddl)
    return {
      schemaDdl: ddl,
      novelChunkKeys: selection.novelChunkKeys,
      novelDdlTokens: selection.tokens,
      novelMemories: memoryContext.includedMemories,
      novelMemoryText: memoryContext.text,
    }
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
  ): Promise<SchemaContext> {
    try {
      return await retrieveSchemaContextUnsafe(tabId, sessionId, userMessage)
    } catch (error) {
      const message = toErrorMessage(error)
      logFrontend('error', `[ai-store] Schema retrieval failed: ${message}`)
      showErrorToast('Schema retrieval failed', message)
      if (get().tabs[tabId]) {
        patchTab(tabId, { isWaitingForIndex: false })
      }
      return emptySchemaContext()
    }
  }

  function appendNovelContextMessages(
    tabId: string,
    userMessageId: string,
    context: SchemaContext
  ): void {
    const hasNovelSchemaChunks = context.novelChunkKeys.length > 0
    const hasNovelMemories = context.novelMemories.length > 0
    if (context.schemaDdl && hasNovelSchemaChunks) {
      appendContextMessage(tabId, userMessageId, {
        id: crypto.randomUUID(),
        role: 'user',
        content: context.schemaDdl,
        timestamp: Date.now(),
        kind: 'schema-context',
        chunkKeys: context.novelChunkKeys,
      })
    }
    if (context.novelMemoryText && hasNovelMemories) {
      appendContextMessage(tabId, userMessageId, {
        id: crypto.randomUUID(),
        role: 'user',
        content: context.novelMemoryText,
        timestamp: Date.now(),
        kind: 'memory-context',
        memoryIds: context.novelMemories.map((memory) => memoryKey(memory)),
      })
    }
  }

  function syncAttachedContextMessage(
    tabId: string,
    userMessageId: string,
    attachedContext: AttachedContext | null
  ): void {
    if (!attachedContext) {
      removePromptOnlyContextMessages(tabId, ['attached-context'])
      return
    }
    upsertPromptOnlyContextMessages(tabId, userMessageId, [
      {
        role: 'user' as const,
        content: buildAttachedContextMessage(attachedContext.sql),
        kind: 'attached-context' as const,
      },
    ])
  }

  function recordProvidedContext(tabId: string, context: SchemaContext): void {
    const hasNovelContext = context.novelChunkKeys.length > 0 || context.novelMemories.length > 0
    if (!hasNovelContext) return
    const currentTabState = get().tabs[tabId]
    if (!currentTabState) return
    patchTab(tabId, {
      providedChunkKeys: withKeys(currentTabState.providedChunkKeys, context.novelChunkKeys),
      cumulativeSchemaTokens: currentTabState.cumulativeSchemaTokens + context.novelDdlTokens,
      providedMemoryIds: withKeys(
        currentTabState.providedMemoryIds,
        context.novelMemories.map((memory) => memoryKey(memory))
      ),
    })
  }

  /**
   * Apply current-turn context messages: retrieve schema/memory, insert context
   * messages before the user message, and update dedup indices.
   */
  async function applyCurrentTurnContext(
    tabId: string,
    connectionId: string,
    turn: { userMessage: AiMessage; attachedContext: AttachedContext | null }
  ): Promise<void> {
    const context = await retrieveSchemaContext(tabId, connectionId, turn.userMessage.content)
    if (!get().tabs[tabId]) return

    ensureBaseSystemPrompt(tabId, AI_SYSTEM_PROMPT)
    appendNovelContextMessages(tabId, turn.userMessage.id, context)
    syncAttachedContextMessage(tabId, turn.userMessage.id, turn.attachedContext)
    recordProvidedContext(tabId, context)
  }

  function isActiveStream(tabId: string, streamId: string): boolean {
    const tab = get().tabs[tabId]
    return tab?.activeStreamId === streamId && tab.isGenerating
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
    const enableReasoning = getAiSetting('ai.enableReasoning') !== 'false'
    const preferResponsesApi = getAiSetting('ai.preferResponsesApi') === 'true'

    patchTab(tabId, {
      activeRequestEndpoint: endpoint,
      activeRequestModel: model,
    })

    const tab = get().tabs[tabId]
    const currentSystemPrompt = getCurrentSystemPrompt(tabId)
    const ipcMessages: IpcAiMessage[] = (tab?.messages ?? []).map((message) => ({
      role: message.role,
      content: message.content,
    }))
    const reusesResponseChain = shouldReuseResponseChain(tab, currentSystemPrompt, endpoint, model)

    return {
      messages: ipcMessages,
      endpoint: endpoint,
      model: model,
      temperature: resolveTemperature(settings.temperature),
      maxTokens: resolveMaxTokens(settings.maxTokens),
      streamId: streamId,
      previousResponseId: reusesResponseChain ? (tab?.previousResponseId ?? null) : null,
      preferResponsesApi: preferResponsesApi,
      enableReasoning: enableReasoning,
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
        connectionId: connectionId,
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

      const startStream = async () => {
        try {
          await applyCurrentTurnContext(tabId, connectionId, {
            userMessage: userMessage,
            attachedContext: attachedContext,
          })
          if (!isActiveStream(tabId, streamId)) return

          const unlisten = await listenToAiStream(streamId, {
            onChunk: (content, kind) => get().onStreamChunk(tabId, streamId, content, kind),
            onDone: (info) => get().onStreamDone(tabId, streamId, info),
            onError: (error) => get().onStreamError(tabId, streamId, error),
          })

          if (!isActiveStream(tabId, streamId)) {
            unlisten()
            return
          }

          get().setUnlisten(tabId, unlisten)
          const payload = buildSendAiChatPayload(tabId, streamId, settings)
          await sendAiChat(payload)
        } catch (error) {
          const errorMessage = toErrorMessage(error)
          logFrontend('error', `[ai-store] AI chat failed: ${errorMessage}`)
          if (!get().tabs[tabId]) return
          callUnlistenSafely(tabId, get().tabs[tabId])
          patchTab(tabId, {
            ...activeRequestResetFragment(),
            error: errorMessage,
          })
          get().restoreTabStatus(tabId)
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
      cancelAiStream(streamId).catch((error) => {
        const errorMessage = toErrorMessage(error)
        logFrontend('warn', `[ai-store] AI cancel failed: ${errorMessage}`)
      })
    },

    // ------ retryLastMessage ------

    retryLastMessage: (tabId, connectionId, settings) => {
      const tab = get().tabs[tabId]
      if (!tab) return

      const lastUserMessage = findLastUserMessage(tab.messages)
      if (!lastUserMessage) return

      const lastUserIndex = tab.messages.lastIndexOf(lastUserMessage)
      const indicesToRemove = findRemovableTurnContextIndices(tab.messages, lastUserIndex)
      const removed = collectRemovedContextIds(tab.messages, indicesToRemove)
      const removeSet = new Set(indicesToRemove)
      const remainingMessages = tab.messages.filter(
        (_, index) => !removeSet.has(index) && index < lastUserIndex
      )

      patchTab(tabId, {
        ...activeRequestResetFragment(),
        ...responseChainResetFragment(),
        messages: remainingMessages,
        error: null,
        providedChunkKeys: withoutKeys(tab.providedChunkKeys, removed.chunkKeys),
        providedMemoryIds: withoutKeys(tab.providedMemoryIds, removed.memoryIds),
        cumulativeSchemaTokens: sumSchemaContextTokens(remainingMessages),
      })

      get().sendMessage(tabId, connectionId, lastUserMessage.content, settings)
    },

    // ------ onStreamChunk ------

    onStreamChunk: (tabId, streamId, content, kind) => {
      const tab = tabForActiveStream(tabId, streamId)
      if (!tab) return

      const messages = applyChunkToMessages(tab.messages, content, kind)

      patchTab(tabId, {
        messages: messages,
        isGenerating: true,
        activeStreamId: streamId,
        ...(kind !== 'thinking' && { activeStreamHasAssistantOutput: true }),
      })
    },

    // ------ onStreamDone ------

    onStreamDone: (tabId, streamId, info) => {
      const tab = tabForActiveStream(tabId, streamId)
      if (!tab) return

      patchTab(tabId, {
        ...activeRequestResetFragment(),
        ...completedResponseChainFragment(tab, info),
      })

      // Tear down event listeners now that the stream is complete
      callUnlistenSafely(tabId, tab)

      // Restore the editor — generation is complete
      get().restoreTabStatus(tabId)
    },

    // ------ onStreamError ------

    onStreamError: (tabId, streamId, error) => {
      const tab = tabForActiveStream(tabId, streamId)
      if (!tab) return

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

      const attachedSqlMessage = buildAttachedContextMessage(context.sql)
      if (currentAttachedMessage?.content !== attachedSqlMessage) {
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
        cancelAiStream(tab.activeStreamId).catch((error) => {
          const errorMessage = toErrorMessage(error)
          logFrontend(
            'warn',
            `[ai-store] AI cancel during clearConversation failed: ${errorMessage}`
          )
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
      const { tabStatus, prevTabStatus: previousTabStatus } = queryTab
      if (isAiLockStatus(tabStatus)) {
        useQueryStore.getState().setTabStatus(tabId, previousTabStatus)
      }
    },

    // ------ cleanupTab ------

    cleanupTab: (tabId) => {
      const tab = get().tabs[tabId]

      // Clear expansion cache for this tab
      clearExpansionCache(tabId)

      // Cancel any in-flight AI request before tearing down the tab
      if (tab?.activeStreamId) {
        cancelAiStream(tab.activeStreamId).catch((error) => {
          const errorMessage = toErrorMessage(error)
          logFrontend(
            'warn',
            `[ai-store] AI cancel during cleanup for tab ${tabId} failed: ${errorMessage}`
          )
        })
      }

      if (tab?._unlisten) {
        try {
          tab._unlisten()
        } catch (error) {
          logFrontend(
            'warn',
            `[ai-store] Error calling unlisten for tab ${tabId}: ${toErrorMessage(error)}`
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
