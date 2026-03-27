import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { useTableDataStore } from '../../../stores/table-data-store'
import { useConnectionStore } from '../../../stores/connection-store'
import type { TableDataTabState, TableDataColumnMeta, RowEditState } from '../../../types/schema'

// Mock toast store
const mockShowError = vi.fn()
const mockShowSuccess = vi.fn()
vi.mock('../../../stores/toast-store', () => ({
  useToastStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) => {
    const state = {
      toasts: [],
      showError: mockShowError,
      showSuccess: mockShowSuccess,
      showInfo: vi.fn(),
      dismiss: vi.fn(),
    }
    return selector(state)
  }),
}))

// Mock AG Grid (needed because store imports may trigger AG Grid refs)
vi.mock('ag-grid-community', () => ({
  AllCommunityModule: {},
  ModuleRegistry: { registerModules: vi.fn() },
}))

vi.mock('ag-grid-react', async () => {
  const React = await import('react')
  return {
    AgGridReact: vi.fn(() =>
      React.createElement('div', { 'data-testid': 'ag-grid-inner' }, 'Grid Mock')
    ),
  }
})

// Mock table-data-commands
vi.mock('../../../lib/table-data-commands', () => ({
  fetchTableData: vi.fn().mockResolvedValue({
    columns: [],
    rows: [],
    totalRows: 0,
    currentPage: 1,
    totalPages: 1,
    pageSize: 1000,
    primaryKey: null,
    executionTimeMs: 0,
  }),
  updateTableRow: vi.fn().mockResolvedValue(undefined),
  insertTableRow: vi.fn().mockResolvedValue([]),
  deleteTableRow: vi.fn().mockResolvedValue(undefined),
  exportTableData: vi.fn().mockResolvedValue(undefined),
}))

// Mock clipboard
vi.mock('../../../lib/context-menu-utils', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    writeClipboardText: vi.fn().mockResolvedValue(undefined),
  }
})

// Mock DateTimePicker — avoids portal + react-datepicker complexity in unit tests
vi.mock('../../../components/table-data/DateTimePicker', async () => {
  const React = await import('react')
  return {
    DateTimePicker: ({
      onApply,
      onCancel,
    }: {
      onApply: (v: string) => void
      onCancel: () => void
    }) =>
      React.createElement(
        'div',
        { 'data-testid': 'date-time-picker-popup' },
        React.createElement(
          'button',
          { 'data-testid': 'mock-apply-btn', onClick: () => onApply('2023-11-24') },
          'Apply'
        ),
        React.createElement(
          'button',
          { 'data-testid': 'mock-cancel-btn', onClick: () => onCancel() },
          'Cancel'
        )
      ),
  }
})

import { TableDataFormView } from '../../../components/table-data/TableDataFormView'
import { writeClipboardText } from '../../../lib/context-menu-utils'
import { updateTableRow } from '../../../lib/table-data-commands'

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
    isAutoIncrement: false,
  },
]

const mockRows: unknown[][] = [[1, 'Alice', '[BLOB - 128 bytes]']]
const mockPK = { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false }

function makeTabState(overrides: Partial<TableDataTabState> = {}): TableDataTabState {
  return {
    columns: mockColumns,
    rows: mockRows,
    totalRows: 1,
    currentPage: 1,
    totalPages: 1,
    pageSize: 1000,
    primaryKey: mockPK,
    executionTimeMs: 15,
    connectionId: 'conn-1',
    database: 'mydb',
    table: 'users',
    editState: null,
    viewMode: 'form',
    selectedRowKey: { id: 1 },
    filterModel: {},
    sort: null,
    isLoading: false,
    error: null,
    saveError: null,
    isExportDialogOpen: false,
    pendingNavigationAction: null,
    ...overrides,
  }
}

function setupConnection(readOnly = false) {
  useConnectionStore.setState({
    activeConnections: {
      'conn-1': {
        id: 'conn-1',
        profile: {
          id: 'conn-1',
          name: 'Test DB',
          host: '127.0.0.1',
          port: 3306,
          username: 'root',
          hasPassword: true,
          defaultDatabase: null,
          sslEnabled: false,
          sslCaPath: null,
          sslCertPath: null,
          sslKeyPath: null,
          color: '#3b82f6',
          groupId: null,
          readOnly,
          sortOrder: 0,
          connectTimeoutSecs: 10,
          keepaliveIntervalSecs: 30,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        },
        status: 'connected',
        serverVersion: '8.0.35',
      },
    },
    activeTabId: 'conn-1',
  })
}

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
  useConnectionStore.setState({ activeConnections: {}, activeTabId: null })
  mockIPC(() => null)
  vi.clearAllMocks()
})

describe('TableDataFormView', () => {
  it('renders form view with record navigation "Record 1 of 1"', () => {
    setupStore()
    renderFormView()

    expect(screen.getByTestId('table-data-form-view')).toBeInTheDocument()
    expect(screen.getByTestId('form-record-nav')).toBeInTheDocument()
    expect(screen.getByText('Record 1 of 1')).toBeInTheDocument()
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
    expect(screen.getByTestId('btn-form-null-name')).toBeInTheDocument()
  })

  it('NULL toggle button NOT shown for non-nullable fields', () => {
    setupStore()
    renderFormView()

    // 'id' is not nullable
    expect(screen.queryByTestId('btn-form-null-id')).not.toBeInTheDocument()
  })

  it('clicking NULL toggle updates cell value to null', () => {
    setupStore()
    renderFormView()

    const nullBtn = screen.getByTestId('btn-form-null-name')
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

  it('Next button disabled on last record', () => {
    setupStore()
    renderFormView()

    const nextBtn = screen.getByTestId('btn-form-next')
    expect(nextBtn).toBeDisabled()
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

    const copyBtn = screen.getByTestId('btn-form-copy-name')
    fireEvent.click(copyBtn)

    expect(writeClipboardText).toHaveBeenCalledWith('Alice')
  })

  it('shows empty state when rows is empty', () => {
    setupStore({ rows: [], totalRows: 0 })
    renderFormView()

    expect(screen.getByText('No rows to display')).toBeInTheDocument()
  })

  it('Previous and Next enabled with multiple records', () => {
    setupStore({
      rows: [
        [1, 'Alice', null],
        [2, 'Bob', null],
      ],
      totalRows: 2,
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

    expect(screen.queryByTestId('btn-form-null-avatar')).not.toBeInTheDocument()
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

  it('displays correct record position with pagination', () => {
    setupStore({
      currentPage: 3,
      pageSize: 10,
      totalPages: 5,
      totalRows: 50,
      selectedRowKey: { id: 1 },
    })
    renderFormView()

    // Record position should be (3-1)*10 + 0 + 1 = 21
    expect(screen.getByText('Record 21 of 50')).toBeInTheDocument()
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
      totalRows: 2,
      selectedRowKey: { id: 1 },
    })
    renderFormView()

    expect(screen.getByText('Record 1 of 2')).toBeInTheDocument()
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
      totalRows: 2,
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
    const nullBtn = screen.getByTestId('btn-form-null-name')
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

    const copyBtn = screen.getByTestId('btn-form-copy-name')
    fireEvent.click(copyBtn)

    expect(writeClipboardText).toHaveBeenCalledWith('NULL')
  })

  it('Save button calls saveCurrentRow', () => {
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
    // saveCurrentRow was called — no crash
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

    expect(screen.queryByTestId('btn-form-null-name')).not.toBeInTheDocument()
  })

  it('handles cross-page navigation next', async () => {
    setupStore({
      rows: [[1, 'Alice', null]],
      totalRows: 10,
      currentPage: 1,
      totalPages: 2,
      pageSize: 1,
      selectedRowKey: { id: 1 },
    })
    renderFormView()

    expect(screen.getByText('Record 1 of 10')).toBeInTheDocument()
    // Next button should be enabled (not on last page)
    const nextBtn = screen.getByTestId('btn-form-next')
    expect(nextBtn).not.toBeDisabled()
    fireEvent.click(nextBtn)
    // Navigation action is dispatched — no crash
  })

  it('Next button disabled on last record of last page', () => {
    setupStore({
      rows: [[1, 'Alice', null]],
      totalRows: 1,
      currentPage: 1,
      totalPages: 1,
      pageSize: 1000,
      selectedRowKey: { id: 1 },
    })
    renderFormView()

    expect(screen.getByTestId('btn-form-next')).toBeDisabled()
  })

  it('Previous button disabled when loading', () => {
    setupStore({
      rows: [
        [1, 'Alice', null],
        [2, 'Bob', null],
      ],
      totalRows: 2,
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

  it('clicking the calendar icon opens the DateTimePicker', () => {
    setupStoreWithTemporal()
    renderFormView()

    // No picker initially
    expect(screen.queryByTestId('date-time-picker-popup')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('calendar-btn-created_at'))

    expect(screen.getByTestId('date-time-picker-popup')).toBeInTheDocument()
  })

  it('picker onApply updates the field value via the store', () => {
    setupStoreWithTemporal()
    renderFormView()

    // Open picker
    fireEvent.click(screen.getByTestId('calendar-btn-created_at'))

    // Click the mock Apply button → triggers onApply('2023-11-24')
    fireEvent.click(screen.getByTestId('mock-apply-btn'))

    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState).not.toBeNull()
    expect(state?.editState?.currentValues.created_at).toBe('2023-11-24')
  })

  it('picker onCancel closes the popup without changing the value', () => {
    setupStoreWithTemporal()
    renderFormView()

    // Open picker
    fireEvent.click(screen.getByTestId('calendar-btn-created_at'))
    expect(screen.getByTestId('date-time-picker-popup')).toBeInTheDocument()

    // Click cancel
    fireEvent.click(screen.getByTestId('mock-cancel-btn'))
    expect(screen.queryByTestId('date-time-picker-popup')).not.toBeInTheDocument()
  })

  it('only one picker is open at a time', () => {
    setupStoreWithTemporal()
    renderFormView()

    // Open picker for created_at
    fireEvent.click(screen.getByTestId('calendar-btn-created_at'))
    expect(screen.getAllByTestId('date-time-picker-popup')).toHaveLength(1)

    // Open picker for login_time (should replace the first)
    fireEvent.click(screen.getByTestId('calendar-btn-login_time'))
    expect(screen.getAllByTestId('date-time-picker-popup')).toHaveLength(1)
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
    const nullBtn = screen.getByTestId('btn-form-null-created_at')
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
    const nullBtn = screen.getByTestId('btn-form-null-created_at')
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

    const saveBtn = screen.getByTestId('btn-form-save')
    expect(saveBtn).not.toBeDisabled()
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(
        'Invalid date value',
        expect.stringContaining('created_at')
      )
    })

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

    const saveBtn = screen.getByTestId('btn-form-save')
    fireEvent.click(saveBtn)

    // Should NOT show error
    await waitFor(() => {
      expect(mockShowError).not.toHaveBeenCalled()
      expect(mockShowSuccess).toHaveBeenCalledWith('Row saved', 'Changes saved successfully.')
    })
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

    fireEvent.click(screen.getByTestId('btn-form-save'))

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(
        'Invalid date value',
        expect.stringContaining('created_at')
      )
    })

    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState).not.toBeNull()
    expect(state?.editState?.modifiedColumns.has('created_at')).toBe(true)
  })

  it('clicking Save shows an error toast when saving fails', async () => {
    ;(updateTableRow as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Save failed'))

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

    fireEvent.click(screen.getByTestId('btn-form-save'))

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Save failed', 'Save failed')
    })
    expect(mockShowSuccess).not.toHaveBeenCalled()
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

    fireEvent.click(screen.getByTestId('btn-form-save'))

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(
        'Invalid date value',
        expect.stringContaining('login_time')
      )
    })
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

    fireEvent.click(screen.getByTestId('btn-form-save'))

    await waitFor(() => {
      expect(mockShowError).not.toHaveBeenCalled()
    })
  })
})
