/**
 * Per-connection schema metadata cache.
 * Module-level singleton — NOT a React component.
 * Manages fetching, caching, and filtering of schema metadata for autocomplete.
 */

import type { TableInfo, ColumnMeta, RoutineMeta, SchemaMetadataResponse } from '../../types/schema'
import { fetchSchemaMetadata } from '../../lib/query-commands'

export type CacheStatus = 'empty' | 'loading' | 'ready' | 'error'

export interface SchemaCache {
  status: CacheStatus
  databases: string[]
  tables: Record<string, TableInfo[]>
  columns: Record<string, ColumnMeta[]>
  routines: Record<string, RoutineMeta[]>
  error?: string
  lastRefreshAt?: number
}

/** Internal cache map — one entry per connection. */
const cacheMap = new Map<string, SchemaCache>()

/** In-flight load promises — prevents concurrent callers from racing. */
const _pendingLoads = new Map<string, Promise<void>>()

function emptyCache(): SchemaCache {
  return {
    status: 'empty',
    databases: [],
    tables: {},
    columns: {},
    routines: {},
  }
}

/**
 * Get current cache for a connection. Returns an empty cache if none exists.
 */
export function getCache(connectionId: string): SchemaCache {
  return cacheMap.get(connectionId) ?? emptyCache()
}

/**
 * Fetch and populate the cache for a connection.
 * No-op if cache status is already 'ready'.
 * Retries on 'error' status.
 * Concurrent callers await the same in-flight promise.
 */
export async function loadCache(connectionId: string): Promise<void> {
  const existing = cacheMap.get(connectionId)
  if (existing?.status === 'ready') return

  // If already loading, return the existing promise so callers await the same fetch
  if (_pendingLoads.has(connectionId)) {
    return _pendingLoads.get(connectionId)!
  }

  const loadingCache: SchemaCache = {
    ...emptyCache(),
    status: 'loading',
  }
  cacheMap.set(connectionId, loadingCache)

  const loadPromise = (async () => {
    try {
      const data: SchemaMetadataResponse = await fetchSchemaMetadata(connectionId)
      const readyCache: SchemaCache = {
        status: 'ready',
        databases: data.databases,
        tables: data.tables,
        columns: data.columns,
        routines: data.routines,
        lastRefreshAt: Date.now(),
      }
      cacheMap.set(connectionId, readyCache)
    } catch (err) {
      const errorCache: SchemaCache = {
        ...emptyCache(),
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      }
      cacheMap.set(connectionId, errorCache)
    }
  })()

  _pendingLoads.set(connectionId, loadPromise)
  try {
    await loadPromise
  } finally {
    _pendingLoads.delete(connectionId)
  }
}

/**
 * Remove cache entry for a connection (forces re-fetch on next loadCache call).
 */
export function invalidateCache(connectionId: string): void {
  cacheMap.delete(connectionId)
}

/**
 * Filter databases by case-insensitive prefix.
 */
export function filterDatabases(connectionId: string, prefix: string): string[] {
  const cache = cacheMap.get(connectionId)
  if (!cache || cache.status !== 'ready') return []
  const lowerPrefix = prefix.toLowerCase()
  return cache.databases.filter((db) => db.toLowerCase().startsWith(lowerPrefix))
}

/**
 * Filter tables for a given database by case-insensitive prefix.
 */
export function filterTables(connectionId: string, database: string, prefix: string): TableInfo[] {
  const cache = cacheMap.get(connectionId)
  if (!cache || cache.status !== 'ready') return []
  const tables = cache.tables[database] ?? []
  const lowerPrefix = prefix.toLowerCase()
  return tables.filter((t) => t.name.toLowerCase().startsWith(lowerPrefix))
}

/**
 * Filter columns for a given database.table by case-insensitive prefix.
 */
export function filterColumns(
  connectionId: string,
  database: string,
  table: string,
  prefix: string
): ColumnMeta[] {
  const cache = cacheMap.get(connectionId)
  if (!cache || cache.status !== 'ready') return []
  const key = `${database}.${table}`
  const cols = cache.columns[key] ?? []
  const lowerPrefix = prefix.toLowerCase()
  return cols.filter((c) => c.name.toLowerCase().startsWith(lowerPrefix))
}

/**
 * Filter routines for a given database by case-insensitive prefix.
 */
export function filterRoutines(
  connectionId: string,
  database: string,
  prefix: string
): RoutineMeta[] {
  const cache = cacheMap.get(connectionId)
  if (!cache || cache.status !== 'ready') return []
  const routines = cache.routines[database] ?? []
  const lowerPrefix = prefix.toLowerCase()
  return routines.filter((r) => r.name.toLowerCase().startsWith(lowerPrefix))
}

/**
 * Clear all caches. Primarily for test cleanup.
 */
export function _clearAllCaches(): void {
  cacheMap.clear()
  _pendingLoads.clear()
}
