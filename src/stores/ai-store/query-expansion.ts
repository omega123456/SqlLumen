import { aiQueryExpand } from '../../lib/ai-commands'
import type { AiMemory } from '../../lib/ai-memory-commands'
import { logFrontend } from '../../lib/app-log-commands'
import { toErrorMessage } from '../../lib/error-message'
import type { AiEndpointModel, AiMessage, TabAiState } from '../ai-store'
import { getAiSetting } from './chat-actions'
import { isPromptOnlyContextMessage } from './context-messages'
import {
  deleteExpansionCacheEntry,
  getExpansionCacheKey,
  lookupExpansionCache,
  storeExpansionCache,
} from './expansion-cache'
import { QUERY_EXPANSION_SYSTEM_PROMPT, parseExpansionResponse } from './expansion-parsing'
import type { ExpansionParseOptions } from './expansion-parsing'
import { readPositiveIntegerSetting } from './schema-retrieval'

const RECENT_CONVERSATION_MESSAGE_LIMIT = 8

const CONVERSATION_SNIPPET_MAX_CHARS = 200

const DEFAULT_EXPANSION_MAX_QUERIES = 8

const EXPANSION_MAX_QUERIES_CAP = 10

function isConversationMessage(message: AiMessage): boolean {
  const isChatRole = message.role === 'user' || message.role === 'assistant'
  return isChatRole && !isPromptOnlyContextMessage(message)
}

export function buildExpansionConversationContext(
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

export interface QueryExpansionRequest {
  tabId: string
  sessionId: string
  userMessage: string
  conversationContext: string
  attachedSql: string
}

interface QueryExpansionTarget extends AiEndpointModel {
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
    cacheKey: getExpansionCacheKey(request, { endpoint: endpoint, model: model }),
    parseOptions: options,
  }
  const cached = lookupExpansionCache(request.tabId, target.cacheKey)
  if (cached) {
    return queriesFromCachedExpansion(request, target, cached.responseText)
  }
  return fetchExpansionQueries(request, target)
}

export async function expandSearchQueries(request: QueryExpansionRequest): Promise<string[]> {
  try {
    return await expandSearchQueriesWithModel(request)
  } catch (error) {
    const message = toErrorMessage(error)
    logFrontend('warn', `[ai-store] Query expansion fallback: ${message}`)
    logFrontend('debug', `[ai-store] falling back to original query: "${request.userMessage}"`)
    return [request.userMessage]
  }
}
