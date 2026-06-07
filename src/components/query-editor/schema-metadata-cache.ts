/**
 * Per-connection schema metadata cache.
 * Module-level singleton — NOT a React component.
 * Manages fetching, caching, and filtering of schema metadata for autocomplete.
 */

import { listen } from '@tauri-apps/api/event'
import type {
  TableInfo,
  ColumnMeta,
  RoutineMeta,
  ViewInfo,
  TriggerInfo,
  ForeignKeyInfo,
  IndexInfo,
  SchemaMetadataFull,
  SearchableObject,
} from '../../types/schema'
import { fetchSchemaMetadataFull } from '../../lib/query-commands'
import { logFrontend } from '../../lib/app-log-commands'
import { hasTauriApis } from '../../lib/tauri-env'

export interface SchemaMetadataInvalidatedPayload {
  connectionId: string
  scope: 'tables' | 'connection'
  tables: string[]
}

export type CacheStatus = 'empty' | 'loading' | 'ready' | 'error'

export interface SchemaCache {
  status: CacheStatus
  databases: string[]
  tables: Record<string, TableInfo[]>
  views: Record<string, ViewInfo[]>
  columns: Record<string, ColumnMeta[]>
  routines: Record<string, RoutineMeta[]>
  triggers: Record<string, TriggerInfo[]>
  foreignKeys: Record<string, ForeignKeyInfo[]>
  indexes: Record<string, IndexInfo[]>
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
    views: {},
    columns: {},
    routines: {},
    triggers: {},
    foreignKeys: {},
    indexes: {},
  }
}

function hasNonEmptyName(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isNamedEntry<T extends { name?: string | null }>(entry: T | null | undefined): entry is T {
  return !!entry && hasNonEmptyName(entry.name)
}

export function sanitizeSchemaMetadata(data: SchemaMetadataFull): SchemaMetadataFull {
  const tables: Record<string, TableInfo[]> = {}
  const views: Record<string, ViewInfo[]> = {}
  const columns: Record<string, ColumnMeta[]> = {}
  const routines: Record<string, RoutineMeta[]> = {}
  const triggers: Record<string, TriggerInfo[]> = {}
  const foreignKeys: Record<string, ForeignKeyInfo[]> = {}
  const indexes: Record<string, IndexInfo[]> = {}
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

  for (const [database, viewList] of Object.entries(data.views ?? {})) {
    if (!hasNonEmptyName(database)) {
      continue
    }
    if (!Array.isArray(viewList)) {
      continue
    }

    const validViews = viewList.filter(isNamedEntry)
    if (validViews.length === 0) {
      continue
    }

    views[database] = validViews
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

  for (const [database, triggerList] of Object.entries(data.triggers ?? {})) {
    if (!hasNonEmptyName(database)) {
      continue
    }
    if (!Array.isArray(triggerList)) {
      continue
    }

    const validTriggers = triggerList.filter(isNamedEntry)
    if (validTriggers.length === 0) {
      continue
    }

    triggers[database] = validTriggers
    databases.add(database)
  }

  // Sanitize foreignKeys (keyed by "db.table")
  for (const [key, fkList] of Object.entries(data.foreignKeys)) {
    const separatorIndex = key.indexOf('.')
    if (separatorIndex <= 0 || separatorIndex >= key.length - 1) {
      continue
    }
    if (!Array.isArray(fkList)) {
      continue
    }

    const database = key.slice(0, separatorIndex)
    const table = key.slice(separatorIndex + 1)
    if (!hasNonEmptyName(database) || !hasNonEmptyName(table)) {
      continue
    }

    const validFks = fkList.filter(isNamedEntry)
    if (validFks.length === 0) {
      continue
    }

    foreignKeys[`${database}.${table}`] = validFks
    databases.add(database)
  }

  // Sanitize indexes (keyed by "db.table")
  for (const [key, idxList] of Object.entries(data.indexes)) {
    const separatorIndex = key.indexOf('.')
    if (separatorIndex <= 0 || separatorIndex >= key.length - 1) {
      continue
    }
    if (!Array.isArray(idxList)) {
      continue
    }

    const database = key.slice(0, separatorIndex)
    const table = key.slice(separatorIndex + 1)
    if (!hasNonEmptyName(database) || !hasNonEmptyName(table)) {
      continue
    }

    const validIndexes = idxList.filter(isNamedEntry)
    if (validIndexes.length === 0) {
      continue
    }

    indexes[`${database}.${table}`] = validIndexes
    databases.add(database)
  }

  return {
    databases: Array.from(databases),
    tables,
    views,
    columns,
    routines,
    triggers,
    foreignKeys,
    indexes,
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
      const data = sanitizeSchemaMetadata(await fetchSchemaMetadataFull(connectionId))

      // Check if cache was invalidated during the fetch (per-connection generation)
      if (getGeneration(connectionId) !== capturedGeneration) {
        return
      }

      const readyCache: SchemaCache = {
        status: 'ready',
        databases: data.databases,
        tables: data.tables,
        views: data.views,
        columns: data.columns,
        routines: data.routines,
        triggers: data.triggers,
        foreignKeys: data.foreignKeys,
        indexes: data.indexes,
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

export async function rebuildCache(connectionId: string): Promise<void> {
  invalidateCache(connectionId)
  await loadCache(connectionId)
}

/**
 * Refresh the cache in the background without invalidating existing data.
 * Does NOT register as a pending load, so autocomplete will not block on it.
 * On success, atomically replaces the cached data.
 * On failure, preserves the existing (stale) cache.
 */
export async function refreshCacheInBackground(connectionId: string): Promise<void> {
  const capturedGeneration = getGeneration(connectionId)
  const data = sanitizeSchemaMetadata(await fetchSchemaMetadataFull(connectionId))

  // If the cache was invalidated during the fetch, discard the result
  if (getGeneration(connectionId) !== capturedGeneration) {
    return
  }

  const readyCache: SchemaCache = {
    status: 'ready',
    databases: data.databases,
    tables: data.tables,
    views: data.views,
    columns: data.columns,
    routines: data.routines,
    triggers: data.triggers,
    foreignKeys: data.foreignKeys,
    indexes: data.indexes,
    lastRefreshAt: Date.now(),
  }
  cacheMap.set(connectionId, readyCache)
}

export async function setupSchemaInvalidationListener(): Promise<(() => void) | undefined> {
  if (!hasTauriApis()) {
    return undefined
  }

  try {
    return await listen<SchemaMetadataInvalidatedPayload>(
      'schema-metadata-invalidated',
      (event) => {
        invalidateCache(event.payload.connectionId)
        void refreshCacheInBackground(event.payload.connectionId).catch((err) => {
          logFrontend(
            'warn',
            ['[schema-metadata-cache] Background refresh after schema invalidation failed:', err]
              .map(String)
              .join(' ')
          )
        })
      }
    )
  } catch (err) {
    logFrontend(
      'warn',
      ['[schema-metadata-cache] schema-metadata-invalidated listen failed:', err]
        .map(String)
        .join(' ')
    )
    return undefined
  }
}

export function hydrateFromSnapshot(snapshotJson: string, connectionId: string): void {
  const parsed = JSON.parse(snapshotJson) as SchemaMetadataFull
  const data = sanitizeSchemaMetadata(parsed)
  cacheMap.set(connectionId, {
    status: 'ready',
    databases: data.databases,
    tables: data.tables,
    views: data.views,
    columns: data.columns,
    routines: data.routines,
    triggers: data.triggers,
    foreignKeys: data.foreignKeys,
    indexes: data.indexes,
    lastRefreshAt: Date.now(),
  })
}

export function serializeCacheSnapshot(connectionId: string): string | null {
  const cache = cacheMap.get(connectionId)
  if (!cache || cache.status !== 'ready') return null
  return JSON.stringify({
    databases: cache.databases,
    tables: cache.tables,
    views: cache.views,
    columns: cache.columns,
    routines: cache.routines,
    triggers: cache.triggers,
    foreignKeys: cache.foreignKeys,
    indexes: cache.indexes,
  } satisfies SchemaMetadataFull)
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

export function getSearchableObjects(connectionId: string): SearchableObject[] {
  const cache = cacheMap.get(connectionId)
  if (!cache || cache.status !== 'ready') return []

  const searchableObjects: SearchableObject[] = []

  for (const [database, tables] of Object.entries(cache.tables)) {
    for (const table of tables) {
      searchableObjects.push({ database, objectType: 'table', name: table.name })
    }
  }

  for (const [database, views] of Object.entries(cache.views)) {
    for (const view of views) {
      searchableObjects.push({ database, objectType: 'view', name: view.name })
    }
  }

  for (const [database, routines] of Object.entries(cache.routines)) {
    for (const routine of routines) {
      const normalizedType = routine.routineType.trim().toUpperCase()
      if (normalizedType === 'PROCEDURE') {
        searchableObjects.push({ database, objectType: 'procedure', name: routine.name })
      } else if (normalizedType === 'FUNCTION') {
        searchableObjects.push({ database, objectType: 'function', name: routine.name })
      }
    }
  }

  for (const [database, triggers] of Object.entries(cache.triggers)) {
    for (const trigger of triggers) {
      searchableObjects.push({ database, objectType: 'trigger', name: trigger.name })
    }
  }

  return searchableObjects
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
