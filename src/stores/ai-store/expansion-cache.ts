import type { AiEndpointModel } from '../ai-store'
import type { QueryExpansionRequest } from './query-expansion'

interface ExpansionCacheEntry {
  responseText: string
}

const expansionCaches = new Map<string, Map<string, ExpansionCacheEntry>>()

const EXPANSION_CACHE_SIZE = 16

export function getExpansionCacheKey(
  request: QueryExpansionRequest,
  { endpoint, model }: AiEndpointModel
): string {
  return JSON.stringify({
    sessionId: request.sessionId,
    endpoint: endpoint,
    model: model,
    userMessage: request.userMessage,
    conversationContext: request.conversationContext,
    attachedSql: request.attachedSql,
  })
}

export function lookupExpansionCache(tabId: string, key: string): ExpansionCacheEntry | null {
  const cache = expansionCaches.get(tabId)
  if (!cache) return null
  const value = cache.get(key)
  if (value === undefined) return null
  cache.delete(key)
  cache.set(key, value)
  return value
}

export function deleteExpansionCacheEntry(tabId: string, key: string): void {
  const cache = expansionCaches.get(tabId)
  if (!cache) return
  cache.delete(key)
  if (cache.size === 0) {
    expansionCaches.delete(tabId)
  }
}

export function storeExpansionCache(tabId: string, key: string, responseText: string): void {
  let cache = expansionCaches.get(tabId)
  if (!cache) {
    cache = new Map()
    expansionCaches.set(tabId, cache)
  }
  cache.delete(key)
  cache.set(key, { responseText })
  if (cache.size > EXPANSION_CACHE_SIZE) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

export function clearExpansionCache(tabId: string): void {
  expansionCaches.delete(tabId)
}
