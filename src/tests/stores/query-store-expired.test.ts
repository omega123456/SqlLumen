import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, waitFor } from '@testing-library/react'
import { useQueryStore, DEFAULT_RESULT_STATE } from '../../stores/query-store'
import { ipc } from '../ipc-mock'

const TAB_ID = 'tab-expired-test'
const CONN_ID = 'conn-expired-test'

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
    useQueryStore.setState({ tabs: {} })
  })

  it('fetchPage sets isExpired when error contains results_expired', async () => {
    setupTabWithResult()

    ipc.override('fetch_result_page', () => {
      throw new Error('results_expired: Results for this tab have expired.')
    })

    await act(async () => {
      await useQueryStore.getState().fetchPage(CONN_ID, TAB_ID, 2)
    })

    const tab = useQueryStore.getState().tabs[TAB_ID]
    expect(tab?.results.every((result) => result.isExpired)).toBe(true)
  })

  it('validateActiveTabResults marks expired when touch_results returns expired', async () => {
    setupTabWithResult()

    ipc.override('touch_results', () => ({ status: 'expired' }))

    await act(async () => {
      useQueryStore.getState().validateActiveTabResults(TAB_ID)
      // Wait for async IPC
      await new Promise((r) => setTimeout(r, 50))
    })

    const tab = useQueryStore.getState().tabs[TAB_ID]
    expect(tab?.results.every((result) => result.isExpired)).toBe(true)
  })

  it('validateActiveTabResults does not mark expired when touch_results returns available', async () => {
    setupTabWithResult()

    ipc.override('touch_results', () => ({ status: 'available' }))

    await act(async () => {
      useQueryStore.getState().validateActiveTabResults(TAB_ID)
      await new Promise((r) => setTimeout(r, 50))
    })

    const tab = useQueryStore.getState().tabs[TAB_ID]
    expect(tab?.results[0]?.isExpired).toBe(false)
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
      firstPage: [[1]],
      totalPages: 1,
      autoLimitApplied: false,
    }))

    ipc.override('execute_query', executeQuerySpy)

    await act(async () => {
      await useQueryStore.getState().retryExpiredResult(TAB_ID)
    })

    const tab = useQueryStore.getState().tabs[TAB_ID]
    expect(executeQuerySpy).toHaveBeenCalledTimes(1)
    expect(ipc.calls('execute_query')[0]).toMatchObject({ sql: 'SELECT * FROM orders WHERE id = 9' })
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
    let resolveReexecute: ((value: {
      sourceSql: string
      reExecutable: boolean
      columns: { name: string; dataType: string }[]
      firstPage: unknown[][]
      totalRows: number
      executionTimeMs: number
      affectedRows: number
      totalPages: number
      autoLimitApplied: boolean
      queryId: string
      error: null
    }) => void) | null = null

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
        firstPage: [[5]],
        totalRows: 1,
        executionTimeMs: 3,
        affectedRows: 0,
        totalPages: 1,
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

  it('changePageSize sets all tab results expired when re-execution returns results_expired', async () => {
    setupMultiResultTab()

    ipc.override('reexecute_single_result', () => {
      throw new Error('results_expired: Results expired.')
    })

    await act(async () => {
      await useQueryStore.getState().changePageSize(CONN_ID, TAB_ID, 50)
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
            'db.users': {
              database: 'db',
              table: 'users',
              columns: [{ name: 'id', dataType: 'INT', isNullable: false, isPrimaryKey: true }],
              primaryKey: {
                constraintName: 'PRIMARY',
                keyColumns: ['id'],
                isUniqueKeyFallback: false,
              },
              foreignKeys: [],
            },
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
      firstPage: [[1]],
      totalPages: 1,
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
      expect(useQueryStore.getState().tabs[TAB_ID]?.results.every((result) => result.isExpired)).toBe(
        true
      )
    })
  })
})
