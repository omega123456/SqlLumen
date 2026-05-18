import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import * as canvasGridModule from '../../../components/shared/glide/CanvasBaseGridView'
import { useConnectionStore } from '../../../stores/connection-store'
import { useTableDataStore } from '../../../stores/table-data-store'
import { useToastStore } from '../../../stores/toast-store'
import type { TableDataTabState, TableDataColumnMeta, RowEditState } from '../../../types/schema'
import { TableDataFormView } from '../../../components/table-data/TableDataFormView'
import { expectToast, ipc } from '../../ipc-mock'
import { makeTableDataTabState, setupTestConnection } from '../../helpers/table-data-test-utils'

const originalCanvasBaseGridView = canvasGridModule.CanvasBaseGridView
const canvasCalls: unknown[] = []

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockColumns: TableDataColumnMeta[] = [
  {
    name: 'id',
    dataType: 'INT',
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
    dataType: 'VARCHAR',
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isBooleanAlias: false,
    isAutoIncrement: false,
  },
  {
    name: 'avatar',
    dataType: 'BLOB',
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: true,
    isBooleanAlias: false,
    isAutoIncrement: false,
  },
]

const mockRows: unknown[][] = [[1, 'Alice', '[BLOB - 128 bytes]']]
const mockPK = { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false }

function makeTabState(overrides: Partial<TableDataTabState> = {}): TableDataTabState {
  return makeTableDataTabState({
    columns: mockColumns,
    rows: mockRows,
    primaryKey: mockPK,
    executionTimeMs: 15,
    viewMode: 'form',
    selectedRowKey: { id: 1 },
    ...overrides,
  })
}

const setupConnection = setupTestConnection

function setupStore(overrides: Partial<TableDataTabState> = {}) {
  setupConnection()
  useTableDataStore.setState({
    tabs: {
      'tab-1': makeTabState(overrides),
    },
  })
}

function renderFormView() {
  return render(<TableDataFormView tabId="tab-1" />)
}

// --- Temporal column mock data ---

const mockColumnsWithTemporal: TableDataColumnMeta[] = [
  {
    name: 'id',
    dataType: 'INT',
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
    dataType: 'VARCHAR',
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isBooleanAlias: false,
    isAutoIncrement: false,
  },
  {
    name: 'created_at',
    dataType: 'DATETIME',
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isBooleanAlias: false,
    isAutoIncrement: false,
  },
  {
    name: 'login_time',
    dataType: 'TIME',
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isBooleanAlias: false,
    isAutoIncrement: false,
  },
  {
    name: 'avatar',
    dataType: 'BLOB',
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: true,
    isBooleanAlias: false,
    isAutoIncrement: false,
  },
]

const mockRowsWithTemporal: unknown[][] = [
  [1, 'Alice', '2023-06-15 10:30:00', '14:30:00', '[BLOB - 128 bytes]'],
]

function setupStoreWithTemporal(overrides: Partial<TableDataTabState> = {}) {
  setupConnection()
  useTableDataStore.setState({
    tabs: {
      'tab-1': makeTabState({
        columns: mockColumnsWithTemporal,
        rows: mockRowsWithTemporal,
        ...overrides,
      }),
    },
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  useTableDataStore.setState({ tabs: {} })
  useToastStore.setState({ toasts: [] })
  useConnectionStore.setState({ activeConnections: {}, activeTabId: null })
  ipc.override('fetch_table_data', () => ({
    columns: [],
    rows: [],
    currentPage: 1,
    pageSize: 1000,
    primaryKey: null,
    executionTimeMs: 0,
  }))
  ipc.override('update_table_row', () => undefined)
  canvasCalls.length = 0
  Object.defineProperty(canvasGridModule, 'CanvasBaseGridView', {
    configurable: true,
    value: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      canvasCalls.push(props)
      return React.createElement(originalCanvasBaseGridView as never, { ...props, ref })
    }),
  })

  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
    writable: true,
    configurable: true,
  })
})

describe('TableDataFormView', () => {
  it('renders form view with unknown-total record navigation', () => {
    setupStore()
    renderFormView()

    expect(screen.getByTestId('table-data-form-view')).toBeInTheDocument()
    expect(screen.getByText('Record 1')).toBeInTheDocument()
    expect(screen.queryByText('Record 1 of 1')).not.toBeInTheDocument()
  })

  it('shows all column fields', () => {
    setupStore()
    renderFormView()

    expect(screen.getByTestId('form-field-id')).toBeInTheDocument()
    expect(screen.getByTestId('form-field-name')).toBeInTheDocument()
    expect(screen.getByTestId('form-field-avatar')).toBeInTheDocument()
  })

  it('BLOB field renders as read-only (no <input>)', () => {
    setupStore()
    renderFormView()

    const avatarInput = screen.getByTestId('form-input-avatar')
    // BLOB fields should be rendered as a div, not an input
    expect(avatarInput.tagName).toBe('DIV')
  })

  it('PK field label shows "(Primary Key)"', () => {
    setupStore()
    renderFormView()

    const idField = screen.getByTestId('form-field-id')
    expect(idField).toHaveTextContent('(Primary Key)')
  })

  it('NULL toggle button shown for nullable fields', () => {
    setupStore()
    renderFormView()

    // 'name' is nullable, so it should have a NULL toggle
    expect(screen.getByTestId('btn-null-name')).toBeInTheDocument()
  })

  it('NULL toggle button NOT shown for non-nullable fields', () => {
    setupStore()
    renderFormView()

    // 'id' is not nullable
    expect(screen.queryByTestId('btn-null-id')).not.toBeInTheDocument()
  })

  it('clicking NULL toggle updates cell value to null', () => {
    setupStore()
    renderFormView()

    const nullBtn = screen.getByTestId('btn-null-name')
    fireEvent.click(nullBtn)

    // After clicking NULL toggle, the store should have an editState with null for 'name'
    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState).not.toBeNull()
    expect(state?.editState?.currentValues.name).toBeNull()
  })

  it('modified field shows glow indicator + "Unsaved change detected"', () => {
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { id: 1, name: 'Alice', avatar: '[BLOB - 128 bytes]' },
      currentValues: { id: 1, name: 'Alice Modified', avatar: '[BLOB - 128 bytes]' },
      modifiedColumns: new Set(['name']),
      isNewRow: false,
    }

    setupStore({ editState })
    renderFormView()

    // Should show the "Unsaved change detected" text
    expect(screen.getByText('Unsaved change detected')).toBeInTheDocument()

    // The name input should have the modified class
    const nameInput = screen.getByTestId('form-input-name')
    expect(nameInput.className).toContain('Modified')
  })

  it('Previous button disabled on first record', () => {
    setupStore()
    renderFormView()

    const prevBtn = screen.getByTestId('btn-form-previous')
    expect(prevBtn).toBeDisabled()
  })

  it('Next button stays enabled for optimistic unknown-total navigation', () => {
    setupStore()
    renderFormView()

    const nextBtn = screen.getByTestId('btn-form-next')
    expect(nextBtn).not.toBeDisabled()
  })

  it('Save button disabled when no changes', () => {
    setupStore()
    renderFormView()

    const saveBtn = screen.getByTestId('btn-form-save')
    expect(saveBtn).toBeDisabled()
  })

  it('Discard button disabled when no editState', () => {
    setupStore()
    renderFormView()

    const discardBtn = screen.getByTestId('btn-form-discard')
    expect(discardBtn).toBeDisabled()
  })

  it('Copy button copies value to clipboard', async () => {
    setupStore()
    renderFormView()

    const copyBtn = screen.getByTestId('btn-copy-name')
    fireEvent.click(copyBtn)

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Alice')
  })

  it('shows empty state when rows is empty', () => {
    setupStore({ rows: [] })
    renderFormView()

    expect(screen.getByText('No rows to display')).toBeInTheDocument()
  })

  it('Previous and Next enabled with multiple records', () => {
    setupStore({
      rows: [
        [1, 'Alice', null],
        [2, 'Bob', null],
      ],
      selectedRowKey: { id: 1 },
    })
    renderFormView()

    expect(screen.getByTestId('btn-form-previous')).toBeDisabled()
    expect(screen.getByTestId('btn-form-next')).not.toBeDisabled()
  })

  it('Save button enabled when there are modifications', () => {
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { id: 1, name: 'Alice', avatar: '[BLOB - 128 bytes]' },
      currentValues: { id: 1, name: 'Changed', avatar: '[BLOB - 128 bytes]' },
      modifiedColumns: new Set(['name']),
      isNewRow: false,
    }

    setupStore({ editState })
    renderFormView()

    expect(screen.getByTestId('btn-form-save')).not.toBeDisabled()
    expect(screen.getByTestId('btn-form-discard')).not.toBeDisabled()
  })

  it('NULL toggle button not shown for BLOB fields even if nullable', () => {
    // avatar is nullable + binary — NULL toggle should not appear
    setupStore()
    renderFormView()

    expect(screen.queryByTestId('btn-null-avatar')).not.toBeInTheDocument()
  })

  it('fields are read-only when connection is read-only', () => {
    setupConnection(true) // read-only
    useTableDataStore.setState({
      tabs: { 'tab-1': makeTabState() },
    })
    renderFormView()

    // Inputs should be rendered as divs (readonly) instead of inputs
    const idInput = screen.getByTestId('form-input-id')
    expect(idInput.tagName).toBe('DIV')

    const nameInput = screen.getByTestId('form-input-name')
    expect(nameInput.tagName).toBe('DIV')
  })

  it('renders FK lookup trigger for FK-backed form fields', () => {
    setupStore({
      columns: [
        mockColumns[0],
        {
          name: 'user_id',
          dataType: 'INT',
          isNullable: false,
          isPrimaryKey: false,
          isUniqueKey: false,
          hasDefault: false,
          columnDefault: null,
          isBinary: false,
          isBooleanAlias: false,
          isAutoIncrement: false,
        },
      ],
      rows: [[1, 42]],
      selectedRowKey: { id: 1 },
      foreignKeys: [
        {
          columnName: 'user_id',
          referencedDatabase: 'mydb',
          referencedTable: 'users',
          referencedColumn: 'id',
          constraintName: 'fk_orders_user',
        },
      ],
    })

    renderFormView()

    expect(screen.getByTestId('fk-lookup-trigger')).toBeInTheDocument()
  })

  it('opens FK lookup dialog when form FK trigger is clicked', async () => {
    ipc.override('fetch_table_data', () => ({
      columns: [mockColumns[0]],
      rows: [[1]],
      currentPage: 1,
      pageSize: 100,
      primaryKey: mockPK,
      executionTimeMs: 4,
    }))

    setupStore({
      columns: [
        mockColumns[0],
        {
          name: 'user_id',
          dataType: 'INT',
          isNullable: false,
          isPrimaryKey: false,
          isUniqueKey: false,
          hasDefault: false,
          columnDefault: null,
          isBinary: false,
          isBooleanAlias: false,
          isAutoIncrement: false,
        },
      ],
      rows: [[1, 42]],
      selectedRowKey: { id: 1 },
      foreignKeys: [
        {
          columnName: 'user_id',
          referencedDatabase: 'mydb',
          referencedTable: 'users',
          referencedColumn: 'id',
          constraintName: 'fk_orders_user',
        },
      ],
    })

    renderFormView()

    fireEvent.click(screen.getByTestId('fk-lookup-trigger'))

    await waitFor(() => {
      expect(screen.getByTestId('fk-lookup-dialog')).toBeInTheDocument()
    })
    expect(
      ipc.calls('fetch_table_data').some(
        (call) => (call as Record<string, unknown>)?.database === 'mydb'
      )
    ).toBe(true)
  })

  it('uses referencedDatabase for cross-database FK lookups', async () => {
    ipc.override('fetch_table_data', () => ({
      columns: [mockColumns[0]],
      rows: [[1]],
      currentPage: 1,
      pageSize: 100,
      primaryKey: mockPK,
      executionTimeMs: 4,
    }))

    setupStore({
      columns: [
        mockColumns[0],
        {
          name: 'user_id',
          dataType: 'INT',
          isNullable: false,
          isPrimaryKey: false,
          isUniqueKey: false,
          hasDefault: false,
          columnDefault: null,
          isBinary: false,
          isBooleanAlias: false,
          isAutoIncrement: false,
        },
      ],
      rows: [[1, 42]],
      selectedRowKey: { id: 1 },
      foreignKeys: [
        {
          columnName: 'user_id',
          referencedDatabase: 'accounts_db',
          referencedTable: 'users',
          referencedColumn: 'id',
          constraintName: 'fk_orders_user',
        },
      ],
    })

    renderFormView()

    fireEvent.click(screen.getByTestId('fk-lookup-trigger'))

    await waitFor(() => {
      expect(screen.getByTestId('fk-lookup-dialog')).toBeInTheDocument()
    })
    expect(
      ipc.calls('fetch_table_data').some(
        (call) => (call as Record<string, unknown>)?.database === 'accounts_db'
      )
    ).toBe(true)
  })

  it('applies selected FK values back into table data form state', async () => {
    ipc.override('fetch_table_data', () => ({
      columns: [mockColumns[0]],
      rows: [[1]],
      currentPage: 1,
      pageSize: 100,
      primaryKey: mockPK,
      executionTimeMs: 4,
    }))

    setupStore({
      columns: [
        mockColumns[0],
        {
          name: 'user_id',
          dataType: 'INT',
          isNullable: false,
          isPrimaryKey: false,
          isUniqueKey: false,
          hasDefault: false,
          columnDefault: null,
          isBinary: false,
          isBooleanAlias: false,
          isAutoIncrement: false,
        },
      ],
      rows: [[1, 42]],
      selectedRowKey: { id: 1 },
      foreignKeys: [
        {
          columnName: 'user_id',
          referencedDatabase: 'mydb',
          referencedTable: 'users',
          referencedColumn: 'id',
          constraintName: 'fk_orders_user',
        },
      ],
    })

    renderFormView()

    fireEvent.click(screen.getByTestId('fk-lookup-trigger'))
    await waitFor(() => {
      expect(screen.getByTestId('fk-lookup-dialog')).toBeInTheDocument()
    })

    const gridProps = canvasCalls[canvasCalls.length - 1] as {
      rows: Record<string, unknown>[]
      onRowClick: (row: Record<string, unknown>) => void
    }
    await act(async () => {
      gridProps.onRowClick(gridProps.rows[0])
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('fk-lookup-apply'))
    })

    await waitFor(() => {
      const userInput = screen.getByTestId('form-input-user_id') as HTMLInputElement
      expect(userInput.value).toBe('1')
    })
  })

  it('displays correct record position with pagination', () => {
    setupStore({
      currentPage: 3,
      pageSize: 10,
      selectedRowKey: { id: 1 },
    })
    renderFormView()

    expect(screen.getByText('Record 21')).toBeInTheDocument()
    expect(screen.queryByText(/of 50/)).not.toBeInTheDocument()
  })

  it('unique key field label shows "(Unique Key)"', () => {
    const columnsWithUnique: TableDataColumnMeta[] = [
      {
        name: 'email',
        dataType: 'VARCHAR',
        isNullable: true,
        isPrimaryKey: false,
        isUniqueKey: true,
        hasDefault: false,
        columnDefault: null,
        isBinary: false,
        isBooleanAlias: false,
        isAutoIncrement: false,
      },
    ]

    setupStore({
      columns: columnsWithUnique,
      rows: [['test@example.com']],
      primaryKey: {
        keyColumns: ['email'],
        hasAutoIncrement: false,
        isUniqueKeyFallback: true,
      },
      selectedRowKey: { email: 'test@example.com' },
    })
    renderFormView()

    const emailField = screen.getByTestId('form-field-email')
    expect(emailField).toHaveTextContent('(Unique Key)')
  })

  it('clicking Next navigates to next record on same page', () => {
    setupStore({
      rows: [
        [1, 'Alice', null],
        [2, 'Bob', null],
      ],
      selectedRowKey: { id: 1 },
    })
    renderFormView()

    expect(screen.getByText('Record 1')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('btn-form-next'))

    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.selectedRowKey).toEqual({ id: 2 })
  })

  it('clicking Previous navigates to previous record on same page', () => {
    setupStore({
      rows: [
        [1, 'Alice', null],
        [2, 'Bob', null],
      ],
      selectedRowKey: { id: 2 },
    })
    renderFormView()

    fireEvent.click(screen.getByTestId('btn-form-previous'))

    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.selectedRowKey).toEqual({ id: 1 })
  })

  it('typing in an input field triggers editing and updates value', () => {
    setupStore()
    renderFormView()

    const nameInput = screen.getByTestId('form-input-name') as HTMLInputElement
    fireEvent.focus(nameInput)
    fireEvent.change(nameInput, { target: { value: 'NewName' } })

    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState).not.toBeNull()
    expect(state?.editState?.currentValues.name).toBe('NewName')
  })

  it('enum fields render as dropdowns and update through selection', async () => {
    const user = userEvent.setup()
    const enumColumns: TableDataColumnMeta[] = [
      mockColumns[0],
      {
        name: 'status',
        dataType: 'ENUM',
        isNullable: true,
        isPrimaryKey: false,
        isUniqueKey: false,
        hasDefault: false,
        columnDefault: null,
        isBinary: false,
        isAutoIncrement: false,
        enumValues: ['active', 'disabled'],
      } as TableDataColumnMeta,
    ]

    setupStore({
      columns: enumColumns,
      rows: [[1, 'active']],
      selectedRowKey: { id: 1 },
    })
    renderFormView()

    const statusField = screen.getByTestId('form-input-status')
    expect(statusField).toHaveAttribute('role', 'combobox')

    await user.click(statusField)
    await user.click(screen.getByRole('option', { name: 'disabled' }))

    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState).not.toBeNull()
    expect(state?.editState?.currentValues.status).toBe('disabled')
  })

  it('nullable enum select writes null when NULL option is selected', async () => {
    const user = userEvent.setup()
    const enumColumns: TableDataColumnMeta[] = [
      mockColumns[0],
      {
        name: 'status',
        dataType: 'ENUM',
        isNullable: true,
        isPrimaryKey: false,
        isUniqueKey: false,
        hasDefault: false,
        columnDefault: null,
        isBinary: false,
        isAutoIncrement: false,
        enumValues: ['active', 'disabled'],
      } as TableDataColumnMeta,
    ]

    setupStore({
      columns: enumColumns,
      rows: [[1, 'active']],
      selectedRowKey: { id: 1 },
    })
    renderFormView()

    const statusField = screen.getByTestId('form-input-status')
    await user.click(statusField)
    await user.click(screen.getByRole('option', { name: 'NULL' }))

    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState?.currentValues.status).toBeNull()
  })

  it('NULL toggle off on enum field picks the first enum option instead of empty string', () => {
    const enumColumn = {
      name: 'status',
      dataType: 'ENUM',
      isNullable: true,
      isPrimaryKey: false,
      isUniqueKey: false,
      hasDefault: false,
      columnDefault: null,
      isBinary: false,
      isAutoIncrement: false,
      enumValues: ['active', 'disabled'],
    } as TableDataColumnMeta

    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { id: 1, status: null },
      currentValues: { id: 1, status: null },
      modifiedColumns: new Set<string>(),
      isNewRow: false,
    }

    setupStore({
      columns: [mockColumns[0], enumColumn],
      rows: [[1, null]],
      selectedRowKey: { id: 1 },
      editState,
    })
    renderFormView()

    fireEvent.click(screen.getByTestId('btn-null-status'))

    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState?.currentValues.status).toBe('active')
  })

  it('null values remain editable in form view', () => {
    setupStore({
      rows: [[1, null, '[BLOB - 128 bytes]']],
      selectedRowKey: { id: 1 },
    })
    renderFormView()

    const nameInput = screen.getByTestId('form-input-name') as HTMLInputElement

    expect(nameInput.disabled).toBe(false)
    expect(nameInput.value).toBe('')

    fireEvent.focus(nameInput)
    fireEvent.change(nameInput, { target: { value: 'Filled in' } })

    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState?.currentValues.name).toBe('Filled in')
    expect(screen.getByTestId('btn-form-save')).not.toBeDisabled()
  })

  it('new rows start with editable empty inputs in form view', () => {
    setupStore()
    useTableDataStore.getState().insertNewRow('tab-1')
    useTableDataStore.getState().setViewMode('tab-1', 'form')
    renderFormView()

    const nameInput = screen.getByTestId('form-input-name') as HTMLInputElement
    expect(nameInput.disabled).toBe(false)
    expect(nameInput.value).toBe('')
  })

  it('temp row shows correct record number without total count', () => {
    setupStore()
    useTableDataStore.getState().insertNewRow('tab-1')
    useTableDataStore.getState().setViewMode('tab-1', 'form')
    renderFormView()

    expect(screen.getByText('Record 2')).toBeInTheDocument()
    expect(screen.queryByText(/of/)).not.toBeInTheDocument()
  })

  it('null toggle OFF sets value to empty string', () => {
    // Start with a row where name is null
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { id: 1, name: null, avatar: '[BLOB - 128 bytes]' },
      currentValues: { id: 1, name: null, avatar: '[BLOB - 128 bytes]' },
      modifiedColumns: new Set<string>(),
      isNewRow: false,
    }

    setupStore({
      rows: [[1, null, '[BLOB - 128 bytes]']],
      editState,
    })
    renderFormView()

    // Click NULL toggle on 'name' — should set value to empty string
    const nullBtn = screen.getByTestId('btn-null-name')
    fireEvent.click(nullBtn)

    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState?.currentValues.name).toBe('')
  })

  it('copy button copies NULL as "NULL" string for null values', async () => {
    setupStore({
      rows: [[1, null, '[BLOB - 128 bytes]']],
      selectedRowKey: { id: 1 },
    })
    renderFormView()

    const copyBtn = screen.getByTestId('btn-copy-name')
    fireEvent.click(copyBtn)

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('NULL')
  })

  it('Save button calls saveCurrentRow', async () => {
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { id: 1, name: 'Alice', avatar: '[BLOB - 128 bytes]' },
      currentValues: { id: 1, name: 'Changed', avatar: '[BLOB - 128 bytes]' },
      modifiedColumns: new Set(['name']),
      isNewRow: false,
    }
    setupStore({ editState })
    renderFormView()

    const saveBtn = screen.getByTestId('btn-form-save')
    expect(saveBtn).not.toBeDisabled()
    fireEvent.click(saveBtn)
    await waitFor(() => {
      expect(ipc.calls('update_table_row').length).toBeGreaterThan(0)
    })
  })

  it('Discard button calls discardCurrentRow', () => {
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { id: 1, name: 'Alice', avatar: '[BLOB - 128 bytes]' },
      currentValues: { id: 1, name: 'Changed', avatar: '[BLOB - 128 bytes]' },
      modifiedColumns: new Set(['name']),
      isNewRow: false,
    }
    setupStore({ editState })
    renderFormView()

    fireEvent.click(screen.getByTestId('btn-form-discard'))

    const state = useTableDataStore.getState().tabs['tab-1']
    // After discard, editState should be cleared
    expect(state?.editState).toBeNull()
  })

  it('fields are read-only when no primary key', () => {
    setupConnection() // writable connection
    useTableDataStore.setState({
      tabs: { 'tab-1': makeTabState({ primaryKey: null }) },
    })
    renderFormView()

    // Without PK, inputs should be rendered as divs
    const idInput = screen.getByTestId('form-input-id')
    expect(idInput.tagName).toBe('DIV')
  })

  it('fields are read-only when isView=true even with PK', () => {
    setupConnection() // writable connection
    useTableDataStore.setState({
      tabs: { 'tab-1': makeTabState() }, // has PK
    })
    render(<TableDataFormView tabId="tab-1" isView={true} />)

    // With isView=true, inputs should be rendered as read-only divs
    const idInput = screen.getByTestId('form-input-id')
    expect(idInput.tagName).toBe('DIV')

    const nameInput = screen.getByTestId('form-input-name')
    expect(nameInput.tagName).toBe('DIV')

    // Save and discard buttons should not be present
    expect(screen.queryByTestId('btn-form-save')).not.toBeInTheDocument()
    expect(screen.queryByTestId('btn-form-discard')).not.toBeInTheDocument()

    // NULL toggle should not be shown for read-only views
    expect(screen.queryByTestId('btn-null-name')).not.toBeInTheDocument()
  })

  it('BLOB field shows data when value is not null', () => {
    setupStore()
    renderFormView()

    const avatarField = screen.getByTestId('form-input-avatar')
    expect(avatarField).toHaveTextContent('[BLOB - 128 bytes]')
  })

  it('BLOB field shows "(BLOB data)" when value is null', () => {
    setupStore({
      rows: [[1, 'Alice', null]],
      selectedRowKey: { id: 1 },
    })
    renderFormView()

    const avatarField = screen.getByTestId('form-input-avatar')
    expect(avatarField).toHaveTextContent('(BLOB data)')
  })

  it('displays edited value from editState instead of raw row data', () => {
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { id: 1, name: 'Alice', avatar: '[BLOB - 128 bytes]' },
      currentValues: { id: 1, name: 'Edited', avatar: '[BLOB - 128 bytes]' },
      modifiedColumns: new Set(['name']),
      isNewRow: false,
    }
    setupStore({ editState })
    renderFormView()

    const nameInput = screen.getByTestId('form-input-name') as HTMLInputElement
    expect(nameInput.value).toBe('Edited')
  })

  it('input stays editable and empty for null values in edit state', () => {
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { id: 1, name: 'Alice', avatar: '[BLOB - 128 bytes]' },
      currentValues: { id: 1, name: null, avatar: '[BLOB - 128 bytes]' },
      modifiedColumns: new Set(['name']),
      isNewRow: false,
    }
    setupStore({ editState })
    renderFormView()

    const nameInput = screen.getByTestId('form-input-name') as HTMLInputElement
    expect(nameInput.value).toBe('')
    expect(nameInput.disabled).toBe(false)
  })

  it('shows read-only input for non-editable non-blob fields with non-null value', () => {
    setupConnection(true) // read-only connection
    useTableDataStore.setState({
      tabs: { 'tab-1': makeTabState() },
    })
    renderFormView()

    const nameInput = screen.getByTestId('form-input-name')
    expect(nameInput.tagName).toBe('DIV')
    expect(nameInput).toHaveTextContent('Alice')
  })

  it('read-only field displays "NULL" when value is null', () => {
    setupConnection(true) // read-only
    useTableDataStore.setState({
      tabs: {
        'tab-1': makeTabState({
          rows: [[1, null, '[BLOB - 128 bytes]']],
          selectedRowKey: { id: 1 },
        }),
      },
    })
    renderFormView()

    const nameInput = screen.getByTestId('form-input-name')
    expect(nameInput).toHaveTextContent('NULL')
  })

  it('NULL toggle button not shown for read-only connection', () => {
    setupConnection(true)
    useTableDataStore.setState({
      tabs: { 'tab-1': makeTabState() },
    })
    renderFormView()

    expect(screen.queryByTestId('btn-null-name')).not.toBeInTheDocument()
  })

  it('handles cross-page navigation next', async () => {
    setupStore({
      rows: [[1, 'Alice', null]],
      currentPage: 1,
      pageSize: 1,
      selectedRowKey: { id: 1 },
    })
    renderFormView()

    expect(screen.getByText('Record 1')).toBeInTheDocument()
    const nextBtn = screen.getByTestId('btn-form-next')
    expect(nextBtn).not.toBeDisabled()
    fireEvent.click(nextBtn)
    await waitFor(() => {
      expect(ipc.calls('fetch_table_data').some((c) => (c as Record<string, unknown>)?.page === 2)).toBe(true)
    })
  })

  it('navigates to first row of next page from a short page', async () => {
    setupStore({
      rows: [[1, 'Alice', null]],
      currentPage: 1,
      pageSize: 2,
      selectedRowKey: { id: 1 },
    })

    const fetchPageSpy = vi
      .spyOn(useTableDataStore.getState(), 'fetchPage')
      .mockImplementation(async (tabId: string, page: number) => {
        useTableDataStore.setState((state) => ({
          tabs: {
            ...state.tabs,
            [tabId]: {
              ...state.tabs[tabId],
              rows: [[2, 'Bob', null]],
              currentPage: page,
              selectedRowKey: null,
            },
          },
        }))
      })

    renderFormView()

    fireEvent.click(screen.getByTestId('btn-form-next'))

    await waitFor(() => {
      expect(fetchPageSpy).toHaveBeenCalledWith('tab-1', 2)
    })

    await waitFor(() => {
      expect(useTableDataStore.getState().tabs['tab-1']?.selectedRowKey).toEqual({ id: 2 })
    })

    fetchPageSpy.mockRestore()
  })

  it('Next button remains enabled on last loaded record', () => {
    setupStore({
      rows: [[1, 'Alice', null]],
      currentPage: 1,
      pageSize: 1000,
      selectedRowKey: { id: 1 },
    })
    renderFormView()

    expect(screen.getByTestId('btn-form-next')).not.toBeDisabled()
  })

  it('Previous button disabled when loading', () => {
    setupStore({
      rows: [
        [1, 'Alice', null],
        [2, 'Bob', null],
      ],
      selectedRowKey: { id: 2 },
      isLoading: true,
    })
    renderFormView()

    expect(screen.getByTestId('btn-form-previous')).toBeDisabled()
  })
})

// ---------------------------------------------------------------------------
// DateTimePicker integration tests
// ---------------------------------------------------------------------------

describe('TableDataFormView — DateTimePicker integration', () => {
  it('temporal columns render a calendar/clock icon button', () => {
    setupStoreWithTemporal()
    renderFormView()

    expect(screen.getByTestId('calendar-btn-created_at')).toBeInTheDocument()
    expect(screen.getByTestId('calendar-btn-login_time')).toBeInTheDocument()
  })

  it('non-temporal columns do NOT render a calendar icon', () => {
    setupStoreWithTemporal()
    renderFormView()

    expect(screen.queryByTestId('calendar-btn-id')).not.toBeInTheDocument()
    expect(screen.queryByTestId('calendar-btn-name')).not.toBeInTheDocument()
  })

  it('BLOB columns do not render a calendar icon', () => {
    setupStoreWithTemporal()
    renderFormView()

    expect(screen.queryByTestId('calendar-btn-avatar')).not.toBeInTheDocument()
  })

  it('DATE/DATETIME/TIMESTAMP columns have aria-label "Open date picker"', () => {
    setupStoreWithTemporal()
    renderFormView()

    const calBtn = screen.getByTestId('calendar-btn-created_at')
    expect(calBtn).toHaveAttribute('aria-label', 'Open date picker')
  })

  it('TIME columns have aria-label "Open time picker"', () => {
    setupStoreWithTemporal()
    renderFormView()

    const clockBtn = screen.getByTestId('calendar-btn-login_time')
    expect(clockBtn).toHaveAttribute('aria-label', 'Open time picker')
  })

  it('clicking the calendar icon opens the DateTimePicker', async () => {
    setupStoreWithTemporal()
    renderFormView()
    const user = userEvent.setup()

    // No picker initially
    expect(screen.queryByTestId('date-time-picker-popup')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('calendar-btn-created_at'))

    await waitFor(() => {
      expect(screen.getByTestId('date-time-picker-popup')).toBeInTheDocument()
    })
  })

  it('picker onApply updates the field value via the store', async () => {
    setupStoreWithTemporal()
    renderFormView()
    const user = userEvent.setup()

    // Open picker
    await user.click(screen.getByTestId('calendar-btn-created_at'))
    await waitFor(() => {
      expect(screen.getByTestId('date-time-picker-popup')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('btn-picker-apply'))

    await waitFor(() => {
      const state = useTableDataStore.getState().tabs['tab-1']
      expect(state?.editState).not.toBeNull()
      expect(state?.editState?.currentValues.created_at).toBe('2023-06-15 10:30:00')
    })
  })

  it('picker onCancel closes the popup without changing the value', async () => {
    setupStoreWithTemporal()
    renderFormView()
    const user = userEvent.setup()

    // Open picker
    await user.click(screen.getByTestId('calendar-btn-created_at'))
    expect(screen.getByTestId('date-time-picker-popup')).toBeInTheDocument()

    await user.click(screen.getByTestId('btn-picker-cancel'))
    await waitFor(() => {
      expect(screen.queryByTestId('date-time-picker-popup')).not.toBeInTheDocument()
    })
  })

  it('only one picker is open at a time', async () => {
    setupStoreWithTemporal()
    renderFormView()
    const user = userEvent.setup()

    // Open picker for created_at
    await user.click(screen.getByTestId('calendar-btn-created_at'))
    await waitFor(() => {
      expect(screen.getAllByTestId('date-time-picker-popup')).toHaveLength(1)
    })

    // Open picker for login_time (should replace the first)
    await user.click(screen.getByTestId('calendar-btn-login_time'))
    await waitFor(() => {
      expect(screen.getAllByTestId('date-time-picker-popup')).toHaveLength(1)
    })
  })

  it('NULL toggle off on a temporal field sets today date instead of empty string', () => {
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: {
        id: 1,
        name: 'Alice',
        created_at: null,
        login_time: '14:30:00',
        avatar: '[BLOB - 128 bytes]',
      },
      currentValues: {
        id: 1,
        name: 'Alice',
        created_at: null,
        login_time: '14:30:00',
        avatar: '[BLOB - 128 bytes]',
      },
      modifiedColumns: new Set<string>(),
      isNewRow: false,
    }

    setupStoreWithTemporal({
      rows: [[1, 'Alice', null, '14:30:00', '[BLOB - 128 bytes]']],
      editState,
    })
    renderFormView()

    // Click NULL toggle on created_at (which is currently null → toggles NULL off)
    const nullBtn = screen.getByTestId('btn-null-created_at')
    fireEvent.click(nullBtn)

    const state = useTableDataStore.getState().tabs['tab-1']
    const value = state?.editState?.currentValues.created_at as string
    // Should NOT be empty string — should be today's date in YYYY-MM-DD HH:MM:SS format
    expect(value).not.toBe('')
    expect(value).not.toBeNull()
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('read-only temporal columns do not show calendar button', () => {
    setupConnection(true) // read-only
    useTableDataStore.setState({
      tabs: {
        'tab-1': makeTabState({
          columns: mockColumnsWithTemporal,
          rows: mockRowsWithTemporal,
        }),
      },
    })
    renderFormView()

    expect(screen.queryByTestId('calendar-btn-created_at')).not.toBeInTheDocument()
    expect(screen.queryByTestId('calendar-btn-login_time')).not.toBeInTheDocument()
  })

  it('direct typing in text input still works for temporal fields', () => {
    setupStoreWithTemporal()
    renderFormView()

    const input = screen.getByTestId('form-input-created_at') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '2023-12-25 00:00:00' } })

    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState).not.toBeNull()
    expect(state?.editState?.currentValues.created_at).toBe('2023-12-25 00:00:00')
  })

  it('temporal columns without PK do not show calendar button', () => {
    setupConnection() // writable
    useTableDataStore.setState({
      tabs: {
        'tab-1': makeTabState({
          columns: mockColumnsWithTemporal,
          rows: mockRowsWithTemporal,
          primaryKey: null,
        }),
      },
    })
    renderFormView()

    expect(screen.queryByTestId('calendar-btn-created_at')).not.toBeInTheDocument()
    expect(screen.queryByTestId('calendar-btn-login_time')).not.toBeInTheDocument()
  })

  it('calendar button is disabled when temporal field value is NULL', () => {
    setupStoreWithTemporal({
      rows: [[1, 'Alice', null, null, '[BLOB - 128 bytes]']],
    })
    renderFormView()

    const calBtn = screen.getByTestId('calendar-btn-created_at')
    expect(calBtn).toBeDisabled()
    const clockBtn = screen.getByTestId('calendar-btn-login_time')
    expect(clockBtn).toBeDisabled()
  })

  it('calendar button is enabled when temporal field value is non-null', () => {
    setupStoreWithTemporal()
    renderFormView()

    const calBtn = screen.getByTestId('calendar-btn-created_at')
    expect(calBtn).not.toBeDisabled()
    const clockBtn = screen.getByTestId('calendar-btn-login_time')
    expect(clockBtn).not.toBeDisabled()
  })

  it('clicking disabled calendar button does NOT open picker for null temporal field', () => {
    setupStoreWithTemporal({
      rows: [[1, 'Alice', null, '14:30:00', '[BLOB - 128 bytes]']],
    })
    renderFormView()

    const calBtn = screen.getByTestId('calendar-btn-created_at')
    fireEvent.click(calBtn)

    expect(screen.queryByTestId('date-time-picker-popup')).not.toBeInTheDocument()
  })

  it('first-click-open on temporal input does NOT open picker when value is NULL', () => {
    setupStoreWithTemporal({
      rows: [[1, 'Alice', null, '14:30:00', '[BLOB - 128 bytes]']],
    })
    renderFormView()

    const input = screen.getByTestId('form-input-created_at')
    // Simulate a click that would normally trigger first-click-open
    fireEvent.click(input)

    // Picker should NOT open because value is null
    expect(screen.queryByTestId('date-time-picker-popup')).not.toBeInTheDocument()
  })

  it('activating NULL toggle closes picker if it was open for that field', () => {
    setupStoreWithTemporal()
    renderFormView()

    // Open picker for created_at via the calendar button
    fireEvent.click(screen.getByTestId('calendar-btn-created_at'))
    expect(screen.getByTestId('date-time-picker-popup')).toBeInTheDocument()

    // Click NULL toggle for created_at — this sets the value to null
    const nullBtn = screen.getByTestId('btn-null-created_at')
    fireEvent.click(nullBtn)

    // Picker should be closed because the field is now NULL
    expect(screen.queryByTestId('date-time-picker-popup')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Save validation — temporal field validation + toast tests
// ---------------------------------------------------------------------------

describe('TableDataFormView — Save validation', () => {
  it('clicking Save with invalid date value shows error toast and blocks save', async () => {
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: {
        id: 1,
        name: 'Alice',
        created_at: '2023-06-15 10:30:00',
        login_time: '14:30:00',
        avatar: '[BLOB - 128 bytes]',
      },
      currentValues: {
        id: 1,
        name: 'Alice',
        created_at: 'garbage',
        login_time: '14:30:00',
        avatar: '[BLOB - 128 bytes]',
      },
      modifiedColumns: new Set(['created_at']),
      isNewRow: false,
    }

    setupStoreWithTemporal({ editState })
    renderFormView()
    const user = userEvent.setup()

    const saveBtn = screen.getByTestId('btn-form-save')
    expect(saveBtn).not.toBeDisabled()
    await user.click(saveBtn)

    await expectToast('error', 'Invalid date value')

    // editState should still be present (save was blocked)
    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState).not.toBeNull()
    expect(state?.editState?.modifiedColumns.has('created_at')).toBe(true)
  })

  it('clicking Save with valid date value calls saveCurrentRow and shows success toast', async () => {
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: {
        id: 1,
        name: 'Alice',
        created_at: '2023-06-15 10:30:00',
        login_time: '14:30:00',
        avatar: '[BLOB - 128 bytes]',
      },
      currentValues: {
        id: 1,
        name: 'Bob',
        created_at: '2023-06-15 10:30:00',
        login_time: '14:30:00',
        avatar: '[BLOB - 128 bytes]',
      },
      modifiedColumns: new Set(['name']),
      isNewRow: false,
    }

    setupStoreWithTemporal({ editState })
    renderFormView()
    const user = userEvent.setup()

    const saveBtn = screen.getByTestId('btn-form-save')
    await user.click(saveBtn)

    // Should NOT show error
    await expectToast('success', 'Row saved')
  })

  it('clicking Save with blank date value shows error toast and blocks save', async () => {
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: {
        id: 1,
        name: 'Alice',
        created_at: '2023-06-15 10:30:00',
        login_time: '14:30:00',
        avatar: '[BLOB - 128 bytes]',
      },
      currentValues: {
        id: 1,
        name: 'Alice',
        created_at: '',
        login_time: '14:30:00',
        avatar: '[BLOB - 128 bytes]',
      },
      modifiedColumns: new Set(['created_at']),
      isNewRow: false,
    }

    setupStoreWithTemporal({ editState })
    renderFormView()
    const user = userEvent.setup()

    await user.click(screen.getByTestId('btn-form-save'))

    await expectToast('error', 'Invalid date value')

    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState).not.toBeNull()
    expect(state?.editState?.modifiedColumns.has('created_at')).toBe(true)
  })

  it('clicking Save shows an error toast when saving fails', async () => {
    let saveAttempts = 0
    ipc.override('update_table_row', () => {
      saveAttempts += 1
      if (saveAttempts === 1) {
        throw new Error('Save failed')
      }
      return undefined
    })

    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: {
        id: 1,
        name: 'Alice',
        created_at: '2023-06-15 10:30:00',
        login_time: '14:30:00',
        avatar: '[BLOB - 128 bytes]',
      },
      currentValues: {
        id: 1,
        name: 'Bob',
        created_at: '2023-06-15 10:30:00',
        login_time: '14:30:00',
        avatar: '[BLOB - 128 bytes]',
      },
      modifiedColumns: new Set(['name']),
      isNewRow: false,
    }

    setupStoreWithTemporal({ editState })
    renderFormView()
    const user = userEvent.setup()

    await user.click(screen.getByTestId('btn-form-save'))

    await expectToast('error', 'Save failed')
  })

  it('clicking Save with invalid TIME value shows error toast', async () => {
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: {
        id: 1,
        name: 'Alice',
        created_at: '2023-06-15 10:30:00',
        login_time: '14:30:00',
        avatar: '[BLOB - 128 bytes]',
      },
      currentValues: {
        id: 1,
        name: 'Alice',
        created_at: '2023-06-15 10:30:00',
        login_time: 'not-a-time',
        avatar: '[BLOB - 128 bytes]',
      },
      modifiedColumns: new Set(['login_time']),
      isNewRow: false,
    }

    setupStoreWithTemporal({ editState })
    renderFormView()
    const user = userEvent.setup()

    await user.click(screen.getByTestId('btn-form-save'))

    await expectToast('error', 'Invalid date value')
  })

  it('clicking Save with null temporal value does NOT show error (null is valid)', async () => {
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: {
        id: 1,
        name: 'Alice',
        created_at: '2023-06-15 10:30:00',
        login_time: '14:30:00',
        avatar: '[BLOB - 128 bytes]',
      },
      currentValues: {
        id: 1,
        name: 'Alice',
        created_at: null,
        login_time: '14:30:00',
        avatar: '[BLOB - 128 bytes]',
      },
      modifiedColumns: new Set(['created_at']),
      isNewRow: false,
    }

    setupStoreWithTemporal({ editState })
    renderFormView()
    const user = userEvent.setup()

    await user.click(screen.getByTestId('btn-form-save'))

    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((toast) => toast.variant === 'error')).toBe(false)
    })
  })
})
