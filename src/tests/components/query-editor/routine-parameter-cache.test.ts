import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getRoutineParameters,
  getCachedRoutineParameters,
  invalidateRoutineCache,
  _clearAllRoutineCaches,
} from '../../../components/query-editor/routine-parameter-cache'
import type { RoutineParameter } from '../../../types/schema'
import type { RoutineParametersWithFoundResponse } from '../../../lib/object-editor-commands'

// Use vi.spyOn to install per-test mock implementations without vi.mock().
import * as ObjectEditorCommandsModule from '../../../lib/object-editor-commands'
import * as AppLogCommandsModule from '../../../lib/app-log-commands'

/** Helper to wrap parameters in the { parameters, found } response shape. */
function foundResponse(parameters: RoutineParameter[]): RoutineParametersWithFoundResponse {
  return { parameters, found: true }
}

function notFoundResponse(): RoutineParametersWithFoundResponse {
  return { parameters: [], found: false }
}

beforeEach(() => {
  _clearAllRoutineCaches()
  vi.spyOn(ObjectEditorCommandsModule, 'getRoutineParametersWithReturnType')
    .mockReset()
    .mockResolvedValue(foundResponse([]))
  vi.spyOn(AppLogCommandsModule, 'logFrontend')
    .mockReset()
    .mockImplementation(() => {})
})

function mockGetRoutineParams() {
  return ObjectEditorCommandsModule.getRoutineParametersWithReturnType as ReturnType<typeof vi.fn>
}

describe('routine-parameter-cache', () => {
  const mockFunctionRows: RoutineParameter[] = [
    { name: '', dataType: 'int', mode: '', ordinalPosition: 0 },
    { name: 'p_id', dataType: 'int', mode: 'IN', ordinalPosition: 1 },
    { name: 'p_name', dataType: 'varchar(255)', mode: 'IN', ordinalPosition: 2 },
  ]

  const mockProcedureRows: RoutineParameter[] = [
    { name: 'p_id', dataType: 'int', mode: 'IN', ordinalPosition: 1 },
    { name: 'p_result', dataType: 'varchar(255)', mode: 'OUT', ordinalPosition: 2 },
  ]

  it('should deduplicate concurrent requests for the same key', async () => {
    let resolveIpc!: (value: RoutineParametersWithFoundResponse) => void
    mockGetRoutineParams().mockReturnValue(
      new Promise<RoutineParametersWithFoundResponse>((resolve) => {
        resolveIpc = resolve
      })
    )

    const promise1 = getRoutineParameters({
      connectionId: 'conn1',
      database: 'mydb',
      routineName: 'my_func',
      routineType: 'function',
    })
    const promise2 = getRoutineParameters({
      connectionId: 'conn1',
      database: 'mydb',
      routineName: 'my_func',
      routineType: 'function',
    })

    resolveIpc(foundResponse(mockFunctionRows))

    const [result1, result2] = await Promise.all([promise1, promise2])

    expect(result1).toBe(result2)
    expect(mockGetRoutineParams()).toHaveBeenCalledTimes(1)
  })

  it('should invalidate all entries for a connection but not others', async () => {
    mockGetRoutineParams()
      .mockResolvedValueOnce(foundResponse(mockFunctionRows))
      .mockResolvedValueOnce(foundResponse(mockProcedureRows))
      .mockResolvedValueOnce(foundResponse(mockFunctionRows))

    const entry1 = await getRoutineParameters({
      connectionId: 'conn1',
      database: 'mydb',
      routineName: 'my_func',
      routineType: 'function',
    })
    const entry2 = await getRoutineParameters({
      connectionId: 'conn2',
      database: 'mydb',
      routineName: 'my_proc',
      routineType: 'procedure',
    })

    expect(entry1).not.toBeNull()
    expect(entry2).not.toBeNull()

    invalidateRoutineCache('conn1')

    // conn1 entry should be cleared — fetches again
    const entry1Again = await getRoutineParameters({
      connectionId: 'conn1',
      database: 'mydb',
      routineName: 'my_func',
      routineType: 'function',
    })
    expect(mockGetRoutineParams()).toHaveBeenCalledTimes(3)
    expect(entry1Again).not.toBe(entry1)

    // conn2 entry should still be cached — no additional fetch
    const entry2Again = await getRoutineParameters({
      connectionId: 'conn2',
      database: 'mydb',
      routineName: 'my_proc',
      routineType: 'procedure',
    })
    expect(entry2Again).toBe(entry2)
    expect(mockGetRoutineParams()).toHaveBeenCalledTimes(3)
  })

  it('should succeed on retry after a transient IPC failure', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // First call fails (transient error)
    mockGetRoutineParams().mockRejectedValueOnce(new Error('Connection refused'))
    const entry1 = await getRoutineParameters({
      connectionId: 'conn1',
      database: 'mydb',
      routineName: 'my_func',
      routineType: 'function',
    })
    expect(entry1).toBeNull()
    expect(mockGetRoutineParams()).toHaveBeenCalledTimes(1)

    // Second call succeeds — the failed fetch was NOT cached
    mockGetRoutineParams().mockResolvedValueOnce(foundResponse(mockFunctionRows))
    const entry2 = await getRoutineParameters({
      connectionId: 'conn1',
      database: 'mydb',
      routineName: 'my_func',
      routineType: 'function',
    })
    expect(entry2).not.toBeNull()
    expect(entry2!.parameters).toHaveLength(2)
    expect(entry2!.returnType).toBe('int')
    expect(mockGetRoutineParams()).toHaveBeenCalledTimes(2)

    // Third call hits the cache (entry2 was properly cached on success)
    const entry3 = await getRoutineParameters({
      connectionId: 'conn1',
      database: 'mydb',
      routineName: 'my_func',
      routineType: 'function',
    })
    expect(entry3).toBe(entry2)
    expect(mockGetRoutineParams()).toHaveBeenCalledTimes(2)

    consoleSpy.mockRestore()
  })

  it('should not repopulate cache if invalidation occurs during fetch', async () => {
    let resolveIpc!: (value: RoutineParametersWithFoundResponse) => void
    mockGetRoutineParams().mockReturnValue(
      new Promise<RoutineParametersWithFoundResponse>((resolve) => {
        resolveIpc = resolve
      })
    )

    const fetchPromise = getRoutineParameters({
      connectionId: 'conn1',
      database: 'mydb',
      routineName: 'my_func',
      routineType: 'function',
    })

    // Invalidate while fetch is in-flight
    invalidateRoutineCache('conn1')

    // Now resolve the fetch
    resolveIpc(foundResponse(mockFunctionRows))

    const result = await fetchPromise
    // Result is null because invalidation happened during fetch
    expect(result).toBeNull()

    // Cache should still be empty for this key — next call should trigger a new fetch
    mockGetRoutineParams().mockResolvedValue(foundResponse(mockFunctionRows))
    const freshResult = await getRoutineParameters({
      connectionId: 'conn1',
      database: 'mydb',
      routineName: 'my_func',
      routineType: 'function',
    })
    expect(freshResult).not.toBeNull()
    expect(mockGetRoutineParams()).toHaveBeenCalledTimes(2)
  })

  // -------------------------------------------------------------------------
  // Fix 2 — empty function lookup returns null without caching
  // -------------------------------------------------------------------------

  it('should not discard a valid conn2 fetch when conn1 is invalidated concurrently', async () => {
    // Start in-flight fetches for both conn1 and conn2
    let resolveConn1!: (value: RoutineParametersWithFoundResponse) => void
    let resolveConn2!: (value: RoutineParametersWithFoundResponse) => void

    mockGetRoutineParams()
      .mockReturnValueOnce(
        new Promise<RoutineParametersWithFoundResponse>((resolve) => {
          resolveConn1 = resolve
        })
      )
      .mockReturnValueOnce(
        new Promise<RoutineParametersWithFoundResponse>((resolve) => {
          resolveConn2 = resolve
        })
      )

    const fetchConn1 = getRoutineParameters({
      connectionId: 'conn1',
      database: 'mydb',
      routineName: 'my_func',
      routineType: 'function',
    })
    const fetchConn2 = getRoutineParameters({
      connectionId: 'conn2',
      database: 'mydb',
      routineName: 'my_func',
      routineType: 'function',
    })

    // Invalidate conn1 while both fetches are in-flight
    invalidateRoutineCache('conn1')

    // Resolve both fetches
    resolveConn1(foundResponse(mockFunctionRows))
    resolveConn2(foundResponse(mockFunctionRows))

    const resultConn1 = await fetchConn1
    const resultConn2 = await fetchConn2

    // conn1 fetch should be discarded (invalidated during flight)
    expect(resultConn1).toBeNull()

    // conn2 fetch should succeed — its generation was NOT affected
    expect(resultConn2).not.toBeNull()
    expect(resultConn2!.parameters).toHaveLength(2)
    expect(resultConn2!.returnType).toBe('int')
  })

  it('should return null for function lookup with zero rows (not found)', async () => {
    mockGetRoutineParams().mockResolvedValue(foundResponse([]))

    const entry = await getRoutineParameters({
      connectionId: 'conn1',
      database: 'mydb',
      routineName: 'nonexistent',
      routineType: 'function',
    })
    expect(entry).toBeNull()

    // Should NOT be cached — next call should fetch again
    mockGetRoutineParams().mockResolvedValue(foundResponse([]))
    const entry2 = await getRoutineParameters({
      connectionId: 'conn1',
      database: 'mydb',
      routineName: 'nonexistent',
      routineType: 'function',
    })
    expect(entry2).toBeNull()
    expect(mockGetRoutineParams()).toHaveBeenCalledTimes(2)
  })

  // -------------------------------------------------------------------------
  // Fix — missing procedure returns found=false, treated as cache miss
  // -------------------------------------------------------------------------

  it('should return null for missing procedure (found=false) and cache it', async () => {
    mockGetRoutineParams().mockResolvedValue(notFoundResponse())

    const entry = await getRoutineParameters({
      connectionId: 'conn1',
      database: 'mydb',
      routineName: 'missing_proc',
      routineType: 'procedure',
    })
    expect(entry).toBeNull()

    // Should BE cached as a permanent miss — no second IPC call
    const entry2 = await getRoutineParameters({
      connectionId: 'conn1',
      database: 'mydb',
      routineName: 'missing_proc',
      routineType: 'procedure',
    })
    expect(entry2).toBeNull()
    expect(mockGetRoutineParams()).toHaveBeenCalledTimes(1)
  })

  it('getCachedRoutineParameters returns null (not undefined) for found=false', async () => {
    mockGetRoutineParams().mockResolvedValue(notFoundResponse())
    await getRoutineParameters({
      connectionId: 'conn1',
      database: 'mydb',
      routineName: 'gone',
      routineType: 'function',
    })

    const cached = getCachedRoutineParameters('conn1', 'mydb', 'gone')
    // null means "confirmed not found", undefined means "never fetched"
    expect(cached).toBeNull()
  })

  // -------------------------------------------------------------------------
  // Fix 3 — stale pendingFetches reference after invalidation
  // -------------------------------------------------------------------------

  it('should not break dedup when old fetch finishes after invalidation and new fetch starts', async () => {
    let resolveA!: (value: RoutineParametersWithFoundResponse) => void
    let resolveB!: (value: RoutineParametersWithFoundResponse) => void

    mockGetRoutineParams().mockReturnValueOnce(
      new Promise<RoutineParametersWithFoundResponse>((resolve) => {
        resolveA = resolve
      })
    )

    // Start fetch A
    const promiseA = getRoutineParameters({
      connectionId: 'conn1',
      database: 'mydb',
      routineName: 'my_func',
      routineType: 'function',
    })

    // Invalidate while A is in-flight
    invalidateRoutineCache('conn1')

    // Start fetch B (after invalidation)
    mockGetRoutineParams().mockReturnValueOnce(
      new Promise<RoutineParametersWithFoundResponse>((resolve) => {
        resolveB = resolve
      })
    )
    const promiseB = getRoutineParameters({
      connectionId: 'conn1',
      database: 'mydb',
      routineName: 'my_func',
      routineType: 'function',
    })

    // Resolve A first — it should be discarded (generation mismatch)
    resolveA(foundResponse(mockFunctionRows))
    const resultA = await promiseA
    expect(resultA).toBeNull()

    // Resolve B — it should succeed
    resolveB(foundResponse(mockFunctionRows))
    const resultB = await promiseB
    expect(resultB).not.toBeNull()
    expect(resultB!.parameters).toHaveLength(2)

    // Both IPCs were called
    expect(mockGetRoutineParams()).toHaveBeenCalledTimes(2)

    // Subsequent call should hit cache (B's result was cached)
    const cached = await getRoutineParameters({
      connectionId: 'conn1',
      database: 'mydb',
      routineName: 'my_func',
      routineType: 'function',
    })
    expect(cached).toBe(resultB)
    expect(mockGetRoutineParams()).toHaveBeenCalledTimes(2) // no additional IPC
  })
  it('getCachedRoutineParameters returns entry when cached', async () => {
    mockGetRoutineParams().mockResolvedValue(foundResponse(mockFunctionRows))
    await getRoutineParameters({
      connectionId: 'conn1',
      database: 'mydb',
      routineName: 'my_func',
      routineType: 'function',
    })

    const cached = getCachedRoutineParameters('conn1', 'mydb', 'my_func')
    expect(cached).not.toBeNull()
    expect(cached).not.toBeUndefined()
    expect(cached!.parameters).toHaveLength(2)
    expect(cached!.routineType).toBe('FUNCTION')
  })
  it('getCachedRoutineParameters returns undefined after a failed fetch (errors are not cached)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetRoutineParams().mockRejectedValue(new Error('not found'))

    await getRoutineParameters({
      connectionId: 'conn1',
      database: 'mydb',
      routineName: 'missing',
      routineType: 'function',
    })

    const cached = getCachedRoutineParameters('conn1', 'mydb', 'missing')
    expect(cached).toBeUndefined()
    consoleSpy.mockRestore()
  })

  // -------------------------------------------------------------------------
  // Fix 4 — sync getter + routineType union
  // -------------------------------------------------------------------------
})
