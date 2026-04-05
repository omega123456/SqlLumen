/**
 * Per-connection routine parameter cache.
 * Module-level singleton — NOT a React component.
 * Manages fetching, caching, and invalidation of stored routine parameter metadata.
 */

import type { RoutineParameter } from '../../types/schema'
import { getRoutineParametersWithReturnType } from '../../lib/object-editor-commands'
import { logFrontend } from '../../lib/app-log-commands'

export interface RoutineParameterCacheEntry {
  parameters: RoutineParameter[] // ordinalPosition > 0 rows only
  returnType: string | null // from ordinalPosition === 0 row's dataType, null for procedures
  routineType: 'FUNCTION' | 'PROCEDURE'
  fetchedAt: number // Date.now()
}

/** Cache storage — key format: `connectionId:db:routineName:routineType` */
const cacheMap = new Map<string, RoutineParameterCacheEntry | null>()

/** In-flight fetch promises — prevents concurrent callers from racing. */
const pendingFetches = new Map<string, Promise<RoutineParameterCacheEntry | null>>()

/** Per-connection generation counter — prevents stale fetches from repopulating after invalidation. */
const generationMap = new Map<string, number>()

function getGeneration(connectionId: string): number {
  return generationMap.get(connectionId) ?? 0
}

function incrementGeneration(connectionId: string): void {
  generationMap.set(connectionId, getGeneration(connectionId) + 1)
}

function makeCacheKey(
  connectionId: string,
  database: string,
  routineName: string,
  routineType: string
): string {
  return `${connectionId}:${database.toLowerCase()}:${routineName.toLowerCase()}:${routineType.toLowerCase()}`
}

/**
 * Get cached routine parameters for a stored procedure or function.
 * Fetches lazily on first access; deduplicates concurrent requests.
 * Returns null on error (never rejects).
 */
export async function getRoutineParameters(
  connectionId: string,
  database: string,
  routineName: string,
  routineType: string
): Promise<RoutineParameterCacheEntry | null> {
  const key = makeCacheKey(connectionId, database, routineName, routineType)

  // Cache hit
  if (cacheMap.has(key)) {
    return cacheMap.get(key) ?? null
  }

  // Deduplicate concurrent requests
  if (pendingFetches.has(key)) {
    return pendingFetches.get(key)!
  }

  const capturedGeneration = getGeneration(connectionId)

  const fetchPromise = (async (): Promise<RoutineParameterCacheEntry | null> => {
    try {
      const ipcRoutineType: 'FUNCTION' | 'PROCEDURE' =
        routineType.toUpperCase() === 'PROCEDURE' ? 'PROCEDURE' : 'FUNCTION'
      const response = await getRoutineParametersWithReturnType(
        connectionId,
        database,
        routineName,
        ipcRoutineType
      )

      // Check if cache was invalidated during the fetch (per-connection generation)
      if (getGeneration(connectionId) !== capturedGeneration) {
        return null
      }

      // Backend returns found=false when the routine does not exist in
      // INFORMATION_SCHEMA.ROUTINES. Cache null to mark this as a confirmed
      // miss — no need to re-query on every keystroke.  Invalidation (e.g.
      // after creating a routine or dropping a DB) clears the cache anyway.
      if (!response.found) {
        cacheMap.set(key, null)
        return null
      }

      const rows = response.parameters

      // For function lookups: zero rows means the function does not exist
      // (functions always have at least the return-type row at ordinalPosition 0).
      // Don't cache so a subsequent call re-queries (the user may create it).
      if (routineType.toLowerCase() === 'function' && rows.length === 0) {
        return null
      }

      // Separate return type row (ordinalPosition === 0) from parameter rows
      const returnTypeRow = rows.find((r) => r.ordinalPosition === 0)
      const parameterRows = rows.filter((r) => r.ordinalPosition > 0)

      // Coerce routineType to the strict union
      const normalizedType: 'FUNCTION' | 'PROCEDURE' =
        routineType.toUpperCase() === 'PROCEDURE' ? 'PROCEDURE' : 'FUNCTION'

      const entry: RoutineParameterCacheEntry = {
        parameters: parameterRows,
        returnType: returnTypeRow?.dataType ?? null,
        routineType: normalizedType,
        fetchedAt: Date.now(),
      }

      cacheMap.set(key, entry)
      return entry
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[routine-param-cache] Failed to fetch parameters for ${routineName}: ${msg}`)
      logFrontend(
        'error',
        `[routine-param-cache] Failed to fetch parameters for ${routineName}: ${msg}`
      )

      // Do NOT cache the error — transient failures (network glitch, server
      // restart) must not permanently silence parameter hints.  The missing
      // cache entry lets the next call retry the fetch.
      return null
    }
  })()

  // Clean up pendingFetches — only delete if this exact promise is still the active
  // one for the key.  After invalidation a new promise may have replaced it.
  fetchPromise.finally(() => {
    if (pendingFetches.get(key) === fetchPromise) {
      pendingFetches.delete(key)
    }
  })

  pendingFetches.set(key, fetchPromise)
  return fetchPromise
}

/**
 * Remove all cache entries for a connection.
 * Also clears pending fetches and increments generation to prevent stale repopulation.
 */
export function invalidateRoutineCache(connectionId: string): void {
  const prefix = `${connectionId}:`

  for (const key of [...cacheMap.keys()]) {
    if (key.startsWith(prefix)) {
      cacheMap.delete(key)
    }
  }

  for (const key of [...pendingFetches.keys()]) {
    if (key.startsWith(prefix)) {
      pendingFetches.delete(key)
    }
  }

  incrementGeneration(connectionId)
}

/**
 * Synchronous cache getter — returns what is already in the cache without
 * triggering any IPC.
 *
 * - Returns a `RoutineParameterCacheEntry` if the entry is cached and valid.
 * - Returns `null` if the key was fetched but explicitly not found.
 * - Returns `undefined` if the key has not been fetched yet.
 */
export function getCachedRoutineParameters(
  connectionId: string,
  database: string,
  routineName: string
): RoutineParameterCacheEntry | null | undefined {
  let anyFetched = false
  for (const rt of ['function', 'procedure'] as const) {
    const key = makeCacheKey(connectionId, database, routineName, rt)
    if (cacheMap.has(key)) {
      anyFetched = true
      const val = cacheMap.get(key)
      if (val) return val
    }
  }
  return anyFetched ? null : undefined
}

/**
 * Clear all caches. Primarily for test cleanup.
 */
export function _clearAllRoutineCaches(): void {
  cacheMap.clear()
  pendingFetches.clear()
  generationMap.clear()
}
