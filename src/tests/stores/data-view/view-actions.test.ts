import { countRanges } from '../../../lib/view-ranges'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useQueryStore, activeQuerySurfaceRef } from '../../../stores/query-store'
import { useToastStore } from '../../../stores/toast-store'
import { flat, withRows } from '../../helpers/query-test-utils'
import { patchResult, registerQueryStoreSetup } from '../../helpers/query-store-fixtures'

registerQueryStoreSetup()

// --- New Phase 5.1 action tests ---

describe('setViewMode', () => {
  it('sets the view mode to form, text and back to grid', () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')

    useQueryStore.getState().setViewMode(activeQuerySurfaceRef('tab-1'), 'form')
    expect(flat('tab-1').viewMode).toBe('form')

    useQueryStore.getState().setViewMode(activeQuerySurfaceRef('tab-1'), 'text')
    expect(flat('tab-1').viewMode).toBe('text')

    useQueryStore.getState().setViewMode(activeQuerySurfaceRef('tab-1'), 'grid')
    expect(flat('tab-1').viewMode).toBe('grid')
  })

  it('does not update selected row when the same row is selected again', () => {
    useQueryStore.getState().setContent('tab-same-row', 'SELECT 1')
    patchResult('tab-same-row', { selectedRowIndex: 2 })

    useQueryStore.getState().setSelectedRow(activeQuerySurfaceRef('tab-same-row'), 2)

    expect(flat('tab-same-row').selectedRowIndex).toBe(2)
  })

  it('does not update selected cell when the same value is set again', () => {
    useQueryStore.getState().setContent('tab-same-cell', 'SELECT 1')
    patchResult('tab-same-cell', {
      selectedCell: { columnKey: 'name', value: 'Ada' },
    })

    useQueryStore
      .getState()
      .setSelectedCell(activeQuerySurfaceRef('tab-same-cell'), { columnKey: 'name', value: 'Ada' })

    expect(flat('tab-same-cell').selectedCell).toEqual({ columnKey: 'name', value: 'Ada' })
  })

  it('shows an error toast when autosave fails while switching to text view', async () => {
    useQueryStore.getState().setContent('tab-text-save-fail', 'SELECT 1')
    patchResult('tab-text-save-fail', {
      resultStatus: 'success' as const,
      queryId: 'q-save-fail',
      columns: [{ name: 'id', dataType: 'INT' }],
      ...withRows([[1]]),
      totalRows: 1,
      viewMode: 'grid' as const,
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1 },
        currentValues: { id: 1 },
        modifiedColumns: new Set(['id']),
        isNewRow: false,
      },
      saveError: 'still broken',
    })

    useQueryStore.getState().setViewMode(activeQuerySurfaceRef('tab-text-save-fail'), 'text')
    await Promise.resolve()
    await Promise.resolve()

    expect(flat('tab-text-save-fail').viewMode).toBe('grid')
    expect(
      useToastStore
        .getState()
        .toasts.some(
          (toast) => toast.variant === 'error' && toast.title === 'Cannot switch to text view'
        )
    ).toBe(true)
  })
})

describe('setResultColumnWidth', () => {
  it('remembers each resized column width on the active result', async () => {
    await useQueryStore.getState().executeQuery('conn-1', 'tab-widths', 'SELECT 1')

    useQueryStore.getState().setResultColumnWidth(activeQuerySurfaceRef('tab-widths'), 'col_0', 180)
    useQueryStore.getState().setResultColumnWidth(activeQuerySurfaceRef('tab-widths'), 'col_1', 90)

    expect(flat('tab-widths').columnWidths).toEqual({ col_0: 180, col_1: 90 })
  })

  it('forgets the widths when the query runs again', async () => {
    await useQueryStore.getState().executeQuery('conn-1', 'tab-widths-rerun', 'SELECT 1')
    useQueryStore
      .getState()
      .setResultColumnWidth(activeQuerySurfaceRef('tab-widths-rerun'), 'col_0', 180)

    await useQueryStore.getState().executeQuery('conn-1', 'tab-widths-rerun', 'SELECT 1')

    expect(flat('tab-widths-rerun').columnWidths).toEqual({})
  })
})

describe('setSelectedRow', () => {
  it('sets and clears the selected row index', () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    patchResult('tab-1', {})

    useQueryStore.getState().setSelectedRow(activeQuerySurfaceRef('tab-1'), 5)
    expect(flat('tab-1').selectedRowIndex).toBe(5)

    useQueryStore.getState().setSelectedRow(activeQuerySurfaceRef('tab-1'), null)
    expect(flat('tab-1').selectedRowIndex).toBeNull()
  })
})

describe('setResultScrollCell', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useQueryStore.setState({ tabs: {} })
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    patchResult('tab-1', { resultStatus: 'success' })
  })

  it('persists scroll position on the active result', () => {
    useQueryStore
      .getState()
      .setResultScrollCell(activeQuerySurfaceRef('tab-1'), { scrollRow: 10, scrollColumn: 5 })
    const result = useQueryStore.getState().tabs['tab-1']!.results[0]
    expect(result.view.layout.scrollRow).toBe(10)
    expect(result.view.layout.scrollCol).toBe(5)
  })

  it('does not create a new state reference when values are unchanged', () => {
    useQueryStore
      .getState()
      .setResultScrollCell(activeQuerySurfaceRef('tab-1'), { scrollRow: 10, scrollColumn: 5 })
    const before = useQueryStore.getState().tabs['tab-1']!.results[0]
    useQueryStore
      .getState()
      .setResultScrollCell(activeQuerySurfaceRef('tab-1'), { scrollRow: 10, scrollColumn: 5 })
    const after = useQueryStore.getState().tabs['tab-1']!.results[0]
    expect(before).toBe(after)
  })

  it('no-ops for non-existent tab', () => {
    useQueryStore
      .getState()
      .setResultScrollCell(activeQuerySurfaceRef('nonexistent'), { scrollRow: 10, scrollColumn: 5 })
    expect(useQueryStore.getState().tabs['nonexistent']).toBeUndefined()
  })

  it('defaults scroll position to zero', () => {
    const result = useQueryStore.getState().tabs['tab-1']!.results[0]
    expect(result.view.layout.scrollRow).toBe(0)
    expect(result.view.layout.scrollCol).toBe(0)
  })
})

describe('setCheckedRanges', () => {
  it('stores checked view ranges tagged with the current view version', () => {
    useQueryStore.getState().setContent('tab-chk', 'SELECT 1')
    patchResult('tab-chk', { viewVersion: 4, checkedRanges: [] })

    useQueryStore.getState().setCheckedRanges(activeQuerySurfaceRef('tab-chk'), [[0, 100_000]])
    expect(flat('tab-chk').checkedRanges).toEqual([[0, 100_000]])
    expect(flat('tab-chk').checkedViewVersion).toBe(4)
    expect(countRanges(flat('tab-chk').checkedRanges)).toBe(100_000)

    useQueryStore.getState().setCheckedRanges(activeQuerySurfaceRef('tab-chk'), [])
    expect(flat('tab-chk').checkedRanges).toEqual([])
    // Clearing an already-empty set is a no-op.
    useQueryStore.getState().setCheckedRanges(activeQuerySurfaceRef('tab-chk'), [])
    useQueryStore.getState().setCheckedRanges(activeQuerySurfaceRef('missing'), [[0, 1]])
  })
})
