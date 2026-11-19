import { patchedLegacyResult, resultState } from '../../../helpers/legacy-result-fields'
import React from 'react'
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ipc, expectToast } from '../../../ipc-mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FilterCondition } from '../../../../types/schema'
import { DataViewBody } from '../../../../components/shared/data-view/DataViewBody'
import { panelClassNameFor } from '../../../../components/shared/data-view/body/data-view-body-model'
import { queryDataViewSource } from '../../../../components/query-editor/result-panel/query-data-view-source'
import { queryToolbarReadiness } from '../../../../components/query-editor/result-panel/result-panel-model'
import {
  useQueryStore,
  querySurfaceRef,
  activeQuerySurfaceRef,
  getActiveResult,
} from '../../../../stores/query-store'
import { makeTabState, withRows } from '../../../helpers/query-test-utils'
import type { DataViewSource } from '../../../../components/shared/data-view/data-view-source'
import * as DataGridViewModule from '../../../../components/shared/data-view/DataGridView'
import * as DataFormViewModule from '../../../../components/shared/data-view/DataFormView'
import * as DataTextViewModule from '../../../../components/shared/data-view/DataTextView'
import * as FilterDialogModule from '../../../../components/dialogs/FilterDialog'
import { useToastStore } from '../../../../stores/toast-store'
import { tableSurfaceRef, useTableDataStore } from '../../../../stores/table-data-store'
import { setViewMode } from '../../../../stores/data-view/view-actions'
import { useTableDataViewSource } from '../../../../components/table-data/table-data-tab/table-data-view-source'
import { loadTablePage, setupTestConnection } from '../../../helpers/table-data-test-utils'
import { makeTableColumnMeta } from '../../../helpers/column-meta-fixtures'
import type { SingleResultState, TabQueryState } from '../../../../stores/query-store'

const BODY_TAB_ID = 'tab-1'

const NO_SLOTS = { editTarget: null, bands: null, exportDialog: null }

/** Renders the shared body over the query route's active result, as the result panel does. */
function renderBody() {
  const ref = querySurfaceRef(BODY_TAB_ID, 0)
  const result = getActiveResult(useQueryStore.getState().tabs[BODY_TAB_ID])
  return render(
    <DataViewBody
      source={queryDataViewSource({ ref: ref, isActive: true, isTruncated: false, canEdit: false })}
      slots={NO_SLOTS}
      readiness={queryToolbarReadiness(result, result.resultStatus)}
      panelAttributes={{}}
    />
  )
}

function setupBodyTab(overrides: Record<string, unknown> = {}) {
  act(() => {
    useQueryStore.setState({
      tabs: {
        [BODY_TAB_ID]: makeTabState({
          status: 'success',
          connectionId: 'conn-1',
          columns: [
            { name: 'id', dataType: 'INT' },
            { name: 'name', dataType: 'VARCHAR' },
          ],
          rows: [
            [1, 'Alice'],
            [2, 'Bob'],
          ],
          queryId: 'q1',
          ...overrides,
        }),
      },
    })
  })
}

function viewOfBodyTab() {
  return useQueryStore.getState().tabs[BODY_TAB_ID].results[0].view
}

describe('DataViewBody', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useQueryStore.setState({ tabs: {} })
    useToastStore.setState({ toasts: [] })
    vi.spyOn(DataGridViewModule.DataGridView, 'type').mockImplementation(
      ({ source }: { source: DataViewSource }) =>
        (
          <div data-testid="grid-view">Grid surface: {source.ref.tabId}</div>
        ) as unknown as React.ReactElement
    )
    vi.spyOn(DataFormViewModule, 'DataFormView').mockImplementation(
      ({ source }: { source: DataViewSource }) =>
        (
          <div data-testid="form-view">Form surface: {source.ref.tabId}</div>
        ) as unknown as React.ReactElement
    )
    vi.spyOn(DataTextViewModule, 'DataTextView').mockImplementation(
      ({ source }: { source: DataViewSource }) =>
        (
          <div data-testid="text-view">Text surface: {source.ref.tabId}</div>
        ) as unknown as React.ReactElement
    )
  })

  it('switching view mode changes the rendered view', async () => {
    const user = userEvent.setup()
    setupBodyTab()
    renderBody()
    act(() => useQueryStore.getState().setViewMode(activeQuerySurfaceRef(BODY_TAB_ID), 'form'))
    expect(await screen.findByTestId('form-view')).toHaveTextContent('Form surface: tab-1')
    act(() => useQueryStore.getState().setViewMode(activeQuerySurfaceRef(BODY_TAB_ID), 'text'))
    await user.click(document.body)
    expect(await screen.findByTestId('text-view')).toHaveTextContent('Text surface: tab-1')
  })

  it('keeps the grid instance and checked rows across a grid to form to grid switch', async () => {
    setupBodyTab()
    renderBody()
    const gridBeforeSwitch = screen.getByTestId('grid-view')
    act(() =>
      useQueryStore.getState().setCheckedRanges(activeQuerySurfaceRef(BODY_TAB_ID), [[0, 2]])
    )

    act(() => useQueryStore.getState().setViewMode(activeQuerySurfaceRef(BODY_TAB_ID), 'form'))
    expect(await screen.findByTestId('form-view')).toBeVisible()
    expect(gridBeforeSwitch).not.toBeVisible()

    act(() => useQueryStore.getState().setViewMode(activeQuerySurfaceRef(BODY_TAB_ID), 'grid'))
    expect(screen.getByTestId('grid-view')).toBe(gridBeforeSwitch)
    expect(gridBeforeSwitch).toBeVisible()
    expect(screen.queryByTestId('form-view')).not.toBeInTheDocument()
    expect(viewOfBodyTab().checked.ranges).toEqual([[0, 2]])
  })

  it('paint- and layout-contains a mounted grid view so it does not invalidate Monaco siblings', () => {
    const gridPanelUtilities = panelClassNameFor('grid', 3).split(' ')

    expect(gridPanelUtilities).toEqual(
      expect.arrayContaining(['contain-layout', 'contain-paint', 'contain-style', 'isolate'])
    )
  })

  it('applies and cancels filter dialog interactions', async () => {
    const user = userEvent.setup()
    vi.spyOn(FilterDialogModule, 'FilterDialog').mockImplementation((props) => {
      const p = props as unknown as Record<string, unknown>
      if (!p.isOpen) return null as unknown as React.ReactElement
      const applyConditions: FilterCondition[] = [
        { column: 'name', operator: '==', value: 'Alice' },
      ]
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
    setupBodyTab()
    renderBody()

    await user.click(screen.getByTestId('btn-filter'))
    expect(screen.getByTestId('filter-dialog-mock')).toBeInTheDocument()

    await user.click(screen.getByTestId('filter-dialog-apply'))

    await waitFor(() => {
      expect(ipc.payloads('set_result_view')[0]).toMatchObject({
        viewSpec: { filters: [{ column: 'name', operator: '==', value: 'Alice' }] },
      })
    })

    await user.click(screen.getByTestId('btn-filter'))
    await user.click(screen.getByTestId('filter-dialog-cancel'))

    await waitFor(() => {
      expect(screen.queryByTestId('filter-dialog-mock')).not.toBeInTheDocument()
    })
  })

  it('wires the unsaved changes dialog to save, discard and cancel', async () => {
    const user = userEvent.setup()
    const navigate = vi.fn()
    setupBodyTab({
      columns: [
        { name: 'id', dataType: 'INT' },
        { name: 'created_at', dataType: 'DATE' },
      ],
      rows: [[1, '2025-01-01']],
      editMode: 'users',
      editingRowIndex: 0,
      editingBaseIndex: 0,
      editTableMetadata: {
        users: {
          database: 'app',
          table: 'users',
          columns: [
            {
              name: 'created_at',
              dataType: 'date',
              isBooleanAlias: false,
              isNullable: true,
              isPrimaryKey: false,
              isUniqueKey: false,
              hasDefault: false,
              columnDefault: null,
              isBinary: false,
              isAutoIncrement: false,
            },
          ],
          primaryKey: { keyColumns: ['id'], isUniqueKeyFallback: false },
        },
      },
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, created_at: '2025-01-01' },
        currentValues: { id: 1, created_at: 'not-a-date' },
        modifiedColumns: new Set(['created_at']),
        isNewRow: false,
      },
      pendingNavigationAction: navigate,
      saveError: 'cannot save yet',
    })
    renderBody()

    expect(screen.getByTestId('unsaved-changes-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('unsaved-changes-error')).toHaveTextContent('cannot save yet')

    await user.click(screen.getByTestId('btn-save-changes'))
    await expectToast('error', 'Invalid date value')
    expect(navigate).not.toHaveBeenCalled()

    await user.click(screen.getByTestId('btn-cancel-changes'))
    expect(viewOfBodyTab().prompts.pendingNavigation).toBeNull()
    expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument()

    act(() => {
      useQueryStore.getState().requestNavigationAction(querySurfaceRef(BODY_TAB_ID, 0), navigate)
    })
    await user.click(screen.getByTestId('btn-discard-changes'))
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(viewOfBodyTab().edit.state).toBeNull()
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

  describe('Filter button state', () => {
    it('filter button is disabled when no columns', () => {
      setupQueryTab({ ...withRows([]), view: { slot: { columns: [] } } })
      renderBody()
      expect(screen.getByTestId('btn-filter')).toBeDisabled()
    })
  })

  describe('Clear filter', () => {
    it('clicking clear filter directly clears filters and shows toast', async () => {
      setupQueryTab({
        ...withRows([[1, 'Alice']]),
        view: {
          slot: { totalRows: 2 },
          spec: { filters: [{ column: 'name', operator: '==', value: 'Alice' }] },
        },
      })
      renderBody()

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
      renderBody()
      expect(screen.getByTestId('btn-filter')).toBeDisabled()
      expect(screen.getByTestId('btn-clear-filter')).toBeDisabled()
    })
  })

  describe('Filter auto-populate from selectedCell', () => {
    it('filter dialog auto-populates with selected cell value', async () => {
      setupQueryTab({ view: { selection: { cell: { columnKey: 'name', value: 'Alice' } } } })
      renderBody()

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
      renderBody()

      fireEvent.click(screen.getByTestId('btn-filter'))
      expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()

      // Should have a pre-populated filter row with IS NULL
      expect(screen.queryByTestId('filter-empty-state')).not.toBeInTheDocument()
      expect(screen.getByTestId('filter-row')).toBeInTheDocument()
    })

    it('filter dialog opens with empty state when no selected cell and no filters', () => {
      setupQueryTab({ view: { selection: { cell: null }, spec: { filters: [] } } })
      renderBody()

      fireEvent.click(screen.getByTestId('btn-filter'))
      expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()
      expect(screen.getByTestId('filter-empty-state')).toBeInTheDocument()
    })
  })
})

describe('DataViewBody on the table route', () => {
  const TABLE_TAB_ID = 'table-tab-1'

  function TableBody() {
    const source = useTableDataViewSource({ tabId: TABLE_TAB_ID, isActive: true, isView: false })
    return (
      <DataViewBody
        source={source}
        slots={NO_SLOTS}
        readiness={{ hasData: true, canInsertRows: true }}
        panelAttributes={{}}
      />
    )
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    useTableDataStore.setState({ tabs: {} })
    setupTestConnection()
    ipc.override('get_table_foreign_keys', () => [])
  })

  it('keeps the grid mounted and hidden while the form view is shown, and unmounts the form', async () => {
    await act(async () => {
      await loadTablePage(TABLE_TAB_ID, {
        columns: [
          makeTableColumnMeta({ name: 'id', dataType: 'bigint', isPrimaryKey: true }),
          makeTableColumnMeta({ name: 'name', dataType: 'varchar' }),
        ],
        rows: [
          [1, 'Alice'],
          [2, 'Bob'],
        ],
        primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
      })
    })
    render(<TableBody />)
    const gridBeforeSwitch = await screen.findByTestId('table-data-grid')

    await act(async () => {
      setViewMode(tableSurfaceRef(TABLE_TAB_ID), 'form')
    })

    await waitFor(() => {
      expect(screen.getByTestId('table-data-form-view')).toBeVisible()
    })
    expect(gridBeforeSwitch).not.toBeVisible()

    await act(async () => {
      setViewMode(tableSurfaceRef(TABLE_TAB_ID), 'grid')
    })

    expect(screen.getByTestId('table-data-grid')).toBe(gridBeforeSwitch)
    expect(gridBeforeSwitch).toBeVisible()
    expect(screen.queryByTestId('table-data-form-view')).not.toBeInTheDocument()
  })
})
