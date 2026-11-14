import { logFrontend } from '../../lib/app-log-commands'
import type { RoutineParameter } from '../../types/schema'
import { getRoutineParametersWithReturnType } from '../../lib/object-editor-commands'
import { toErrorMessage } from '../../lib/error-message'

export interface RoutineParameterCacheEntry {
  parameters: RoutineParameter[]
  returnType: string | null
  routineType: 'FUNCTION' | 'PROCEDURE'
  fetchedAt: number
}

const cacheMap = new Map<string, RoutineParameterCacheEntry | null>()

const pendingFetches = new Map<string, Promise<RoutineParameterCacheEntry | null>>()

const generationMap = new Map<string, number>()

function getGeneration(connectionId: string): number {
  return generationMap.get(connectionId) ?? 0
}

function isCurrentGeneration(connectionId: string, capturedGeneration: number): boolean {
  return getGeneration(connectionId) === capturedGeneration
}

function toRoutineKind(routineType: string): 'FUNCTION' | 'PROCEDURE' {
  const isProcedure = routineType.toUpperCase() === 'PROCEDURE'
  return isProcedure ? 'PROCEDURE' : 'FUNCTION'
}

function incrementGeneration(connectionId: string): void {
  generationMap.set(connectionId, getGeneration(connectionId) + 1)
}

function makeCacheKey({
  connectionId,
  database,
  routineName,
  routineType,
}: RoutineIdentity): string {
  return `${connectionId}:${database.toLowerCase()}:${routineName.toLowerCase()}:${routineType.toLowerCase()}`
}

export interface RoutineIdentity {
  connectionId: string
  database: string
  routineName: string
  routineType: string
}

interface RoutineFetch {
  identity: RoutineIdentity
  key: string
  capturedGeneration: number
}

function toCacheEntry(rows: RoutineParameter[], routineType: string): RoutineParameterCacheEntry {
  const returnTypeRow = rows.find((parameter) => parameter.ordinalPosition === 0)
  const parameterRows = rows.filter((parameter) => parameter.ordinalPosition > 0)
  return {
    parameters: parameterRows,
    returnType: returnTypeRow?.dataType ?? null,
    routineType: toRoutineKind(routineType),
    fetchedAt: Date.now(),
  }
}

async function fetchRoutineEntry({
  identity,
  key,
  capturedGeneration,
}: RoutineFetch): Promise<RoutineParameterCacheEntry | null> {
  const { connectionId, routineName, routineType } = identity
  try {
    const response = await getRoutineParametersWithReturnType({
      connectionId: connectionId,
      database: identity.database,
      routineName: routineName,
      routineType: toRoutineKind(routineType),
    })
    if (!isCurrentGeneration(connectionId, capturedGeneration)) {
      return null
    }

    if (!response.found) {
      cacheMap.set(key, null)
      return null
    }

    const rows = response.parameters
    const isMissingFunction = routineType.toLowerCase() === 'function' && rows.length === 0
    if (isMissingFunction) {
      return null
    }

    const entry = toCacheEntry(rows, routineType)
    cacheMap.set(key, entry)
    return entry
  } catch (error) {
    const message = toErrorMessage(error)
    logFrontend(
      'error',
      `[routine-param-cache] Failed to fetch parameters for ${routineName}: ${message}`
    )
    return null
  }
}

function releasePendingFetchWhenSettled(
  key: string,
  fetchPromise: Promise<RoutineParameterCacheEntry | null>
): void {
  fetchPromise.finally(() => {
    const isOwnPendingFetch = pendingFetches.get(key) === fetchPromise
    if (isOwnPendingFetch) {
      pendingFetches.delete(key)
    }
  })
}

export async function getRoutineParameters(
  identity: RoutineIdentity
): Promise<RoutineParameterCacheEntry | null> {
  const key = makeCacheKey(identity)

  if (cacheMap.has(key)) {
    return cacheMap.get(key) ?? null
  }

  const pendingFetch = pendingFetches.get(key)
  if (pendingFetch) {
    return pendingFetch
  }

  const fetchPromise = fetchRoutineEntry({
    identity: identity,
    key: key,
    capturedGeneration: getGeneration(identity.connectionId),
  })
  releasePendingFetchWhenSettled(key, fetchPromise)
  pendingFetches.set(key, fetchPromise)
  return fetchPromise
}

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

export function getCachedRoutineParameters(
  connectionId: string,
  database: string,
  routineName: string
): RoutineParameterCacheEntry | null | undefined {
  let anyFetched = false
  for (const rt of ['function', 'procedure'] as const) {
    const key = makeCacheKey({
      connectionId: connectionId,
      database: database,
      routineName: routineName,
      routineType: rt,
    })
    if (!cacheMap.has(key)) continue
    anyFetched = true
    const value = cacheMap.get(key)
    if (value) return value
  }
  return anyFetched ? null : undefined
}

export function _clearAllRoutineCaches(): void {
  cacheMap.clear()
  pendingFetches.clear()
  generationMap.clear()
}
