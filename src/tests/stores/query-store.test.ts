import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import { useQueryStore } from '../../stores/query-store'

beforeEach(() => {
  useQueryStore.setState({ tabs: {} })

  mockIPC((cmd) => {
    switch (cmd) {
      case 'execute_query':
        return {
          queryId: 'q-mock',
          columns: [{ name: 'id', dataType: 'INT' }],
          totalRows: 3,
          executionTimeMs: 10,
          affectedRows: 0,
          firstPage: [[1], [2], [3]],
          totalPages: 1,
          autoLimitApplied: false,
        }
      case 'fetch_result_page':
        return { rows: [[4], [5]], page: 2, totalPages: 2 }
      case 'evict_results':
        return null
      default:
        return null
    }
  })
})

const BOOLEAN_ALIAS_COLUMNS = [
  { name: 'is_active', dataType: 'BOOLEAN' },
  { name: 'is_archived', dataType: 'BOOL' },
  { name: 'label', dataType: 'VARCHAR' },
]

describe('useQueryStore — getTabState', () => {
  it('returns default state for unknown tab', () => {
    const state = useQueryStore.getState().getTabState('unknown')
    expect(state.status).toBe('idle')
    expect(state.content).toBe('')
    expect(state.columns).toHaveLength(0)
  })

  it('returns default new fields for unknown tab', () => {
    const state = useQueryStore.getState().getTabState('unknown')
    expect(state.viewMode).toBe('grid')
    expect(state.sortColumn).toBeNull()
    expect(state.sortDirection).toBeNull()
    expect(state.selectedRowIndex).toBeNull()
    expect(state.exportDialogOpen).toBe(false)
    expect(state.lastExecutedSql).toBeNull()
  })
})

describe('useQueryStore — setContent', () => {
  it('updates content for tab', () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    const state = useQueryStore.getState().getTabState('tab-1')
    expect(state.content).toBe('SELECT 1')
  })
})

describe('useQueryStore — setFilePath', () => {
  it('updates filePath for tab', () => {
    useQueryStore.getState().setFilePath('tab-1', '/path/to/file.sql')
    const state = useQueryStore.getState().getTabState('tab-1')
    expect(state.filePath).toBe('/path/to/file.sql')
  })
})

describe('useQueryStore — executeQuery', () => {
  it('sets running status then success', async () => {
    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT 1')
    const state = useQueryStore.getState().getTabState('tab-1')
    expect(state.status).toBe('success')
    expect(state.queryId).toBe('q-mock')
    expect(state.totalRows).toBe(3)
    expect(state.columns).toHaveLength(1)
    expect(state.rows).toEqual([[1], [2], [3]])
  })

  it('sets error status on failure', async () => {
    mockIPC(() => {
      throw new Error('Query failed: table not found')
    })
    await useQueryStore.getState().executeQuery('conn-1', 'tab-error', 'SELECT * FROM bad_table')
    const state = useQueryStore.getState().getTabState('tab-error')
    expect(state.status).toBe('error')
    expect(state.errorMessage).toContain('table not found')
  })

  it('saves lastExecutedSql on success', async () => {
    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT * FROM users')
    const state = useQueryStore.getState().getTabState('tab-1')
    expect(state.lastExecutedSql).toBe('SELECT * FROM users')
  })

  it('uses stored pageSize for the IPC call', async () => {
    // Set a custom page size before executing
    useQueryStore.getState().setContent('tab-ps', 'SELECT 1')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-ps': {
          ...prev.tabs['tab-ps']!,
          pageSize: 500,
        },
      },
    }))

    await useQueryStore.getState().executeQuery('conn-1', 'tab-ps', 'SELECT 1')
    const state = useQueryStore.getState().getTabState('tab-ps')
    expect(state.status).toBe('success')
    // The query still succeeds (the mock doesn't validate pageSize,
    // but the code path passes it)
    expect(state.rows).toEqual([[1], [2], [3]])
  })

  it('resets sortColumn, sortDirection, and selectedRowIndex on new query', async () => {
    // Set up tab with existing sort/selection state
    useQueryStore.getState().setContent('tab-reset', 'SELECT 1')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-reset': {
          ...prev.tabs['tab-reset']!,
          sortColumn: 'id',
          sortDirection: 'asc' as const,
          selectedRowIndex: 5,
        },
      },
    }))

    await useQueryStore.getState().executeQuery('conn-1', 'tab-reset', 'SELECT 1')
    const state = useQueryStore.getState().getTabState('tab-reset')
    expect(state.sortColumn).toBeNull()
    expect(state.sortDirection).toBeNull()
    expect(state.selectedRowIndex).toBeNull()
  })

  it('normalizes tinyint boolean aliases to integer rows on executeQuery', async () => {
    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-bool',
          columns: BOOLEAN_ALIAS_COLUMNS,
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstPage: [[true, false, 'flagged']],
          totalPages: 1,
          autoLimitApplied: false,
        }
      }
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-bool', 'SELECT is_active FROM flags')

    expect(useQueryStore.getState().getTabState('tab-bool').rows).toEqual([[1, 0, 'flagged']])
  })

  it('treats missing or non-array analyze_query_for_edit result as no edit tables', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-analyze-null',
          columns: [{ name: 'id', dataType: 'INT' }],
          totalRows: 1,
          executionTimeMs: 1,
          affectedRows: 0,
          firstPage: [[1]],
          totalPages: 1,
          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') {
        return null
      }
      if (cmd === 'evict_results') {
        return null
      }
      return null
    })

    await useQueryStore.getState().executeQuery(
      'conn-1',
      'tab-null-analyze',
      'SELECT id FROM t'
    )

    await vi.waitFor(() => {
      expect(useQueryStore.getState().getTabState('tab-null-analyze').isAnalyzingQuery).toBe(false)
    })

    expect(useQueryStore.getState().getTabState('tab-null-analyze').editTableMetadata).toEqual({})
    const analyzeErrors = errSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('analyze_query_for_edit')
    )
    expect(analyzeErrors).toHaveLength(0)
    errSpy.mockRestore()
  })
})

describe('useQueryStore — fetchPage', () => {
  it('updates rows for new page', async () => {
    // First set up a query result
    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT 1')

    await useQueryStore.getState().fetchPage('conn-1', 'tab-1', 2)
    const state = useQueryStore.getState().getTabState('tab-1')
    expect(state.rows).toEqual([[4], [5]])
    expect(state.currentPage).toBe(2)
  })

  it('does nothing when no queryId', async () => {
    await useQueryStore.getState().fetchPage('conn-1', 'no-query-tab', 1)
    // Should not throw
  })

  it('handles null fetch_result_page without throwing', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockIPC((cmd) => {
      switch (cmd) {
        case 'execute_query':
          return {
            queryId: 'q-null-fetch',
            columns: [{ name: 'id', dataType: 'INT' }],
            totalRows: 1,
            executionTimeMs: 1,
            affectedRows: 0,
            firstPage: [[1]],
            totalPages: 2,
            autoLimitApplied: false,
          }
        case 'fetch_result_page':
          return null
        case 'evict_results':
          return null
        default:
          return null
      }
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-null-fetch', 'SELECT 1')
    await useQueryStore.getState().fetchPage('conn-1', 'tab-null-fetch', 2)

    expect(useQueryStore.getState().getTabState('tab-null-fetch').currentPage).toBe(1)
    expect(consoleSpy).toHaveBeenCalledWith(
      '[query-store] fetchPage failed: invalid fetch_result_page payload (expected rows, page, totalPages)'
    )
    consoleSpy.mockRestore()
  })

  it('normalizes tinyint boolean aliases to integer rows on fetchPage', async () => {
    mockIPC((cmd) => {
      if (cmd === 'fetch_result_page') {
        return { rows: [[false, true, 'page-2']], page: 2, totalPages: 2 }
      }
      if (cmd === 'evict_results') return null
      return null
    })

    useQueryStore.getState().setContent('tab-bool-page', 'SELECT 1')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-bool-page': {
          ...prev.tabs['tab-bool-page']!,
          queryId: 'q-bool-page',
          columns: BOOLEAN_ALIAS_COLUMNS,
        },
      },
    }))

    await useQueryStore.getState().fetchPage('conn-1', 'tab-bool-page', 2)

    const state = useQueryStore.getState().getTabState('tab-bool-page')
    expect(state.rows).toEqual([[0, 1, 'page-2']])
    expect(state.currentPage).toBe(2)
  })
})

describe('useQueryStore — cleanupTab', () => {
  it('removes tab state', () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    useQueryStore.getState().cleanupTab('conn-1', 'tab-1')
    expect(useQueryStore.getState().tabs['tab-1']).toBeUndefined()
  })
})

describe('useQueryStore — cleanupConnection', () => {
  it('removes all specified tab states', () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    useQueryStore.getState().setContent('tab-2', 'SELECT 2')
    useQueryStore.getState().cleanupConnection('conn-1', ['tab-1', 'tab-2'])
    expect(useQueryStore.getState().tabs['tab-1']).toBeUndefined()
    expect(useQueryStore.getState().tabs['tab-2']).toBeUndefined()
  })
})

describe('useQueryStore — setCursorPosition', () => {
  it('sets cursor position for a tab', () => {
    useQueryStore.getState().setCursorPosition('tab-1', { lineNumber: 5, column: 10 })
    const state = useQueryStore.getState().getTabState('tab-1')
    expect(state.cursorPosition).toEqual({ lineNumber: 5, column: 10 })
  })

  it('updates cursor position for an existing tab', () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    useQueryStore.getState().setCursorPosition('tab-1', { lineNumber: 1, column: 1 })
    expect(useQueryStore.getState().tabs['tab-1']?.cursorPosition).toEqual({
      lineNumber: 1,
      column: 1,
    })

    useQueryStore.getState().setCursorPosition('tab-1', { lineNumber: 3, column: 5 })
    expect(useQueryStore.getState().tabs['tab-1']?.cursorPosition).toEqual({
      lineNumber: 3,
      column: 5,
    })
  })
})

describe('useQueryStore — stale query guard', () => {
  it('skips state update if tab was cleaned up during executeQuery', async () => {
    // Use a controlled promise so we can cleanup the tab mid-flight
    let resolveQuery: ((value: unknown) => void) | null = null
    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return new Promise((resolve) => {
          resolveQuery = resolve
        })
      }
      if (cmd === 'evict_results') return null
      return null
    })

    useQueryStore.getState().setContent('tab-stale', 'SELECT 1')
    const promise = useQueryStore.getState().executeQuery('conn-1', 'tab-stale', 'SELECT 1')

    // Tab is in running state
    expect(useQueryStore.getState().tabs['tab-stale']?.status).toBe('running')

    // Simulate tab close
    useQueryStore.getState().cleanupTab('conn-1', 'tab-stale')
    expect(useQueryStore.getState().tabs['tab-stale']).toBeUndefined()

    // Resolve the query
    resolveQuery!({
      queryId: 'q-mock',
      columns: [{ name: 'id', dataType: 'INT' }],
      totalRows: 1,
      executionTimeMs: 10,
      affectedRows: 0,
      firstPage: [[1]],
      totalPages: 1,
      autoLimitApplied: false,
    })
    await promise

    // Tab state should still be undefined (guard prevented the write)
    expect(useQueryStore.getState().tabs['tab-stale']).toBeUndefined()
  })

  it('skips state update on error if tab was cleaned up during executeQuery', async () => {
    let rejectQuery: ((reason: unknown) => void) | null = null
    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return new Promise((_resolve, reject) => {
          rejectQuery = reject
        })
      }
      if (cmd === 'evict_results') return null
      return null
    })

    useQueryStore.getState().setContent('tab-stale2', 'SELECT bad')
    const promise = useQueryStore.getState().executeQuery('conn-1', 'tab-stale2', 'SELECT bad')

    // Simulate tab close
    useQueryStore.getState().cleanupTab('conn-1', 'tab-stale2')

    // Reject the query
    rejectQuery!(new Error('Query failed'))
    await promise

    // Tab state should still be undefined
    expect(useQueryStore.getState().tabs['tab-stale2']).toBeUndefined()
  })
})

// --- New Phase 5.1 action tests ---

describe('useQueryStore — setViewMode', () => {
  it('sets view mode for a tab', () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    useQueryStore.getState().setViewMode('tab-1', 'form')
    expect(useQueryStore.getState().tabs['tab-1']?.viewMode).toBe('form')
  })

  it('sets view mode to text', () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    useQueryStore.getState().setViewMode('tab-1', 'text')
    expect(useQueryStore.getState().tabs['tab-1']?.viewMode).toBe('text')
  })

  it('sets view mode back to grid', () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    useQueryStore.getState().setViewMode('tab-1', 'form')
    useQueryStore.getState().setViewMode('tab-1', 'grid')
    expect(useQueryStore.getState().tabs['tab-1']?.viewMode).toBe('grid')
  })
})

describe('useQueryStore — setSelectedRow', () => {
  it('sets selected row index', () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    useQueryStore.getState().setSelectedRow('tab-1', 5)
    expect(useQueryStore.getState().tabs['tab-1']?.selectedRowIndex).toBe(5)
  })

  it('clears selected row with null', () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    useQueryStore.getState().setSelectedRow('tab-1', 3)
    useQueryStore.getState().setSelectedRow('tab-1', null)
    expect(useQueryStore.getState().tabs['tab-1']?.selectedRowIndex).toBeNull()
  })
})

describe('useQueryStore — export dialog', () => {
  it('opens export dialog', () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    useQueryStore.getState().openExportDialog('tab-1')
    expect(useQueryStore.getState().tabs['tab-1']?.exportDialogOpen).toBe(true)
  })

  it('closes export dialog', () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    useQueryStore.getState().openExportDialog('tab-1')
    useQueryStore.getState().closeExportDialog('tab-1')
    expect(useQueryStore.getState().tabs['tab-1']?.exportDialogOpen).toBe(false)
  })
})

describe('useQueryStore — sortResults', () => {
  it('calls sort_results IPC and updates store state', async () => {
    // Set up mock IPC with sort_results handler
    mockIPC((cmd) => {
      switch (cmd) {
        case 'execute_query':
          return {
            queryId: 'q-mock',
            columns: [{ name: 'id', dataType: 'INT' }],
            totalRows: 3,
            executionTimeMs: 10,
            affectedRows: 0,
            firstPage: [[3], [1], [2]],
            totalPages: 1,
            autoLimitApplied: false,
          }
        case 'sort_results':
          return { rows: [[1], [2], [3]], page: 1, totalPages: 1 }
        case 'evict_results':
          return null
        default:
          return null
      }
    })

    // Execute a query first
    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT id FROM t')

    // Sort ascending
    await useQueryStore.getState().sortResults('conn-1', 'tab-1', 'id', 'asc')
    const state = useQueryStore.getState().getTabState('tab-1')
    expect(state.sortColumn).toBe('id')
    expect(state.sortDirection).toBe('asc')
    expect(state.rows).toEqual([[1], [2], [3]])
    expect(state.currentPage).toBe(1)
  })

  it('clears sort state when direction is null and re-executes query', async () => {
    // Set up mock IPC with execute_query handler (for re-execution)
    mockIPC((cmd) => {
      switch (cmd) {
        case 'execute_query':
          return {
            queryId: 'q-reexec',
            columns: [{ name: 'id', dataType: 'INT' }],
            totalRows: 3,
            executionTimeMs: 8,
            affectedRows: 0,
            firstPage: [[3], [1], [2]],
            totalPages: 1,
            autoLimitApplied: false,
          }
        case 'evict_results':
          return null
        default:
          return null
      }
    })

    // Set up tab with sort state and lastExecutedSql
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-1': {
          ...prev.tabs['tab-1']!,
          sortColumn: 'id',
          sortDirection: 'asc' as const,
          lastExecutedSql: 'SELECT id FROM t',
          queryId: 'q-old',
          status: 'success' as const,
        },
      },
    }))

    await useQueryStore.getState().sortResults('conn-1', 'tab-1', 'id', null)
    const state = useQueryStore.getState().getTabState('tab-1')
    expect(state.sortColumn).toBeNull()
    expect(state.sortDirection).toBeNull()
    // Should have re-executed and gotten fresh data
    expect(state.queryId).toBe('q-reexec')
    expect(state.rows).toEqual([[3], [1], [2]])
  })

  it('normalizes tinyint boolean aliases when clearing sort re-executes the query', async () => {
    mockIPC((cmd) => {
      switch (cmd) {
        case 'execute_query':
          return {
            queryId: 'q-reexec-bool',
            columns: BOOLEAN_ALIAS_COLUMNS,
            totalRows: 1,
            executionTimeMs: 8,
            affectedRows: 0,
            firstPage: [[true, false, 'reexec']],
            totalPages: 1,
            autoLimitApplied: false,
          }
        case 'evict_results':
          return null
        default:
          return null
      }
    })

    useQueryStore.getState().setContent('tab-bool-reexec', 'SELECT 1')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-bool-reexec': {
          ...prev.tabs['tab-bool-reexec']!,
          sortColumn: 'is_active',
          sortDirection: 'asc' as const,
          lastExecutedSql: 'SELECT is_active FROM t',
          queryId: 'q-old',
          status: 'success' as const,
        },
      },
    }))

    await useQueryStore.getState().sortResults('conn-1', 'tab-bool-reexec', 'is_active', null)

    const state = useQueryStore.getState().getTabState('tab-bool-reexec')
    expect(state.sortColumn).toBeNull()
    expect(state.sortDirection).toBeNull()
    expect(state.rows).toEqual([[1, 0, 'reexec']])
  })

  it('clears sort state visually when no lastExecutedSql', async () => {
    // Set up tab with sort state but NO lastExecutedSql
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-1': {
          ...prev.tabs['tab-1']!,
          sortColumn: 'id',
          sortDirection: 'asc' as const,
          lastExecutedSql: null,
        },
      },
    }))

    await useQueryStore.getState().sortResults('conn-1', 'tab-1', 'id', null)
    const state = useQueryStore.getState().getTabState('tab-1')
    expect(state.sortColumn).toBeNull()
    expect(state.sortDirection).toBeNull()
  })

  it('logs error on IPC failure', async () => {
    mockIPC((cmd) => {
      if (cmd === 'sort_results') throw new Error('Sort failed')
      return null
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    await useQueryStore.getState().sortResults('conn-1', 'tab-1', 'id', 'asc')
    expect(consoleSpy).toHaveBeenCalledWith('[query-store] sortResults failed:', expect.any(Error))
    consoleSpy.mockRestore()
  })

  it('handles null sort_results payload without throwing', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockIPC((cmd) => {
      switch (cmd) {
        case 'execute_query':
          return {
            queryId: 'q-sort-null',
            columns: [{ name: 'id', dataType: 'INT' }],
            totalRows: 2,
            executionTimeMs: 1,
            affectedRows: 0,
            firstPage: [[2], [1]],
            totalPages: 1,
            autoLimitApplied: false,
          }
        case 'sort_results':
          return null
        case 'evict_results':
          return null
        default:
          return null
      }
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-sort-null', 'SELECT id FROM t')
    await useQueryStore.getState().sortResults('conn-1', 'tab-sort-null', 'id', 'asc')

    const state = useQueryStore.getState().getTabState('tab-sort-null')
    expect(state.sortColumn).toBeNull()
    expect(state.rows).toEqual([[2], [1]])
    expect(consoleSpy).toHaveBeenCalledWith(
      '[query-store] sortResults failed: invalid sort_results payload (expected rows, page, totalPages)'
    )
    consoleSpy.mockRestore()
  })

  it('skips state update if tab was cleaned up during sort', async () => {
    let resolveSortPromise: ((value: unknown) => void) | null = null
    mockIPC((cmd) => {
      if (cmd === 'sort_results') {
        return new Promise((resolve) => {
          resolveSortPromise = resolve
        })
      }
      if (cmd === 'evict_results') return null
      return null
    })

    useQueryStore.getState().setContent('tab-stale-sort', 'SELECT 1')
    const promise = useQueryStore.getState().sortResults('conn-1', 'tab-stale-sort', 'id', 'asc')

    // Simulate tab close during sort
    useQueryStore.getState().cleanupTab('conn-1', 'tab-stale-sort')
    expect(useQueryStore.getState().tabs['tab-stale-sort']).toBeUndefined()

    // Resolve the sort
    resolveSortPromise!({ rows: [[1]], page: 1, totalPages: 1 })
    await promise

    // Tab should remain undefined
    expect(useQueryStore.getState().tabs['tab-stale-sort']).toBeUndefined()
  })

  it('normalizes tinyint boolean aliases to integer rows on sortResults', async () => {
    mockIPC((cmd) => {
      if (cmd === 'sort_results') {
        return { rows: [[false, true, 'sorted']], page: 1, totalPages: 1 }
      }
      if (cmd === 'evict_results') return null
      return null
    })

    useQueryStore.getState().setContent('tab-bool-sort', 'SELECT 1')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-bool-sort': {
          ...prev.tabs['tab-bool-sort']!,
          columns: BOOLEAN_ALIAS_COLUMNS,
        },
      },
    }))

    await useQueryStore.getState().sortResults('conn-1', 'tab-bool-sort', 'is_active', 'asc')

    const state = useQueryStore.getState().getTabState('tab-bool-sort')
    expect(state.rows).toEqual([[0, 1, 'sorted']])
    expect(state.sortColumn).toBe('is_active')
    expect(state.sortDirection).toBe('asc')
  })
})

describe('useQueryStore — changePageSize', () => {
  it('re-executes query with new page size', async () => {
    const executeFn = vi.fn(() => ({
      queryId: 'q-new',
      columns: [{ name: 'id', dataType: 'INT' }],
      totalRows: 100,
      executionTimeMs: 5,
      affectedRows: 0,
      firstPage: [[1], [2]],
      totalPages: 2,
      autoLimitApplied: false,
    }))

    mockIPC((cmd) => {
      if (cmd === 'execute_query') return executeFn()
      if (cmd === 'evict_results') return null
      return null
    })

    // Set up tab with lastExecutedSql
    useQueryStore.getState().setContent('tab-1', 'SELECT id FROM t')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-1': {
          ...prev.tabs['tab-1']!,
          lastExecutedSql: 'SELECT id FROM t',
          status: 'success' as const,
          queryId: 'q-old',
          selectedRowIndex: 3,
        },
      },
    }))

    await useQueryStore.getState().changePageSize('conn-1', 'tab-1', 500)
    const state = useQueryStore.getState().getTabState('tab-1')
    expect(state.status).toBe('success')
    expect(state.pageSize).toBe(500)
    expect(state.queryId).toBe('q-new')
    expect(state.totalRows).toBe(100)
    expect(state.rows).toEqual([[1], [2]])
    expect(state.currentPage).toBe(1)
    expect(state.sortColumn).toBeNull()
    expect(state.sortDirection).toBeNull()
    expect(state.selectedRowIndex).toBeNull()
  })

  it('normalizes tinyint boolean aliases when changePageSize re-executes the query', async () => {
    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-new-bool',
          columns: BOOLEAN_ALIAS_COLUMNS,
          totalRows: 1,
          executionTimeMs: 5,
          affectedRows: 0,
          firstPage: [[false, true, 'resized']],
          totalPages: 1,
          autoLimitApplied: false,
        }
      }
      if (cmd === 'evict_results') return null
      return null
    })

    useQueryStore.getState().setContent('tab-bool-size', 'SELECT is_active FROM t')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-bool-size': {
          ...prev.tabs['tab-bool-size']!,
          lastExecutedSql: 'SELECT is_active FROM t',
          status: 'success' as const,
          queryId: 'q-old',
        },
      },
    }))

    await useQueryStore.getState().changePageSize('conn-1', 'tab-bool-size', 250)

    const state = useQueryStore.getState().getTabState('tab-bool-size')
    expect(state.rows).toEqual([[0, 1, 'resized']])
    expect(state.pageSize).toBe(250)
  })

  it('does nothing when no lastExecutedSql', async () => {
    useQueryStore.getState().setContent('tab-1', '')
    await useQueryStore.getState().changePageSize('conn-1', 'tab-1', 500)
    // Should not throw; status should remain unchanged
    expect(useQueryStore.getState().getTabState('tab-1').status).toBe('idle')
  })

  it('sets error status on IPC failure', async () => {
    mockIPC((cmd) => {
      if (cmd === 'execute_query') throw new Error('Query failed')
      if (cmd === 'evict_results') return null
      return null
    })

    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-1': {
          ...prev.tabs['tab-1']!,
          lastExecutedSql: 'SELECT 1',
          status: 'success' as const,
        },
      },
    }))

    await useQueryStore.getState().changePageSize('conn-1', 'tab-1', 500)
    const state = useQueryStore.getState().getTabState('tab-1')
    expect(state.status).toBe('error')
    expect(state.errorMessage).toContain('Query failed')
  })

  it('skips state update if tab was cleaned up during changePageSize', async () => {
    let resolveQuery: ((value: unknown) => void) | null = null
    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return new Promise((resolve) => {
          resolveQuery = resolve
        })
      }
      if (cmd === 'evict_results') return null
      return null
    })

    useQueryStore.getState().setContent('tab-stale-ps', 'SELECT id FROM t')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-stale-ps': {
          ...prev.tabs['tab-stale-ps']!,
          lastExecutedSql: 'SELECT id FROM t',
          status: 'success' as const,
        },
      },
    }))

    const promise = useQueryStore.getState().changePageSize('conn-1', 'tab-stale-ps', 500)

    // Simulate tab close mid-flight
    useQueryStore.getState().cleanupTab('conn-1', 'tab-stale-ps')
    expect(useQueryStore.getState().tabs['tab-stale-ps']).toBeUndefined()

    // Resolve the query
    resolveQuery!({
      queryId: 'q-new',
      columns: [{ name: 'id', dataType: 'INT' }],
      totalRows: 10,
      executionTimeMs: 5,
      affectedRows: 0,
      firstPage: [[1]],
      totalPages: 1,
      autoLimitApplied: false,
    })
    await promise

    // Tab should remain undefined
    expect(useQueryStore.getState().tabs['tab-stale-ps']).toBeUndefined()
  })

  it('skips error update if tab was cleaned up during failed changePageSize', async () => {
    let rejectQuery: ((reason: unknown) => void) | null = null
    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return new Promise((_resolve, reject) => {
          rejectQuery = reject
        })
      }
      if (cmd === 'evict_results') return null
      return null
    })

    useQueryStore.getState().setContent('tab-stale-ps2', 'SELECT 1')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-stale-ps2': {
          ...prev.tabs['tab-stale-ps2']!,
          lastExecutedSql: 'SELECT 1',
          status: 'success' as const,
        },
      },
    }))

    const promise = useQueryStore.getState().changePageSize('conn-1', 'tab-stale-ps2', 100)

    // Simulate tab close mid-flight
    useQueryStore.getState().cleanupTab('conn-1', 'tab-stale-ps2')

    // Reject the query
    rejectQuery!(new Error('Timeout'))
    await promise

    // Tab should remain undefined (error handler guard prevents write-back)
    expect(useQueryStore.getState().tabs['tab-stale-ps2']).toBeUndefined()
  })
})
