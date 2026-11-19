import { patchedLegacyResult, resultState } from '../../helpers/legacy-result-fields'
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ipc } from '../../ipc-mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FilterCondition } from '../../../types/schema'
import { ResultPanel } from '../../../components/query-editor/ResultPanel'
import { useQueryStore, querySurfaceRef } from '../../../stores/query-store'
import { makeTabState, withRows } from '../../helpers/query-test-utils'
import * as ResultSubTabsModule from '../../../components/query-editor/ResultSubTabs'
import * as DataToolbarModule from '../../../components/shared/data-view/DataToolbar'
import type { DataViewSource } from '../../../components/shared/data-view/data-view-source'
import * as DataGridViewModule from '../../../components/shared/data-view/DataGridView'
import * as DataFormViewModule from '../../../components/shared/data-view/DataFormView'
import * as DataTextViewModule from '../../../components/shared/data-view/DataTextView'
import * as ExportDialogModule from '../../../components/dialogs/ExportDialog'
import * as FilterDialogModule from '../../../components/dialogs/FilterDialog'
import { useToastStore } from '../../../stores/toast-store'
import type { SingleResultState, TabQueryState } from '../../../stores/query-store'
import * as FkLookupDialogModule from '../../../components/shared/FkLookupDialog'

// Use vi.spyOn to install per-test mock implementations without vi.mock().
// IPC commands are handled via ipc.override().

let capturedExportDialogProps: Record<string, unknown> = {}

beforeEach(() => {
  vi.clearAllMocks()
  capturedExportDialogProps = {}
  useQueryStore.setState({ tabs: {} })

  ipc.override('execute_query', () => ({
    queryId: 'q1',
    columns: [],
    totalRows: 0,
    executionTimeMs: 0,
    affectedRows: 0,
    autoLimitApplied: false,
    rows: [],
  }))
  ipc.override('fetch_cached_rows', () => ({ rows: [], columns: [] }))
  ipc.override('evict_results', () => undefined)
  ipc.override('sort_results', () => ({ rows: [] }))
  ipc.override('export_results', () => ({ bytesWritten: 1024, rowsExported: 2 }))
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

  vi.spyOn(ResultSubTabsModule, 'ResultSubTabs').mockImplementation(
    ({ tabId }: { tabId: string }) =>
      (<div data-testid="result-subtabs">{tabId}</div>) as unknown as React.ReactElement
  )

  vi.spyOn(DataToolbarModule, 'DataToolbar').mockImplementation(({ filter }) => {
    return (
      <div data-testid="result-toolbar">
        <button data-testid="toolbar-open-filter" onClick={filter.openFilterDialog}>
          Filter
        </button>
        <button data-testid="toolbar-clear-filter" onClick={filter.clearFilter}>
          Clear
        </button>
      </div>
    ) as unknown as React.ReactElement
  })

  vi.spyOn(DataGridViewModule.DataGridView, 'type').mockImplementation(
    () => (<div data-testid="result-grid-view" />) as unknown as React.ReactElement
  )

  vi.spyOn(DataFormViewModule, 'DataFormView').mockImplementation(
    () => (<div data-testid="result-form-view">Form View</div>) as unknown as React.ReactElement
  )

  vi.spyOn(DataTextViewModule, 'DataTextView').mockImplementation(
    ({ source }: { source: DataViewSource }) =>
      (
        <div data-testid="result-text-view">{source.ref.tabId}</div>
      ) as unknown as React.ReactElement
  )

  vi.spyOn(ExportDialogModule, 'default').mockImplementation((props) => {
    const p = props as unknown as Record<string, unknown>
    capturedExportDialogProps = p
    return (
      <button data-testid="export-dialog-close" onClick={p.onClose as () => void}>
        Close Export
      </button>
    ) as unknown as React.ReactElement
  })

  vi.spyOn(FilterDialogModule, 'FilterDialog').mockImplementation((props) => {
    const p = props as unknown as Record<string, unknown>
    if (!p.isOpen) return null as unknown as React.ReactElement

    const applyConditions: FilterCondition[] = [{ column: 'name', operator: '==', value: 'Alice' }]

    return (
      <div data-testid="filter-dialog-mock">
        <button
          data-testid="filter-dialog-apply"
          onClick={() => (p.onApply as (conditions: FilterCondition[]) => void)(applyConditions)}
        >
          Apply
        </button>
        <button data-testid="filter-dialog-cancel" onClick={p.onCancel as () => void}>
          Cancel
        </button>
      </div>
    ) as unknown as React.ReactElement
  })
})

function renderPanel(overrides: Record<string, unknown> = {}) {
  useQueryStore.setState({
    tabs: {
      'tab-1': makeTabState({
        status: 'success',
        connectionId: 'conn-1',
        columns: [
          { name: 'id', dataType: 'INT' },
          { name: 'role_id', dataType: 'INT' },
          { name: 'name', dataType: 'VARCHAR' },
        ],
        rows: [
          [1, 5, 'Alice'],
          [2, 6, 'Bob'],
        ],
        totalRows: 2,
        selectedRowIndex: 0,
        queryId: 'q1',
        ...overrides,
      }),
    },
  })

  return render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
}

describe('ResultPanel actions and states', () => {
  it('renders running and error states with multi-result tabs', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          ...makeTabState({ connectionId: 'conn-1' }),
          tabStatus: 'running',
          results: [resultState({ resultStatus: 'success' })],
        },
      },
    })

    const { rerender } = render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByText('Executing query...')).toBeInTheDocument()

    useQueryStore.setState({
      tabs: {
        'tab-1': {
          ...makeTabState({ connectionId: 'conn-1' }),
          tabStatus: 'success',
          activeResultIndex: 1,
          results: [
            resultState({
              resultStatus: 'success',
              ...withRows([[1]]),
              view: { slot: { columns: [{ name: 'id', dataType: 'INT' }], totalRows: 1 } },
            }),
            resultState({ resultStatus: 'error', errorMessage: 'Broken query' }),
          ],
        },
      },
    })

    rerender(<ResultPanel tabId="tab-1" connectionId="conn-1" />)

    expect(screen.getByTestId('result-subtabs')).toHaveTextContent('tab-1')
    expect(screen.getByText('Broken query')).toBeInTheDocument()
  })

  it('suppresses result sub-tabs when hideSubTabs is true', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          ...makeTabState({ connectionId: 'conn-1' }),
          tabStatus: 'success',
          activeResultIndex: 1,
          results: [
            resultState({
              resultStatus: 'success',
              ...withRows([[1]]),
              view: { slot: { columns: [{ name: 'id', dataType: 'INT' }], totalRows: 1 } },
            }),
            resultState({ resultStatus: 'error', errorMessage: 'Broken query' }),
          ],
        },
      },
    })

    render(<ResultPanel tabId="tab-1" connectionId="conn-1" hideSubTabs />)

    expect(screen.queryByTestId('result-subtabs')).not.toBeInTheDocument()
    expect(screen.getByText('Broken query')).toBeInTheDocument()
  })

  it('shows affected row count for DML success results', () => {
    renderPanel({ columns: [], rows: [], affectedRows: 3 })

    expect(screen.getByTestId('dml-success')).toHaveTextContent('Query OK3 rows affected')
  })

  it('applies and cancels filter dialog interactions', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByTestId('toolbar-open-filter'))
    expect(screen.getByTestId('filter-dialog-mock')).toBeInTheDocument()

    await user.click(screen.getByTestId('filter-dialog-apply'))

    await waitFor(() => {
      expect(ipc.payloads('set_result_view')[0]).toMatchObject({
        viewSpec: { filters: [{ column: 'name', operator: '==', value: 'Alice' }] },
      })
    })

    await user.click(screen.getByTestId('toolbar-open-filter'))
    await user.click(screen.getByTestId('filter-dialog-cancel'))

    await waitFor(() => {
      expect(screen.queryByTestId('filter-dialog-mock')).not.toBeInTheDocument()
    })
  })

  it('wires unsaved changes dialog actions to store handlers', async () => {
    const user = userEvent.setup()
    const confirmNavigationSpy = vi
      .spyOn(useQueryStore.getState(), 'confirmNavigation')
      .mockResolvedValue(undefined)
    const cancelNavigationSpy = vi.spyOn(useQueryStore.getState(), 'cancelNavigation')

    renderPanel({ pendingNavigationAction: () => undefined, saveError: 'cannot save yet' })

    expect(screen.getByTestId('unsaved-changes-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('unsaved-changes-error')).toHaveTextContent('cannot save yet')

    await user.click(screen.getByTestId('btn-save-changes'))
    await waitFor(() => {
      expect(confirmNavigationSpy).toHaveBeenCalledWith(querySurfaceRef('tab-1', 0), true)
    })

    await user.click(screen.getByTestId('btn-discard-changes'))
    expect(confirmNavigationSpy).toHaveBeenCalledWith(querySurfaceRef('tab-1', 0), false)

    await user.click(screen.getByTestId('btn-cancel-changes'))
    expect(cancelNavigationSpy).toHaveBeenCalledWith(querySurfaceRef('tab-1', 0))
  })

  it('renders export dialog and closes it through the provided handler', async () => {
    const user = userEvent.setup()
    const closeExportDialogSpy = vi.spyOn(useQueryStore.getState(), 'closeExportDialog')

    renderPanel({ exportDialogOpen: true })

    expect(screen.getByTestId('export-dialog-close')).toBeInTheDocument()
    expect(capturedExportDialogProps.resultIndex).toBe(0)

    await user.click(screen.getByTestId('export-dialog-close'))

    expect(closeExportDialogSpy).toHaveBeenCalledWith(querySurfaceRef('tab-1', 0))
  })
})

describe('filter button and dialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

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
      autoLimitApplied: false,
      rows: [],
    }))
    ipc.override('fetch_cached_rows', () => ({ rows: [], columns: [] }))
    ipc.override('evict_results', () => undefined)
    ipc.override('sort_results', () => ({ rows: [] }))
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

    vi.spyOn(DataGridViewModule.DataGridView, 'type').mockImplementation(
      () => (<div data-testid="grid-view">Grid Mock</div>) as unknown as React.ReactElement
    )
    vi.spyOn(FkLookupDialogModule, 'FkLookupDialog').mockImplementation(
      () => null as unknown as React.ReactElement
    )
  })

  /**
   * Set up a tab in the query store with success status and filter-relevant state.
   */
  function setupQueryTab(resultOverrides: object = {}) {
    const result: SingleResultState = patchedLegacyResult(
      resultState({
        view: {
          slot: {
            columns: [
              { name: 'id', dataType: 'INT' },
              { name: 'name', dataType: 'VARCHAR' },
            ],
            totalRows: 2,
            queryId: 'q1',
          },
        },
        resultStatus: 'success',
        ...withRows([
          [1, 'Alice'],
          [2, 'Bob'],
        ]),
      }),
      resultOverrides
    )

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
      executionStartedAt: null,
      isCancelling: false,
      wasCancelled: false,
      runExport: null,
      activeBottomPanelItem: { type: 'result' },
    }

    useQueryStore.setState({ tabs: { 'tab-1': tab } })
  }

  describe('ResultPanel — Filter button state', () => {
    it('filter button is disabled when no columns', () => {
      setupQueryTab({ ...withRows([]), view: { slot: { columns: [] } } })
      render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
      expect(screen.getByTestId('btn-filter')).toBeDisabled()
    })
  })

  describe('ResultPanel — Clear filter', () => {
    it('clicking clear filter directly clears filters and shows toast', async () => {
      setupQueryTab({
        ...withRows([[1, 'Alice']]),
        view: {
          slot: { totalRows: 2 },
          spec: { filters: [{ column: 'name', operator: '==', value: 'Alice' }] },
        },
      })
      render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)

      // Click clear filter — no confirm dialog
      fireEvent.click(screen.getByTestId('btn-clear-filter'))

      // filterModel should be cleared immediately
      await waitFor(() => {
        const result = useQueryStore.getState().tabs['tab-1']!.results[0]
        expect(result.view.spec.filters).toEqual([])
      })

      // Toast should be shown via real toast store
      const toasts = useToastStore.getState().toasts
      expect(toasts.some((t) => t.variant === 'success' && t.title === 'Filters cleared')).toBe(
        true
      )

      // No confirm dialog should appear
      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
    })

    it('disables both filter buttons while a row is being edited', () => {
      setupQueryTab({
        view: {
          spec: { filters: [{ column: 'name', operator: '==', value: 'Alice' }] },
          edit: {
            state: {
              rowKey: { id: 1 },
              originalValues: { id: 1, name: 'Alice' },
              currentValues: { id: 1, name: 'Alice' },
              modifiedColumns: new Set<string>(),
              isNewRow: false,
            },
            rowIndex: 0,
          },
        },
      })
      render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
      expect(screen.getByTestId('btn-filter')).toBeDisabled()
      expect(screen.getByTestId('btn-clear-filter')).toBeDisabled()
    })
  })

  describe('ResultPanel — Filter auto-populate from selectedCell', () => {
    it('filter dialog auto-populates with selected cell value', async () => {
      setupQueryTab({ view: { selection: { cell: { columnKey: 'name', value: 'Alice' } } } })
      render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)

      fireEvent.click(screen.getByTestId('btn-filter'))
      expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()

      // Should have a pre-populated filter row (not empty state)
      expect(screen.queryByTestId('filter-empty-state')).not.toBeInTheDocument()
      expect(screen.getByTestId('filter-row')).toBeInTheDocument()
      expect(screen.getByTestId('filter-column-select-0')).toHaveTextContent('name')
      expect(screen.getByTestId('filter-operator-select-0')).toHaveTextContent('==')
      expect(screen.getByTestId('filter-value-input')).toHaveValue('Alice')
      await waitFor(() => {
        expect(screen.getByTestId('filter-value-input')).toHaveFocus()
      })
    })

    it('filter dialog auto-populates IS NULL when cell value is null', () => {
      setupQueryTab({ view: { selection: { cell: { columnKey: 'name', value: null } } } })
      render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)

      fireEvent.click(screen.getByTestId('btn-filter'))
      expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()

      // Should have a pre-populated filter row with IS NULL
      expect(screen.queryByTestId('filter-empty-state')).not.toBeInTheDocument()
      expect(screen.getByTestId('filter-row')).toBeInTheDocument()
    })

    it('filter dialog opens with empty state when no selected cell and no filters', () => {
      setupQueryTab({ view: { selection: { cell: null }, spec: { filters: [] } } })
      render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)

      fireEvent.click(screen.getByTestId('btn-filter'))
      expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()
      expect(screen.getByTestId('filter-empty-state')).toBeInTheDocument()
    })
  })
})
