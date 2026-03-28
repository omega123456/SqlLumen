import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock AG Grid modules before importing the component
vi.mock('ag-grid-community', () => ({
  AllCommunityModule: {},
  ModuleRegistry: { registerModules: vi.fn() },
}))

vi.mock('ag-grid-react', async () => {
  const React = await import('react')
  return {
    AgGridReact: vi.fn((props: Record<string, unknown>) => {
      const colDefs = props.columnDefs as Array<{
        headerName: string
        field: string
        editable: boolean
      }>
      const rowData = props.rowData as Array<Record<string, unknown>>

      return React.createElement(
        'div',
        { 'data-testid': 'ag-grid-inner' },
        React.createElement(
          'div',
          { 'data-testid': 'ag-grid-headers' },
          colDefs?.map((col) =>
            React.createElement(
              'span',
              { key: col.field, 'data-field': col.field, 'data-editable': String(col.editable) },
              col.headerName
            )
          )
        ),
        React.createElement(
          'div',
          { 'data-testid': 'ag-grid-rows' },
          rowData?.map((row, i) =>
            React.createElement(
              'div',
              { key: i, 'data-testid': `ag-grid-row-${i}` },
              ...Object.entries(row)
                .filter(([key]) => key !== '__rowIndex' && key !== '__tempId')
                .map(([key, val]) =>
                  React.createElement(
                    'span',
                    { key, 'data-field': key },
                    val === null ? 'NULL' : String(val)
                  )
                )
            )
          )
        )
      )
    }),
  }
})

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

const { mockShowError, mockShowSuccess } = vi.hoisted(() => ({
  mockShowError: vi.fn(),
  mockShowSuccess: vi.fn(),
}))

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
  showErrorToast: mockShowError,
  showSuccessToast: mockShowSuccess,
  showInfoToast: vi.fn(),
}))

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentType } from 'react'
import type { Mock } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import { useTableDataStore } from '../../../stores/table-data-store'
import { useConnectionStore } from '../../../stores/connection-store'
import {
  TableDataGrid,
  buildColumnDefs,
  getFilterType,
} from '../../../components/table-data/TableDataGrid'
import { TableDataToolbar } from '../../../components/table-data/TableDataToolbar'
import { AgGridReact } from 'ag-grid-react'
import { updateTableRow } from '../../../lib/table-data-commands'
import type { TableDataColumnMeta, TableDataTabState, RowEditState } from '../../../types/schema'

function getLatestGridProps(): Record<string, unknown> {
  const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
  expect(mockCalls.length).toBeGreaterThanOrEqual(1)
  return mockCalls[mockCalls.length - 1][0] as Record<string, unknown>
}

function setupConnection() {
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
          readOnly: false,
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

const testColumns: TableDataColumnMeta[] = [
  {
    name: 'id',
    dataType: 'bigint',
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
    dataType: 'varchar',
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
    dataType: 'blob',
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: true,
    isAutoIncrement: false,
  },
]

function setupTabState(overrides: Partial<TableDataTabState> = {}) {
  const defaultState: TableDataTabState = {
    columns: testColumns,
    rows: [
      [1, 'Alice', null],
      [2, null, '[BLOB 32 bytes]'],
    ],
    totalRows: 2,
    currentPage: 1,
    totalPages: 1,
    pageSize: 1000,
    primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
    executionTimeMs: 15,
    connectionId: 'conn-1',
    database: 'mydb',
    table: 'users',
    editState: null,
    viewMode: 'grid',
    selectedRowKey: null,
    filterModel: {},
    sort: null,
    isLoading: false,
    error: null,
    saveError: null,
    isExportDialogOpen: false,
    pendingNavigationAction: null,
    ...overrides,
  }

  useTableDataStore.setState({
    tabs: { 'tab-1': defaultState },
  })
}

/** `sortByColumn` / `applyFilters` call `fetchPage` without awaiting — flush updates for act(). */
async function flushAsyncTableDataUpdates() {
  await waitFor(() => {
    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab?.isLoading).toBe(false)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  useTableDataStore.setState({ tabs: {} })
  useConnectionStore.setState({
    activeConnections: {},
    activeTabId: null,
  })
  mockIPC(() => null)
})

describe('buildColumnDefs', () => {
  it('creates correct column definitions', () => {
    const defs = buildColumnDefs(testColumns, false, true)
    expect(defs).toHaveLength(3)
    expect(defs[0].field).toBe('id')
    expect(defs[0].headerName).toBe('id')
    expect(defs[1].field).toBe('name')
    expect(defs[2].field).toBe('avatar')
  })

  it('marks binary columns as NOT editable', () => {
    const defs = buildColumnDefs(testColumns, false, true)
    expect(defs[0].editable).toBe(true) // id (non-binary)
    expect(defs[1].editable).toBe(true) // name (non-binary)
    expect(defs[2].editable).toBe(false) // avatar (binary)
  })

  it('all columns non-editable when read-only', () => {
    const defs = buildColumnDefs(testColumns, true, true)
    defs.forEach((d) => {
      expect(d.editable).toBe(false)
    })
  })

  it('all columns non-editable when no PK', () => {
    const defs = buildColumnDefs(testColumns, false, false)
    defs.forEach((d) => {
      expect(d.editable).toBe(false)
    })
  })

  it('uses agNumberColumnFilter for numeric and agTextColumnFilter for text columns', () => {
    const defs = buildColumnDefs(testColumns, false, true)
    expect(defs[0].filter).toBe('agNumberColumnFilter') // id is bigint
    expect(defs[1].filter).toBe('agTextColumnFilter') // name is varchar
    expect(defs[2].filter).toBe(false) // avatar is binary
  })

  it('uses noop comparator for server-side sort', () => {
    const defs = buildColumnDefs(testColumns, false, true)
    defs.forEach((d) => {
      if (typeof d.comparator === 'function') {
        expect(d.comparator(null, null, {} as never, {} as never, false)).toBe(0)
      }
    })
  })
})

describe('getFilterType', () => {
  function makeCol(name: string, dataType: string, isBinary = false): TableDataColumnMeta {
    return {
      name,
      dataType,
      isNullable: false,
      isPrimaryKey: false,
      isUniqueKey: false,
      hasDefault: false,
      columnDefault: null,
      isBinary,
      isAutoIncrement: false,
    }
  }

  it('returns false for binary columns', () => {
    expect(getFilterType(makeCol('avatar', 'BLOB', true))).toBe(false)
  })

  it('returns agNumberColumnFilter for integer types', () => {
    expect(getFilterType(makeCol('id', 'INT'))).toBe('agNumberColumnFilter')
    expect(getFilterType(makeCol('id', 'BIGINT'))).toBe('agNumberColumnFilter')
    expect(getFilterType(makeCol('id', 'TINYINT'))).toBe('agNumberColumnFilter')
    expect(getFilterType(makeCol('id', 'SMALLINT'))).toBe('agNumberColumnFilter')
    expect(getFilterType(makeCol('id', 'MEDIUMINT'))).toBe('agNumberColumnFilter')
    expect(getFilterType(makeCol('id', 'INTEGER'))).toBe('agNumberColumnFilter')
  })

  it('returns agNumberColumnFilter for float/double/decimal types', () => {
    expect(getFilterType(makeCol('price', 'FLOAT'))).toBe('agNumberColumnFilter')
    expect(getFilterType(makeCol('price', 'DOUBLE'))).toBe('agNumberColumnFilter')
    expect(getFilterType(makeCol('price', 'DECIMAL'))).toBe('agNumberColumnFilter')
    expect(getFilterType(makeCol('price', 'NUMERIC'))).toBe('agNumberColumnFilter')
    expect(getFilterType(makeCol('price', 'REAL'))).toBe('agNumberColumnFilter')
  })

  it('handles unsigned/size suffixes (e.g. "BIGINT UNSIGNED")', () => {
    expect(getFilterType(makeCol('id', 'BIGINT UNSIGNED'))).toBe('agNumberColumnFilter')
    expect(getFilterType(makeCol('id', 'INT(11)'))).toBe('agNumberColumnFilter')
    expect(getFilterType(makeCol('id', 'DECIMAL(10,2)'))).toBe('agNumberColumnFilter')
  })

  it('returns agTextColumnFilter for text types', () => {
    expect(getFilterType(makeCol('name', 'VARCHAR'))).toBe('agTextColumnFilter')
    expect(getFilterType(makeCol('body', 'TEXT'))).toBe('agTextColumnFilter')
    expect(getFilterType(makeCol('dt', 'DATETIME'))).toBe('agTextColumnFilter')
    expect(getFilterType(makeCol('d', 'DATE'))).toBe('agTextColumnFilter')
  })

  it('is case-insensitive on dataType', () => {
    expect(getFilterType(makeCol('id', 'bigint'))).toBe('agNumberColumnFilter')
    expect(getFilterType(makeCol('name', 'varchar'))).toBe('agTextColumnFilter')
  })
})

describe('TableDataGrid', () => {
  it('renders with data-testid="table-data-grid"', () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    expect(screen.getByTestId('table-data-grid')).toBeInTheDocument()
  })

  it('has ag-theme-precision class on container', () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const container = screen.getByTestId('table-data-grid')
    expect(container.className).toContain('ag-theme-precision')
  })

  it('transforms row data from arrays to objects', () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(mockCalls.length).toBeGreaterThanOrEqual(1)
    const props = mockCalls[0][0] as Record<string, unknown>
    const rowData = props.rowData as Array<Record<string, unknown>>
    expect(rowData).toHaveLength(2)
    expect(rowData[0].id).toBe(1)
    expect(rowData[0].name).toBe('Alice')
    expect(rowData[0].avatar).toBe(null)
    expect(rowData[1].id).toBe(2)
    expect(rowData[1].name).toBe(null)
  })

  it('passes correct number of column defs', () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
    const props = mockCalls[0][0] as Record<string, unknown>
    const colDefs = props.columnDefs as Array<{ field: string }>
    expect(colDefs).toHaveLength(3)
  })

  it('renders NULL values via mock display', () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    // Our mock renders null as "NULL"
    const nullCells = screen.getAllByText('NULL')
    expect(nullCells.length).toBeGreaterThanOrEqual(1)
  })

  it('renders with empty data', () => {
    setupConnection()
    setupTabState({ rows: [], columns: [] })
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    expect(screen.getByTestId('table-data-grid')).toBeInTheDocument()
  })

  it('sets cellEditor and cellEditorParams on editable columns', () => {
    const defs = buildColumnDefs(testColumns, false, true)
    // Editable columns should have nullableCellEditor
    expect(defs[0].cellEditor).toBe('nullableCellEditor')
    expect(defs[0].cellEditorParams).toEqual({
      isNullable: false,
      columnMeta: testColumns[0],
    })
    expect(defs[1].cellEditor).toBe('nullableCellEditor')
    expect(defs[1].cellEditorParams).toEqual({
      isNullable: true,
      columnMeta: testColumns[1],
    })
    // Binary columns (not editable) should NOT have cellEditor
    expect(defs[2].cellEditor).toBeUndefined()
    expect(defs[2].cellEditorParams).toBeUndefined()
  })

  it('uses enumCellEditor for enum columns with options', () => {
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

    const defs = buildColumnDefs([enumColumn], false, true)

    expect(defs[0].cellEditor).toBe('enumCellEditor')
    expect(defs[0].cellEditorParams).toEqual({
      isNullable: true,
      columnMeta: enumColumn,
    })
  })

  it('enumCellEditor writes null when NULL option is selected', () => {
    setupConnection()
    setupTabState({
      columns: [
        testColumns[0],
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
      ],
      rows: [[1, 'active']],
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, status: 'active' },
        currentValues: { id: 1, status: 'active' },
        modifiedColumns: new Set<string>(),
        isNewRow: false,
      },
    })
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)

    const props = getLatestGridProps()
    const components = props.components as Record<string, ComponentType<Record<string, unknown>>>
    const EnumEditor = components.enumCellEditor

    const editor = render(
      <EnumEditor
        value="active"
        isNullable={true}
        columnMeta={{
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
        }}
        colDef={{ field: 'status' }}
        context={{ tabId: 'tab-1' }}
      />
    )

    fireEvent.change(editor.getByRole('combobox'), {
      target: { value: '__MYSQL_CLIENT_ENUM_NULL__' },
    })

    expect(useTableDataStore.getState().tabs['tab-1']?.editState?.currentValues.status).toBeNull()
  })

  it('non-editable columns do not get cellEditor or cellEditorParams', () => {
    const defs = buildColumnDefs(testColumns, true, true) // read-only
    defs.forEach((d) => {
      expect(d.cellEditor).toBeUndefined()
      expect(d.cellEditorParams).toBeUndefined()
    })
  })

  it('all columns use tableDataCellRenderer', () => {
    const defs = buildColumnDefs(testColumns, false, true)
    defs.forEach((d) => {
      expect(d.cellRenderer).toBe('tableDataCellRenderer')
    })
  })

  it('passes sort indicator when sort is set', () => {
    setupConnection()
    setupTabState({ sort: { column: 'name', direction: 'desc' } })
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
    const props = mockCalls[0][0] as Record<string, unknown>
    const colDefs = props.columnDefs as Array<{ field: string; sort?: string }>
    const nameCol = colDefs.find((d) => d.field === 'name')
    expect(nameCol?.sort).toBe('desc')
    // Other columns should not have sort
    const idCol = colDefs.find((d) => d.field === 'id')
    expect(idCol?.sort).toBeUndefined()
  })

  it('getRowId uses __tempId for new rows', () => {
    setupConnection()
    setupTabState({
      editState: {
        rowKey: { __tempId: 'temp-1' },
        originalValues: {},
        currentValues: { id: null, name: '', avatar: null },
        modifiedColumns: new Set(),
        isNewRow: true,
        tempId: 'temp-1',
      },
    })
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
    const props = mockCalls[0][0] as Record<string, unknown>
    const getRowId = props.getRowId as (params: { data: Record<string, unknown> }) => string
    // Row with __tempId
    expect(getRowId({ data: { __tempId: 'temp-1', id: null } })).toBe('temp-1')
    // Normal row with PK
    expect(getRowId({ data: { __rowIndex: 0, id: 42 } })).toBe('42')
  })

  it('getRowId falls back to __rowIndex when no PK', () => {
    setupConnection()
    setupTabState({ primaryKey: null })
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
    const props = mockCalls[0][0] as Record<string, unknown>
    const getRowId = props.getRowId as (params: { data: Record<string, unknown> }) => string
    expect(getRowId({ data: { __rowIndex: 5 } })).toBe('5')
  })

  it('getRowClass returns editing class for active edit row', () => {
    setupConnection()
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { id: 1, name: 'Alice', avatar: null },
      currentValues: { id: 1, name: 'Alice', avatar: null },
      modifiedColumns: new Set(),
      isNewRow: false,
    }
    setupTabState({ editState })
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
    const props = mockCalls[0][0] as Record<string, unknown>
    const getRowClass = props.getRowClass as (params: {
      data?: Record<string, unknown>
    }) => string | undefined
    // Row matching editState
    expect(getRowClass({ data: { id: 1, __rowIndex: 0 } })).toBe('td-editing-row')
    // Different row
    expect(getRowClass({ data: { id: 2, __rowIndex: 1 } })).toBeUndefined()
    // No data
    expect(getRowClass({})).toBeUndefined()
  })

  it('getRowClass returns new-row class for new row edit', () => {
    setupConnection()
    const editState: RowEditState = {
      rowKey: { __tempId: 'temp-1' },
      originalValues: {},
      currentValues: { id: null, name: '' },
      modifiedColumns: new Set(),
      isNewRow: true,
      tempId: 'temp-1',
    }
    setupTabState({ editState })
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
    const props = mockCalls[0][0] as Record<string, unknown>
    const getRowClass = props.getRowClass as (params: {
      data?: Record<string, unknown>
    }) => string | undefined
    expect(getRowClass({ data: { __tempId: 'temp-1', __rowIndex: 0 } })).toBe(
      'td-editing-row td-new-row'
    )
  })

  it('cellClassRules td-modified-cell returns true for modified cells', () => {
    setupConnection()
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { id: 1, name: 'Alice' },
      currentValues: { id: 1, name: 'Modified' },
      modifiedColumns: new Set(['name']),
      isNewRow: false,
    }
    setupTabState({ editState })
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
    const props = mockCalls[0][0] as Record<string, unknown>
    const defaultColDef = props.defaultColDef as {
      cellClassRules: Record<
        string,
        (params: { colDef?: { field?: string }; data?: Record<string, unknown> }) => boolean
      >
    }
    const modifiedRule = defaultColDef.cellClassRules['td-modified-cell']
    // Modified column on matching row
    expect(modifiedRule({ colDef: { field: 'name' }, data: { id: 1 } })).toBe(true)
    // Unmodified column on matching row
    expect(modifiedRule({ colDef: { field: 'id' }, data: { id: 1 } })).toBe(false)
    // Modified column on different row
    expect(modifiedRule({ colDef: { field: 'name' }, data: { id: 2 } })).toBe(false)
    // No data
    expect(modifiedRule({ colDef: { field: 'name' } })).toBe(false)
    // No colDef field
    expect(modifiedRule({ colDef: {}, data: { id: 1 } })).toBe(false)
  })

  it('cellClassRules td-editable-cell returns true when writable with PK', () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
    const props = mockCalls[0][0] as Record<string, unknown>
    const defaultColDef = props.defaultColDef as {
      cellClassRules: Record<string, () => boolean>
    }
    expect(defaultColDef.cellClassRules['td-editable-cell']()).toBe(true)
  })

  it('cellClassRules td-editable-cell returns false when readOnly', () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={true} />)
    const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
    const props = mockCalls[0][0] as Record<string, unknown>
    const defaultColDef = props.defaultColDef as {
      cellClassRules: Record<string, () => boolean>
    }
    expect(defaultColDef.cellClassRules['td-editable-cell']()).toBe(false)
  })

  it('onCellEditingStarted calls startEditing in the store', async () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
    const props = mockCalls[0][0] as Record<string, unknown>
    const onCellEditingStarted = props.onCellEditingStarted as (event: {
      data: Record<string, unknown>
      colDef: { field: string }
    }) => Promise<void>

    await act(async () => {
      await onCellEditingStarted({
        data: { id: 1, name: 'Alice', avatar: null, __rowIndex: 0 },
        colDef: { field: 'name' },
      })
    })

    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState).not.toBeNull()
    expect(state?.editState?.rowKey).toEqual({ id: 1 })
  })

  it('onCellEditingStopped updates store when value changes', () => {
    setupConnection()
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { id: 1, name: 'Alice', avatar: null },
      currentValues: { id: 1, name: 'Alice', avatar: null },
      modifiedColumns: new Set(),
      isNewRow: false,
    }
    setupTabState({ editState })
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
    const props = mockCalls[0][0] as Record<string, unknown>
    const onCellEditingStopped = props.onCellEditingStopped as (event: {
      colDef: { field: string }
      oldValue: unknown
      newValue: unknown
    }) => void

    act(() => {
      onCellEditingStopped({
        colDef: { field: 'name' },
        oldValue: 'Alice',
        newValue: 'Bob',
      })
    })

    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState?.currentValues.name).toBe('Bob')
    expect(state?.editState?.modifiedColumns.has('name')).toBe(true)
  })

  it('onCellEditingStopped does not update store when value unchanged', () => {
    setupConnection()
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { id: 1, name: 'Alice', avatar: null },
      currentValues: { id: 1, name: 'Alice', avatar: null },
      modifiedColumns: new Set(),
      isNewRow: false,
    }
    setupTabState({ editState })
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
    const props = mockCalls[0][0] as Record<string, unknown>
    const onCellEditingStopped = props.onCellEditingStopped as (event: {
      colDef: { field: string }
      oldValue: unknown
      newValue: unknown
    }) => void

    act(() => {
      onCellEditingStopped({
        colDef: { field: 'name' },
        oldValue: 'Alice',
        newValue: 'Alice', // same value
      })
    })

    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState?.modifiedColumns.size).toBe(0)
  })

  it('onCellEditingStopped ignores events without colDef.field', () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
    const props = mockCalls[0][0] as Record<string, unknown>
    const onCellEditingStopped = props.onCellEditingStopped as (event: {
      colDef?: { field?: string }
      oldValue: unknown
      newValue: unknown
    }) => void

    act(() => {
      onCellEditingStopped({ oldValue: 'x', newValue: 'y' })
      onCellEditingStopped({ colDef: {}, oldValue: 'x', newValue: 'y' })
    })
  })

  it('clears no-op edit state when a cell edit ends unchanged', async () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)

    const startProps = getLatestGridProps()
    const onCellEditingStarted = startProps.onCellEditingStarted as (event: {
      data: Record<string, unknown>
      colDef: { field: string }
      api: { stopEditing: (cancel?: boolean) => void }
    }) => Promise<void>

    await act(async () => {
      await onCellEditingStarted({
        data: { id: 1, name: 'Alice', avatar: null, __rowIndex: 0 },
        colDef: { field: 'name' },
        api: { stopEditing: vi.fn() },
      })
    })

    const stopProps = getLatestGridProps()
    const onCellEditingStopped = stopProps.onCellEditingStopped as (event: {
      data: Record<string, unknown>
      colDef: { field: string }
      oldValue: unknown
      newValue: unknown
    }) => void

    act(() => {
      onCellEditingStopped({
        data: { id: 1, name: 'Alice', avatar: null, __rowIndex: 0 },
        colDef: { field: 'name' },
        oldValue: 'Alice',
        newValue: 'Alice',
      })
    })

    expect(useTableDataStore.getState().tabs['tab-1']?.editState).toBeNull()

    const latestProps = getLatestGridProps()
    const getRowClass = latestProps.getRowClass as (params: {
      data?: Record<string, unknown>
    }) => string | undefined
    expect(getRowClass({ data: { id: 1, __rowIndex: 0 } })).toBeUndefined()
  })

  it('typing in the cell editor immediately enables save and preserves changes on row switch', async () => {
    setupConnection()
    setupTabState()
    render(
      <>
        <TableDataToolbar tabId="tab-1" />
        <TableDataGrid tabId="tab-1" isReadOnly={false} />
      </>
    )

    const startProps = getLatestGridProps()
    const onCellEditingStarted = startProps.onCellEditingStarted as (event: {
      data: Record<string, unknown>
      colDef: { field: string }
      api: { stopEditing: (cancel?: boolean) => void }
    }) => Promise<void>
    const components = startProps.components as Record<
      string,
      ComponentType<Record<string, unknown>>
    >
    const NullableEditor = components.nullableCellEditor

    await act(async () => {
      await onCellEditingStarted({
        data: { id: 1, name: null, avatar: null, __rowIndex: 0 },
        colDef: { field: 'name' },
        api: { stopEditing: vi.fn() },
      })
    })

    const editor = render(
      <NullableEditor
        value={null}
        isNullable={true}
        columnMeta={testColumns[1]}
        colDef={{ field: 'name' }}
        context={{ tabId: 'tab-1' }}
      />
    )
    const input = editor.getByRole('textbox') as HTMLInputElement

    expect(input).not.toBeDisabled()
    expect(input.value).toBe('')

    fireEvent.change(input, { target: { value: 'Bob' } })

    expect(input.value).toBe('Bob')
    expect(useTableDataStore.getState().tabs['tab-1']?.editState?.currentValues.name).toBe('Bob')
    expect(screen.getByTestId('btn-save')).not.toBeDisabled()

    await act(async () => {
      await onCellEditingStarted({
        data: { id: 2, name: null, avatar: '[BLOB 32 bytes]', __rowIndex: 1 },
        colDef: { field: 'name' },
        api: { stopEditing: vi.fn() },
      })
    })

    expect(updateTableRow).toHaveBeenCalledWith({
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'users',
      primaryKeyColumns: ['id'],
      originalPkValues: { id: 1 },
      updatedValues: { name: 'Bob' },
    })
  })

  it('pressing Escape reverts the editor draft and does not leave pending modifications', async () => {
    setupConnection()
    setupTabState()
    render(
      <>
        <TableDataToolbar tabId="tab-1" />
        <TableDataGrid tabId="tab-1" isReadOnly={false} />
      </>
    )

    const startProps = getLatestGridProps()
    const onCellEditingStarted = startProps.onCellEditingStarted as (event: {
      data: Record<string, unknown>
      colDef: { field: string }
      api: { stopEditing: (cancel?: boolean) => void }
    }) => Promise<void>
    const onCellEditingStopped = startProps.onCellEditingStopped as (event: {
      data: Record<string, unknown>
      colDef: { field: string }
      oldValue: unknown
      newValue: unknown
    }) => void
    const components = startProps.components as Record<
      string,
      ComponentType<Record<string, unknown>>
    >
    const NullableEditor = components.nullableCellEditor

    await act(async () => {
      await onCellEditingStarted({
        data: { id: 1, name: null, avatar: null, __rowIndex: 0 },
        colDef: { field: 'name' },
        api: { stopEditing: vi.fn() },
      })
    })

    const editor = render(
      <NullableEditor
        value={null}
        isNullable={true}
        columnMeta={testColumns[1]}
        colDef={{ field: 'name' }}
        context={{ tabId: 'tab-1' }}
      />
    )
    const input = editor.getByRole('textbox') as HTMLInputElement

    fireEvent.change(input, { target: { value: 'Canceled' } })
    expect(screen.getByTestId('btn-save')).not.toBeDisabled()

    fireEvent.keyDown(input, { key: 'Escape' })
    act(() => {
      onCellEditingStopped({
        data: { id: 1, name: null, avatar: null, __rowIndex: 0 },
        colDef: { field: 'name' },
        oldValue: null,
        newValue: null,
      })
    })

    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState).toBeNull()
    expect(screen.getByTestId('btn-save')).toBeDisabled()
  })

  it('editing a primary key keeps the same row identity while moving to another cell', async () => {
    setupConnection()
    setupTabState({
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, name: 'Alice', avatar: null },
        currentValues: { id: 10, name: 'Alice', avatar: null },
        modifiedColumns: new Set(['id']),
        isNewRow: false,
      },
    })
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)

    const props = getLatestGridProps()
    const rowData = props.rowData as Array<Record<string, unknown>>
    const getRowId = props.getRowId as (params: { data: Record<string, unknown> }) => string
    const onCellEditingStarted = props.onCellEditingStarted as (event: {
      data: Record<string, unknown>
      colDef: { field: string }
      api: { stopEditing: (cancel?: boolean) => void }
    }) => Promise<void>

    expect(rowData[0].id).toBe(10)
    expect(getRowId({ data: rowData[0] })).toBe('1')

    await act(async () => {
      await onCellEditingStarted({
        data: rowData[0],
        colDef: { field: 'name' },
        api: { stopEditing: vi.fn() },
      })
    })

    expect(updateTableRow).not.toHaveBeenCalled()
    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState?.rowKey).toEqual({ id: 1 })
    expect(state?.editState?.currentValues.id).toBe(10)
  })

  it('clicking into another row blocks outside-row save when temporal validation fails', async () => {
    setupConnection()
    setupTabState({
      columns: [
        testColumns[0],
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
      ],
      rows: [
        [1, '2023-01-01 00:00:00'],
        [2, '2023-01-02 00:00:00'],
      ],
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, created_at: '2023-01-01 00:00:00' },
        currentValues: { id: 1, created_at: 'garbage' },
        modifiedColumns: new Set(['created_at']),
        isNewRow: false,
      },
    })
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)

    const props = getLatestGridProps()
    const rowData = props.rowData as Array<Record<string, unknown>>
    const onCellEditingStarted = props.onCellEditingStarted as (event: {
      data: Record<string, unknown>
      colDef: { field: string }
      api: { stopEditing: (cancel?: boolean) => void }
    }) => Promise<void>
    const stopEditing = vi.fn()

    await act(async () => {
      await onCellEditingStarted({
        data: rowData[1],
        colDef: { field: 'created_at' },
        api: { stopEditing },
      })
    })

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(
        'Invalid date value',
        expect.stringContaining('created_at')
      )
    })
    expect(updateTableRow).not.toHaveBeenCalled()
    expect(stopEditing).toHaveBeenCalledWith(true)
    expect(useTableDataStore.getState().tabs['tab-1']?.editState?.rowKey).toEqual({ id: 1 })
  })

  it('clicking into another row blocks outside-row save when temporal value is blank', async () => {
    setupConnection()
    setupTabState({
      columns: [
        testColumns[0],
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
      ],
      rows: [
        [1, '2023-01-01 00:00:00'],
        [2, '2023-01-02 00:00:00'],
      ],
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, created_at: '2023-01-01 00:00:00' },
        currentValues: { id: 1, created_at: '' },
        modifiedColumns: new Set(['created_at']),
        isNewRow: false,
      },
    })
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)

    const props = getLatestGridProps()
    const rowData = props.rowData as Array<Record<string, unknown>>
    const onCellEditingStarted = props.onCellEditingStarted as (event: {
      data: Record<string, unknown>
      colDef: { field: string }
      api: { stopEditing: (cancel?: boolean) => void }
    }) => Promise<void>
    const stopEditing = vi.fn()

    await act(async () => {
      await onCellEditingStarted({
        data: rowData[1],
        colDef: { field: 'created_at' },
        api: { stopEditing },
      })
    })

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(
        'Invalid date value',
        expect.stringContaining('created_at')
      )
    })
    expect(updateTableRow).not.toHaveBeenCalled()
    expect(stopEditing).toHaveBeenCalledWith(true)
    expect(useTableDataStore.getState().tabs['tab-1']?.editState?.rowKey).toEqual({ id: 1 })
  })

  it('clicking into another row shows the save toast after a successful outside-row save', async () => {
    setupConnection()
    setupTabState({
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, name: 'Alice', avatar: null },
        currentValues: { id: 1, name: 'Bob', avatar: null },
        modifiedColumns: new Set(['name']),
        isNewRow: false,
      },
    })
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)

    const props = getLatestGridProps()
    const rowData = props.rowData as Array<Record<string, unknown>>
    const onCellEditingStarted = props.onCellEditingStarted as (event: {
      data: Record<string, unknown>
      colDef: { field: string }
      api: { stopEditing: (cancel?: boolean) => void }
    }) => Promise<void>

    await act(async () => {
      await onCellEditingStarted({
        data: rowData[1],
        colDef: { field: 'name' },
        api: { stopEditing: vi.fn() },
      })
    })

    expect(updateTableRow).toHaveBeenCalledWith({
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'users',
      primaryKeyColumns: ['id'],
      originalPkValues: { id: 1 },
      updatedValues: { name: 'Bob' },
    })
    await waitFor(() => {
      expect(mockShowSuccess).toHaveBeenCalledWith('Row saved', 'Changes saved successfully.')
    })
  })

  it('handleRowClicked sets selected row in store', () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
    const props = mockCalls[0][0] as Record<string, unknown>
    const onRowClicked = props.onRowClicked as (event: { data: Record<string, unknown> }) => void

    act(() => {
      onRowClicked({ data: { id: 2, name: null, avatar: '[BLOB 32 bytes]', __rowIndex: 1 } })
    })

    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.selectedRowKey).toEqual({ id: 2 })
  })

  it('handleRowClicked ignores events without data', () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
    const props = mockCalls[0][0] as Record<string, unknown>
    const onRowClicked = props.onRowClicked as (event: { data?: Record<string, unknown> }) => void

    act(() => {
      onRowClicked({})
    })
  })

  it('onCellEditingStarted ignores events without data', async () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
    const props = mockCalls[0][0] as Record<string, unknown>
    const onCellEditingStarted = props.onCellEditingStarted as (event: {
      data?: Record<string, unknown>
    }) => Promise<void>

    await act(async () => {
      await onCellEditingStarted({})
    })
  })

  it('onCellEditingStarted does NOT reset edit state when staying on same row', async () => {
    setupConnection()
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { id: 1, name: 'Alice', avatar: null },
      currentValues: { id: 1, name: 'Modified', avatar: null },
      modifiedColumns: new Set(['name']),
      isNewRow: false,
    }
    setupTabState({ editState })
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
    const props = mockCalls[0][0] as Record<string, unknown>
    const onCellEditingStarted = props.onCellEditingStarted as (event: {
      data: Record<string, unknown>
      colDef: { field: string }
    }) => Promise<void>

    await act(async () => {
      await onCellEditingStarted({
        data: { id: 1, name: 'Modified', avatar: null, __rowIndex: 0 },
        colDef: { field: 'avatar' },
      })
    })

    // Edit state should be PRESERVED — not reset
    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState).not.toBeNull()
    expect(state?.editState?.modifiedColumns.has('name')).toBe(true)
    expect(state?.editState?.currentValues.name).toBe('Modified')
  })

  it('handleSortChanged dispatches sort action', async () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
    const props = mockCalls[0][0] as Record<string, unknown>
    const onSortChanged = props.onSortChanged as (event: {
      api: { getColumnState: () => Array<{ colId: string; sort: string | null }> }
    }) => void

    act(() => {
      onSortChanged({
        api: {
          getColumnState: () => [
            { colId: 'id', sort: 'asc' },
            { colId: 'name', sort: null },
          ],
        },
      })
    })

    await flushAsyncTableDataUpdates()
  })

  it('handleSortChanged handles sort cleared', async () => {
    setupConnection()
    setupTabState({ sort: { column: 'id', direction: 'asc' } })
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
    const props = mockCalls[0][0] as Record<string, unknown>
    const onSortChanged = props.onSortChanged as (event: {
      api: { getColumnState: () => Array<{ colId: string; sort: string | null }> }
    }) => void

    act(() => {
      onSortChanged({
        api: {
          getColumnState: () => [
            { colId: 'id', sort: null },
            { colId: 'name', sort: null },
          ],
        },
      })
    })

    await flushAsyncTableDataUpdates()
  })

  it('handleFilterChanged dispatches filter action', async () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
    const props = mockCalls[0][0] as Record<string, unknown>
    const onFilterChanged = props.onFilterChanged as (event: {
      api: { getFilterModel: () => Record<string, unknown> }
    }) => void

    act(() => {
      onFilterChanged({
        api: {
          getFilterModel: () => ({
            name: { filterType: 'text', type: 'contains', filter: 'alice' },
          }),
        },
      })
    })

    await flushAsyncTableDataUpdates()
  })

  it('rowData carries __tempId for new row in editState', () => {
    setupConnection()
    setupTabState({
      rows: [
        [1, 'Alice', null],
        [null, '', null],
      ],
      editState: {
        rowKey: { __tempId: 'temp-1' },
        originalValues: {},
        currentValues: { id: null, name: '', avatar: null },
        modifiedColumns: new Set(),
        isNewRow: true,
        tempId: 'temp-1',
      },
    })
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
    const props = mockCalls[0][0] as Record<string, unknown>
    const rowData = props.rowData as Array<Record<string, unknown>>
    // Last row should have __tempId
    expect(rowData[rowData.length - 1].__tempId).toBe('temp-1')
    // First row should not
    expect(rowData[0].__tempId).toBeUndefined()
  })

  it('passes framework components (tableDataCellRenderer and nullableCellEditor)', () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
    const props = mockCalls[0][0] as Record<string, unknown>
    const components = props.components as Record<string, unknown>
    expect(components.tableDataCellRenderer).toBeDefined()
    expect(components.nullableCellEditor).toBeDefined()
  })

  it('passes singleClickEdit and stopEditingWhenCellsLoseFocus to AG Grid', () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
    const props = mockCalls[0][0] as Record<string, unknown>
    expect(props.singleClickEdit).toBe(true)
    expect(props.stopEditingWhenCellsLoseFocus).toBe(true)
  })

  it('onCellEditingStarted snaps back when save fails on row switch', async () => {
    // Make updateTableRow reject to simulate save failure
    ;(updateTableRow as Mock).mockRejectedValueOnce(new Error('Save failed'))

    setupConnection()
    // Set up tab with an edit that has modifications (triggers save on row switch)
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { id: 1, name: 'Alice', avatar: null },
      currentValues: { id: 1, name: 'Modified', avatar: null },
      modifiedColumns: new Set(['name']),
      isNewRow: false,
    }
    setupTabState({ editState })
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
    const props = mockCalls[0][0] as Record<string, unknown>
    const stopEditingMock = vi.fn()
    const onCellEditingStarted = props.onCellEditingStarted as (event: {
      data: Record<string, unknown>
      colDef: { field: string }
      api: { stopEditing: (cancel?: boolean) => void }
    }) => Promise<void>

    await act(async () => {
      await onCellEditingStarted({
        data: { id: 2, name: 'Bob', avatar: null, __rowIndex: 1 },
        colDef: { field: 'name' },
        api: { stopEditing: stopEditingMock },
      })
    })

    // Save failed — editState should remain on the original row (id=1)
    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.saveError).toBe('Save failed')
    expect(state?.editState).not.toBeNull()
    expect(state?.editState?.rowKey).toEqual({ id: 1 })
    expect(mockShowError).toHaveBeenCalledWith('Save failed', 'Save failed')
    // stopEditing(true) should have been called to cancel the new cell
    expect(stopEditingMock).toHaveBeenCalledWith(true)
    // selectedRowKey should snap back to the failed row
    expect(state?.selectedRowKey).toEqual({ id: 1 })
  })
})
