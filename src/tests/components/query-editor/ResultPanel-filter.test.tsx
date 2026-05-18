import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ipc } from '../../ipc-mock'
import { ResultPanel } from '../../../components/query-editor/ResultPanel'
import { useQueryStore, DEFAULT_RESULT_STATE } from '../../../stores/query-store'
import { useToastStore } from '../../../stores/toast-store'
import type { SingleResultState, TabQueryState } from '../../../stores/query-store'
import * as ResultGridViewModule from '../../../components/query-editor/ResultGridView'
import * as FkLookupDialogModule from '../../../components/table-data/FkLookupDialog'

// Use vi.spyOn to install per-test mock implementations without vi.mock().
// ResultGridView is stubbed to avoid rendering the real grid canvas.
// FkLookupDialog is stubbed to null (no dialog needed for filter tests).
// Real FilterDialog is used — the tests assert on its real rendered output.
// IPC fixtures in setup.ts handle log_frontend. Per-test ipc.override() covers
// query and table-data commands.

beforeEach(() => {
  useQueryStore.setState({ tabs: {} })
  useToastStore.setState({ toasts: [] })
  vi.clearAllMocks()

  ipc.override('execute_query', () => ({
    queryId: 'q1',
    columns: [],
    totalRows: 0,
    executionTimeMs: 0,
    affectedRows: 0,
    totalPages: 1,
    autoLimitApplied: false,
    firstPage: [],
  }))
  ipc.override('fetch_result_page', () => ({ rows: [], page: 1, totalPages: 1 }))
  ipc.override('evict_results', () => undefined)
  ipc.override('sort_results', () => ({ rows: [], page: 1, totalPages: 1 }))
  ipc.override('fetch_table_data', () => ({
    columns: [],
    rows: [],
    currentPage: 1,
    pageSize: 100,
    primaryKey: null,
    executionTimeMs: 0,
  }))
  ipc.override('update_table_row', () => undefined)
  ipc.override('insert_table_row', () => [])
  ipc.override('delete_table_row', () => undefined)
  ipc.override('export_table_data', () => undefined)
  ipc.override('export_results', () => ({ bytesWritten: 1024, rowsExported: 5 }))

  vi.spyOn(ResultGridViewModule, 'ResultGridView').mockImplementation(
    () => (<div data-testid="grid-view">Grid Mock</div>) as unknown as React.ReactElement
  )
  vi.spyOn(FkLookupDialogModule, 'FkLookupDialog').mockImplementation(
    () => null as unknown as React.ReactElement
  )
})

import React from 'react'

/**
 * Set up a tab in the query store with success status and filter-relevant state.
 */
function setupQueryTab(resultOverrides: Partial<SingleResultState> = {}) {
  const result: SingleResultState = {
    ...DEFAULT_RESULT_STATE,
    resultStatus: 'success',
    columns: [
      { name: 'id', dataType: 'INT' },
      { name: 'name', dataType: 'VARCHAR' },
    ],
    rows: [
      [1, 'Alice'],
      [2, 'Bob'],
    ],
    totalRows: 2,
    queryId: 'q1',
    ...resultOverrides,
  }

  const tab: TabQueryState = {
    content: '',
    selectedText: '',
    filePath: null,
    tabStatus: 'success',
    prevTabStatus: 'idle',
    cursorPosition: null,
    connectionId: 'conn-1',
    results: [result],
    activeResultIndex: 0,
    pendingNavigationAction: null,
    executionStartedAt: null,
    isCancelling: false,
    wasCancelled: false,
    activeBottomPanelItem: { type: 'result' },
  }

  useQueryStore.setState({ tabs: { 'tab-1': tab } })
}

describe('ResultPanel — Filter button state', () => {
  it('filter button is disabled when no columns', () => {
    setupQueryTab({ columns: [], rows: [] })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('btn-filter')).toBeDisabled()
  })

  it('clear filter button is not visible when no filters', () => {
    setupQueryTab({ filterModel: [] })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.queryByTestId('btn-clear-filter')).not.toBeInTheDocument()
  })

  it('clear filter button is visible when filters are active', () => {
    setupQueryTab({
      filterModel: [{ column: 'name', operator: '==', value: 'Alice' }],
    })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('btn-clear-filter')).toBeInTheDocument()
  })
})

describe('ResultPanel — Clear filter', () => {
  it('clicking clear filter directly clears filters and shows toast', async () => {
    setupQueryTab({
      filterModel: [{ column: 'name', operator: '==', value: 'Alice' }],
      unfilteredRows: [
        [1, 'Alice'],
        [2, 'Bob'],
      ],
      rows: [[1, 'Alice']],
    })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)

    // Click clear filter — no confirm dialog
    fireEvent.click(screen.getByTestId('btn-clear-filter'))

    // filterModel should be cleared immediately
    await waitFor(() => {
      const result = useQueryStore.getState().tabs['tab-1']!.results[0]
      expect(result.filterModel).toEqual([])
    })

    // Toast should be shown via real toast store
    const toasts = useToastStore.getState().toasts
    expect(toasts.some((t) => t.variant === 'success' && t.title === 'Filters cleared')).toBe(true)

    // No confirm dialog should appear
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
  })

  it('clear filter button is disabled when editing is active', () => {
    setupQueryTab({
      filterModel: [{ column: 'name', operator: '==', value: 'Alice' }],
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, name: 'Alice' },
        currentValues: { id: 1, name: 'Alice' },
        modifiedColumns: new Set<string>(),
        isNewRow: false,
      },
      editingRowIndex: 0,
    })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('btn-clear-filter')).toBeDisabled()
  })

  it('filter button is disabled when editing is active', () => {
    setupQueryTab({
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, name: 'Alice' },
        currentValues: { id: 1, name: 'Alice' },
        modifiedColumns: new Set<string>(),
        isNewRow: false,
      },
      editingRowIndex: 0,
    })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('btn-filter')).toBeDisabled()
  })
})

describe('ResultPanel — Filter auto-populate from selectedCell', () => {
  it('filter dialog auto-populates with selected cell value', () => {
    setupQueryTab({
      selectedCell: { columnKey: 'name', value: 'Alice' },
    })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)

    fireEvent.click(screen.getByTestId('btn-filter'))
    expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()

    // Should have a pre-populated filter row (not empty state)
    expect(screen.queryByTestId('filter-empty-state')).not.toBeInTheDocument()
    expect(screen.getByTestId('filter-row')).toBeInTheDocument()
  })

  it('filter dialog auto-populates IS NULL when cell value is null', () => {
    setupQueryTab({
      selectedCell: { columnKey: 'name', value: null },
    })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)

    fireEvent.click(screen.getByTestId('btn-filter'))
    expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()

    // Should have a pre-populated filter row with IS NULL
    expect(screen.queryByTestId('filter-empty-state')).not.toBeInTheDocument()
    expect(screen.getByTestId('filter-row')).toBeInTheDocument()
  })

  it('filter dialog opens with empty state when no selected cell and no filters', () => {
    setupQueryTab({
      selectedCell: null,
      filterModel: [],
    })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)

    fireEvent.click(screen.getByTestId('btn-filter'))
    expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('filter-empty-state')).toBeInTheDocument()
  })
})
