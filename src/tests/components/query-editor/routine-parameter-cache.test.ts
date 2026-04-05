import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getRoutineParameters,
  getCachedRoutineParameters,
  invalidateRoutineCache,
  _clearAllRoutineCaches,
} from '../../../components/query-editor/routine-parameter-cache'
import type { RoutineParameter } from '../../../types/schema'
import type { RoutineParametersWithFoundResponse } from '../../../lib/object-editor-commands'

vi.mock('../../../lib/object-editor-commands', () => ({
  getRoutineParametersWithReturnType: vi.fn(),
}))

vi.mock('../../../lib/app-log-commands', () => ({
  logFrontend: vi.fn(),
}))

import { getRoutineParametersWithReturnType } from '../../../lib/object-editor-commands'
import { logFrontend } from '../../../lib/app-log-commands'

const mockGetRoutineParams = vi.mocked(getRoutineParametersWithReturnType)
const mockLogFrontend = vi.mocked(logFrontend)

/** Helper to wrap parameters in the { parameters, found } response shape. */
function foundResponse(parameters: RoutineParameter[]): RoutineParametersWithFoundResponse {
  return { parameters, found: true }
}

function notFoundResponse(): RoutineParametersWithFoundResponse {
  return { parameters: [], found: false }
}

beforeEach(() => {
  _clearAllRoutineCaches()
  mockGetRoutineParams.mockReset()
  mockLogFrontend.mockReset()
})

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

  it('should fetch and cache routine parameters on first access', async () => {
    mockGetRoutineParams.mockResolvedValue(foundResponse(mockFunctionRows))

    const entry = await getRoutineParameters('conn1', 'mydb', 'my_func', 'function')

    expect(entry).not.toBeNull()
    expect(entry!.parameters).toHaveLength(2)
    expect(entry!.parameters[0].name).toBe('p_id')
    expect(entry!.parameters[1].name).toBe('p_name')
    expect(entry!.returnType).toBe('int')
    expect(entry!.routineType).toBe('FUNCTION')
    expect(entry!.fetchedAt).toBeGreaterThan(0)
    expect(mockGetRoutineParams).toHaveBeenCalledTimes(1)
    expect(mockGetRoutineParams).toHaveBeenCalledWith('conn1', 'mydb', 'my_func', 'FUNCTION')
  })

  it('should return cached result without calling IPC again', async () => {
    mockGetRoutineParams.mockResolvedValue(foundResponse(mockFunctionRows))

    const first = await getRoutineParameters('conn1', 'mydb', 'my_func', 'function')
    const second = await getRoutineParameters('conn1', 'mydb', 'my_func', 'function')

    expect(first).toBe(second)
    expect(mockGetRoutineParams).toHaveBeenCalledTimes(1)
  })

  it('should deduplicate concurrent requests for the same key', async () => {
    let resolveIpc!: (value: RoutineParametersWithFoundResponse) => void
    mockGetRoutineParams.mockReturnValue(
      new Promise<RoutineParametersWithFoundResponse>((resolve) => {
        resolveIpc = resolve
      })
    )

    const promise1 = getRoutineParameters('conn1', 'mydb', 'my_func', 'function')
    const promise2 = getRoutineParameters('conn1', 'mydb', 'my_func', 'function')

    resolveIpc(foundResponse(mockFunctionRows))

    const [result1, result2] = await Promise.all([promise1, promise2])

    expect(result1).toBe(result2)
    expect(mockGetRoutineParams).toHaveBeenCalledTimes(1)
  })

  it('should invalidate all entries for a connection but not others', async () => {
    mockGetRoutineParams
      .mockResolvedValueOnce(foundResponse(mockFunctionRows))
      .mockResolvedValueOnce(foundResponse(mockProcedureRows))
      .mockResolvedValueOnce(foundResponse(mockFunctionRows))

    const entry1 = await getRoutineParameters('conn1', 'mydb', 'my_func', 'function')
    const entry2 = await getRoutineParameters('conn2', 'mydb', 'my_proc', 'procedure')

    expect(entry1).not.toBeNull()
    expect(entry2).not.toBeNull()

    invalidateRoutineCache('conn1')

    // conn1 entry should be cleared — fetches again
    const entry1Again = await getRoutineParameters('conn1', 'mydb', 'my_func', 'function')
    expect(mockGetRoutineParams).toHaveBeenCalledTimes(3)
    expect(entry1Again).not.toBe(entry1)

    // conn2 entry should still be cached — no additional fetch
    const entry2Again = await getRoutineParameters('conn2', 'mydb', 'my_proc', 'procedure')
    expect(entry2Again).toBe(entry2)
    expect(mockGetRoutineParams).toHaveBeenCalledTimes(3)
  })

  it('should return null on IPC failure but NOT cache it (allows retry)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetRoutineParams.mockRejectedValueOnce(new Error('Connection refused'))

    const entry = await getRoutineParameters('conn1', 'mydb', 'my_func', 'function')

    expect(entry).toBeNull()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[routine-param-cache]'))
    expect(mockLogFrontend).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('[routine-param-cache]')
    )

    // Subsequent call should retry (not return cached null)
    mockGetRoutineParams.mockRejectedValueOnce(new Error('Still failing'))
    const entry2 = await getRoutineParameters('conn1', 'mydb', 'my_func', 'function')
    expect(entry2).toBeNull()
    expect(mockGetRoutineParams).toHaveBeenCalledTimes(2)

    consoleSpy.mockRestore()
  })

  it('should succeed on retry after a transient IPC failure', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // First call fails (transient error)
    mockGetRoutineParams.mockRejectedValueOnce(new Error('Connection refused'))
    const entry1 = await getRoutineParameters('conn1', 'mydb', 'my_func', 'function')
    expect(entry1).toBeNull()
    expect(mockGetRoutineParams).toHaveBeenCalledTimes(1)

    // Second call succeeds — the failed fetch was NOT cached
    mockGetRoutineParams.mockResolvedValueOnce(foundResponse(mockFunctionRows))
    const entry2 = await getRoutineParameters('conn1', 'mydb', 'my_func', 'function')
    expect(entry2).not.toBeNull()
    expect(entry2!.parameters).toHaveLength(2)
    expect(entry2!.returnType).toBe('int')
    expect(mockGetRoutineParams).toHaveBeenCalledTimes(2)

    // Third call hits the cache (entry2 was properly cached on success)
    const entry3 = await getRoutineParameters('conn1', 'mydb', 'my_func', 'function')
    expect(entry3).toBe(entry2)
    expect(mockGetRoutineParams).toHaveBeenCalledTimes(2)

    consoleSpy.mockRestore()
  })

  it('should reset all state with _clearAllRoutineCaches', async () => {
    mockGetRoutineParams.mockResolvedValue(foundResponse(mockFunctionRows))

    await getRoutineParameters('conn1', 'mydb', 'my_func', 'function')
    expect(mockGetRoutineParams).toHaveBeenCalledTimes(1)

    _clearAllRoutineCaches()

    // Should fetch again after clear
    mockGetRoutineParams.mockResolvedValue(foundResponse(mockFunctionRows))
    await getRoutineParameters('conn1', 'mydb', 'my_func', 'function')
    expect(mockGetRoutineParams).toHaveBeenCalledTimes(2)
  })

  it('should separate return type row from parameter rows correctly', async () => {
    mockGetRoutineParams.mockResolvedValue(foundResponse(mockFunctionRows))

    const entry = await getRoutineParameters('conn1', 'mydb', 'my_func', 'function')

    expect(entry).not.toBeNull()
    // Return type row (ordinalPosition 0) goes to returnType
    expect(entry!.returnType).toBe('int')
    // Only ordinalPosition > 0 rows go to parameters
    expect(entry!.parameters).toHaveLength(2)
    expect(entry!.parameters.every((p) => p.ordinalPosition > 0)).toBe(true)
  })

  it('should cache procedure vs function separately for same name in same db', async () => {
    mockGetRoutineParams
      .mockResolvedValueOnce(foundResponse(mockProcedureRows))
      .mockResolvedValueOnce(foundResponse(mockFunctionRows))

    const procEntry = await getRoutineParameters('conn1', 'mydb', 'dual_name', 'procedure')
    const funcEntry = await getRoutineParameters('conn1', 'mydb', 'dual_name', 'function')

    expect(mockGetRoutineParams).toHaveBeenCalledTimes(2)
    expect(procEntry).not.toBeNull()
    expect(funcEntry).not.toBeNull()
    expect(procEntry!.routineType).toBe('PROCEDURE')
    expect(funcEntry!.routineType).toBe('FUNCTION')
    expect(procEntry!.returnType).toBeNull()
    expect(funcEntry!.returnType).toBe('int')
  })

  it('should not repopulate cache if invalidation occurs during fetch', async () => {
    let resolveIpc!: (value: RoutineParametersWithFoundResponse) => void
    mockGetRoutineParams.mockReturnValue(
      new Promise<RoutineParametersWithFoundResponse>((resolve) => {
        resolveIpc = resolve
      })
    )

    const fetchPromise = getRoutineParameters('conn1', 'mydb', 'my_func', 'function')

    // Invalidate while fetch is in-flight
    invalidateRoutineCache('conn1')

    // Now resolve the fetch
    resolveIpc(foundResponse(mockFunctionRows))

    const result = await fetchPromise
    // Result is null because invalidation happened during fetch
    expect(result).toBeNull()

    // Cache should still be empty for this key — next call should trigger a new fetch
    mockGetRoutineParams.mockResolvedValue(foundResponse(mockFunctionRows))
    const freshResult = await getRoutineParameters('conn1', 'mydb', 'my_func', 'function')
    expect(freshResult).not.toBeNull()
    expect(mockGetRoutineParams).toHaveBeenCalledTimes(2)
  })

  it('should not discard a valid conn2 fetch when conn1 is invalidated concurrently', async () => {
    // Start in-flight fetches for both conn1 and conn2
    let resolveConn1!: (value: RoutineParametersWithFoundResponse) => void
    let resolveConn2!: (value: RoutineParametersWithFoundResponse) => void

    mockGetRoutineParams
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

    const fetchConn1 = getRoutineParameters('conn1', 'mydb', 'my_func', 'function')
    const fetchConn2 = getRoutineParameters('conn2', 'mydb', 'my_func', 'function')

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

  // -------------------------------------------------------------------------
  // Fix 2 — empty function lookup returns null without caching
  // -------------------------------------------------------------------------

  it('should return null for function lookup with zero rows (not found)', async () => {
    mockGetRoutineParams.mockResolvedValue(foundResponse([]))

    const entry = await getRoutineParameters('conn1', 'mydb', 'nonexistent', 'function')
    expect(entry).toBeNull()

    // Should NOT be cached — next call should fetch again
    mockGetRoutineParams.mockResolvedValue(foundResponse([]))
    const entry2 = await getRoutineParameters('conn1', 'mydb', 'nonexistent', 'function')
    expect(entry2).toBeNull()
    expect(mockGetRoutineParams).toHaveBeenCalledTimes(2)
  })

  it('should cache zero-parameter procedure as valid entry (found=true)', async () => {
    mockGetRoutineParams.mockResolvedValue(foundResponse([]))

    const entry = await getRoutineParameters('conn1', 'mydb', 'flush_logs', 'procedure')
    expect(entry).not.toBeNull()
    expect(entry!.parameters).toHaveLength(0)
    expect(entry!.routineType).toBe('PROCEDURE')

    // Should be cached — no second IPC call
    const entry2 = await getRoutineParameters('conn1', 'mydb', 'flush_logs', 'procedure')
    expect(entry2).toBe(entry)
    expect(mockGetRoutineParams).toHaveBeenCalledTimes(1)
  })

  // -------------------------------------------------------------------------
  // Fix — missing procedure returns found=false, treated as cache miss
  // -------------------------------------------------------------------------

  it('should return null for missing procedure (found=false) and cache it', async () => {
    mockGetRoutineParams.mockResolvedValue(notFoundResponse())

    const entry = await getRoutineParameters('conn1', 'mydb', 'missing_proc', 'procedure')
    expect(entry).toBeNull()

    // Should BE cached as a permanent miss — no second IPC call
    const entry2 = await getRoutineParameters('conn1', 'mydb', 'missing_proc', 'procedure')
    expect(entry2).toBeNull()
    expect(mockGetRoutineParams).toHaveBeenCalledTimes(1)
  })

  it('should return null for missing function (found=false) and cache it', async () => {
    mockGetRoutineParams.mockResolvedValue(notFoundResponse())

    const entry = await getRoutineParameters('conn1', 'mydb', 'missing_func', 'function')
    expect(entry).toBeNull()

    // Should BE cached as a permanent miss — no second IPC call
    const entry2 = await getRoutineParameters('conn1', 'mydb', 'missing_func', 'function')
    expect(entry2).toBeNull()
    expect(mockGetRoutineParams).toHaveBeenCalledTimes(1)
  })

  it('getCachedRoutineParameters returns null (not undefined) for found=false', async () => {
    mockGetRoutineParams.mockResolvedValue(notFoundResponse())
    await getRoutineParameters('conn1', 'mydb', 'gone', 'function')

    const cached = getCachedRoutineParameters('conn1', 'mydb', 'gone')
    // null means "confirmed not found", undefined means "never fetched"
    expect(cached).toBeNull()
  })

  it('invalidation clears found=false cache, allowing fresh lookup', async () => {
    // First call: routine not found, cached as null
    mockGetRoutineParams.mockResolvedValueOnce(notFoundResponse())
    const entry1 = await getRoutineParameters('conn1', 'mydb', 'new_proc', 'procedure')
    expect(entry1).toBeNull()
    expect(mockGetRoutineParams).toHaveBeenCalledTimes(1)

    // Invalidate (e.g. user created the routine)
    invalidateRoutineCache('conn1')

    // Second call: routine now exists, should re-fetch
    mockGetRoutineParams.mockResolvedValueOnce(foundResponse(mockProcedureRows))
    const entry2 = await getRoutineParameters('conn1', 'mydb', 'new_proc', 'procedure')
    expect(entry2).not.toBeNull()
    expect(entry2!.parameters).toHaveLength(2)
    expect(mockGetRoutineParams).toHaveBeenCalledTimes(2)
  })

  // -------------------------------------------------------------------------
  // Fix 3 — stale pendingFetches reference after invalidation
  // -------------------------------------------------------------------------

  it('should not break dedup when old fetch finishes after invalidation and new fetch starts', async () => {
    let resolveA!: (value: RoutineParametersWithFoundResponse) => void
    let resolveB!: (value: RoutineParametersWithFoundResponse) => void

    mockGetRoutineParams.mockReturnValueOnce(
      new Promise<RoutineParametersWithFoundResponse>((resolve) => {
        resolveA = resolve
      })
    )

    // Start fetch A
    const promiseA = getRoutineParameters('conn1', 'mydb', 'my_func', 'function')

    // Invalidate while A is in-flight
    invalidateRoutineCache('conn1')

    // Start fetch B (after invalidation)
    mockGetRoutineParams.mockReturnValueOnce(
      new Promise<RoutineParametersWithFoundResponse>((resolve) => {
        resolveB = resolve
      })
    )
    const promiseB = getRoutineParameters('conn1', 'mydb', 'my_func', 'function')

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
    expect(mockGetRoutineParams).toHaveBeenCalledTimes(2)

    // Subsequent call should hit cache (B's result was cached)
    const cached = await getRoutineParameters('conn1', 'mydb', 'my_func', 'function')
    expect(cached).toBe(resultB)
    expect(mockGetRoutineParams).toHaveBeenCalledTimes(2) // no additional IPC
  })

  // -------------------------------------------------------------------------
  // Fix 4 — sync getter + routineType union
  // -------------------------------------------------------------------------

  it('getCachedRoutineParameters returns entry when cached', async () => {
    mockGetRoutineParams.mockResolvedValue(foundResponse(mockFunctionRows))
    await getRoutineParameters('conn1', 'mydb', 'my_func', 'function')

    const cached = getCachedRoutineParameters('conn1', 'mydb', 'my_func')
    expect(cached).not.toBeNull()
    expect(cached).not.toBeUndefined()
    expect(cached!.parameters).toHaveLength(2)
    expect(cached!.routineType).toBe('FUNCTION')
  })

  it('getCachedRoutineParameters returns undefined after a failed fetch (errors are not cached)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetRoutineParams.mockRejectedValue(new Error('not found'))

    await getRoutineParameters('conn1', 'mydb', 'missing', 'function')

    const cached = getCachedRoutineParameters('conn1', 'mydb', 'missing')
    expect(cached).toBeUndefined()
    consoleSpy.mockRestore()
  })

  it('getCachedRoutineParameters returns undefined when not yet fetched', () => {
    const cached = getCachedRoutineParameters('conn1', 'mydb', 'never_fetched')
    expect(cached).toBeUndefined()
  })

  it('should coerce routineType to FUNCTION or PROCEDURE uppercase', async () => {
    mockGetRoutineParams.mockResolvedValue(foundResponse(mockFunctionRows))
    const funcEntry = await getRoutineParameters('conn1', 'mydb', 'f', 'function')
    expect(funcEntry!.routineType).toBe('FUNCTION')

    mockGetRoutineParams.mockResolvedValue(foundResponse(mockProcedureRows))
    const procEntry = await getRoutineParameters('conn1', 'mydb', 'p', 'procedure')
    expect(procEntry!.routineType).toBe('PROCEDURE')
  })

  it('should default unrecognized routineType to FUNCTION', async () => {
    mockGetRoutineParams.mockResolvedValue(foundResponse(mockFunctionRows))
    const entry = await getRoutineParameters('conn1', 'mydb', 'x', 'unknown_type')
    expect(entry!.routineType).toBe('FUNCTION')
  })
})
