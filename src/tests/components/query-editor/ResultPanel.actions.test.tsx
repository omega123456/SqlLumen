import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FilterCondition, ForeignKeyColumnInfo } from '../../../types/schema'
import { ResultPanel } from '../../../components/query-editor/ResultPanel'
import { DEFAULT_RESULT_STATE, useQueryStore } from '../../../stores/query-store'
import { makeTabState } from '../../helpers/query-test-utils'

let capturedGridProps: Record<string, unknown> = {}
let capturedFormProps: Record<string, unknown> = {}
let capturedToolbarProps: Record<string, unknown> = {}
let capturedFilterDialogProps: Record<string, unknown> = {}
let capturedFkLookupDialogProps: Record<string, unknown> = {}
let capturedExportDialogProps: Record<string, unknown> = {}

vi.mock('../../../components/query-editor/ResultSubTabs', () => ({
  ResultSubTabs: ({ tabId }: { tabId: string }) => <div data-testid="result-subtabs">{tabId}</div>,
}))

vi.mock('../../../components/query-editor/ResultToolbar', () => ({
  ResultToolbar: (props: Record<string, unknown>) => {
    capturedToolbarProps = props
    return (
      <div data-testid="result-toolbar">
        <button data-testid="toolbar-open-filter" onClick={props.onFilterClick as () => void}>
          Filter
        </button>
        <button
          data-testid="toolbar-clear-filter"
          onClick={props.onClearFilterClick as () => void}
        >
          Clear
        </button>
        <span data-testid="toolbar-clone-disabled">{String(props.isCloneDisabled)}</span>
      </div>
    )
  },
}))

vi.mock('../../../components/query-editor/ResultGridView', async () => {
  const React = await import('react')
  const { useFkLookup } = await import('../../../components/shared/fk-lookup-context')

  return {
    ResultGridView: (props: Record<string, unknown>) => {
      capturedGridProps = props
      const fkLookup = useFkLookup()
      const defaultForeignKey: ForeignKeyColumnInfo = {
        columnName: 'role_id',
        referencedDatabase: 'appdb',
        referencedTable: 'roles',
        referencedColumn: 'id',
        constraintName: 'fk_users_role',
      }

      return React.createElement(
        'div',
        { 'data-testid': 'result-grid-view' },
        React.createElement(
          'button',
          {
            'data-testid': 'grid-trigger-fk',
            onClick: () =>
              fkLookup?.onFkLookup({
                columnKey: 'col_1',
                currentValue: 5,
                foreignKey: defaultForeignKey,
                rowData: { __rowIdx: 0, col_0: 1, col_1: 5 },
              }),
          },
          'FK'
        ),
        React.createElement(
          'button',
          {
            'data-testid': 'grid-trigger-unresolved-fk',
            onClick: () =>
              fkLookup?.onFkLookup({
                columnKey: 'col_99',
                currentValue: 5,
                foreignKey: defaultForeignKey,
                rowData: { __rowIdx: 0, col_99: 5 },
              }),
          },
          'Unresolved FK'
        )
      )
    },
  }
})

vi.mock('../../../components/query-editor/ResultFormView', () => ({
  ResultFormView: (props: Record<string, unknown>) => {
    capturedFormProps = props
    return <div data-testid="result-form-view">Form View</div>
  },
}))

vi.mock('../../../components/query-editor/ResultTextView', () => ({
  ResultTextView: ({ rows }: { rows: unknown[][] }) => (
    <div data-testid="result-text-view">{rows.length}</div>
  ),
}))

vi.mock('../../../components/dialogs/ExportDialog', () => ({
  default: (props: Record<string, unknown>) => {
    capturedExportDialogProps = props
    return (
      <button data-testid="export-dialog-close" onClick={props.onClose as () => void}>
        Close Export
      </button>
    )
  },
}))

vi.mock('../../../components/dialogs/FilterDialog', () => ({
  FilterDialog: (props: Record<string, unknown>) => {
    capturedFilterDialogProps = props
    if (!props.isOpen) return null

    const applyConditions: FilterCondition[] = [{ column: 'name', operator: '==', value: 'Alice' }]

    return (
      <div data-testid="filter-dialog-mock">
        <button
          data-testid="filter-dialog-apply"
          onClick={() => (props.onApply as (conditions: FilterCondition[]) => void)(applyConditions)}
        >
          Apply
        </button>
        <button data-testid="filter-dialog-cancel" onClick={props.onCancel as () => void}>
          Cancel
        </button>
      </div>
    )
  },
}))

vi.mock('../../../components/table-data/FkLookupDialog', () => ({
  FkLookupDialog: (props: Record<string, unknown>) => {
    capturedFkLookupDialogProps = props
    if (!props.isOpen) return null

    return (
      <div data-testid="fk-lookup-dialog-mock">
        <div data-testid="fk-lookup-database">{String(props.database)}</div>
        <div data-testid="fk-lookup-source-column">{String(props.sourceColumn)}</div>
        <button data-testid="fk-lookup-apply-same" onClick={() => props.onApply?.(props.currentValue)}>
          Apply Same
        </button>
        <button data-testid="fk-lookup-apply-new" onClick={() => props.onApply?.(9)}>
          Apply New
        </button>
        <button data-testid="fk-lookup-close" onClick={props.onClose as () => void}>
          Close
        </button>
      </div>
    )
  },
}))

vi.mock('../../../lib/context-menu-utils', () => ({
  writeClipboardText: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../lib/export-commands', () => ({
  exportResults: vi.fn().mockResolvedValue({ bytesWritten: 1024, rowsExported: 2 }),
}))

vi.mock('../../../lib/query-commands', () => ({
  executeQuery: vi.fn().mockResolvedValue({
    queryId: 'q1',
    columns: [],
    totalRows: 0,
    executionTimeMs: 0,
    affectedRows: 0,
    totalPages: 1,
    autoLimitApplied: false,
    firstPage: [],
  }),
  fetchResultPage: vi.fn().mockResolvedValue({ rows: [], page: 1, totalPages: 1 }),
  evictResults: vi.fn().mockResolvedValue(undefined),
  sortResults: vi.fn().mockResolvedValue({ rows: [], page: 1, totalPages: 1 }),
}))

vi.mock('../../../lib/table-data-commands', () => ({
  fetchTableData: vi.fn().mockResolvedValue({
    columns: [],
    rows: [],
    currentPage: 1,
    pageSize: 100,
    primaryKey: null,
    executionTimeMs: 0,
  }),
  updateTableRow: vi.fn().mockResolvedValue(undefined),
  insertTableRow: vi.fn().mockResolvedValue([]),
  deleteTableRow: vi.fn().mockResolvedValue(undefined),
  exportTableData: vi.fn().mockResolvedValue(undefined),
}))

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

beforeEach(() => {
  vi.clearAllMocks()
  capturedGridProps = {}
  capturedFormProps = {}
  capturedToolbarProps = {}
  capturedFilterDialogProps = {}
  capturedFkLookupDialogProps = {}
  capturedExportDialogProps = {}
  useQueryStore.setState({ tabs: {} })
  mockIPC(() => null)
})

describe('ResultPanel actions and states', () => {
  it('handles missing active-result fields via safe defaults', () => {
    renderPanel({
      columns: undefined,
      rows: undefined,
      totalRows: undefined,
      affectedRows: undefined,
      viewMode: undefined,
      sortColumn: undefined,
      sortDirection: undefined,
      selectedRowIndex: undefined,
      exportDialogOpen: undefined,
      editMode: undefined,
      editableColumnMap: undefined,
      editColumnBindings: undefined,
      editBoundColumnIndexMap: undefined,
      editState: undefined,
      editingRowIndex: undefined,
      editForeignKeys: undefined,
      saveError: undefined,
      isAnalyzingQuery: undefined,
    })

    expect(screen.getByTestId('dml-success')).toHaveTextContent('Query executed successfully')
  })

  it('renders running and error states with multi-result tabs', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          ...makeTabState({ connectionId: 'conn-1' }),
          tabStatus: 'running',
          results: [{ ...DEFAULT_RESULT_STATE, resultStatus: 'success' }],
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
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              columns: [{ name: 'id', dataType: 'INT' }],
              rows: [[1]],
              totalRows: 1,
            },
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'error',
              errorMessage: 'Broken query',
            },
          ],
        },
      },
    })

    rerender(<ResultPanel tabId="tab-1" connectionId="conn-1" />)

    expect(screen.getByTestId('result-subtabs')).toHaveTextContent('tab-1')
    expect(screen.getByText('Broken query')).toBeInTheDocument()
  })

  it('shows affected row count for DML success results', () => {
    renderPanel({ columns: [], rows: [], affectedRows: 3 })

    expect(screen.getByTestId('dml-success')).toHaveTextContent('Query executed: 3 rows affected')
  })

  it('delegates sort changes through navigation guarding and store sortResults', () => {
    const requestNavigationActionSpy = vi.spyOn(useQueryStore.getState(), 'requestNavigationAction')
    const sortResultsSpy = vi
      .spyOn(useQueryStore.getState(), 'sortResults')
      .mockResolvedValue(undefined)

    renderPanel()

    ;(capturedGridProps.onSortChanged as (column: string, direction: 'asc' | 'desc' | null) => void)(
      'name',
      'desc'
    )

    expect(requestNavigationActionSpy).toHaveBeenCalledWith('tab-1', expect.any(Function))
    expect(sortResultsSpy).toHaveBeenCalledWith('conn-1', 'tab-1', 'name', 'desc')
  })

  it('navigates form rows, saves form edits, and discards form edits', async () => {
    const setSelectedRowSpy = vi.spyOn(useQueryStore.getState(), 'setSelectedRow')
    const discardCurrentRowSpy = vi.spyOn(useQueryStore.getState(), 'discardCurrentRow')
    const saveCurrentRowSpy = vi
      .spyOn(useQueryStore.getState(), 'saveCurrentRow')
      .mockImplementation(async () => {
        useQueryStore.setState((state) => ({
          tabs: {
            ...state.tabs,
            'tab-1': {
              ...state.tabs['tab-1'],
              results: state.tabs['tab-1'].results.map((result, index) =>
                index === 0 ? { ...result, saveError: 'failed to save' } : result
              ),
            },
          },
        }))
        return false
      })

    const { rerender } = renderPanel({ viewMode: 'form', selectedRowIndex: 0 })

    act(() => {
      ;(capturedFormProps.onNavigate as (direction: 'prev' | 'next') => void)('next')
      ;(capturedFormProps.onNavigate as (direction: 'prev' | 'next') => void)('prev')
    })

    expect(setSelectedRowSpy).toHaveBeenCalledTimes(1)
    expect(setSelectedRowSpy).toHaveBeenCalledWith('tab-1', 1)

    useQueryStore.setState({
      tabs: {
        ...useQueryStore.getState().tabs,
        'tab-1': makeTabState({
          status: 'success',
          connectionId: 'conn-1',
          viewMode: 'form',
          selectedRowIndex: 1,
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
          queryId: 'q1',
        }),
      },
    })
    rerender(<ResultPanel tabId="tab-1" connectionId="conn-1" />)

    act(() => {
      ;(capturedFormProps.onNavigate as (direction: 'prev' | 'next') => void)('prev')
    })

    expect(setSelectedRowSpy).toHaveBeenCalledTimes(2)
    expect(setSelectedRowSpy).toHaveBeenLastCalledWith('tab-1', 0)

    await act(async () => {
      await expect((capturedFormProps.onSaveRow as () => Promise<boolean>)()).resolves.toBe(false)
    })
    expect(saveCurrentRowSpy).toHaveBeenCalledWith('tab-1')

    act(() => {
      ;(capturedFormProps.onDiscardRow as () => void)()
    })
    expect(discardCurrentRowSpy).toHaveBeenCalledWith('tab-1')
  })

  it('applies and cancels filter dialog interactions', async () => {
    const user = userEvent.setup()
    const applyQueryFiltersSpy = vi.spyOn(useQueryStore.getState(), 'applyQueryFilters')

    renderPanel()

    await user.click(screen.getByTestId('toolbar-open-filter'))
    expect(screen.getByTestId('filter-dialog-mock')).toBeInTheDocument()

    await user.click(screen.getByTestId('filter-dialog-apply'))

    expect(applyQueryFiltersSpy).toHaveBeenCalledWith('tab-1', 0, [
      { column: 'name', operator: '==', value: 'Alice' },
    ])

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
      expect(confirmNavigationSpy).toHaveBeenCalledWith('tab-1', true)
    })

    await user.click(screen.getByTestId('btn-discard-changes'))
    expect(confirmNavigationSpy).toHaveBeenCalledWith('tab-1', false)

    await user.click(screen.getByTestId('btn-cancel-changes'))
    expect(cancelNavigationSpy).toHaveBeenCalledWith('tab-1')
  })

  it('renders export dialog and closes it through the provided handler', async () => {
    const user = userEvent.setup()
    const closeExportDialogSpy = vi.spyOn(useQueryStore.getState(), 'closeExportDialog')

    renderPanel({ exportDialogOpen: true })

    expect(screen.getByTestId('export-dialog-close')).toBeInTheDocument()
    expect(capturedExportDialogProps.resultIndex).toBe(0)

    await user.click(screen.getByTestId('export-dialog-close'))

    expect(closeExportDialogSpy).toHaveBeenCalledWith('tab-1')
  })

  it('opens fk lookup, starts editing, and applies a new value', async () => {
    const user = userEvent.setup()
    const startEditingRowSpy = vi.spyOn(useQueryStore.getState(), 'startEditingRow')
    const setSelectedRowSpy = vi.spyOn(useQueryStore.getState(), 'setSelectedRow')
    const syncCellValueSpy = vi.spyOn(useQueryStore.getState(), 'syncCellValue')

    renderPanel({
      editMode: 'appdb.users',
      editColumnBindings: new Map([[1, 'role_id']]),
      editForeignKeys: [
        {
          columnName: 'role_id',
          referencedDatabase: 'appdb',
          referencedTable: 'roles',
          referencedColumn: 'id',
          constraintName: 'fk_users_role',
        },
      ],
      editTableMetadata: {
        'appdb.users': {
          database: 'appdb',
          table: 'users',
          columns: [],
          primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
          foreignKeys: [],
        },
      },
      editingRowIndex: null,
      editState: null,
    })

    await user.click(screen.getByTestId('grid-trigger-fk'))

    expect(screen.getByTestId('fk-lookup-dialog-mock')).toBeInTheDocument()
    expect(screen.getByTestId('fk-lookup-database')).toHaveTextContent('appdb')
    expect(screen.getByTestId('fk-lookup-source-column')).toHaveTextContent('role_id')
    expect(startEditingRowSpy).toHaveBeenCalledWith('tab-1', 0)
    expect(setSelectedRowSpy).toHaveBeenCalledWith('tab-1', 0)

    await user.click(screen.getByTestId('fk-lookup-apply-new'))

    expect(syncCellValueSpy).toHaveBeenCalledWith('tab-1', 1, 9)
    await waitFor(() => {
      expect(screen.queryByTestId('fk-lookup-dialog-mock')).not.toBeInTheDocument()
    })
  })

  it('does not open fk lookup when the target column cannot be resolved', async () => {
    const user = userEvent.setup()

    renderPanel({
      editMode: 'appdb.users',
      editColumnBindings: new Map([[1, 'role_id']]),
      editForeignKeys: [
        {
          columnName: 'role_id',
          referencedDatabase: 'appdb',
          referencedTable: 'roles',
          referencedColumn: 'id',
          constraintName: 'fk_users_role',
        },
      ],
    })

    await user.click(screen.getByTestId('grid-trigger-unresolved-fk'))

    expect(screen.queryByTestId('fk-lookup-dialog-mock')).not.toBeInTheDocument()
  })

  it('aborts fk lookup row switching when auto-save fails on a dirty row', async () => {
    const user = userEvent.setup()
    const saveCurrentRowSpy = vi
      .spyOn(useQueryStore.getState(), 'saveCurrentRow')
      .mockResolvedValue(false)
    const startEditingRowSpy = vi.spyOn(useQueryStore.getState(), 'startEditingRow')

    renderPanel({
      editMode: 'appdb.users',
      editColumnBindings: new Map([[1, 'role_id']]),
      editForeignKeys: [
        {
          columnName: 'role_id',
          referencedDatabase: 'appdb',
          referencedTable: 'roles',
          referencedColumn: 'id',
          constraintName: 'fk_users_role',
        },
      ],
      editTableMetadata: {
        'appdb.users': {
          database: 'appdb',
          table: 'users',
          columns: [],
          primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
          foreignKeys: [],
        },
      },
      editingRowIndex: 1,
      editState: {
        rowKey: { id: 2 },
        originalValues: { id: 2, role_id: 6 },
        currentValues: { id: 2, role_id: 8 },
        modifiedColumns: new Set(['role_id']),
        isNewRow: false,
      },
    })

    await user.click(screen.getByTestId('grid-trigger-fk'))

    expect(saveCurrentRowSpy).toHaveBeenCalledWith('tab-1')
    expect(startEditingRowSpy).not.toHaveBeenCalledWith('tab-1', 0)
    expect(screen.queryByTestId('fk-lookup-dialog-mock')).not.toBeInTheDocument()
  })

  it('reselects the current row and closes fk lookup when applying the same value', async () => {
    const user = userEvent.setup()
    const setSelectedRowSpy = vi.spyOn(useQueryStore.getState(), 'setSelectedRow')
    const syncCellValueSpy = vi.spyOn(useQueryStore.getState(), 'syncCellValue')

    renderPanel({
      editMode: 'appdb.users',
      editColumnBindings: new Map([[1, 'role_id']]),
      editForeignKeys: [
        {
          columnName: 'role_id',
          referencedDatabase: 'appdb',
          referencedTable: 'roles',
          referencedColumn: 'id',
          constraintName: 'fk_users_role',
        },
      ],
      editTableMetadata: {
        'appdb.users': {
          database: 'appdb',
          table: 'users',
          columns: [],
          primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
          foreignKeys: [],
        },
      },
      editingRowIndex: 0,
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, role_id: 5 },
        currentValues: { id: 1, role_id: 5 },
        modifiedColumns: new Set<string>(),
        isNewRow: false,
      },
    })

    await user.click(screen.getByTestId('grid-trigger-fk'))
    await user.click(screen.getByTestId('fk-lookup-apply-same'))

    expect(setSelectedRowSpy).toHaveBeenCalledWith('tab-1', 0)
    expect(syncCellValueSpy).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.queryByTestId('fk-lookup-dialog-mock')).not.toBeInTheDocument()
    })
  })
})
