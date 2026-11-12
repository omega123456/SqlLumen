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
import { logFrontendWarning } from '../../lib/app-log-commands'
import { hasTauriApis } from '../../lib/tauri-env'
import { toErrorMessage } from '../../lib/error-message'

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

type NamedEntry = { name?: string | null }

function namedEntriesOf<Entry extends NamedEntry>(entries: Entry[]): Entry[] {
  if (!Array.isArray(entries)) return []
  return entries.filter(isNamedEntry)
}

function sanitizeByDatabase<Entry extends NamedEntry>(
  source: Record<string, Entry[]>,
  databases: Set<string>
): Record<string, Entry[]> {
  const sanitized: Record<string, Entry[]> = {}
  for (const [database, entries] of Object.entries(source)) {
    if (!hasNonEmptyName(database)) continue
    const validEntries = namedEntriesOf(entries)
    if (validEntries.length === 0) continue
    sanitized[database] = validEntries
    databases.add(database)
  }
  return sanitized
}

interface TableKey {
  database: string
  table: string
}

function splitTableKey(key: string): TableKey | null {
  const separatorIndex = key.indexOf('.')
  if (separatorIndex <= 0 || separatorIndex >= key.length - 1) return null
  const database = key.slice(0, separatorIndex)
  const table = key.slice(separatorIndex + 1)
  if (!hasNonEmptyName(database) || !hasNonEmptyName(table)) return null
  return { database: database, table: table }
}

function sanitizeByTableKey<Entry extends NamedEntry>(
  source: Record<string, Entry[]>,
  databases: Set<string>
): Record<string, Entry[]> {
  const sanitized: Record<string, Entry[]> = {}
  for (const [key, entries] of Object.entries(source)) {
    const tableKey = splitTableKey(key)
    if (!tableKey) continue
    const validEntries = namedEntriesOf(entries)
    if (validEntries.length === 0) continue
    sanitized[`${tableKey.database}.${tableKey.table}`] = validEntries
    databases.add(tableKey.database)
  }
  return sanitized
}

export function sanitizeSchemaMetadata(data: SchemaMetadataFull): SchemaMetadataFull {
  const databases = new Set<string>(data.databases.filter(hasNonEmptyName))
  const tables = sanitizeByDatabase(data.tables, databases)
  const views = sanitizeByDatabase(data.views ?? {}, databases)
  const columns = sanitizeByTableKey(data.columns, databases)
  const routines = sanitizeByDatabase(data.routines, databases)
  const triggers = sanitizeByDatabase(data.triggers ?? {}, databases)
  const foreignKeys = sanitizeByTableKey(data.foreignKeys, databases)
  const indexes = sanitizeByTableKey(data.indexes, databases)

  return {
    databases: Array.from(databases),
    tables: tables,
    views: views,
    columns: columns,
    routines: routines,
    triggers: triggers,
    foreignKeys: foreignKeys,
    indexes: indexes,
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
    } catch (error) {
      // Check if cache was invalidated during the fetch (per-connection generation)
      if (getGeneration(connectionId) !== capturedGeneration) {
        return
      }

      const errorCache: SchemaCache = {
        ...emptyCache(),
        status: 'error',
        error: toErrorMessage(error),
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
        void refreshCacheInBackground(event.payload.connectionId).catch((error) => {
          logFrontendWarning(
            '[schema-metadata-cache] Background refresh after schema invalidation failed:',
            error
          )
        })
      }
    )
  } catch (error) {
    logFrontendWarning('[schema-metadata-cache] schema-metadata-invalidated listen failed:', error)
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
  return tables.filter((table) => table.name.toLowerCase().startsWith(lowerPrefix))
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
  const columns = cache.columns[key] ?? []
  const lowerPrefix = prefix.toLowerCase()
  return columns.filter((column) => column.name.toLowerCase().startsWith(lowerPrefix))
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
  return routines.filter((routine) => routine.name.toLowerCase().startsWith(lowerPrefix))
}

type SearchableObjectType = SearchableObject['objectType']

const ROUTINE_OBJECT_TYPES: Partial<Record<string, SearchableObjectType>> = {
  PROCEDURE: 'procedure',
  FUNCTION: 'function',
}

function searchableEntries(
  source: Record<string, { name: string }[]>,
  objectType: SearchableObjectType
): SearchableObject[] {
  return Object.entries(source).flatMap(([database, entries]) =>
    entries.map((entry) => ({ database: database, objectType: objectType, name: entry.name }))
  )
}

function searchableRoutines(routinesByDatabase: Record<string, RoutineMeta[]>): SearchableObject[] {
  const searchableObjects: SearchableObject[] = []
  for (const [database, routines] of Object.entries(routinesByDatabase)) {
    for (const routine of routines) {
      const objectType = ROUTINE_OBJECT_TYPES[routine.routineType.trim().toUpperCase()]
      if (!objectType) continue
      searchableObjects.push({ database: database, objectType: objectType, name: routine.name })
    }
  }
  return searchableObjects
}

export function getSearchableObjects(connectionId: string): SearchableObject[] {
  const cache = cacheMap.get(connectionId)
  if (!cache || cache.status !== 'ready') return []

  return [
    ...searchableEntries(cache.tables, 'table'),
    ...searchableEntries(cache.views, 'view'),
    ...searchableRoutines(cache.routines),
    ...searchableEntries(cache.triggers, 'trigger'),
  ]
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
