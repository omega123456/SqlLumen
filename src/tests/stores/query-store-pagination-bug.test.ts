import { describe, it, expect, beforeEach } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import { useQueryStore, getFlatTabState } from '../../stores/query-store'

/**
 * Regression test: When the user provides an explicit LIMIT (autoLimitApplied=false),
 * the backend should send ALL fetched rows in firstPage so the query result view
 * displays every row without needing pagination.
 */

function flat(tabId: string) {
  return getFlatTabState(useQueryStore.getState().getTabState(tabId))
}

describe('query result view should show all returned rows regardless of page size', () => {
  beforeEach(() => {
    useQueryStore.setState({ tabs: {} })
  })

  it('displays all rows when totalRows exceeds firstPage length', async () => {
    // With the fix, the backend sends all 100 rows in firstPage when autoLimitApplied=false
    const allRows = Array.from({ length: 100 }, (_, i) => [i + 1])
    const totalRows = 100

    mockIPC((cmd) => {
      switch (cmd) {
        case 'execute_query':
          return {
            queryId: 'q-limit-bug',
            columns: [{ name: 'id', dataType: 'INT' }],
            totalRows,
            executionTimeMs: 10,
            affectedRows: 0,
            firstPage: allRows,
            totalPages: 1,
            autoLimitApplied: false,
          }
        case 'evict_results':
          return null
        default:
          return null
      }
    })

    const store = useQueryStore.getState()
    store.setContent('tab-1', 'SELECT * FROM users LIMIT 100')
    await store.executeQuery('conn-1', 'tab-1', 'SELECT * FROM users LIMIT 100')

    const state = flat('tab-1')

    // All 100 rows should be displayed in the query result view
    expect(state!.rows.length).toBe(totalRows)
  })
})
