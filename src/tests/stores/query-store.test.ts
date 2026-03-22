import { describe, it, expect, beforeEach } from 'vitest'
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

describe('useQueryStore — getTabState', () => {
  it('returns default state for unknown tab', () => {
    const state = useQueryStore.getState().getTabState('unknown')
    expect(state.status).toBe('idle')
    expect(state.content).toBe('')
    expect(state.columns).toHaveLength(0)
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
