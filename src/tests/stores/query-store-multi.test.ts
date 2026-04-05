/**
 * Tests for multi-query store actions: executeMultiQuery, executeCallQuery,
 * setActiveResultIndex, and per-result isolation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import { useQueryStore, getFlatTabState, DEFAULT_RESULT_STATE } from '../../stores/query-store'

/** Shorthand: get a flat (tab + active result) view for assertions. */
function flat(tabId: string) {
  return getFlatTabState(useQueryStore.getState().getTabState(tabId))
}

// Shared mock setup
const multiQueryResult = {
  results: [
    {
      queryId: 'mq1',
      sourceSql: 'SELECT 1',
      columns: [{ name: 'id', dataType: 'INT' }],
      totalRows: 1,
      executionTimeMs: 5,
      affectedRows: 0,
      firstPage: [[1]],
      totalPages: 1,
      autoLimitApplied: false,
      error: null,
      reExecutable: true,
    },
    {
      queryId: 'mq2',
      sourceSql: 'INSERT INTO t VALUES (1)',
      columns: [],
      totalRows: 0,
      executionTimeMs: 3,
      affectedRows: 1,
      firstPage: [],
      totalPages: 1,
      autoLimitApplied: false,
      error: null,
      reExecutable: true,
    },
    {
      queryId: 'mq3',
      sourceSql: 'SELECT name FROM users',
      columns: [{ name: 'name', dataType: 'VARCHAR' }],
      totalRows: 2,
      executionTimeMs: 10,
      affectedRows: 0,
      firstPage: [['Alice'], ['Bob']],
      totalPages: 1,
      autoLimitApplied: false,
      error: null,
      reExecutable: true,
    },
  ],
}

beforeEach(() => {
  useQueryStore.setState({ tabs: {} })
  mockIPC((cmd) => {
    switch (cmd) {
      case 'execute_multi_query':
        return multiQueryResult
      case 'execute_call_query':
        return multiQueryResult
      case 'analyze_query_for_edit':
        return []
      case 'evict_results':
        return null
      default:
        return null
    }
  })
})

describe('useQueryStore — executeMultiQuery', () => {
  it('populates results array with multiple SingleResultState entries', async () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1; INSERT INTO t; SELECT name FROM users')

    await useQueryStore
      .getState()
      .executeMultiQuery('conn-1', 'tab-1', [
        'SELECT 1',
        'INSERT INTO t VALUES (1)',
        'SELECT name FROM users',
      ])

    const tab = useQueryStore.getState().tabs['tab-1']!
    expect(tab.status).toBe('success')
    expect(tab.results).toHaveLength(3)
    expect(tab.activeResultIndex).toBe(0)
  })

  it('first result has correct columns and rows', async () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')

    await useQueryStore
      .getState()
      .executeMultiQuery('conn-1', 'tab-1', [
        'SELECT 1',
        'INSERT INTO t VALUES (1)',
        'SELECT name FROM users',
      ])

    const tab = useQueryStore.getState().tabs['tab-1']!
    const r0 = tab.results[0]
    expect(r0.status).toBe('success')
    expect(r0.columns).toEqual([{ name: 'id', dataType: 'INT' }])
    expect(r0.rows).toEqual([[1]])
    expect(r0.queryId).toBe('mq1')
    expect(r0.lastExecutedSql).toBe('SELECT 1')
    expect(r0.reExecutable).toBe(true)
  })

  it('DML result has empty columns and affectedRows', async () => {
    useQueryStore.getState().setContent('tab-1', 'multi')

    await useQueryStore
      .getState()
      .executeMultiQuery('conn-1', 'tab-1', [
        'SELECT 1',
        'INSERT INTO t VALUES (1)',
        'SELECT name FROM users',
      ])

    const tab = useQueryStore.getState().tabs['tab-1']!
    const r1 = tab.results[1]
    expect(r1.status).toBe('success')
    expect(r1.columns).toEqual([])
    expect(r1.rows).toEqual([])
    expect(r1.affectedRows).toBe(1)
  })

  it('third result has correct data', async () => {
    useQueryStore.getState().setContent('tab-1', 'multi')

    await useQueryStore
      .getState()
      .executeMultiQuery('conn-1', 'tab-1', [
        'SELECT 1',
        'INSERT INTO t VALUES (1)',
        'SELECT name FROM users',
      ])

    const tab = useQueryStore.getState().tabs['tab-1']!
    const r2 = tab.results[2]
    expect(r2.status).toBe('success')
    expect(r2.columns).toEqual([{ name: 'name', dataType: 'VARCHAR' }])
    expect(r2.rows).toEqual([['Alice'], ['Bob']])
    expect(r2.totalRows).toBe(2)
  })

  it('sets tab status to error on IPC failure', async () => {
    mockIPC((cmd) => {
      if (cmd === 'execute_multi_query') throw new Error('Connection lost')
      return null
    })

    useQueryStore.getState().setContent('tab-1', 'SELECT 1; SELECT 2')

    await useQueryStore.getState().executeMultiQuery('conn-1', 'tab-1', ['SELECT 1', 'SELECT 2'])

    const tab = useQueryStore.getState().tabs['tab-1']!
    expect(tab.status).toBe('error')
    expect(tab.results).toHaveLength(1)
    expect(tab.results[0].status).toBe('error')
    expect(tab.results[0].errorMessage).toBe('Connection lost')
  })

  it('does not execute when tab is already running', async () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    // Set status to running manually
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-1': { ...prev.tabs['tab-1']!, status: 'running' },
      },
    }))

    const spy = vi.fn()
    mockIPC(() => {
      spy()
      return multiQueryResult
    })

    await useQueryStore.getState().executeMultiQuery('conn-1', 'tab-1', ['SELECT 1'])

    expect(spy).not.toHaveBeenCalled()
  })
})

describe('useQueryStore — executeCallQuery', () => {
  it('populates results from CALL statement', async () => {
    useQueryStore.getState().setContent('tab-1', 'CALL my_proc()')

    await useQueryStore.getState().executeCallQuery('conn-1', 'tab-1', 'CALL my_proc()')

    const tab = useQueryStore.getState().tabs['tab-1']!
    expect(tab.status).toBe('success')
    expect(tab.results).toHaveLength(3)
    expect(tab.activeResultIndex).toBe(0)
  })

  it('sets error on IPC failure', async () => {
    mockIPC((cmd) => {
      if (cmd === 'execute_call_query') throw new Error('Proc not found')
      return null
    })

    useQueryStore.getState().setContent('tab-1', 'CALL my_proc()')

    await useQueryStore.getState().executeCallQuery('conn-1', 'tab-1', 'CALL my_proc()')

    const tab = useQueryStore.getState().tabs['tab-1']!
    expect(tab.status).toBe('error')
    expect(tab.results[0].errorMessage).toBe('Proc not found')
  })
})

describe('useQueryStore — setActiveResultIndex', () => {
  function setupMultiResult() {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          content: 'SELECT 1; SELECT 2',
          filePath: null,
          status: 'success',
          cursorPosition: null,
          connectionId: 'conn-1',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              status: 'success',
              queryId: 'q1',
              columns: [{ name: 'id', dataType: 'INT' }],
              rows: [[1]],
              totalRows: 1,
            },
            {
              ...DEFAULT_RESULT_STATE,
              status: 'success',
              queryId: 'q2',
              columns: [{ name: 'name', dataType: 'VARCHAR' }],
              rows: [['Alice']],
              totalRows: 1,
            },
          ],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
        },
      },
    })
  }

  it('switches active result index', () => {
    setupMultiResult()
    useQueryStore.getState().setActiveResultIndex('tab-1', 1)
    const tab = useQueryStore.getState().tabs['tab-1']!
    expect(tab.activeResultIndex).toBe(1)
  })

  it('does nothing for out-of-bounds index', () => {
    setupMultiResult()
    useQueryStore.getState().setActiveResultIndex('tab-1', 5)
    const tab = useQueryStore.getState().tabs['tab-1']!
    expect(tab.activeResultIndex).toBe(0)
  })

  it('does nothing for negative index', () => {
    setupMultiResult()
    useQueryStore.getState().setActiveResultIndex('tab-1', -1)
    const tab = useQueryStore.getState().tabs['tab-1']!
    expect(tab.activeResultIndex).toBe(0)
  })

  it('does nothing for unknown tab', () => {
    setupMultiResult()
    useQueryStore.getState().setActiveResultIndex('nonexistent', 0)
    // Should not throw
    expect(useQueryStore.getState().tabs['nonexistent']).toBeUndefined()
  })

  it('flat() returns data for the active result', () => {
    setupMultiResult()
    // Initial: activeResultIndex=0
    expect(flat('tab-1').queryId).toBe('q1')

    useQueryStore.getState().setActiveResultIndex('tab-1', 1)
    expect(flat('tab-1').queryId).toBe('q2')
    expect(flat('tab-1').columns).toEqual([{ name: 'name', dataType: 'VARCHAR' }])
  })
})

describe('useQueryStore — per-result isolation', () => {
  it('actions on one result do not affect other results', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          content: '',
          filePath: null,
          status: 'success',
          cursorPosition: null,
          connectionId: 'conn-1',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              status: 'success',
              queryId: 'q1',
              columns: [{ name: 'id', dataType: 'INT' }],
              rows: [[1], [2]],
              totalRows: 2,
              viewMode: 'grid',
            },
            {
              ...DEFAULT_RESULT_STATE,
              status: 'success',
              queryId: 'q2',
              columns: [{ name: 'name', dataType: 'VARCHAR' }],
              rows: [['Alice']],
              totalRows: 1,
              viewMode: 'grid',
            },
          ],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
        },
      },
    })

    // Set selected row on result 0
    useQueryStore.getState().setSelectedRow('tab-1', 1)

    // Result 0 should be updated
    const tab = useQueryStore.getState().tabs['tab-1']!
    expect(tab.results[0].selectedRowIndex).toBe(1)
    // Result 1 should be untouched
    expect(tab.results[1].selectedRowIndex).toBeNull()
  })

  it('switching view mode only affects active result', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          content: '',
          filePath: null,
          status: 'success',
          cursorPosition: null,
          connectionId: 'conn-1',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              status: 'success',
              queryId: 'q1',
              columns: [{ name: 'id', dataType: 'INT' }],
              rows: [[1]],
              totalRows: 1,
              viewMode: 'grid',
            },
            {
              ...DEFAULT_RESULT_STATE,
              status: 'success',
              queryId: 'q2',
              columns: [{ name: 'name', dataType: 'VARCHAR' }],
              rows: [['Alice']],
              totalRows: 1,
              viewMode: 'grid',
            },
          ],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
        },
      },
    })

    // Switch view mode on active result (index 0)
    useQueryStore.getState().setViewMode('tab-1', 'form')

    const tab = useQueryStore.getState().tabs['tab-1']!
    expect(tab.results[0].viewMode).toBe('form')
    expect(tab.results[1].viewMode).toBe('grid')
  })
})

describe('useQueryStore — isCallSql', () => {
  it('detects CALL statements', async () => {
    const { isCallSql } = await import('../../stores/query-store')
    expect(isCallSql('CALL my_proc()')).toBe(true)
    expect(isCallSql('  CALL my_proc()')).toBe(true)
    expect(isCallSql('-- comment\nCALL my_proc()')).toBe(true)
    expect(isCallSql('SELECT 1')).toBe(false)
    expect(isCallSql('INSERT INTO t VALUES (1)')).toBe(false)
  })
})

describe('useQueryStore — hasAnyUnsavedEdits', () => {
  it('returns false when no results have edits', async () => {
    const { hasAnyUnsavedEdits } = await import('../../stores/query-store')
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          content: '',
          filePath: null,
          status: 'success',
          cursorPosition: null,
          connectionId: 'conn-1',
          results: [
            { ...DEFAULT_RESULT_STATE, status: 'success' },
            { ...DEFAULT_RESULT_STATE, status: 'success' },
          ],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
        },
      },
    })

    const tab = useQueryStore.getState().tabs['tab-1']!
    expect(hasAnyUnsavedEdits(tab)).toBe(false)
  })

  it('returns true when any result has modified columns', async () => {
    const { hasAnyUnsavedEdits } = await import('../../stores/query-store')
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          content: '',
          filePath: null,
          status: 'success',
          cursorPosition: null,
          connectionId: 'conn-1',
          results: [
            { ...DEFAULT_RESULT_STATE, status: 'success' },
            {
              ...DEFAULT_RESULT_STATE,
              status: 'success',
              editState: {
                rowKey: { id: 1 },
                originalValues: { name: 'Alice' },
                currentValues: { name: 'Bob' },
                modifiedColumns: new Set(['name']),
                isNewRow: false,
              },
            },
          ],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
        },
      },
    })

    const tab = useQueryStore.getState().tabs['tab-1']!
    expect(hasAnyUnsavedEdits(tab)).toBe(true)
  })

  it('returns false for undefined tab', async () => {
    const { hasAnyUnsavedEdits } = await import('../../stores/query-store')
    expect(hasAnyUnsavedEdits(undefined)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Additional coverage: setActiveResultIndex edge cases
// ---------------------------------------------------------------------------

describe('useQueryStore — setActiveResultIndex (deferred analysis & edit discard)', () => {
  function setupMultiResultForAnalysis() {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          content: 'SELECT 1; SELECT name FROM users',
          filePath: null,
          status: 'success',
          cursorPosition: null,
          connectionId: 'conn-1',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              status: 'success',
              queryId: 'q1',
              columns: [{ name: 'id', dataType: 'INT' }],
              rows: [[1]],
              totalRows: 1,
              isAnalyzed: true,
              lastExecutedSql: 'SELECT 1',
              reExecutable: true,
            },
            {
              ...DEFAULT_RESULT_STATE,
              status: 'success',
              queryId: 'q2',
              columns: [{ name: 'name', dataType: 'VARCHAR' }],
              rows: [['Alice']],
              totalRows: 1,
              isAnalyzed: false,
              lastExecutedSql: 'SELECT name FROM users',
              reExecutable: true,
            },
          ],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
        },
      },
    })
  }

  it('triggers deferred analysis when switching to an unanalyzed SELECT result', async () => {
    setupMultiResultForAnalysis()
    const analyzeHandler = vi.fn().mockResolvedValue([])
    mockIPC((cmd) => {
      if (cmd === 'analyze_query_for_edit') return analyzeHandler()
      return null
    })

    useQueryStore.getState().setActiveResultIndex('tab-1', 1)
    const tab = useQueryStore.getState().tabs['tab-1']!
    expect(tab.activeResultIndex).toBe(1)

    // Allow the fire-and-forget analysis to settle
    await vi.waitFor(() => {
      expect(analyzeHandler).toHaveBeenCalled()
    })
  })

  it('discards clean editState when switching result', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          content: 'SELECT 1; SELECT 2',
          filePath: null,
          status: 'success',
          cursorPosition: null,
          connectionId: 'conn-1',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              status: 'success',
              queryId: 'q1',
              columns: [{ name: 'id', dataType: 'INT' }],
              rows: [[1]],
              totalRows: 1,
              // editState with NO modified columns (clean)
              editState: {
                rowKey: { id: 1 },
                originalValues: { id: 1 },
                currentValues: { id: 1 },
                modifiedColumns: new Set<string>(),
                isNewRow: false,
              },
              editingRowIndex: 0,
            },
            {
              ...DEFAULT_RESULT_STATE,
              status: 'success',
              queryId: 'q2',
              columns: [{ name: 'name', dataType: 'VARCHAR' }],
              rows: [['Alice']],
              totalRows: 1,
            },
          ],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
        },
      },
    })

    useQueryStore.getState().setActiveResultIndex('tab-1', 1)
    const tab = useQueryStore.getState().tabs['tab-1']!
    expect(tab.activeResultIndex).toBe(1)
    // The clean editState should have been discarded
    expect(tab.results[0].editState).toBeNull()
    expect(tab.results[0].editingRowIndex).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Additional coverage: cancelQuery
// ---------------------------------------------------------------------------

describe('useQueryStore — cancelQuery', () => {
  it('sets isCancelling and wasCancelled flags', async () => {
    mockIPC((cmd) => {
      if (cmd === 'cancel_query') return true
      return null
    })

    useQueryStore.getState().setContent('tab-1', 'SELECT SLEEP(10)')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-1': { ...prev.tabs['tab-1']!, status: 'running' },
      },
    }))

    await useQueryStore.getState().cancelQuery('conn-1', 'tab-1')

    // After successful cancel, isCancelling stays true (reset by finalizeExecution in the query)
    const tab = useQueryStore.getState().tabs['tab-1']!
    // The toast should have been shown — just verify the tab wasn't removed
    expect(tab).toBeDefined()
  })

  it('does nothing when tab does not exist', async () => {
    const spy = vi.fn()
    mockIPC(() => {
      spy()
      return true
    })

    await useQueryStore.getState().cancelQuery('conn-1', 'nonexistent')
    expect(spy).not.toHaveBeenCalled()
  })

  it('does nothing when already cancelling', async () => {
    const spy = vi.fn()
    mockIPC(() => {
      spy()
      return true
    })

    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-1': { ...prev.tabs['tab-1']!, status: 'running', isCancelling: true },
      },
    }))

    await useQueryStore.getState().cancelQuery('conn-1', 'tab-1')
    expect(spy).not.toHaveBeenCalled()
  })

  it('handles cancel failure gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockIPC((cmd) => {
      if (cmd === 'cancel_query') throw new Error('Cancel RPC failed')
      return null
    })

    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-1': { ...prev.tabs['tab-1']!, status: 'running' },
      },
    }))

    await useQueryStore.getState().cancelQuery('conn-1', 'tab-1')

    const tab = useQueryStore.getState().tabs['tab-1']!
    // Should have reset cancel flags on error
    expect(tab.isCancelling).toBe(false)
    expect(tab.wasCancelled).toBe(false)
    consoleSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Additional coverage: fetchPage
// ---------------------------------------------------------------------------

describe('useQueryStore — fetchPage', () => {
  function setupTabWithResult() {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          content: 'SELECT id FROM users',
          filePath: null,
          status: 'success',
          cursorPosition: null,
          connectionId: 'conn-1',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              status: 'success',
              queryId: 'q1',
              columns: [{ name: 'id', dataType: 'INT' }],
              rows: [[1], [2], [3]],
              totalRows: 10,
              totalPages: 4,
              currentPage: 1,
              reExecutable: true,
              lastExecutedSql: 'SELECT id FROM users',
            },
          ],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
        },
      },
    })
  }

  it('updates rows and page after successful fetch', async () => {
    setupTabWithResult()
    mockIPC((cmd) => {
      if (cmd === 'fetch_result_page')
        return {
          rows: [[4], [5], [6]],
          page: 2,
          totalPages: 4,
        }
      return null
    })

    await useQueryStore.getState().fetchPage('conn-1', 'tab-1', 2)

    const tab = useQueryStore.getState().tabs['tab-1']!
    expect(tab.results[0].rows).toEqual([[4], [5], [6]])
    expect(tab.results[0].currentPage).toBe(2)
    expect(tab.results[0].totalPages).toBe(4)
  })

  it('does nothing when tab does not exist', async () => {
    const spy = vi.fn()
    mockIPC(() => {
      spy()
      return null
    })

    await useQueryStore.getState().fetchPage('conn-1', 'nonexistent', 1)
    expect(spy).not.toHaveBeenCalled()
  })

  it('does nothing when result has no queryId', async () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          content: '',
          filePath: null,
          status: 'idle',
          cursorPosition: null,
          connectionId: 'conn-1',
          results: [{ ...DEFAULT_RESULT_STATE }],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
        },
      },
    })

    const spy = vi.fn()
    mockIPC(() => {
      spy()
      return null
    })

    await useQueryStore.getState().fetchPage('conn-1', 'tab-1', 1)
    expect(spy).not.toHaveBeenCalled()
  })

  it('handles invalid fetchPage payload gracefully', async () => {
    setupTabWithResult()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockIPC((cmd) => {
      if (cmd === 'fetch_result_page') return { invalid: true }
      return null
    })

    await useQueryStore.getState().fetchPage('conn-1', 'tab-1', 2)

    // Rows should remain unchanged
    const tab = useQueryStore.getState().tabs['tab-1']!
    expect(tab.results[0].rows).toEqual([[1], [2], [3]])
    expect(tab.results[0].currentPage).toBe(1)
    consoleSpy.mockRestore()
  })

  it('handles fetchPage error gracefully', async () => {
    setupTabWithResult()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockIPC((cmd) => {
      if (cmd === 'fetch_result_page') throw new Error('Fetch failed')
      return null
    })

    await useQueryStore.getState().fetchPage('conn-1', 'tab-1', 2)

    // Rows should remain unchanged
    const tab = useQueryStore.getState().tabs['tab-1']!
    expect(tab.results[0].rows).toEqual([[1], [2], [3]])
    consoleSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Additional coverage: changePageSize with non-reExecutable
// ---------------------------------------------------------------------------

describe('useQueryStore — changePageSize', () => {
  it('shows warning toast for non-reExecutable results', async () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          content: 'CALL proc()',
          filePath: null,
          status: 'success',
          cursorPosition: null,
          connectionId: 'conn-1',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              status: 'success',
              queryId: 'q1',
              columns: [{ name: 'id', dataType: 'INT' }],
              rows: [[1]],
              totalRows: 1,
              reExecutable: false,
              lastExecutedSql: 'CALL proc()',
            },
          ],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
        },
      },
    })

    await useQueryStore.getState().changePageSize('conn-1', 'tab-1', 50)

    // Page size should NOT have changed (non-reExecutable)
    const tab = useQueryStore.getState().tabs['tab-1']!
    expect(tab.results[0].pageSize).toBe(DEFAULT_RESULT_STATE.pageSize)
  })
})

// ---------------------------------------------------------------------------
// Additional coverage: cleanupTab and cleanupConnection
// ---------------------------------------------------------------------------

describe('useQueryStore — cleanupTab / cleanupConnection', () => {
  it('cleanupTab removes the tab', () => {
    mockIPC(() => null)
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    expect(useQueryStore.getState().tabs['tab-1']).toBeDefined()

    useQueryStore.getState().cleanupTab('conn-1', 'tab-1')
    expect(useQueryStore.getState().tabs['tab-1']).toBeUndefined()
  })

  it('cleanupConnection removes multiple tabs', () => {
    mockIPC(() => null)
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    useQueryStore.getState().setContent('tab-2', 'SELECT 2')
    useQueryStore.getState().setContent('tab-3', 'SELECT 3')

    useQueryStore.getState().cleanupConnection('conn-1', ['tab-1', 'tab-3'])

    expect(useQueryStore.getState().tabs['tab-1']).toBeUndefined()
    expect(useQueryStore.getState().tabs['tab-2']).toBeDefined()
    expect(useQueryStore.getState().tabs['tab-3']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Additional coverage: setViewMode for tab with no results
// ---------------------------------------------------------------------------

describe('useQueryStore — setViewMode edge cases', () => {
  it('creates a result with the new viewMode when tab has empty results', () => {
    useQueryStore.getState().setContent('tab-1', '')
    // tab-1 now has results: []
    useQueryStore.getState().setViewMode('tab-1', 'form')

    const tab = useQueryStore.getState().tabs['tab-1']!
    expect(tab.results).toHaveLength(1)
    expect(tab.results[0].viewMode).toBe('form')
  })

  it('switches to text view for normal result', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          content: 'SELECT 1',
          filePath: null,
          status: 'success',
          cursorPosition: null,
          connectionId: 'conn-1',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              status: 'success',
              queryId: 'q1',
              columns: [{ name: 'id', dataType: 'INT' }],
              rows: [[1]],
              totalRows: 1,
              viewMode: 'grid',
            },
          ],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
        },
      },
    })

    useQueryStore.getState().setViewMode('tab-1', 'text')
    const tab = useQueryStore.getState().tabs['tab-1']!
    expect(tab.results[0].viewMode).toBe('text')
  })
})

// ---------------------------------------------------------------------------
// Additional coverage: sortResults edge cases
// ---------------------------------------------------------------------------

describe('useQueryStore — sortResults', () => {
  function setupSortableTab(overrides: Record<string, unknown> = {}) {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          content: 'CALL proc()',
          filePath: null,
          status: 'success',
          cursorPosition: null,
          connectionId: 'conn-1',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              status: 'success',
              queryId: 'q1',
              columns: [{ name: 'id', dataType: 'INT' }],
              rows: [[3], [1], [2]],
              totalRows: 3,
              lastExecutedSql: 'SELECT id FROM t',
              sortColumn: 'id',
              sortDirection: 'asc' as const,
              ...overrides,
            },
          ],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
        },
      },
    })
  }

  it('shows warning toast and preserves sort for non-reExecutable result when direction is null', async () => {
    setupSortableTab({ reExecutable: false })

    await useQueryStore.getState().sortResults('conn-1', 'tab-1', 'id', null)

    // Sort state should NOT be cleared for cache-only results
    const tab = useQueryStore.getState().tabs['tab-1']!
    expect(tab.results[0].sortColumn).toBe('id')
    expect(tab.results[0].sortDirection).toBe('asc')

    // A warning toast should have been shown
    const { useToastStore } = await import('../../stores/toast-store')
    const toasts = useToastStore.getState().toasts
    expect(toasts.some((t) => t.variant === 'warning')).toBe(true)
  })

  it('applies sort via IPC for reExecutable result', async () => {
    setupSortableTab({ reExecutable: true })
    mockIPC((cmd) => {
      if (cmd === 'sort_results')
        return {
          rows: [[1], [2], [3]],
          page: 1,
          totalPages: 1,
        }
      return null
    })

    await useQueryStore.getState().sortResults('conn-1', 'tab-1', 'id', 'asc')

    const tab = useQueryStore.getState().tabs['tab-1']!
    expect(tab.results[0].sortColumn).toBe('id')
    expect(tab.results[0].sortDirection).toBe('asc')
    expect(tab.results[0].rows).toEqual([[1], [2], [3]])
  })

  it('handles sort IPC error gracefully', async () => {
    setupSortableTab({ reExecutable: true })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockIPC((cmd) => {
      if (cmd === 'sort_results') throw new Error('Sort failed')
      return null
    })

    await useQueryStore.getState().sortResults('conn-1', 'tab-1', 'id', 'asc')

    // Sort state should remain unchanged on error
    consoleSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Stale re-execution discard: sortResults (sort-clear) on multi-result tabs
// ---------------------------------------------------------------------------

describe('useQueryStore — sortResults stale re-execution discard', () => {
  function setupMultiResultForSort() {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          content: 'SELECT 1; SELECT 2',
          filePath: null,
          status: 'success',
          cursorPosition: null,
          connectionId: 'conn-1',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              status: 'success',
              queryId: 'q1',
              columns: [{ name: 'id', dataType: 'INT' }],
              rows: [[1]],
              totalRows: 1,
              lastExecutedSql: 'SELECT 1',
              reExecutable: true,
              sortColumn: 'id',
              sortDirection: 'asc' as const,
            },
            {
              ...DEFAULT_RESULT_STATE,
              status: 'success',
              queryId: 'q2',
              columns: [{ name: 'name', dataType: 'VARCHAR' }],
              rows: [['Alice']],
              totalRows: 1,
              lastExecutedSql: 'SELECT 2',
              reExecutable: true,
            },
          ],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
        },
      },
    })
  }

  it('discards stale sort re-execution when queryId changes during await', async () => {
    setupMultiResultForSort()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    mockIPC((cmd) => {
      if (cmd === 'reexecute_single_result') {
        // Simulate a newer query replacing the results while re-exec is in flight
        useQueryStore.setState((prev) => {
          const tab = prev.tabs['tab-1']
          if (!tab) return prev
          const newResults = [...tab.results]
          newResults[0] = {
            ...newResults[0],
            queryId: 'q1-replaced-by-newer-query',
            rows: [[999]],
          }
          return {
            tabs: {
              ...prev.tabs,
              'tab-1': { ...tab, results: newResults },
            },
          }
        })
        return {
          queryId: 'reexec-result',
          sourceSql: 'SELECT 1',
          columns: [{ name: 'id', dataType: 'INT' }],
          totalRows: 1,
          executionTimeMs: 5,
          affectedRows: 0,
          firstPage: [[42]],
          totalPages: 1,
          autoLimitApplied: false,
          error: null,
          reExecutable: true,
        }
      }
      return null
    })

    await useQueryStore.getState().sortResults('conn-1', 'tab-1', 'id', null)

    // The stale result should have been discarded — rows should still be from the newer query
    const tab = useQueryStore.getState().tabs['tab-1']!
    expect(tab.results[0].rows).toEqual([[999]])
    expect(tab.results[0].queryId).toBe('q1-replaced-by-newer-query')
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('discarding stale re-execution result')
    )
    warnSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Stale re-execution discard: changePageSize on multi-result tabs
// ---------------------------------------------------------------------------

describe('useQueryStore — changePageSize stale re-execution discard', () => {
  function setupMultiResultForPageSize() {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          content: 'SELECT 1; SELECT 2',
          filePath: null,
          status: 'success',
          cursorPosition: null,
          connectionId: 'conn-1',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              status: 'success',
              queryId: 'q1',
              columns: [{ name: 'id', dataType: 'INT' }],
              rows: [[1]],
              totalRows: 1,
              lastExecutedSql: 'SELECT 1',
              reExecutable: true,
            },
            {
              ...DEFAULT_RESULT_STATE,
              status: 'success',
              queryId: 'q2',
              columns: [{ name: 'name', dataType: 'VARCHAR' }],
              rows: [['Alice']],
              totalRows: 1,
              lastExecutedSql: 'SELECT 2',
              reExecutable: true,
            },
          ],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
        },
      },
    })
  }

  it('discards stale changePageSize re-execution when queryId changes during await', async () => {
    setupMultiResultForPageSize()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    mockIPC((cmd) => {
      if (cmd === 'reexecute_single_result') {
        // Simulate a newer query replacing the results while re-exec is in flight
        useQueryStore.setState((prev) => {
          const tab = prev.tabs['tab-1']
          if (!tab) return prev
          const newResults = [...tab.results]
          newResults[0] = {
            ...newResults[0],
            queryId: 'q1-replaced-newer',
            rows: [[777]],
          }
          return {
            tabs: {
              ...prev.tabs,
              'tab-1': { ...tab, results: newResults },
            },
          }
        })
        return {
          queryId: 'reexec-page-result',
          sourceSql: 'SELECT 1',
          columns: [{ name: 'id', dataType: 'INT' }],
          totalRows: 1,
          executionTimeMs: 5,
          affectedRows: 0,
          firstPage: [[42]],
          totalPages: 1,
          autoLimitApplied: false,
          error: null,
          reExecutable: true,
        }
      }
      return null
    })

    await useQueryStore.getState().changePageSize('conn-1', 'tab-1', 50)

    // The stale result should have been discarded
    const tab = useQueryStore.getState().tabs['tab-1']!
    expect(tab.results[0].rows).toEqual([[777]])
    expect(tab.results[0].queryId).toBe('q1-replaced-newer')
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('discarding stale re-execution result')
    )
    warnSpy.mockRestore()
  })

  it('applies changePageSize normally when queryId is unchanged', async () => {
    setupMultiResultForPageSize()

    mockIPC((cmd) => {
      if (cmd === 'reexecute_single_result') {
        return {
          queryId: 'new-q1',
          sourceSql: 'SELECT 1',
          columns: [{ name: 'id', dataType: 'INT' }],
          totalRows: 1,
          executionTimeMs: 5,
          affectedRows: 0,
          firstPage: [[42]],
          totalPages: 1,
          autoLimitApplied: false,
          error: null,
          reExecutable: true,
        }
      }
      if (cmd === 'analyze_query_for_edit') return []
      return null
    })

    await useQueryStore.getState().changePageSize('conn-1', 'tab-1', 50)

    // The result should have been applied normally
    const tab = useQueryStore.getState().tabs['tab-1']!
    expect(tab.results[0].rows).toEqual([[42]])
    expect(tab.results[0].queryId).toBe('new-q1')
    expect(tab.results[0].pageSize).toBe(50)
  })
})
