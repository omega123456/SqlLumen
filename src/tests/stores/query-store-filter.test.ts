import { describe, it, expect, beforeEach } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import { useQueryStore, DEFAULT_RESULT_STATE } from '../../stores/query-store'
import type { ColumnMeta, FilterCondition } from '../../types/schema'

/**
 * Inject a result with given overrides into the store for a tab.
 * Handles fields like selectedCell, filterModel, unfilteredRows that are
 * part of SingleResultState but not routed by makeTabState's RESULT_KEYS.
 */
function setupTab(
  tabId: string,
  resultOverrides: Record<string, unknown> = {},
  tabOverrides: Record<string, unknown> = {}
) {
  useQueryStore.setState((prev) => ({
    tabs: {
      ...prev.tabs,
      [tabId]: {
        content: '',
        filePath: null,
        status: 'idle' as const,
        cursorPosition: null,
        connectionId: '',
        results: [{ ...DEFAULT_RESULT_STATE, ...resultOverrides }],
        activeResultIndex: 0,
        pendingNavigationAction: null,
        executionStartedAt: null,
        isCancelling: false,
        wasCancelled: false,
        ...tabOverrides,
      },
    },
  }))
}

/** Standard columns used across tests. */
const COLUMNS: ColumnMeta[] = [
  { name: 'id', dataType: 'INT' },
  { name: 'name', dataType: 'VARCHAR' },
  { name: 'age', dataType: 'INT' },
]

/** Standard rows used across tests. */
const ROWS: unknown[][] = [
  [1, 'Alice', 30],
  [2, 'Bob', 25],
  [3, 'Charlie', 35],
  [4, 'Diana', null],
  [5, 'Eve', 28],
]

beforeEach(() => {
  useQueryStore.setState({ tabs: {} })
  mockIPC(() => null)
})

describe('applyQueryFilters — apply and clear', () => {
  it('filters rows by a non-empty condition and saves unfilteredRows', () => {
    setupTab('tab-1', {
      columns: COLUMNS,
      rows: ROWS,
      totalRows: 5,
      pageSize: 1000,
    })

    const conditions: FilterCondition[] = [{ column: 'name', operator: '==', value: 'Alice' }]
    useQueryStore.getState().applyQueryFilters('tab-1', 0, conditions)

    const result = useQueryStore.getState().tabs['tab-1']!.results[0]
    expect(result.rows).toEqual([[1, 'Alice', 30]])
    expect(result.unfilteredRows).toEqual(ROWS)
    expect(result.filterModel).toEqual(conditions)
    expect(result.currentPage).toBe(1)
  })

  it('clears filter and restores rows from unfilteredRows', () => {
    setupTab('tab-1', {
      columns: COLUMNS,
      rows: [[1, 'Alice', 30]],
      unfilteredRows: ROWS,
      filterModel: [{ column: 'name', operator: '==', value: 'Alice' }],
      totalRows: 5,
      pageSize: 1000,
    })

    useQueryStore.getState().applyQueryFilters('tab-1', 0, [])

    const result = useQueryStore.getState().tabs['tab-1']!.results[0]
    expect(result.rows).toEqual(ROWS)
    expect(result.unfilteredRows).toBeNull()
    expect(result.filterModel).toEqual([])
    expect(result.currentPage).toBe(1)
  })

  it('re-applies a different filter from unfilteredRows (not currently filtered rows)', () => {
    // First apply: name == 'Alice'
    setupTab('tab-1', {
      columns: COLUMNS,
      rows: ROWS,
      totalRows: 5,
      pageSize: 1000,
    })
    useQueryStore
      .getState()
      .applyQueryFilters('tab-1', 0, [{ column: 'name', operator: '==', value: 'Alice' }])

    // Re-apply: name == 'Bob' — should filter from original rows, not the already-filtered set
    useQueryStore
      .getState()
      .applyQueryFilters('tab-1', 0, [{ column: 'name', operator: '==', value: 'Bob' }])

    const result = useQueryStore.getState().tabs['tab-1']!.results[0]
    expect(result.rows).toEqual([[2, 'Bob', 25]])
    // unfilteredRows should still be the original full set
    expect(result.unfilteredRows).toEqual(ROWS)
    expect(result.filterModel).toEqual([{ column: 'name', operator: '==', value: 'Bob' }])
  })
})

describe('applyQueryFilters — operators', () => {
  it('IS NULL — matches rows with null/undefined values', () => {
    setupTab('tab-1', {
      columns: COLUMNS,
      rows: ROWS,
      pageSize: 1000,
    })

    useQueryStore
      .getState()
      .applyQueryFilters('tab-1', 0, [{ column: 'age', operator: 'IS NULL', value: '' }])

    const result = useQueryStore.getState().tabs['tab-1']!.results[0]
    expect(result.rows).toEqual([[4, 'Diana', null]])
  })

  it('IS NOT NULL — matches rows with non-null values', () => {
    setupTab('tab-1', {
      columns: COLUMNS,
      rows: ROWS,
      pageSize: 1000,
    })

    useQueryStore
      .getState()
      .applyQueryFilters('tab-1', 0, [{ column: 'age', operator: 'IS NOT NULL', value: '' }])

    const result = useQueryStore.getState().tabs['tab-1']!.results[0]
    expect(result.rows).toHaveLength(4)
    expect(result.rows.every((r) => r[2] !== null)).toBe(true)
  })

  it('LIKE — %lic% matches Alice', () => {
    setupTab('tab-1', {
      columns: COLUMNS,
      rows: ROWS,
      pageSize: 1000,
    })

    useQueryStore
      .getState()
      .applyQueryFilters('tab-1', 0, [{ column: 'name', operator: 'LIKE', value: '%lic%' }])

    const result = useQueryStore.getState().tabs['tab-1']!.results[0]
    expect(result.rows).toEqual([[1, 'Alice', 30]])
  })

  it('NOT LIKE — excludes matching rows', () => {
    setupTab('tab-1', {
      columns: COLUMNS,
      rows: ROWS,
      pageSize: 1000,
    })

    useQueryStore
      .getState()
      .applyQueryFilters('tab-1', 0, [{ column: 'name', operator: 'NOT LIKE', value: '%lic%' }])

    const result = useQueryStore.getState().tabs['tab-1']!.results[0]
    // Alice is excluded, others remain
    expect(result.rows.some((r) => r[1] === 'Alice')).toBe(false)
    expect(result.rows.length).toBe(4)
  })

  it('> operator — numeric comparison', () => {
    setupTab('tab-1', {
      columns: COLUMNS,
      rows: ROWS,
      pageSize: 1000,
    })

    useQueryStore
      .getState()
      .applyQueryFilters('tab-1', 0, [{ column: 'age', operator: '>', value: '29' }])

    const result = useQueryStore.getState().tabs['tab-1']!.results[0]
    // Alice (30) and Charlie (35) — Diana (null) fails because Number(null) is 0 which is not > 29
    expect(result.rows).toEqual([
      [1, 'Alice', 30],
      [3, 'Charlie', 35],
    ])
  })

  it('unknown column in condition — row passes (skip condition)', () => {
    setupTab('tab-1', {
      columns: COLUMNS,
      rows: ROWS,
      pageSize: 1000,
    })

    useQueryStore
      .getState()
      .applyQueryFilters('tab-1', 0, [{ column: 'nonexistent', operator: '==', value: 'anything' }])

    const result = useQueryStore.getState().tabs['tab-1']!.results[0]
    // All rows pass because the condition column was not found
    expect(result.rows).toEqual(ROWS)
  })
})

describe('applyQueryFilters — pagination recalculation', () => {
  it('recalculates totalPages based on filtered row count and pageSize', () => {
    setupTab('tab-1', {
      columns: COLUMNS,
      rows: ROWS,
      pageSize: 2,
    })

    // Filter to 3 rows with pageSize 2 → totalPages should be 2
    useQueryStore
      .getState()
      .applyQueryFilters('tab-1', 0, [{ column: 'age', operator: 'IS NOT NULL', value: '' }])

    const result = useQueryStore.getState().tabs['tab-1']!.results[0]
    expect(result.rows).toHaveLength(4) // 4 non-null age rows
    expect(result.totalPages).toBe(2) // ceil(4/2) = 2
    expect(result.currentPage).toBe(1)
  })

  it('resets currentPage to 1 when filter is applied', () => {
    setupTab('tab-1', {
      columns: COLUMNS,
      rows: ROWS,
      pageSize: 1000,
      currentPage: 3,
    })

    useQueryStore
      .getState()
      .applyQueryFilters('tab-1', 0, [{ column: 'name', operator: '==', value: 'Alice' }])

    const result = useQueryStore.getState().tabs['tab-1']!.results[0]
    expect(result.currentPage).toBe(1)
  })
})

describe('applyQueryFilters — edge cases', () => {
  it('does nothing for invalid tab', () => {
    useQueryStore
      .getState()
      .applyQueryFilters('nonexistent', 0, [{ column: 'id', operator: '==', value: '1' }])
    // No crash, no tab created
    expect(useQueryStore.getState().tabs['nonexistent']).toBeUndefined()
  })

  it('does nothing for out-of-range resultIndex', () => {
    setupTab('tab-1', { columns: COLUMNS, rows: ROWS, pageSize: 1000 })

    useQueryStore
      .getState()
      .applyQueryFilters('tab-1', 5, [{ column: 'id', operator: '==', value: '1' }])

    // Rows should be unchanged
    const result = useQueryStore.getState().tabs['tab-1']!.results[0]
    expect(result.rows).toEqual(ROWS)
  })

  it('clearing filter when no unfilteredRows uses current rows', () => {
    setupTab('tab-1', {
      columns: COLUMNS,
      rows: ROWS,
      unfilteredRows: null,
      filterModel: [],
      pageSize: 1000,
    })

    useQueryStore.getState().applyQueryFilters('tab-1', 0, [])

    const result = useQueryStore.getState().tabs['tab-1']!.results[0]
    expect(result.rows).toEqual(ROWS)
    expect(result.unfilteredRows).toBeNull()
  })

  it('totalPages is at least 1 even when filter produces 0 rows', () => {
    setupTab('tab-1', {
      columns: COLUMNS,
      rows: ROWS,
      pageSize: 1000,
    })

    useQueryStore
      .getState()
      .applyQueryFilters('tab-1', 0, [{ column: 'name', operator: '==', value: 'Nonexistent' }])

    const result = useQueryStore.getState().tabs['tab-1']!.results[0]
    expect(result.rows).toHaveLength(0)
    expect(result.totalPages).toBe(1) // Math.max(1, ...)
  })
})

describe('setSelectedCell', () => {
  it('sets selectedCell on a specific result', () => {
    setupTab('tab-1', {
      columns: COLUMNS,
      rows: ROWS,
    })

    useQueryStore.getState().setSelectedCell('tab-1', { columnKey: 'name', value: 'Alice' })

    const result = useQueryStore.getState().tabs['tab-1']!.results[0]
    expect(result.selectedCell).toEqual({ columnKey: 'name', value: 'Alice' })
  })

  it('clears selectedCell with null', () => {
    setupTab('tab-1', {
      columns: COLUMNS,
      rows: ROWS,
      selectedCell: { columnKey: 'name', value: 'Alice' },
    })

    useQueryStore.getState().setSelectedCell('tab-1', null)

    const result = useQueryStore.getState().tabs['tab-1']!.results[0]
    expect(result.selectedCell).toBeNull()
  })
})
