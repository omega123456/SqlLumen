import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, waitFor } from '@testing-library/react'
import { useQueryStore, DEFAULT_RESULT_STATE } from '../../stores/query-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { ipc } from '../ipc-mock'
import { useSettingsStore } from '../../stores/settings-store'
import type { FilterCondition, QueryTableEditInfo, TableDataColumnMeta } from '../../types/schema'

const TAB_ID = 'tab-expired-test'
const CONN_ID = 'conn-expired-test'
const FILTER_EQ_ID_2: FilterCondition[] = [{ column: 'id', operator: '==', value: '2' }]
const TEST_EDIT_TABLE_COLUMNS: TableDataColumnMeta[] = [
  {
    name: 'id',
    dataType: 'INT',
    isBooleanAlias: false,
    isNullable: false,
    isPrimaryKey: true,
    isUniqueKey: true,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isAutoIncrement: false,
  },
]
const TEST_EDIT_TABLE_INFO: QueryTableEditInfo = {
  database: 'db',
  table: 'users',
  columns: TEST_EDIT_TABLE_COLUMNS,
  primaryKey: {
    keyColumns: ['id'],
    hasAutoIncrement: false,
    isUniqueKeyFallback: false,
  },
  foreignKeys: [],
}

function setupTabWithResult() {
  act(() => {
    useQueryStore.setState({
      tabs: {
        [TAB_ID]: {
          content: 'SELECT * FROM users',
          selectedText: '',
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: CONN_ID,
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'q-test-1',
              lastExecutedSql: 'SELECT * FROM users',
              columns: [{ name: 'id', dataType: 'INT' }],
              rows: [[1]],
              totalRows: 1,
            },
          ],
          activeResultIndex: 0,
          activeBottomPanelItem: { type: 'result' },
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
        },
      },
    })
  })
}

function setupMultiResultTab() {
  act(() => {
    useQueryStore.setState({
      tabs: {
        [TAB_ID]: {
          content: 'SELECT * FROM users; SELECT * FROM orders;',
          selectedText: '',
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: { lineNumber: 1, column: 10 },
          connectionId: CONN_ID,
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'q-test-1',
              lastExecutedSql: 'SELECT * FROM users',
              columns: [{ name: 'id', dataType: 'INT' }],
              rows: [[1]],
              totalRows: 1,
            },
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'q-test-2',
              lastExecutedSql: 'SELECT * FROM orders',
              columns: [{ name: 'id', dataType: 'INT' }],
              rows: [[2]],
              totalRows: 1,
            },
          ],
          activeResultIndex: 0,
          activeBottomPanelItem: { type: 'result' },
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
        },
      },
    })
  })
}

describe('query-store expired result handling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useQueryStore.setState({ tabs: {} })
    useWorkspaceStore.setState({
      tabsByConnection: {
        [CONN_ID]: [
          {
            id: TAB_ID,
            type: 'query-editor',
            label: 'Query 1',
            connectionId: CONN_ID,
          },
        ],
      },
      activeTabByConnection: {
        [CONN_ID]: TAB_ID,
      },
      lastFocusedSurfaceByTab: {},
      blockingNavigationByTab: {},
      pendingCascadeClose: null,
    })
    useSettingsStore.setState({
      settings: {
        'results.cacheTTL': '1',
      },
    })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('validateActiveTabResults marks expired when touch_results returns expired', async () => {
    setupTabWithResult()

    ipc.override('touch_results', () => ({ status: 'expired' }))

    act(() => {
      useQueryStore.getState().validateActiveTabResults(TAB_ID)
    })

    await waitFor(() => {
      const tab = useQueryStore.getState().tabs[TAB_ID]
      expect(tab?.results.every((result) => result.isExpired)).toBe(true)
    })
  })

  it('validateActiveTabResults does not mark expired when touch_results returns available', async () => {
    setupTabWithResult()

    ipc.override('touch_results', () => ({ status: 'available' }))

    act(() => {
      useQueryStore.getState().validateActiveTabResults(TAB_ID)
    })

    await waitFor(() => {
      const tab = useQueryStore.getState().tabs[TAB_ID]
      expect(tab?.results[0]?.isExpired).toBe(false)
    })
  })

  it('evicts inactive result rows after the configured TTL', async () => {
    setupTabWithResult()

    act(() => {
      useQueryStore.getState().markResultSurfaceInactive(TAB_ID, 0)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    const result = useQueryStore.getState().tabs[TAB_ID]?.results[0]
    expect(result?.rows).toEqual([])
    expect(result?.rowResidency.status).toBe('evicted')
    expect(result?.rowsEvictedAt).toBeTypeOf('number')
    expect(result?.isExpired).toBe(false)
  })

  it('still evicts filtered results when visible rows are empty but unfiltered rows remain', async () => {
    setupTabWithResult()

    act(() => {
      useQueryStore.setState((state) => {
        const tab = state.tabs[TAB_ID]
        if (!tab) return state
        const result = {
          ...tab.results[0],
          rows: [],
          unfilteredRows: [[1], [2]],
        }
        return {
          tabs: {
            ...state.tabs,
            [TAB_ID]: {
              ...tab,
              results: [result],
            },
          },
        }
      })
    })

    act(() => {
      useQueryStore.getState().markResultSurfaceInactive(TAB_ID, 0)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    const result = useQueryStore.getState().tabs[TAB_ID]?.results[0]
    expect(result?.rowResidency.status).toBe('evicted')
    expect(result?.unfilteredRows).toBeNull()
    expect(result?.rowsEvictedAt).toBeTypeOf('number')
  })

  it('restores evicted rows for an active result and reapplies client-side filters', async () => {
    setupTabWithResult()

    act(() => {
      useQueryStore.setState((state) => {
        const tab = state.tabs[TAB_ID]
        if (!tab) return state
        const result = {
          ...tab.results[0],
          rows: [],
          rowsEvictedAt: 1234,
          filterModel: FILTER_EQ_ID_2,
          rowResidency: {
            status: 'evicted' as const,
            isActive: false,
            inactiveSince: Date.now(),
          },
        }
        return {
          tabs: {
            ...state.tabs,
            [TAB_ID]: {
              ...tab,
              results: [result],
            },
          },
        }
      })
    })

    ipc.override('touch_results', () => ({ status: 'available' }))
    ipc.override('fetch_cached_rows', () => ({
      rows: [[1], [2]],
      columns: [{ name: 'id', dataType: 'INT' }],
    }))

    await act(async () => {
      await useQueryStore.getState().markResultSurfaceActive(TAB_ID, 0)
    })

    const result = useQueryStore.getState().tabs[TAB_ID]?.results[0]
    expect(result?.rowResidency.status).toBe('resident')
    expect(result?.rowResidency.isActive).toBe(true)
    expect(result?.rowsEvictedAt).toBeNull()
    expect(result?.rows).toEqual([[2]])
    expect(result?.unfilteredRows).toEqual([[1], [2]])
    expect(ipc.calls('touch_results')).toHaveLength(1)
    expect(ipc.calls('fetch_cached_rows')[0]).toMatchObject({
      connectionId: CONN_ID,
      tabId: TAB_ID,
      queryId: 'q-test-1',
      resultIndex: 0,
    })
  })

  it('preserves the latest inactive visibility state when restore finishes after switching away', async () => {
    setupMultiResultTab()

    act(() => {
      useQueryStore.setState((state) => {
        const tab = state.tabs[TAB_ID]
        if (!tab) return state
        const results = [...tab.results]
        results[1] = {
          ...results[1],
          rows: [],
          rowResidency: {
            status: 'evicted',
            isActive: false,
            inactiveSince: 123,
          },
        }
        return {
          tabs: {
            ...state.tabs,
            [TAB_ID]: { ...tab, results, activeResultIndex: 1 },
          },
        }
      })
    })

    const deferred: {
      resolve?: (value: {
        rows: unknown[][]
        columns: Array<{ name: string; dataType: string }>
      }) => void
    } = {}
    ipc.override('touch_results', () => ({ status: 'available' }))
    ipc.override(
      'fetch_cached_rows',
      () =>
        new Promise((resolve) => {
          deferred.resolve = resolve
        })
    )

    const restorePromise = useQueryStore.getState().markResultSurfaceActive(TAB_ID, 1)
    await waitFor(() => {
      expect(ipc.calls('fetch_cached_rows')).toHaveLength(1)
    })
    act(() => {
      useQueryStore.getState().markResultSurfaceInactive(TAB_ID, 1)
    })
    if (!deferred.resolve) {
      throw new Error('Expected fetch_cached_rows resolver')
    }
    deferred.resolve({ rows: [[22]], columns: [{ name: 'id', dataType: 'INT' }] })
    await restorePromise

    const result = useQueryStore.getState().tabs[TAB_ID]?.results[1]
    expect(result?.rows).toEqual([[22]])
    expect(result?.rowResidency).toEqual({
      status: 'resident',
      isActive: false,
      inactiveSince: expect.any(Number),
    })
  })

  it('does not mark a resident active result as restoring while another result is being restored', async () => {
    setupMultiResultTab()

    act(() => {
      useQueryStore.setState((state) => {
        const tab = state.tabs[TAB_ID]
        if (!tab) return state
        const results = [...tab.results]
        results[1] = {
          ...results[1],
          rows: [],
          rowResidency: {
            status: 'evicted',
            isActive: false,
            inactiveSince: 123,
          },
        }
        return {
          tabs: {
            ...state.tabs,
            [TAB_ID]: { ...tab, results, activeResultIndex: 1 },
          },
        }
      })
    })

    const deferred: {
      resolve?: (value: {
        rows: unknown[][]
        columns: Array<{ name: string; dataType: string }>
      }) => void
    } = {}
    ipc.override('touch_results', () => ({ status: 'available' }))
    ipc.override(
      'fetch_cached_rows',
      () =>
        new Promise((resolve) => {
          deferred.resolve = resolve
        })
    )

    const restorePromise = useQueryStore.getState().markResultSurfaceActive(TAB_ID, 1)
    await waitFor(() => {
      expect(ipc.calls('fetch_cached_rows')).toHaveLength(1)
    })

    act(() => {
      useQueryStore.getState().setActiveResultIndex(TAB_ID, 0)
    })

    const activeResult = useQueryStore.getState().tabs[TAB_ID]?.results[0]
    expect(activeResult?.rowResidency.status).toBe('resident')
    expect(useQueryStore.getState().tabs[TAB_ID]?.tabStatus).toBe('restoring')

    if (!deferred.resolve) {
      throw new Error('Expected fetch_cached_rows resolver')
    }
    deferred.resolve({ rows: [[22]], columns: [{ name: 'id', dataType: 'INT' }] })
    await restorePromise
  })

  it('marks results expired when restore finds missing backend cache', async () => {
    setupTabWithResult()

    act(() => {
      useQueryStore.setState((state) => {
        const tab = state.tabs[TAB_ID]
        if (!tab) return state
        const result = {
          ...tab.results[0],
          rows: [],
          rowResidency: {
            status: 'evicted' as const,
            isActive: false,
            inactiveSince: Date.now(),
          },
        }
        return {
          tabs: {
            ...state.tabs,
            [TAB_ID]: {
              ...tab,
              results: [result],
            },
          },
        }
      })
    })

    ipc.override('touch_results', () => ({ status: 'missing' }))

    await act(async () => {
      await useQueryStore.getState().markResultSurfaceActive(TAB_ID, 0)
    })

    const result = useQueryStore.getState().tabs[TAB_ID]?.results[0]
    expect(result?.isExpired).toBe(true)
    expect(result?.rowResidency.status).toBe('evicted')
    expect(ipc.calls('fetch_cached_rows')).toHaveLength(0)
  })

  it('resets restoring status back to evicted when restore fetch throws', async () => {
    setupTabWithResult()

    act(() => {
      useQueryStore.setState((state) => {
        const tab = state.tabs[TAB_ID]
        if (!tab) return state
        return {
          tabs: {
            ...state.tabs,
            [TAB_ID]: {
              ...tab,
              results: [
                {
                  ...tab.results[0],
                  rows: [],
                  rowResidency: {
                    status: 'evicted',
                    isActive: false,
                    inactiveSince: 999,
                  },
                },
              ],
            },
          },
        }
      })
    })

    ipc.override('touch_results', () => ({ status: 'available' }))
    ipc.override('fetch_cached_rows', () => {
      throw new Error('restore failed')
    })

    await act(async () => {
      await useQueryStore.getState().markResultSurfaceActive(TAB_ID, 0)
    })

    const result = useQueryStore.getState().tabs[TAB_ID]?.results[0]
    expect(result?.rowResidency).toEqual({
      status: 'evicted',
      isActive: true,
      inactiveSince: null,
    })
  })

  it('does not evict rows for results with dirty edits', async () => {
    setupTabWithResult()

    act(() => {
      useQueryStore.setState((state) => {
        const tab = state.tabs[TAB_ID]
        if (!tab) return state
        const result = {
          ...tab.results[0],
          editState: {
            rowKey: { id: 1 },
            originalValues: { id: 1 },
            currentValues: { id: 2 },
            modifiedColumns: new Set(['id']),
            isNewRow: false,
            insertEligibleColumns: new Set<string>(),
          },
        }
        return {
          tabs: {
            ...state.tabs,
            [TAB_ID]: {
              ...tab,
              results: [result],
            },
          },
        }
      })
    })

    act(() => {
      useQueryStore.getState().markResultSurfaceInactive(TAB_ID, 0)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    const result = useQueryStore.getState().tabs[TAB_ID]?.results[0]
    expect(result?.rows).toEqual([[1]])
    expect(result?.rowResidency.status).toBe('resident')
  })

  it('restores the newly active evicted result in a multi-result tab', async () => {
    setupMultiResultTab()

    act(() => {
      useQueryStore.setState((state) => {
        const tab = state.tabs[TAB_ID]
        if (!tab) return state
        const results = [...tab.results]
        results[1] = {
          ...results[1],
          rows: [],
          rowResidency: {
            status: 'evicted',
            isActive: false,
            inactiveSince: Date.now(),
          },
        }
        return {
          tabs: {
            ...state.tabs,
            [TAB_ID]: { ...tab, results },
          },
        }
      })
    })

    ipc.override('touch_results', () => ({ status: 'available' }))
    ipc.override('fetch_cached_rows', () => ({
      rows: [[22]],
      columns: [{ name: 'id', dataType: 'INT' }],
    }))

    await act(async () => {
      useQueryStore.getState().setActiveResultIndex(TAB_ID, 1)
      await waitFor(() => {
        const result = useQueryStore.getState().tabs[TAB_ID]?.results[1]
        expect(result?.rowResidency.status).toBe('resident')
      })
    })

    const tab = useQueryStore.getState().tabs[TAB_ID]
    expect(tab?.activeResultIndex).toBe(1)
    expect(tab?.results[1]?.rows).toEqual([[22]])
    expect(tab?.results[0]?.rowResidency.isActive).toBe(false)
    expect(tab?.results[1]?.rowResidency.isActive).toBe(true)
  })

  it('retryExpiredResult uses the shared editor execution plan from selected text', async () => {
    setupTabWithResult()

    act(() => {
      useQueryStore.setState((state) => {
        const tab = state.tabs[TAB_ID]
        if (!tab) return state
        const results = [...tab.results]
        results[0] = {
          ...results[0],
          isExpired: true,
          lastExecutedSql: 'SELECT * FROM users',
        }
        return {
          tabs: {
            ...state.tabs,
            [TAB_ID]: {
              ...tab,
              content: 'SELECT * FROM users;\nSELECT * FROM orders WHERE id = 9;',
              selectedText: 'SELECT * FROM orders WHERE id = 9',
              cursorPosition: { lineNumber: 1, column: 10 },
              results,
            },
          },
        }
      })
    })

    const executeQuerySpy = vi.fn(() => ({
      queryId: 'q-retried',
      columns: [{ name: 'id', dataType: 'INT' }],
      totalRows: 1,
      executionTimeMs: 5,
      affectedRows: 0,
      rows: [[1]],

      autoLimitApplied: false,
    }))

    ipc.override('execute_query', executeQuerySpy)

    await act(async () => {
      await useQueryStore.getState().retryExpiredResult(TAB_ID)
    })

    const tab = useQueryStore.getState().tabs[TAB_ID]
    expect(executeQuerySpy).toHaveBeenCalledTimes(1)
    expect(ipc.calls('execute_query')[0]).toMatchObject({
      sql: 'SELECT * FROM orders WHERE id = 9',
    })
    expect(tab?.results[0]?.isExpired).toBe(false)
  })

  it('retryExpiredResult keeps isExpired when no valid rerun plan is available', async () => {
    setupTabWithResult()

    act(() => {
      useQueryStore.setState((state) => {
        const tab = state.tabs[TAB_ID]
        if (!tab) return state
        const results = [...tab.results]
        results[0] = { ...results[0], isExpired: true, lastExecutedSql: null }
        return {
          tabs: {
            ...state.tabs,
            [TAB_ID]: { ...tab, content: '   ', selectedText: '', cursorPosition: null, results },
          },
        }
      })
    })

    await act(async () => {
      await useQueryStore.getState().retryExpiredResult(TAB_ID)
    })

    expect(ipc.calls('execute_query')).toHaveLength(0)
    expect(useQueryStore.getState().tabs[TAB_ID]?.results[0]?.isExpired).toBe(true)
  })

  it('retryExpiredResult keeps isExpired when rerun fails', async () => {
    setupTabWithResult()

    act(() => {
      useQueryStore.setState((state) => {
        const tab = state.tabs[TAB_ID]
        if (!tab) return state
        const results = [...tab.results]
        results[0] = { ...results[0], isExpired: true }
        return { tabs: { ...state.tabs, [TAB_ID]: { ...tab, results } } }
      })
    })

    ipc.override('execute_query', () => {
      throw new Error('connection dropped')
    })

    await act(async () => {
      await useQueryStore.getState().retryExpiredResult(TAB_ID)
    })

    const tab = useQueryStore.getState().tabs[TAB_ID]
    expect(tab?.results.every((item) => item.isExpired)).toBe(true)
    expect(tab?.results[0]?.resultStatus).toBe('error')
  })

  it('retryExpiredResult uses the statement at cursor for multi-result tabs', async () => {
    setupMultiResultTab()
    let resolveReexecute:
      | ((value: {
          sourceSql: string
          reExecutable: boolean
          columns: { name: string; dataType: string }[]
          rows: unknown[][]
          totalRows: number
          executionTimeMs: number
          affectedRows: number
          autoLimitApplied: boolean
          queryId: string
          error: null
        }) => void)
      | null = null

    act(() => {
      useQueryStore.setState((state) => {
        const tab = state.tabs[TAB_ID]
        if (!tab) return state
        const results = [...tab.results]
        results[0] = { ...results[0], isExpired: true }
        return { tabs: { ...state.tabs, [TAB_ID]: { ...tab, results } } }
      })
    })

    ipc.override(
      'reexecute_single_result',
      () =>
        new Promise((resolve) => {
          resolveReexecute = resolve
        })
    )

    await act(async () => {
      const retryPromise = useQueryStore.getState().retryExpiredResult(TAB_ID)
      expect(useQueryStore.getState().tabs[TAB_ID]?.tabStatus).toBe('running')
      resolveReexecute?.({
        sourceSql: 'SELECT * FROM users',
        reExecutable: true,
        columns: [{ name: 'id', dataType: 'INT' }],
        rows: [[5]],
        totalRows: 1,
        executionTimeMs: 3,
        affectedRows: 0,

        autoLimitApplied: false,
        queryId: 'q-reexec-1',
        error: null,
      })
      await retryPromise
    })

    expect(ipc.calls('reexecute_single_result')[0]).toMatchObject({
      sql: 'SELECT * FROM users',
      resultIndex: 0,
    })
    expect(useQueryStore.getState().tabs[TAB_ID]?.results[0]?.isExpired).toBe(false)
  })

  it('sortResults sets isExpired when error contains results_expired', async () => {
    setupMultiResultTab()

    ipc.override('sort_results', () => {
      throw new Error('results_expired: Results expired.')
    })

    await act(async () => {
      await useQueryStore.getState().sortResults(CONN_ID, TAB_ID, 'id', 'asc')
    })

    const tab = useQueryStore.getState().tabs[TAB_ID]
    expect(tab?.results.every((result) => result.isExpired)).toBe(true)
  })

  it('changeRowLimit sets all tab results expired when re-execution returns results_expired', async () => {
    setupMultiResultTab()

    ipc.override('reexecute_single_result', () => {
      throw new Error('results_expired: Results expired.')
    })

    await act(async () => {
      await useQueryStore.getState().changeRowLimit(CONN_ID, TAB_ID, 50)
    })

    expect(useQueryStore.getState().tabs[TAB_ID]?.results.every((result) => result.isExpired)).toBe(
      true
    )
  })

  it('saveCurrentRow marks the whole tab expired when cache sync reports results_expired', async () => {
    setupTabWithResult()

    act(() => {
      useQueryStore.setState((state) => {
        const tab = state.tabs[TAB_ID]
        if (!tab) return state
        const result = {
          ...tab.results[0],
          editMode: 'db.users',
          editConnectionId: CONN_ID,
          editingRowIndex: 0,
          editBoundColumnIndexMap: new Map([['id', 0]]),
          editColumnBindings: new Map([[0, 'id']]),
          editState: {
            rowKey: { id: 1 },
            originalValues: { id: 1 },
            currentValues: { id: 2 },
            modifiedColumns: new Set(['id']),
            isNewRow: false,
            insertEligibleColumns: new Set<string>(),
          },
          editTableMetadata: {
            'db.users': TEST_EDIT_TABLE_INFO,
          },
        }
        return {
          tabs: {
            ...state.tabs,
            [TAB_ID]: { ...tab, results: [result] },
          },
        }
      })
    })

    ipc.override('update_table_row', () => undefined)
    ipc.override('update_result_cell', () => {
      throw new Error('results_expired: Results expired.')
    })

    await act(async () => {
      const saved = await useQueryStore.getState().saveCurrentRow(TAB_ID)
      expect(saved).toBe(true)
    })

    expect(useQueryStore.getState().tabs[TAB_ID]?.results.every((result) => result.isExpired)).toBe(
      true
    )
  })

  it('successful executeQuery sets isExpired to false', async () => {
    setupTabWithResult()

    // Mark as expired first
    act(() => {
      useQueryStore.setState((state) => {
        const tab = state.tabs[TAB_ID]
        if (!tab) return state
        const results = [...tab.results]
        results[0] = { ...results[0], isExpired: true }
        return { tabs: { ...state.tabs, [TAB_ID]: { ...tab, results } } }
      })
    })

    ipc.override('execute_query', () => ({
      queryId: 'q-fresh',
      columns: [{ name: 'id', dataType: 'INT' }],
      totalRows: 1,
      executionTimeMs: 5,
      affectedRows: 0,
      rows: [[1]],

      autoLimitApplied: false,
    }))

    await act(async () => {
      await useQueryStore.getState().executeQuery(CONN_ID, TAB_ID, 'SELECT 1')
    })

    const tab = useQueryStore.getState().tabs[TAB_ID]
    // executeQuery creates a new result with DEFAULT_RESULT_STATE which has isExpired: false
    expect(tab?.results[0]?.isExpired).toBe(false)
  })

  it('validateActiveTabResults leaves tab available when touch_results returns available', async () => {
    setupMultiResultTab()

    act(() => {
      useQueryStore.setState((state) => {
        const tab = state.tabs[TAB_ID]
        if (!tab) return state
        return {
          tabs: {
            ...state.tabs,
            [TAB_ID]: {
              ...tab,
              results: tab.results.map((result) => ({ ...result, isExpired: true })),
            },
          },
        }
      })
    })

    ipc.override('touch_results', () => ({ status: 'available' }))

    act(() => {
      useQueryStore.getState().validateActiveTabResults(TAB_ID)
    })

    await waitFor(() => {
      expect(
        useQueryStore.getState().tabs[TAB_ID]?.results.every((result) => result.isExpired)
      ).toBe(true)
    })
  })
})
