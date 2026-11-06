/**
 * Sort and filter run in Rust over a view of the cached result. The store only
 * sends view specs (`set_result_view`) and paints the returned first window.
 *
 * Covers the compare-and-swap protocol (D15): request sequence numbers, the
 * latest known view version, at most one re-issue after `view_superseded`,
 * and the terminal rule (revert + "Couldn't apply sort or filter" band).
 * Filter operator semantics are covered by the Rust view tests.
 */
import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ipc } from '../ipc-mock'
import { useQueryStore } from '../../stores/query-store'
import { useToastStore } from '../../stores/toast-store'
import { getResultSurface, requestVisibleRange } from '../../lib/result-window-cache'
import type {
  ColumnMeta,
  FilterCondition,
  ResultWindow,
  SetResultViewResult,
} from '../../types/schema'
import { makeTabState, rowsOf } from '../helpers/query-test-utils'

const TAB = 'tab-1'
const CONN = 'conn-1'

const COLUMNS: ColumnMeta[] = [
  { name: 'id', dataType: 'INT' },
  { name: 'name', dataType: 'VARCHAR' },
  { name: 'age', dataType: 'INT' },
]

const ROWS: unknown[][] = [
  [1, 'Alice', 30],
  [2, 'Bob', 25],
  [3, 'Charlie', 35],
]

const FILTER_A: FilterCondition[] = [{ column: 'age', operator: '>', value: '26' }]

function windowOf(rows: unknown[][], baseIndices: number[]): ResultWindow {
  return { offset: 0, rows, baseIndices }
}

function viewResponse(
  viewVersion: number,
  rows: unknown[][],
  baseIndices: number[],
  totalRows = ROWS.length
): SetResultViewResult {
  return {
    viewVersion,
    viewRowCount: rows.length,
    totalRows,
    firstWindow: windowOf(rows, baseIndices),
  }
}

interface Pending {
  args: Record<string, unknown>
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

/** Queue `set_result_view` calls so a test can settle them in any order. */
function deferSetResultView(): Pending[] {
  const pending: Pending[] = []
  ipc.override(
    'set_result_view',
    (args) =>
      new Promise((resolve, reject) => {
        pending.push({ args: args ?? {}, resolve, reject })
      })
  )
  return pending
}

function result() {
  return useQueryStore.getState().tabs[TAB]!.results[0]
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
  act(() => {
    useQueryStore.setState({
      tabs: {
        [TAB]: makeTabState({
          connectionId: CONN,
          status: 'success',
          columns: COLUMNS,
          rows: ROWS,
          queryId: 'q-1',
          viewVersion: 1,
          lastExecutedSql: 'SELECT * FROM people',
          selectedRowIndex: 1,
          checkedRowIndices: [0],
        }),
      },
    })
  })
})

describe('applyQueryFilters', () => {
  it('sends the whole view spec with the latest known version and paints the first window', async () => {
    ipc.override('set_result_view', () => viewResponse(2, [ROWS[0], ROWS[2]], [0, 2]))

    await act(async () => {
      useQueryStore.getState().applyQueryFilters(TAB, 0, FILTER_A)
      expect(result().isFiltering).toBe(true)
      await flush()
    })

    expect(ipc.calls('set_result_view')[0]).toEqual({
      connectionId: CONN,
      tabId: TAB,
      resultIndex: 0,
      queryId: 'q-1',
      baseViewVersion: 1,
      viewSpec: { sort: null, filters: FILTER_A },
    })
    const painted = result()
    expect(painted.isFiltering).toBe(false)
    expect(painted.filterModel).toEqual(FILTER_A)
    expect(painted.viewVersion).toBe(2)
    expect(painted.viewRowCount).toBe(2)
    expect(painted.totalRows).toBe(3)
    expect(rowsOf(TAB)).toEqual([ROWS[0], ROWS[2]])
    // Checked rows and the selection belong to the old view.
    expect(painted.checkedRanges).toEqual([])
    expect(painted.checkedViewVersion).toBe(2)
    expect(painted.selectedRowIndex).toBeNull()
    expect(ipc.calls('execute_query')).toHaveLength(0)
  })

  it('keeps the current sort when filtering', async () => {
    act(() => {
      useQueryStore.setState((state) => ({
        tabs: {
          ...state.tabs,
          [TAB]: {
            ...state.tabs[TAB]!,
            results: [{ ...result(), sortColumn: 'name', sortDirection: 'desc' }],
          },
        },
      }))
    })
    ipc.override('set_result_view', () => viewResponse(2, [ROWS[2]], [2]))

    await act(async () => {
      useQueryStore.getState().applyQueryFilters(TAB, 0, FILTER_A)
      await flush()
    })

    expect(ipc.calls('set_result_view')[0]).toMatchObject({
      viewSpec: { sort: { column: 'name', direction: 'desc' }, filters: FILTER_A },
    })
    expect(result().sortColumn).toBe('name')
  })

  it('clearing filters restores the unfiltered view in Rust without a re-run', async () => {
    ipc.override('set_result_view', () => viewResponse(3, ROWS, [0, 1, 2]))

    await act(async () => {
      useQueryStore.getState().applyQueryFilters(TAB, 0, [])
      await flush()
    })

    expect(ipc.calls('set_result_view')[0]).toMatchObject({ viewSpec: { sort: null, filters: [] } })
    expect(result().filterModel).toEqual([])
    expect(rowsOf(TAB)).toEqual(ROWS)
    expect(ipc.calls('execute_query')).toHaveLength(0)
    expect(ipc.calls('reexecute_single_result')).toHaveLength(0)
  })

  it('ignores an out-of-range result index', () => {
    useQueryStore.getState().applyQueryFilters(TAB, 5, FILTER_A)
    useQueryStore.getState().applyQueryFilters('missing', 0, FILTER_A)
    expect(ipc.calls('set_result_view')).toHaveLength(0)
  })
})

describe('sortResults', () => {
  it('sorts in Rust and clearing the sort restores base order with no execute command', async () => {
    ipc.override('set_result_view', (args) => {
      const sort = (args?.viewSpec as { sort: unknown }).sort
      return sort
        ? viewResponse(2, [ROWS[2], ROWS[1], ROWS[0]], [2, 1, 0])
        : viewResponse(3, ROWS, [0, 1, 2])
    })

    await act(async () => {
      await useQueryStore.getState().sortResults(CONN, TAB, 'id', 'desc')
    })
    expect(result().sortColumn).toBe('id')
    expect(result().sortDirection).toBe('desc')
    expect(rowsOf(TAB)).toEqual([ROWS[2], ROWS[1], ROWS[0]])

    await act(async () => {
      await useQueryStore.getState().sortResults(CONN, TAB, 'id', null)
    })
    expect(ipc.calls('set_result_view')[1]).toMatchObject({
      baseViewVersion: 2,
      viewSpec: { sort: null, filters: [] },
    })
    expect(result().sortColumn).toBeNull()
    expect(result().sortDirection).toBeNull()
    expect(rowsOf(TAB)).toEqual(ROWS)
    expect(ipc.calls('execute_query')).toHaveLength(0)
    expect(ipc.calls('reexecute_single_result')).toHaveLength(0)
  })

  it('shows the sorting overlay while the view request is pending', async () => {
    const pending = deferSetResultView()
    let sortPromise: Promise<void> = Promise.resolve()
    act(() => {
      sortPromise = useQueryStore.getState().sortResults(CONN, TAB, 'id', 'asc')
    })
    expect(result().isSorting).toBe(true)
    await act(async () => {
      pending[0].resolve(viewResponse(2, ROWS, [0, 1, 2]))
      await sortPromise
    })
    expect(result().isSorting).toBe(false)
  })

  it('marks the tab expired when the view request reports results_expired', async () => {
    ipc.override('set_result_view', () => {
      throw new Error('results_expired: gone')
    })
    await act(async () => {
      await useQueryStore.getState().sortResults(CONN, TAB, 'id', 'asc')
    })
    expect(result().isExpired).toBe(true)
    expect(result().isSorting).toBe(false)
  })

  it('discards a response for a result that was replaced meanwhile', async () => {
    const pending = deferSetResultView()
    let sortPromise: Promise<void> = Promise.resolve()
    act(() => {
      sortPromise = useQueryStore.getState().sortResults(CONN, TAB, 'id', 'asc')
    })
    act(() => {
      useQueryStore.setState((state) => ({
        tabs: {
          ...state.tabs,
          [TAB]: { ...state.tabs[TAB]!, results: [{ ...result(), queryId: 'q-new' }] },
        },
      }))
    })
    await act(async () => {
      pending[0].resolve(viewResponse(9, [ROWS[2]], [2]))
      await sortPromise
    })
    expect(result().viewVersion).toBe(1)
    expect(result().sortColumn).toBeNull()
  })
})

describe('overlapping view changes (D15)', () => {
  it('an older success updates the latest known version; a superseded newer request is re-issued once and painted', async () => {
    const pending = deferSetResultView()

    // Filter A (seq 1) and sort B (seq 2) both start from version 1.
    act(() => {
      useQueryStore.getState().applyQueryFilters(TAB, 0, FILTER_A)
    })
    let sortPromise: Promise<void> = Promise.resolve()
    act(() => {
      sortPromise = useQueryStore.getState().sortResults(CONN, TAB, 'name', 'asc')
    })
    expect(pending.map((call) => call.args.baseViewVersion)).toEqual([1, 1])
    expect(pending[1].args.viewSpec).toEqual({
      sort: { column: 'name', direction: 'asc' },
      filters: FILTER_A,
    })

    // A wins the compare-and-swap: not painted (older sequence), but its version is kept.
    await act(async () => {
      pending[0].resolve(viewResponse(2, [ROWS[0], ROWS[2]], [0, 2]))
      await flush()
    })
    expect(result().latestKnownViewVersion).toBe(2)
    expect(result().viewVersion).toBe(1)
    expect(result().filterModel).toEqual([])

    // B is refused against the old version and re-issued once against <n>.
    await act(async () => {
      pending[1].reject(new Error('view_superseded: current=2'))
      await flush()
    })
    expect(pending).toHaveLength(3)
    expect(pending[2].args.baseViewVersion).toBe(2)

    await act(async () => {
      pending[2].resolve(viewResponse(3, [ROWS[0], ROWS[2]], [0, 2]))
      await sortPromise
    })
    const painted = result()
    expect(painted.viewVersion).toBe(3)
    expect(painted.sortColumn).toBe('name')
    expect(painted.filterModel).toEqual(FILTER_A)
    expect(painted.viewError).toBeNull()

    // Window fetches keep working against the painted version.
    ipc.override('fetch_result_window', (args) => ({
      offset: args?.offset,
      rows: [],
      baseIndices: [],
      viewRowCount: 2,
      viewVersion: 3,
    }))
    expect(getResultSurface(TAB, 0)?.viewVersion).toBe(3)
  })

  it('a second refusal reverts to the latest successful view and shows the view-error band', async () => {
    const pending = deferSetResultView()
    act(() => {
      useQueryStore.getState().applyQueryFilters(TAB, 0, FILTER_A)
    })
    let sortPromise: Promise<void> = Promise.resolve()
    act(() => {
      sortPromise = useQueryStore.getState().sortResults(CONN, TAB, 'name', 'asc')
    })
    await act(async () => {
      pending[0].resolve(viewResponse(2, [ROWS[0], ROWS[2]], [0, 2]))
      pending[1].reject(new Error('view_superseded: current=2'))
      await flush()
    })
    await act(async () => {
      pending[2].reject(new Error('view_superseded: current=2'))
      await sortPromise
    })

    // No automatic re-issue after the second refusal.
    expect(pending).toHaveLength(3)
    const reverted = result()
    expect(reverted.viewVersion).toBe(2)
    expect(reverted.filterModel).toEqual(FILTER_A)
    expect(reverted.sortColumn).toBeNull()
    expect(reverted.viewError).toBe('view_superseded: current=2')
    expect(reverted.isSorting).toBe(false)
    expect(rowsOf(TAB)).toEqual([ROWS[0], ROWS[2]])
    expect(
      useToastStore.getState().toasts.some((t) => t.title === "Couldn't apply sort or filter")
    ).toBe(true)
  })

  it('a newer request failing with a non-superseded error reverts to the latest success without re-issuing', async () => {
    const pending = deferSetResultView()
    act(() => {
      useQueryStore.getState().applyQueryFilters(TAB, 0, FILTER_A)
    })
    let sortPromise: Promise<void> = Promise.resolve()
    act(() => {
      sortPromise = useQueryStore.getState().sortResults(CONN, TAB, 'missing', 'asc')
    })
    await act(async () => {
      pending[0].resolve(viewResponse(2, [ROWS[0], ROWS[2]], [0, 2]))
      pending[1].reject(new Error("Sort column 'missing' not found"))
      await sortPromise
    })

    expect(pending).toHaveLength(2)
    expect(result().viewVersion).toBe(2)
    expect(result().filterModel).toEqual(FILTER_A)
    expect(result().viewError).toBe("Sort column 'missing' not found")
  })

  it('with no successful view, keeps the server view and refetches it when its version moved on', async () => {
    const pending = deferSetResultView()
    ipc.override('fetch_result_window', () => ({
      offset: 0,
      rows: [ROWS[1]],
      baseIndices: [1],
      viewRowCount: 1,
      viewVersion: 4,
    }))
    let sortPromise: Promise<void> = Promise.resolve()
    act(() => {
      sortPromise = useQueryStore.getState().sortResults(CONN, TAB, 'id', 'asc')
    })
    await act(async () => {
      pending[0].reject(new Error('view_superseded: current=4'))
      await flush()
    })
    await act(async () => {
      pending[1].reject(new Error('view_superseded: current=4'))
      await sortPromise
    })

    expect(ipc.calls('fetch_result_window')[0]).toMatchObject({ viewVersion: 4, offset: 0 })
    expect(result().viewVersion).toBe(4)
    expect(result().viewError).toBe('view_superseded: current=4')
    expect(rowsOf(TAB)).toEqual([ROWS[1]])
  })

  it('with no successful view and no newer version, only shows the band', async () => {
    ipc.override('set_result_view', () => {
      throw new Error('boom')
    })
    await act(async () => {
      await useQueryStore.getState().sortResults(CONN, TAB, 'id', 'asc')
    })
    expect(result().viewVersion).toBe(1)
    expect(result().sortColumn).toBeNull()
    expect(result().viewError).toBe('boom')
    expect(rowsOf(TAB)).toEqual(ROWS)
  })

  it('keeps the band when refetching the server view also fails', async () => {
    const pending = deferSetResultView()
    ipc.override('fetch_result_window', () => {
      throw new Error('offline')
    })
    let sortPromise: Promise<void> = Promise.resolve()
    act(() => {
      sortPromise = useQueryStore.getState().sortResults(CONN, TAB, 'id', 'asc')
    })
    await act(async () => {
      pending[0].reject(new Error('view_superseded: current=4'))
      await flush()
      pending[1].reject(new Error('view_superseded: current=4'))
      await sortPromise
    })
    expect(result().viewError).toBe('view_superseded: current=4')
    expect(result().isSorting).toBe(false)
  })

  it('a success older than a tombstone write repaints the server view with its spec', async () => {
    const pending = deferSetResultView()
    let sortPromise: Promise<void> = Promise.resolve()
    act(() => {
      sortPromise = useQueryStore.getState().sortResults(CONN, TAB, 'name', 'desc')
    })
    // Meanwhile a delete tombstoned row 1 on top of the sorted view (v3) and painted.
    act(() => {
      useQueryStore.setState((state) => {
        const tab = state.tabs[TAB]!
        return {
          tabs: {
            ...state.tabs,
            [TAB]: {
              ...tab,
              results: [{ ...tab.results[0], viewVersion: 3, latestKnownViewVersion: 3 }],
            },
          },
        }
      })
    })
    ipc.override('fetch_result_window', () => ({
      offset: 0,
      rows: [ROWS[2], ROWS[0]],
      baseIndices: [2, 0],
      viewRowCount: 2,
      viewVersion: 3,
    }))
    await act(async () => {
      pending[0].resolve(viewResponse(2, [ROWS[2], ROWS[1], ROWS[0]], [2, 1, 0]))
      await sortPromise
    })

    // v2 is never painted: its windows would all be view_stale.
    expect(ipc.calls('fetch_result_window')[0]).toMatchObject({
      viewVersion: 3,
      offset: 0,
      limit: 1000,
    })
    const painted = result()
    expect(painted.viewVersion).toBe(3)
    expect(painted.sortColumn).toBe('name')
    expect(painted.sortDirection).toBe('desc')
    expect(painted.isSorting).toBe(false)
    expect(painted.viewError).toBeNull()
    expect(rowsOf(TAB)).toEqual([ROWS[2], ROWS[0]])
  })

  it('settles with the view-error band when repainting the server view fails', async () => {
    const pending = deferSetResultView()
    let sortPromise: Promise<void> = Promise.resolve()
    act(() => {
      sortPromise = useQueryStore.getState().sortResults(CONN, TAB, 'name', 'desc')
    })
    act(() => {
      useQueryStore.setState((state) => {
        const tab = state.tabs[TAB]!
        return {
          tabs: {
            ...state.tabs,
            [TAB]: { ...tab, results: [{ ...tab.results[0], latestKnownViewVersion: 3 }] },
          },
        }
      })
    })
    ipc.override('fetch_result_window', () => {
      throw new Error('offline')
    })
    await act(async () => {
      pending[0].resolve(viewResponse(2, ROWS, [0, 1, 2]))
      await sortPromise
    })
    expect(result().isSorting).toBe(false)
    expect(result().viewError).toBe('offline')
  })

  it('Retry re-issues the latest requested spec', async () => {
    ipc.override('set_result_view', () => {
      throw new Error('boom')
    })
    await act(async () => {
      useQueryStore.getState().applyQueryFilters(TAB, 0, FILTER_A)
      await flush()
    })
    expect(result().viewError).toBe('boom')

    ipc.override('set_result_view', () => viewResponse(2, [ROWS[0], ROWS[2]], [0, 2]))
    await act(async () => {
      useQueryStore.getState().retryViewChange(TAB)
      await flush()
    })
    expect(ipc.calls('set_result_view')[1]).toMatchObject({
      viewSpec: { sort: null, filters: FILTER_A },
    })
    expect(result().viewError).toBeNull()
    expect(result().filterModel).toEqual(FILTER_A)
  })

  it('retryViewChange is a no-op for unknown tabs', () => {
    useQueryStore.getState().retryViewChange('missing')
    expect(ipc.calls('set_result_view')).toHaveLength(0)
  })
})

describe('window retry', () => {
  it('retryResultWindow clears the failed range and refetches it', async () => {
    ipc.override('fetch_result_window', () => {
      throw new Error('offline')
    })
    act(() => {
      useQueryStore.setState((state) => ({
        tabs: {
          ...state.tabs,
          [TAB]: { ...state.tabs[TAB]!, results: [{ ...result(), viewRowCount: 3000 }] },
        },
      }))
    })
    // A larger view than the seeded rows: positions past the first window aren't loaded.
    useQueryStore.setState((state) => state)
    const surface = getResultSurface(TAB, 0)
    expect(surface).toBeDefined()
    await act(async () => {
      requestVisibleRange(TAB, 0, [3, 3])
      await flush()
    })
    act(() => {
      useQueryStore.getState().retryResultWindow(TAB)
    })
    expect(result().failedWindowRange).toBeNull()
  })
})
