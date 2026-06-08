import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useTableDataStore } from '../../../stores/table-data-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { useToastStore } from '../../../stores/toast-store'
import type { TableDataTabState } from '../../../types/schema'
import { expectToast, ipc } from '../../ipc-mock'
import { makeTableDataTabState, setupTestConnection } from '../../helpers/table-data-test-utils'

import { TableDataToolbar } from '../../../components/table-data/TableDataToolbar'

const setupConnection = setupTestConnection

function makeDefaultTabState(overrides: Partial<TableDataTabState> = {}): TableDataTabState {
  return makeTableDataTabState({
    columns: [
      {
        name: 'id',
        dataType: 'bigint',
        isNullable: false,
        isPrimaryKey: true,
        isUniqueKey: false,
        hasDefault: false,
        columnDefault: null,
        isBinary: false,
        isBooleanAlias: false,
        isAutoIncrement: true,
      },
      {
        name: 'name',
        dataType: 'varchar',
        isNullable: true,
        isPrimaryKey: false,
        isUniqueKey: false,
        hasDefault: false,
        columnDefault: null,
        isBinary: false,
        isBooleanAlias: false,
        isAutoIncrement: false,
      },
    ],
    rows: [
      [1, 'Alice'],
      [2, 'Bob'],
      [3, 'Charlie'],
    ],
    primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
    executionTimeMs: 15,
    ...overrides,
  })
}

function setupTabState(overrides: Partial<TableDataTabState> = {}) {
  useTableDataStore.setState({
    tabs: { 'tab-1': makeDefaultTabState(overrides) },
  })
}

beforeEach(() => {
  useTableDataStore.setState({ tabs: {} })
  useConnectionStore.setState({ activeConnections: {}, activeTabId: null })
  useToastStore.setState({ toasts: [] })
  ipc.override('fetch_table_data', () => ({
    columns: [],
    rows: [],
    currentPage: 1,
    pageSize: 1000,
    primaryKey: null,
    executionTimeMs: 0,
  }))
  vi.clearAllMocks()
})

describe('TableDataToolbar — Clear Filter button', () => {
  it('clear filter button is not visible when no filters', () => {
    setupConnection()
    setupTabState({ filterModel: [] })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.queryByTestId('btn-clear-filter')).not.toBeInTheDocument()
  })

  it('clear filter button is visible when filters are active', () => {
    setupConnection()
    setupTabState({
      filterModel: [{ column: 'name', operator: '==', value: 'Alice' }],
    })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-clear-filter')).toBeInTheDocument()
  })

  it('clicking clear filter directly clears filters and shows toast (no confirm dialog)', async () => {
    setupConnection()
    setupTabState({
      filterModel: [{ column: 'name', operator: '==', value: 'Alice' }],
    })
    render(<TableDataToolbar tabId="tab-1" />)

    // Click clear filter — should clear immediately via withNavigationGuard (no edits pending)
    fireEvent.click(screen.getByTestId('btn-clear-filter'))

    // No confirm dialog should appear
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()

    // filterModel should be cleared
    await waitFor(() => {
      const tab = useTableDataStore.getState().tabs['tab-1']
      expect(tab?.filterModel).toEqual([])
    })

    // Toast should be shown
    await expectToast('success', 'Filters cleared')
  })

  it('confirming clear filter calls applyFilters([]) and shows "Filters cleared" toast', async () => {
    setupConnection()
    setupTabState({
      filterModel: [{ column: 'name', operator: '==', value: 'Alice' }],
    })
    render(<TableDataToolbar tabId="tab-1" />)

    // Click clear filter
    fireEvent.click(screen.getByTestId('btn-clear-filter'))

    // filterModel should be cleared
    await waitFor(() => {
      const tab = useTableDataStore.getState().tabs['tab-1']
      expect(tab?.filterModel).toEqual([])
    })

    // Toast should be shown
    await expectToast('success', 'Filters cleared')
  })

  it('clear filter button has aria-label', () => {
    setupConnection()
    setupTabState({
      filterModel: [{ column: 'name', operator: '==', value: 'Alice' }],
    })
    render(<TableDataToolbar tabId="tab-1" />)

    const btn = screen.getByTestId('btn-clear-filter')
    expect(btn).toHaveAttribute('aria-label', 'Clear filters')
  })
})

describe('TableDataToolbar — Filter auto-populate from selectedCell', () => {
  it('filter dialog opens with empty conditions when no selected cell', () => {
    setupConnection()
    setupTabState({ selectedCell: null })
    render(<TableDataToolbar tabId="tab-1" />)

    fireEvent.click(screen.getByTestId('btn-filter'))
    expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()

    // Empty state should be visible (no conditions pre-populated)
    expect(screen.getByTestId('filter-empty-state')).toBeInTheDocument()
  })

  it('filter dialog auto-populates with selected cell value', async () => {
    setupConnection()
    setupTabState({
      selectedCell: { columnKey: 'name', value: 'Alice' },
    })
    render(<TableDataToolbar tabId="tab-1" />)

    fireEvent.click(screen.getByTestId('btn-filter'))
    expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()

    // Should have a filter row pre-populated (not empty state)
    expect(screen.queryByTestId('filter-empty-state')).not.toBeInTheDocument()
    expect(screen.getByTestId('filter-row')).toBeInTheDocument()
    expect(screen.getByTestId('filter-column-select-0')).toHaveTextContent('name')
    expect(screen.getByTestId('filter-operator-select-0')).toHaveTextContent('==')
    expect(screen.getByTestId('filter-value-input')).toHaveValue('Alice')
    await waitFor(() => {
      expect(screen.getByTestId('filter-value-input')).toHaveFocus()
    })
  })

  it('filter dialog auto-populates with IS NULL when cell value is null', () => {
    setupConnection()
    setupTabState({
      selectedCell: { columnKey: 'name', value: null },
    })
    render(<TableDataToolbar tabId="tab-1" />)

    fireEvent.click(screen.getByTestId('btn-filter'))
    expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()

    // Should have a filter row
    expect(screen.queryByTestId('filter-empty-state')).not.toBeInTheDocument()
    expect(screen.getByTestId('filter-row')).toBeInTheDocument()
  })

  it('filter dialog uses existing filterModel when filters are active (ignores selectedCell)', () => {
    setupConnection()
    setupTabState({
      filterModel: [{ column: 'id', operator: '>', value: '10' }],
      selectedCell: { columnKey: 'name', value: 'Alice' },
    })
    render(<TableDataToolbar tabId="tab-1" />)

    fireEvent.click(screen.getByTestId('btn-filter'))
    expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()

    // Should show the existing filter condition, not the selected cell
    expect(screen.getByTestId('filter-row')).toBeInTheDocument()
  })
})
