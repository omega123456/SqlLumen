import { afterEach, describe, expect, it, vi } from 'vitest'
import { ipc } from '../ipc-mock'
import {
  RESULT_LOADING_STATUS_DELAY_MS,
  RESULT_MAX_PAGES,
  RESULT_PAGE_SIZE,
  applyResultView,
  applySavedRowValues,
  clearAllResultWindows,
  clearResultWindowPages,
  dropTabResultWindows,
  getLoadedRow,
  getResultSurface,
  isAbortError,
  isResultsExpiredError,
  isViewStaleError,
  parseSupersededVersion,
  readViewRange,
  requestVisibleRange,
  resultSurfaceKey,
  retryFailedWindow,
  seedResultWindow,
  setWindowExpiredHandler,
  setWindowStatusHandler,
  subscribeToResultWindow,
  subscribeToRowPatches,
} from '../../lib/result-window-cache'
import type { ColumnMeta } from '../../types/schema'

const TAB = 'tab-w'
const COLUMNS: ColumnMeta[] = [{ name: 'id', dataType: 'INT' }]

/** A virtual result of `total` rows: row i is [i], base index = i. */
function serveWindows(total: number, viewVersion = 1) {
  ipc.override('fetch_result_window', (args) => {
    const offset = Math.min(Number(args?.offset), total)
    const limit = Math.min(Number(args?.limit), 2000)
    const end = Math.min(total, offset + limit)
    const rows = Array.from({ length: end - offset }, (_, i) => [offset + i])
    return {
      offset,
      rows,
      baseIndices: rows.map((row) => row[0]),
      viewRowCount: total,
      viewVersion,
    }
  })
}

function seed(total: number, firstRows = Math.min(total, 1000), viewVersion = 1) {
  const rows = Array.from({ length: firstRows }, (_, i) => [i])
  seedResultWindow({
    connectionId: 'conn-1',
    tabId: TAB,
    resultIndex: 0,
    queryId: 'q-1',
    viewVersion,
    viewRowCount: total,
    columns: COLUMNS,
    window: { offset: 0, rows, baseIndices: rows.map((_, i) => i) },
  })
}

/** View positions of the loaded rows of the test surface. */
function loadedPositions(): number[] {
  const total = getResultSurface(TAB, 0)?.viewRowCount ?? 0
  return Array.from({ length: total }, (_, position) => position).filter(
    (position) => getLoadedRow(TAB, 0, position) !== undefined
  )
}

function windowCalls(): Array<Record<string, unknown>> {
  return ipc.calls('fetch_result_window') as Array<Record<string, unknown>>
}

afterEach(() => {
  vi.useRealTimers()
  setWindowStatusHandler(null)
  setWindowExpiredHandler(null)
})

describe('error helpers', () => {
  it('classify window and view errors', () => {
    expect(isViewStaleError(new Error('view_stale: old'))).toBe(true)
    expect(isViewStaleError('nope')).toBe(false)
    expect(isResultsExpiredError('results_expired: gone')).toBe(true)
    expect(parseSupersededVersion('view_superseded: current=7')).toBe(7)
    expect(parseSupersededVersion('view_superseded: ???')).toBeNull()
    expect(parseSupersededVersion(new Error('other'))).toBeNull()
    expect(isAbortError(new DOMException('x', 'AbortError'))).toBe(true)
    expect(isAbortError(new Error('x'))).toBe(false)
    expect(resultSurfaceKey('t', 2)).toBe('t:2')
  })
})

describe('seeding and reading loaded rows', () => {
  it('splits the first window into pages and serves rows by view position', () => {
    seed(1200)
    expect(getResultSurface(TAB, 0)).toMatchObject({ viewVersion: 1, viewRowCount: 1200 })
    expect(getLoadedRow(TAB, 0, 0)).toEqual({ row: [0], baseIndex: 0 })
    expect(getLoadedRow(TAB, 0, 999)).toEqual({ row: [999], baseIndex: 999 })
    expect(getLoadedRow(TAB, 0, 1000)).toBeUndefined()
    expect(getLoadedRow(TAB, 0, -1)).toBeUndefined()
    expect(getLoadedRow('missing', 0, 0)).toBeUndefined()
    expect(loadedPositions()).toHaveLength(1000)
  })

  it('normalizes TINYINT(1) boolean columns to 0/1 per page', () => {
    seedResultWindow({
      connectionId: 'conn-1',
      tabId: TAB,
      resultIndex: 0,
      queryId: 'q-1',
      viewVersion: 1,
      viewRowCount: 2,
      columns: [{ name: 'flag', dataType: 'BOOLEAN' }],
      window: { offset: 0, rows: [[true], [false]], baseIndices: [0, 1] },
    })
    expect(getLoadedRow(TAB, 0, 0)?.row).toEqual([1])
    expect(getLoadedRow(TAB, 0, 1)?.row).toEqual([0])
  })

  it('applyResultView repaints a new view of the same query from its first window', () => {
    seed(10)
    applyResultView(TAB, 0, {
      viewVersion: 2,
      viewRowCount: 2,
      window: { offset: 0, rows: [[9], [8]], baseIndices: [9, 8] },
    })
    expect(getResultSurface(TAB, 0)).toMatchObject({ viewVersion: 2, viewRowCount: 2 })
    expect(getLoadedRow(TAB, 0, 0)).toEqual({ row: [9], baseIndex: 9 })
    // Without a window the view has no loaded pages yet.
    applyResultView(TAB, 0, { viewVersion: 3, viewRowCount: 2 })
    expect(getLoadedRow(TAB, 0, 0)).toBeUndefined()
    // Unknown surfaces are ignored.
    expect(() => applyResultView('nope', 0, { viewVersion: 1, viewRowCount: 0 })).not.toThrow()
  })

  it('applies a saved row edit to its loaded page and notifies its position', () => {
    seedResultWindow({
      connectionId: 'conn-1',
      tabId: TAB,
      resultIndex: 0,
      queryId: 'q-1',
      viewVersion: 1,
      viewRowCount: 2,
      columns: [
        { name: 'id', dataType: 'INT' },
        { name: 'flag', dataType: 'BOOLEAN' },
      ],
      window: {
        offset: 0,
        rows: [
          [1, 0],
          [2, 0],
        ],
        baseIndices: [0, 1],
      },
    })
    const listener = vi.fn()
    subscribeToResultWindow(TAB, 0, listener)
    applySavedRowValues(TAB, 0, 'q-1', 1, { 1: true })
    // Other columns are kept; the saved value is normalized like loaded rows.
    expect(getLoadedRow(TAB, 0, 1)?.row).toEqual([2, 1])
    expect(listener).toHaveBeenCalledWith([1, 2])
  })

  it('ignores a saved row edit for a replaced query or an unknown surface', () => {
    seed(10)
    const patches = vi.fn()
    subscribeToRowPatches(TAB, 0, patches)
    applySavedRowValues(TAB, 0, 'q-old', 4, { 0: 44 })
    applySavedRowValues('nope', 0, 'q-1', 4, { 0: 44 })
    expect(getLoadedRow(TAB, 0, 4)?.row).toEqual([4])
    expect(patches).not.toHaveBeenCalled()
  })

  it('tells row-patch subscribers about saved rows outside the loaded pages', () => {
    seed(5000)
    const patches = vi.fn()
    const unsubscribe = subscribeToRowPatches(TAB, 0, patches)
    applySavedRowValues(TAB, 0, 'q-1', 4321, { 0: 'new' })
    expect(patches).toHaveBeenCalledWith(4321, expect.any(Function))
    const apply = patches.mock.calls[0][1] as (row: unknown[]) => unknown[]
    expect(apply([4321])).toEqual(['new'])
    // Row-patch listeners survive a re-seed, until unsubscribed.
    seed(5000)
    unsubscribe()
    applySavedRowValues(TAB, 0, 'q-1', 1, { 0: 'x' })
    expect(patches).toHaveBeenCalledTimes(1)
  })

  it('lets a grid subscribe before the first seed and keeps the listener', () => {
    const listener = vi.fn()
    const patches = vi.fn()
    const unsubscribe = subscribeToResultWindow(TAB, 0, listener)
    const unsubscribePatches = subscribeToRowPatches('tab-early', 0, patches)
    seed(3)
    expect(listener).toHaveBeenCalledWith([0, 3], { reseeded: true })
    unsubscribe()
    unsubscribePatches()
    seed(3)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('visible-range loading', () => {
  it('fetches the missing pages around the visible range (half-page prefetch)', async () => {
    serveWindows(5000)
    seed(5000)
    const listener = vi.fn()
    subscribeToResultWindow(TAB, 0, listener)

    requestVisibleRange(TAB, 0, [2100, 2140])
    await vi.waitFor(() => expect(getLoadedRow(TAB, 0, 2100)).toBeDefined())

    // Pages 3 (1500–2000) and 4 (2000–2500) are covered by prefetch; page 5 is not.
    const offsets = windowCalls().map((call) => call.offset)
    expect(offsets).toEqual(expect.arrayContaining([1500, 2000]))
    expect(offsets).not.toContain(2500)
    expect(windowCalls()[0]).toMatchObject({ viewVersion: 1, limit: RESULT_PAGE_SIZE })
    expect(listener).toHaveBeenCalledWith([2000, 2500])
  })

  it('does not fetch pages that are already loaded or in flight', async () => {
    serveWindows(5000)
    seed(5000)
    requestVisibleRange(TAB, 0, [10, 50])
    expect(windowCalls()).toHaveLength(0)

    requestVisibleRange(TAB, 0, [3000, 3010])
    requestVisibleRange(TAB, 0, [3000, 3010])
    await vi.waitFor(() => expect(getLoadedRow(TAB, 0, 3000)).toBeDefined())
    const offsets = windowCalls().map((call) => call.offset)
    expect(offsets.filter((offset) => offset === 3000)).toHaveLength(1)
  })

  it('evicts least-recently-used pages beyond the cap', async () => {
    serveWindows(20000)
    seed(20000)
    for (let page = 2; page < 2 + RESULT_MAX_PAGES + 4; page += 1) {
      const start = page * RESULT_PAGE_SIZE + 200
      requestVisibleRange(TAB, 0, [start, start + 10])
      await vi.waitFor(() => expect(getLoadedRow(TAB, 0, start)).toBeDefined())
    }
    const loadedPages = new Set(
      loadedPositions().map((position) => Math.floor(position / RESULT_PAGE_SIZE))
    )
    expect(loadedPages.size).toBeLessThanOrEqual(RESULT_MAX_PAGES)
    // The first window's pages were the least recently used.
    expect(getLoadedRow(TAB, 0, 0)).toBeUndefined()
  })

  it('discards a response for an old view version (never painted)', async () => {
    serveWindows(3000, 1)
    seed(3000, 1000, 1)
    const listener = vi.fn()
    subscribeToResultWindow(TAB, 0, listener)
    let release: (() => void) | undefined
    ipc.override(
      'fetch_result_window',
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              offset: 2000,
              rows: [[1]],
              baseIndices: [1],
              viewRowCount: 3000,
              viewVersion: 1,
            })
        })
    )
    requestVisibleRange(TAB, 0, [2100, 2110])
    // A new view arrives before the old response.
    applyResultView(TAB, 0, { viewVersion: 2, viewRowCount: 3000 })
    listener.mockClear()
    release?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(getLoadedRow(TAB, 0, 2000)).toBeUndefined()
    expect(listener).not.toHaveBeenCalled()
  })

  it('drops a response whose version differs from the surface view', async () => {
    ipc.override('fetch_result_window', () => ({
      offset: 2000,
      rows: [[2000]],
      baseIndices: [2000],
      viewRowCount: 3000,
      viewVersion: 9,
    }))
    seed(3000)
    requestVisibleRange(TAB, 0, [2000, 2010])
    // Pages 3 and 4 (half-page prefetch on each side).
    await vi.waitFor(() => expect(windowCalls()).toHaveLength(2))
    await Promise.resolve()
    expect(getLoadedRow(TAB, 0, 2000)).toBeUndefined()
  })

  it('ignores view_stale and replaced-query errors silently', async () => {
    const status = vi.fn()
    setWindowStatusHandler(status)
    ipc.override('fetch_result_window', () => {
      throw new Error('view_stale: old version')
    })
    seed(3000)
    requestVisibleRange(TAB, 0, [2000, 2010])
    await vi.waitFor(() => expect(windowCalls()).toHaveLength(2))
    ipc.override('fetch_result_window', () => {
      throw new Error('Results were refreshed. Re-run the query.')
    })
    // Stale and failed responses must not re-issue the same pages.
    requestVisibleRange(TAB, 0, [2800, 2810])
    // Page 5 only: the view ends at 3,000 rows.
    await vi.waitFor(() => expect(windowCalls()).toHaveLength(3))
    await Promise.resolve()
    expect(status).not.toHaveBeenCalledWith(TAB, 0, expect.anything(), expect.anything())
    await vi.waitFor(() =>
      expect(ipc.calls('log_frontend')).toContainEqual({
        level: 'debug',
        message: expect.stringContaining('discarding a stale window'),
      })
    )
  })

  it('keeps a newer fetch of the same page in flight when an older fetch settles', async () => {
    const releases = new Map<number, Array<() => void>>()
    ipc.override(
      'fetch_result_window',
      (args) =>
        new Promise((resolve) => {
          const offset = Number(args?.offset)
          const list = releases.get(offset) ?? []
          list.push(() =>
            resolve({
              offset,
              rows: [[offset]],
              baseIndices: [offset],
              viewRowCount: 5000,
              viewVersion: 1,
            })
          )
          releases.set(offset, list)
        })
    )
    seed(5000)
    requestVisibleRange(TAB, 0, [3600, 3610])
    await vi.waitFor(() => expect(releases.get(3500)).toHaveLength(1))
    // Inactive-tab eviction while page 7 is in flight, then the tab comes back.
    clearResultWindowPages(TAB, 0)
    requestVisibleRange(TAB, 0, [3600, 3610])
    await vi.waitFor(() => expect(releases.get(3500)).toHaveLength(2))

    // The old fetch settles: it must not clear the new fetch's in-flight marker.
    releases.get(3500)![0]()
    await Promise.resolve()
    await Promise.resolve()
    requestVisibleRange(TAB, 0, [3600, 3610])
    expect(releases.get(3500)).toHaveLength(2)

    releases.get(3500)![1]()
    await vi.waitFor(() => expect(getLoadedRow(TAB, 0, 3500)).toBeDefined())
  })

  it('routes results_expired to the expired handler', async () => {
    const expired = vi.fn()
    setWindowExpiredHandler(expired)
    ipc.override('fetch_result_window', () => {
      throw new Error('results_expired: evicted')
    })
    seed(3000)
    requestVisibleRange(TAB, 0, [2000, 2010])
    await vi.waitFor(() => expect(expired).toHaveBeenCalledWith(TAB))
  })

  it('records a failed range for the Retry band and refetches on retry', async () => {
    const status = vi.fn()
    setWindowStatusHandler(status)
    ipc.override('fetch_result_window', () => {
      throw new Error('connection reset')
    })
    seed(3000)
    requestVisibleRange(TAB, 0, [2100, 2120])
    await vi.waitFor(() =>
      expect(status).toHaveBeenCalledWith(
        TAB,
        0,
        { failedWindowRange: [2100, 2120] },
        { message: 'connection reset' }
      )
    )

    serveWindows(3000)
    retryFailedWindow(TAB, 0)
    expect(status).toHaveBeenCalledWith(TAB, 0, { failedWindowRange: null }, undefined)
    await vi.waitFor(() => expect(getLoadedRow(TAB, 0, 2100)).toBeDefined())
    retryFailedWindow('nope', 0)
  })

  it('reports the pending range only after the 1 s threshold', async () => {
    vi.useFakeTimers()
    const status = vi.fn()
    setWindowStatusHandler(status)
    const releases: Array<() => void> = []
    ipc.override(
      'fetch_result_window',
      (args) =>
        new Promise((resolve) => {
          releases.push(() =>
            resolve({
              offset: args?.offset,
              rows: [[1]],
              baseIndices: [1],
              viewRowCount: 3000,
              viewVersion: 1,
            })
          )
        })
    )
    seed(3000)
    requestVisibleRange(TAB, 0, [2100, 2110])
    vi.advanceTimersByTime(RESULT_LOADING_STATUS_DELAY_MS - 1)
    expect(status).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(status).toHaveBeenCalledWith(TAB, 0, { pendingWindowRange: [2100, 2110] }, undefined)
    releases.forEach((release) => release())
    await vi.waitFor(() =>
      expect(status).toHaveBeenCalledWith(TAB, 0, { pendingWindowRange: null }, undefined)
    )
  })

  it('ignores requests for unknown or empty surfaces', () => {
    requestVisibleRange('nope', 0, [0, 10])
    seed(0, 0)
    requestVisibleRange(TAB, 0, [0, 10])
    expect(windowCalls()).toHaveLength(0)
  })
})

describe('eviction and teardown', () => {
  it('clearResultWindowPages drops pages but keeps the surface metadata', () => {
    seed(10)
    clearResultWindowPages(TAB, 0)
    expect(loadedPositions()).toEqual([])
    expect(getResultSurface(TAB, 0)).toMatchObject({ viewRowCount: 10 })
    clearResultWindowPages('nope', 0)
  })

  it('dropTabResultWindows and clearAllResultWindows forget surfaces', () => {
    seed(10)
    seedResultWindow({
      connectionId: 'conn-1',
      tabId: 'other',
      resultIndex: 0,
      queryId: 'q-2',
      viewVersion: 1,
      viewRowCount: 0,
      columns: COLUMNS,
      window: { offset: 0, rows: [], baseIndices: [] },
    })
    dropTabResultWindows(TAB)
    expect(getResultSurface(TAB, 0)).toBeUndefined()
    expect(getResultSurface('other', 0)).toBeDefined()
    clearAllResultWindows()
    expect(getResultSurface('other', 0)).toBeUndefined()
  })
})

describe('off-window reads', () => {
  it('readViewRange reuses loaded rows and fetches the rest in 2,000-row chunks', async () => {
    serveWindows(5000)
    seed(5000)
    const progress = vi.fn()
    const rows = await readViewRange(TAB, 0, [500, 4500], { onProgress: progress })
    expect(rows).toHaveLength(4000)
    expect(rows[0]).toEqual({ row: [500], baseIndex: 500 })
    expect(rows[3999]).toEqual({ row: [4499], baseIndex: 4499 })
    const limits = windowCalls().map((call) => call.limit)
    expect(Math.max(...(limits as number[]))).toBeLessThanOrEqual(2000)
    expect(progress).toHaveBeenLastCalledWith({ done: 4000, total: 4000 })
    // Off-window reads don't populate the page cache.
    expect(getLoadedRow(TAB, 0, 4000)).toBeUndefined()
  })

  it('readViewRange serves a fully loaded range without IPC', async () => {
    seed(100)
    await expect(readViewRange(TAB, 0, [10, 12])).resolves.toEqual([
      { row: [10], baseIndex: 10 },
      { row: [11], baseIndex: 11 },
    ])
    expect(windowCalls()).toHaveLength(0)
  })

  it('readViewRange fails with view_stale when the view changes mid-read', async () => {
    serveWindows(5000, 2)
    seed(5000)
    await expect(readViewRange(TAB, 0, [2000, 2100])).rejects.toThrow(/view_stale/)
  })

  it('readViewRange aborts between chunks', async () => {
    serveWindows(9000)
    seed(9000)
    const controller = new AbortController()
    const read = readViewRange(TAB, 0, [1000, 9000], {
      signal: controller.signal,
      onProgress: () => controller.abort(),
    })
    await expect(read).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('readViewRange fails for unknown surfaces', async () => {
    await expect(readViewRange('nope', 0, [0, 1])).rejects.toThrow(/not available/)
  })
})
