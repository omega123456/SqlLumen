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

/** Per-connection generation counter — prevents stale fetches from repopulating after invalidation. */
const _generationMap = new Map<string, number>()

function getGeneration(connectionId: string): number {
  return _generationMap.get(connectionId) ?? 0
}

function incrementGeneration(connectionId: string): void {
  _generationMap.set(connectionId, getGeneration(connectionId) + 1)
}

function emptyCache(): SchemaCache {
  return {
    status: 'empty',
    databases: [],
    tables: {},
    columns: {},
    routines: {},
  }
}

function hasNonEmptyName(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isNamedEntry<T extends { name?: string | null }>(entry: T | null | undefined): entry is T {
  return !!entry && hasNonEmptyName(entry.name)
}

function sanitizeSchemaMetadata(data: SchemaMetadataResponse): SchemaMetadataResponse {
  const tables: Record<string, TableInfo[]> = {}
  const columns: Record<string, ColumnMeta[]> = {}
  const routines: Record<string, RoutineMeta[]> = {}
  const databases = new Set<string>()

  for (const db of data.databases) {
    if (hasNonEmptyName(db)) {
      databases.add(db)
    }
  }

  for (const [database, tableList] of Object.entries(data.tables)) {
    if (!hasNonEmptyName(database)) {
      continue
    }
    if (!Array.isArray(tableList)) {
      continue
    }

    const validTables = tableList.filter(isNamedEntry)
    if (validTables.length === 0) {
      continue
    }

    tables[database] = validTables
    databases.add(database)
  }

  for (const [key, columnList] of Object.entries(data.columns)) {
    const separatorIndex = key.indexOf('.')
    if (separatorIndex <= 0 || separatorIndex >= key.length - 1) {
      continue
    }
    if (!Array.isArray(columnList)) {
      continue
    }

    const database = key.slice(0, separatorIndex)
    const table = key.slice(separatorIndex + 1)
    if (!hasNonEmptyName(database) || !hasNonEmptyName(table)) {
      continue
    }

    const validColumns = columnList.filter(isNamedEntry)
    if (validColumns.length === 0) {
      continue
    }

    columns[`${database}.${table}`] = validColumns
    databases.add(database)
  }

  for (const [database, routineList] of Object.entries(data.routines)) {
    if (!hasNonEmptyName(database)) {
      continue
    }
    if (!Array.isArray(routineList)) {
      continue
    }

    const validRoutines = routineList.filter(isNamedEntry)
    if (validRoutines.length === 0) {
      continue
    }

    routines[database] = validRoutines
    databases.add(database)
  }

  return {
    databases: Array.from(databases),
    tables,
    columns,
    routines,
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

  const capturedGeneration = getGeneration(connectionId)

  const loadPromise = (async () => {
    try {
      const data = sanitizeSchemaMetadata(await fetchSchemaMetadata(connectionId))

      // Check if cache was invalidated during the fetch (per-connection generation)
      if (getGeneration(connectionId) !== capturedGeneration) {
        return
      }

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
      // Check if cache was invalidated during the fetch (per-connection generation)
      if (getGeneration(connectionId) !== capturedGeneration) {
        return
      }

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
    if (_pendingLoads.get(connectionId) === loadPromise) {
      _pendingLoads.delete(connectionId)
    }
  }
}

/**
 * Remove cache entry for a connection (forces re-fetch on next loadCache call).
 * Also clears pending loads and increments generation to prevent stale repopulation.
 */
export function invalidateCache(connectionId: string): void {
  cacheMap.delete(connectionId)
  _pendingLoads.delete(connectionId)
  incrementGeneration(connectionId)
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
 * Returns the in-flight load promise for a connection, or null if not loading.
 * Used by the completionService to await pending schema fetches before
 * returning completions, so the user sees schema items instead of "Loading schema…".
 */
export function getPendingLoad(connectionId: string): Promise<void> | null {
  return _pendingLoads.get(connectionId) ?? null
}

/**
 * Clear all caches. Primarily for test cleanup.
 */
export function _clearAllCaches(): void {
  cacheMap.clear()
  _pendingLoads.clear()
  _generationMap.clear()
}
