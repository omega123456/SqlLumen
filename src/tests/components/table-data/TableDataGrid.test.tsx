import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock react-data-grid DataGrid before importing the component
const mockDataGridFn = vi.fn()
const mockSelectCell = vi.fn()

vi.mock('../../../components/shared/DataGrid', async () => {
  const React = await import('react')
  return {
    DataGrid: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      mockDataGridFn(props)
      React.useImperativeHandle(ref, () => ({
        selectCell: mockSelectCell,
      }))
      const columns = props.columns as Array<{ key: string; name: string }>
      const rows = props.rows as Array<Record<string, unknown>>

      return React.createElement(
        'div',
        { 'data-testid': 'data-grid-inner' },
        React.createElement(
          'div',
          { 'data-testid': 'data-grid-headers' },
          columns?.map((col) =>
            React.createElement('span', { key: col.key, 'data-field': col.key }, col.name)
          )
        ),
        React.createElement(
          'div',
          { 'data-testid': 'data-grid-rows' },
          rows?.map((row, i) =>
            React.createElement(
              'div',
              { key: i, 'data-testid': `data-grid-row-${i}` },
              ...Object.entries(row)
                .filter(([key]) => !key.startsWith('__'))
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
      showWarning: vi.fn(),
      dismiss: vi.fn(),
    }
    return selector(state)
  }),
  showErrorToast: mockShowError,
  showSuccessToast: mockShowSuccess,
  showWarningToast: vi.fn(),
}))

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import type { Mock } from 'vitest'
import { useTableDataStore } from '../../../stores/table-data-store'
import { useConnectionStore } from '../../../stores/connection-store'
import sharedStyles from '../../../components/shared/grid-cell-editors.module.css'
import { TableDataGrid } from '../../../components/table-data/TableDataGrid'
import { TableDataToolbar } from '../../../components/table-data/TableDataToolbar'
import { NullableCellEditor, EnumCellEditor } from '../../../components/shared/grid-cell-editors'
import { updateTableRow } from '../../../lib/table-data-commands'
import type { TableDataColumnMeta, TableDataTabState, RowEditState } from '../../../types/schema'
import { buildColumnDescriptors } from '../../../components/table-data/table-data-grid-columns'

function getLatestGridProps(): Record<string, unknown> {
  const mockCalls = mockDataGridFn.mock.calls
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
  {
    name: 'avatar',
    dataType: 'blob',
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

function makeColumnMeta(
  name: string,
  dataType: string,
  overrides: Partial<TableDataColumnMeta> = {}
): TableDataColumnMeta {
  return {
    name,
    dataType,
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isBooleanAlias: false,
    isAutoIncrement: false,
    ...overrides,
  }
}

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
    filterModel: [],
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

describe('buildColumnDescriptors', () => {
  it('creates correct column descriptors', () => {
    const defs = buildColumnDescriptors(testColumns, false, true, [])
    expect(defs).toHaveLength(3)
    expect(defs[0].key).toBe('id')
    expect(defs[0].displayName).toBe('id')
    expect(defs[1].key).toBe('name')
    expect(defs[2].key).toBe('avatar')
  })

  it('marks binary columns as NOT editable', () => {
    const defs = buildColumnDescriptors(testColumns, false, true, [])
    expect(defs[0].editable).toBe(true) // id (non-binary)
    expect(defs[1].editable).toBe(true) // name (non-binary)
    expect(defs[2].editable).toBe(false) // avatar (binary)
  })

  it('all columns non-editable when read-only', () => {
    const defs = buildColumnDescriptors(testColumns, true, true, [])
    defs.forEach((d) => {
      expect(d.editable).toBe(false)
    })
  })

  it('all columns non-editable when no PK', () => {
    const defs = buildColumnDescriptors(testColumns, false, false, [])
    defs.forEach((d) => {
      expect(d.editable).toBe(false)
    })
  })

  it('assigns body/primary vs mono-muted cell classes via rendered column defs', () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{
      key: string
      cellClass: (row: Record<string, unknown>) => string
    }>
    // PK column → mono-muted
    expect(colDefs[0].cellClass({})).toContain('td-cell-mono-muted')
    // varchar column → body + primary
    expect(colDefs[1].cellClass({})).toContain('td-cell-body')
    expect(colDefs[1].cellClass({})).toContain('td-cell-primary')
    // blob column → body
    expect(colDefs[2].cellClass({})).toContain('td-cell-body')
  })

  it('has sensible column widths via rendered column defs', () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{ key: string; width: number }>
    colDefs.forEach((d) => {
      expect(d.width).toBeGreaterThan(0)
    })
  })

  it('all columns are sortable and resizable via rendered column defs', () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{ key: string; sortable: boolean; resizable: boolean }>
    colDefs.forEach((d) => {
      expect(d.sortable).toBe(true)
      expect(d.resizable).toBe(true)
    })
  })
})

describe('TableDataGrid', () => {
  it('renders with data-testid="table-data-grid"', () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    expect(screen.getByTestId('table-data-grid')).toBeInTheDocument()
  })

  it('transforms row data from arrays to objects', () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const props = getLatestGridProps()
    const rowData = props.rows as Array<Record<string, unknown>>
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
    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{ key: string }>
    expect(colDefs).toHaveLength(3)
  })

  it('auto-sizes columns from visible row data by default', () => {
    setupConnection()
    setupTabState({
      columns: [testColumns[0], testColumns[1], makeColumnMeta('email', 'varchar')],
      rows: [
        [1, 'Al', 'avery.long.email.address@example.com'],
        [2, 'Bob', 'b@example.com'],
      ],
    })

    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)

    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{ key: string; width: number }>
    const nameCol = colDefs.find((d) => d.key === 'name')
    const emailCol = colDefs.find((d) => d.key === 'email')

    expect(nameCol).toBeDefined()
    expect(emailCol).toBeDefined()
    expect(emailCol!.width).toBeGreaterThan(nameCol!.width)
  })

  it('auto-size uses only the target column values — other columns do not inflate width', () => {
    // name has short values; a third column has very long values.
    // With the single-column proxy, sizing 'name' uses only name values,
    // so name stays narrow even though the same rows contain long values elsewhere.
    setupConnection()
    setupTabState({
      columns: [testColumns[0], testColumns[1], makeColumnMeta('notes', 'varchar')],
      rows: [
        [1, 'Hi', 'a'.repeat(300)],
        [2, 'Ok', 'b'.repeat(300)],
      ],
    })

    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)

    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{ key: string; width: number }>
    const nameCol = colDefs.find((d) => d.key === 'name')
    const notesCol = colDefs.find((d) => d.key === 'notes')

    expect(nameCol).toBeDefined()
    expect(notesCol).toBeDefined()
    // notes column is capped at AUTO_WIDTH_MAX (560px); name column is narrow
    expect(notesCol!.width).toBeGreaterThan(nameCol!.width)
    // Verify name is sized to its own short values, not to the long notes values
    expect(nameCol!.width).toBeLessThan(200)
  })

  it('keeps FK icon width in auto-sizing when the grid mounts with an active edit state', () => {
    setupConnection()
    setupTabState({
      columns: [testColumns[0], makeColumnMeta('user_id', 'BIGINT')],
      rows: [[1, 42]],
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, user_id: 42 },
        currentValues: { id: 1, user_id: 42 },
        modifiedColumns: new Set<string>(),
        isNewRow: false,
      },
      foreignKeys: [],
    })

    const { unmount } = render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)

    const withoutFkProps = getLatestGridProps()
    const withoutFkCols = withoutFkProps.columns as Array<{ key: string; width: number }>
    const withoutFkWidth = withoutFkCols.find((d) => d.key === 'user_id')?.width

    unmount()

    setupConnection()
    setupTabState({
      columns: [testColumns[0], makeColumnMeta('user_id', 'BIGINT')],
      rows: [[1, 42]],
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, user_id: 42 },
        currentValues: { id: 1, user_id: 42 },
        modifiedColumns: new Set<string>(),
        isNewRow: false,
      },
      foreignKeys: [
        {
          columnName: 'user_id',
          referencedDatabase: 'test_db',
          referencedTable: 'users',
          referencedColumn: 'id',
          constraintName: 'fk_user',
        },
      ],
    })

    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)

    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{ key: string; width: number }>
    const fkCol = colDefs.find((d) => d.key === 'user_id')

    expect(withoutFkWidth).toBeDefined()
    expect(fkCol).toBeDefined()
    expect(fkCol!.width).toBeGreaterThan(withoutFkWidth!)
    expect(fkCol!.width - withoutFkWidth!).toBe(14)
  })

  it('gives temporal columns a wider default width for inline editing controls', () => {
    setupConnection()
    setupTabState({
      columns: [testColumns[0], makeColumnMeta('created_at', 'DATETIME')],
      rows: [[1, '2023-11-24 14:30:00']],
    })

    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)

    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{ key: string; width: number }>
    const createdAtCol = colDefs.find((d) => d.key === 'created_at')

    expect(createdAtCol).toBeDefined()
    expect(createdAtCol!.width).toBeGreaterThanOrEqual(240)
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

  it('editable columns have renderEditCell defined', () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{ key: string; renderEditCell?: unknown }>
    // id and name are editable
    expect(colDefs[0].renderEditCell).toBeDefined()
    expect(colDefs[1].renderEditCell).toBeDefined()
    // avatar (binary) is not editable
    expect(colDefs[2].renderEditCell).toBeUndefined()
  })

  it('read-only columns do not have renderEditCell', () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={true} />)
    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{ key: string; renderEditCell?: unknown }>
    colDefs.forEach((d) => {
      expect(d.renderEditCell).toBeUndefined()
    })
  })

  it('no PK columns do not have renderEditCell', () => {
    setupConnection()
    setupTabState({ primaryKey: null })
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{ key: string; renderEditCell?: unknown }>
    colDefs.forEach((d) => {
      expect(d.renderEditCell).toBeUndefined()
    })
  })

  it('passes sort indicator when sort is set', () => {
    setupConnection()
    setupTabState({ sort: { column: 'name', direction: 'desc' } })
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const props = getLatestGridProps()
    const sortColumns = props.sortColumns as Array<{ columnKey: string; direction: string }>
    expect(sortColumns).toHaveLength(1)
    expect(sortColumns[0].columnKey).toBe('name')
    expect(sortColumns[0].direction).toBe('DESC')
  })

  it('rowKeyGetter uses __tempId for new rows', () => {
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
    const props = getLatestGridProps()
    const rowKeyGetter = props.rowKeyGetter as (row: Record<string, unknown>) => string
    // Row with __tempId
    expect(rowKeyGetter({ __tempId: 'temp-1', id: null })).toBe('temp-1')
    // Normal row with PK
    expect(rowKeyGetter({ __rowIndex: 0, id: 42 })).toBe(JSON.stringify([42]))
  })

  it('rowKeyGetter falls back to __rowIndex when no PK', () => {
    setupConnection()
    setupTabState({ primaryKey: null })
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const props = getLatestGridProps()
    const rowKeyGetter = props.rowKeyGetter as (row: Record<string, unknown>) => string
    expect(rowKeyGetter({ __rowIndex: 5 })).toBe('5')
  })

  it('rowClass returns editing class for active edit row', () => {
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
    const props = getLatestGridProps()
    const rowClass = props.rowClass as (row: Record<string, unknown>) => string | undefined
    // Row matching editState
    expect(rowClass({ id: 1, __rowIndex: 0 })).toBe('rdg-editing-row')
    // Different row
    expect(rowClass({ id: 2, __rowIndex: 1 })).toBeUndefined()
  })

  it('rowClass returns new-row class for new row edit', () => {
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
    const props = getLatestGridProps()
    const rowClass = props.rowClass as (row: Record<string, unknown>) => string | undefined
    expect(rowClass({ __tempId: 'temp-1', __rowIndex: 0 })).toBe('rdg-editing-row rdg-new-row')
  })

  it('cellClass includes rdg-modified-cell for modified cells', () => {
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
    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{
      key: string
      cellClass: (row: Record<string, unknown>) => string
    }>
    const nameCol = colDefs.find((d) => d.key === 'name')!
    // Modified column on matching row
    expect(nameCol.cellClass({ id: 1 })).toContain('rdg-modified-cell')
    // Unmodified column on matching row
    const idCol = colDefs.find((d) => d.key === 'id')!
    expect(idCol.cellClass({ id: 1 })).not.toContain('rdg-modified-cell')
    // Modified column on different row
    expect(nameCol.cellClass({ id: 2 })).not.toContain('rdg-modified-cell')
  })

  it('cellClass includes rdg-editable-cell when writable with PK', () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{
      key: string
      cellClass: (row: Record<string, unknown>) => string
    }>
    expect(colDefs[0].cellClass({ id: 1 })).toContain('rdg-editable-cell')
  })

  it('cellClass does not include rdg-editable-cell when readOnly', () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={true} />)
    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{
      key: string
      cellClass: (row: Record<string, unknown>) => string
    }>
    expect(colDefs[0].cellClass({ id: 1 })).not.toContain('rdg-editable-cell')
  })

  it('onCellClick starts editing in the store', async () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const props = getLatestGridProps()
    const onCellClick = props.onCellClick as (
      args: {
        row: Record<string, unknown>
        column: { key: string; idx: number }
        rowIdx: number
      },
      event: { preventGridDefault: () => void }
    ) => Promise<void>

    await act(async () => {
      await onCellClick(
        {
          row: { id: 1, name: 'Alice', avatar: null, __rowIndex: 0 },
          column: { key: 'name', idx: 1 },
          rowIdx: 0,
        },
        { preventGridDefault: vi.fn() }
      )
    })

    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState).not.toBeNull()
    expect(state?.editState?.rowKey).toEqual({ id: 1 })
  })

  it('onCellClick sets selected row in store', async () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const props = getLatestGridProps()
    const onCellClick = props.onCellClick as (
      args: {
        row: Record<string, unknown>
        column: { key: string; idx: number }
        rowIdx: number
      },
      event: { preventGridDefault: () => void }
    ) => Promise<void>

    await act(async () => {
      await onCellClick(
        {
          row: { id: 2, name: null, avatar: '[BLOB 32 bytes]', __rowIndex: 1 },
          column: { key: 'name', idx: 1 },
          rowIdx: 1,
        },
        { preventGridDefault: vi.fn() }
      )
    })

    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.selectedRowKey).toEqual({ id: 2 })
  })

  it('onCellClick does NOT reset edit state when staying on same row', async () => {
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
    const props = getLatestGridProps()
    const onCellClick = props.onCellClick as (
      args: {
        row: Record<string, unknown>
        column: { key: string; idx: number }
        rowIdx: number
      },
      event: { preventGridDefault: () => void }
    ) => Promise<void>

    await act(async () => {
      await onCellClick(
        {
          row: { id: 1, name: 'Modified', avatar: null, __rowIndex: 0, __editingRowKey: { id: 1 } },
          column: { key: 'id', idx: 0 },
          rowIdx: 0,
        },
        { preventGridDefault: vi.fn() }
      )
    })

    // Edit state should be PRESERVED — not reset
    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState).not.toBeNull()
    expect(state?.editState?.modifiedColumns.has('name')).toBe(true)
    expect(state?.editState?.currentValues.name).toBe('Modified')
  })

  it('enumCellEditor writes null when NULL option is selected', async () => {
    const user = userEvent.setup()
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

    const editor = render(
      <EnumCellEditor
        row={{ id: 1, status: 'active' }}
        column={{ key: 'status' }}
        onRowChange={vi.fn()}
        onClose={vi.fn()}
        isNullable={true}
        columnMeta={
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
          } as TableDataColumnMeta
        }
        tabId="tab-1"
        updateCellValue={useTableDataStore.getState().updateCellValue}
        syncCellValue={useTableDataStore.getState().syncCellValue}
      />
    )

    await user.click(editor.getByRole('combobox'))
    await user.click(editor.getByRole('option', { name: 'NULL' }))

    expect(useTableDataStore.getState().tabs['tab-1']?.editState?.currentValues.status).toBeNull()
  })

  it('all columns use renderCell (TableDataCellRenderer)', () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{ key: string; renderCell?: unknown }>
    colDefs.forEach((d) => {
      expect(d.renderCell).toBeDefined()
    })
  })

  it('handleSortColumnsChange dispatches sort action', async () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const props = getLatestGridProps()
    const onSortColumnsChange = props.onSortColumnsChange as (
      sortCols: Array<{ columnKey: string; direction: string }>
    ) => void

    act(() => {
      onSortColumnsChange([{ columnKey: 'id', direction: 'ASC' }])
    })

    await flushAsyncTableDataUpdates()
  })

  it('handleSortColumnsChange handles sort cleared', async () => {
    setupConnection()
    setupTabState({ sort: { column: 'id', direction: 'asc' } })
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)
    const props = getLatestGridProps()
    const onSortColumnsChange = props.onSortColumnsChange as (
      sortCols: Array<{ columnKey: string; direction: string }>
    ) => void

    act(() => {
      onSortColumnsChange([])
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
    const props = getLatestGridProps()
    const rowData = props.rows as Array<Record<string, unknown>>
    // Last row should have __tempId
    expect(rowData[rowData.length - 1].__tempId).toBe('temp-1')
    // First row should not
    expect(rowData[0].__tempId).toBeUndefined()
  })

  it('typing in the cell editor immediately enables save and preserves changes on row switch', async () => {
    setupConnection()
    setupTabState()

    // First, start editing by simulating cell click
    render(
      <>
        <TableDataToolbar tabId="tab-1" />
        <TableDataGrid tabId="tab-1" isReadOnly={false} />
      </>
    )

    // Start editing row 1
    const props = getLatestGridProps()
    const onCellClick = props.onCellClick as (
      args: {
        row: Record<string, unknown>
        column: { key: string; idx: number }
        rowIdx: number
      },
      event: { preventGridDefault: () => void }
    ) => Promise<void>

    await act(async () => {
      await onCellClick(
        {
          row: { id: 1, name: null, avatar: null, __rowIndex: 0 },
          column: { key: 'name', idx: 1 },
          rowIdx: 0,
        },
        { preventGridDefault: vi.fn() }
      )
    })

    // Render the editor standalone and type a value
    const editor = render(
      <NullableCellEditor
        row={{ id: 1, name: null }}
        column={{ key: 'name' }}
        onRowChange={vi.fn()}
        onClose={vi.fn()}
        isNullable={true}
        columnMeta={testColumns[1]}
        tabId="tab-1"
        updateCellValue={useTableDataStore.getState().updateCellValue}
        syncCellValue={useTableDataStore.getState().syncCellValue}
      />
    )
    const input = editor.getByRole('textbox') as HTMLInputElement

    expect(input).not.toBeDisabled()
    expect(input.value).toBe('')

    fireEvent.change(input, { target: { value: 'Bob' } })

    expect(input.value).toBe('Bob')
    expect(useTableDataStore.getState().tabs['tab-1']?.editState?.currentValues.name).toBe('Bob')
    expect(screen.getByTestId('btn-save')).not.toBeDisabled()

    // Now switch to row 2 by simulating cell click
    const latestProps = getLatestGridProps()
    const latestOnCellClick = latestProps.onCellClick as typeof onCellClick

    await act(async () => {
      await latestOnCellClick(
        {
          row: { id: 2, name: null, avatar: '[BLOB 32 bytes]', __rowIndex: 1 },
          column: { key: 'name', idx: 1 },
          rowIdx: 1,
        },
        { preventGridDefault: vi.fn() }
      )
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

    // Start editing
    const props = getLatestGridProps()
    const onCellClick = props.onCellClick as (
      args: {
        row: Record<string, unknown>
        column: { key: string; idx: number }
        rowIdx: number
      },
      event: { preventGridDefault: () => void }
    ) => Promise<void>

    await act(async () => {
      await onCellClick(
        {
          row: { id: 1, name: null, avatar: null, __rowIndex: 0 },
          column: { key: 'name', idx: 1 },
          rowIdx: 0,
        },
        { preventGridDefault: vi.fn() }
      )
    })

    // Render editor and type a value
    const editor = render(
      <NullableCellEditor
        row={{ id: 1, name: null }}
        column={{ key: 'name' }}
        onRowChange={vi.fn()}
        onClose={vi.fn()}
        isNullable={true}
        columnMeta={testColumns[1]}
        tabId="tab-1"
        updateCellValue={useTableDataStore.getState().updateCellValue}
        syncCellValue={useTableDataStore.getState().syncCellValue}
      />
    )
    const input = editor.getByRole('textbox') as HTMLInputElement

    fireEvent.change(input, { target: { value: 'Canceled' } })
    expect(screen.getByTestId('btn-save')).not.toBeDisabled()

    // Press Escape — editor restores original value
    fireEvent.keyDown(input, { key: 'Escape' })

    // After Escape, the editor synced the original null value back. modifiedColumns is empty.
    // Call clearEditStateIfUnmodified to simulate what the component would do on editor close.
    act(() => {
      const tab = useTableDataStore.getState().tabs['tab-1']
      if (tab?.editState) {
        useTableDataStore.getState().clearEditStateIfUnmodified('tab-1', tab.editState.rowKey)
      }
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
    const rowData = props.rows as Array<Record<string, unknown>>
    const rowKeyGetter = props.rowKeyGetter as (row: Record<string, unknown>) => string

    expect(rowData[0].id).toBe(10)
    expect(rowKeyGetter(rowData[0])).toBe(JSON.stringify([1]))

    // Click same row, different column
    const onCellClick = props.onCellClick as (
      args: {
        row: Record<string, unknown>
        column: { key: string; idx: number }
        rowIdx: number
      },
      event: { preventGridDefault: () => void }
    ) => Promise<void>

    await act(async () => {
      await onCellClick(
        {
          row: rowData[0],
          column: { key: 'name', idx: 1 },
          rowIdx: 0,
        },
        { preventGridDefault: vi.fn() }
      )
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
          isBooleanAlias: false,
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
    const rowData = props.rows as Array<Record<string, unknown>>
    const onCellClick = props.onCellClick as (
      args: {
        row: Record<string, unknown>
        column: { key: string; idx: number }
        rowIdx: number
      },
      event: { preventGridDefault: () => void }
    ) => Promise<void>

    await act(async () => {
      await onCellClick(
        {
          row: rowData[1],
          column: { key: 'created_at', idx: 1 },
          rowIdx: 1,
        },
        { preventGridDefault: vi.fn() }
      )
    })

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(
        'Invalid date value',
        expect.stringContaining('created_at')
      )
    })
    expect(updateTableRow).not.toHaveBeenCalled()
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
          isBooleanAlias: false,
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
    const rowData = props.rows as Array<Record<string, unknown>>
    const onCellClick = props.onCellClick as (
      args: {
        row: Record<string, unknown>
        column: { key: string; idx: number }
        rowIdx: number
      },
      event: { preventGridDefault: () => void }
    ) => Promise<void>

    await act(async () => {
      await onCellClick(
        {
          row: rowData[1],
          column: { key: 'created_at', idx: 1 },
          rowIdx: 1,
        },
        { preventGridDefault: vi.fn() }
      )
    })

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(
        'Invalid date value',
        expect.stringContaining('created_at')
      )
    })
    expect(updateTableRow).not.toHaveBeenCalled()
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
    const rowData = props.rows as Array<Record<string, unknown>>
    const onCellClick = props.onCellClick as (
      args: {
        row: Record<string, unknown>
        column: { key: string; idx: number }
        rowIdx: number
      },
      event: { preventGridDefault: () => void }
    ) => Promise<void>

    await act(async () => {
      await onCellClick(
        {
          row: rowData[1],
          column: { key: 'name', idx: 1 },
          rowIdx: 1,
        },
        { preventGridDefault: vi.fn() }
      )
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

  it('onCellClick snaps back when save fails on row switch', async () => {
    ;(updateTableRow as Mock).mockRejectedValueOnce(new Error('Save failed'))

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
    const props = getLatestGridProps()
    const onCellClick = props.onCellClick as (
      args: {
        row: Record<string, unknown>
        column: { key: string; idx: number }
        rowIdx: number
      },
      event: { preventGridDefault: () => void }
    ) => Promise<void>

    await act(async () => {
      await onCellClick(
        {
          row: { id: 2, name: 'Bob', avatar: null, __rowIndex: 1 },
          column: { key: 'name', idx: 1 },
          rowIdx: 1,
        },
        { preventGridDefault: vi.fn() }
      )
    })

    // Save failed — editState should remain on the original row (id=1)
    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.saveError).toBe('Save failed')
    expect(state?.editState).not.toBeNull()
    expect(state?.editState?.rowKey).toEqual({ id: 1 })
    expect(mockShowError).toHaveBeenCalledWith('Save failed', 'Save failed')
    // selectedRowKey should snap back to the failed row
    expect(state?.selectedRowKey).toEqual({ id: 1 })
    expect(mockSelectCell).toHaveBeenCalledWith(
      { rowIdx: 0, idx: 1 },
      expect.objectContaining({ shouldFocusCell: true })
    )
  })

  it('preserves the original editing row identity when committing a primary-key edit', async () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)

    const initialProps = getLatestGridProps()
    const initialRows = initialProps.rows as Array<Record<string, unknown>>
    const onCellClick = initialProps.onCellClick as (
      args: {
        row: Record<string, unknown>
        column: { key: string; idx: number }
        rowIdx: number
      },
      event: { preventGridDefault: () => void }
    ) => Promise<void>

    await act(async () => {
      await onCellClick(
        {
          row: initialRows[0],
          column: { key: 'id', idx: 0 },
          rowIdx: 0,
        },
        { preventGridDefault: vi.fn() }
      )
    })

    const editingProps = getLatestGridProps()
    const editingRows = editingProps.rows as Array<Record<string, unknown>>
    const onRowsChange = editingProps.onRowsChange as (
      rows: Array<Record<string, unknown>>,
      data: { indexes: number[]; column?: { key: string } }
    ) => void

    act(() => {
      const nextRows = [...editingRows]
      nextRows[0] = { ...editingRows[0], id: 10 }
      onRowsChange(nextRows, { indexes: [0], column: { key: 'id' } })
    })

    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState?.rowKey).toEqual({ id: 10 })
    expect(state?.selectedRowKey).toEqual({ id: 10 })
  })

  it('clears no-op edit state via onRowsChange', () => {
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
    const props = getLatestGridProps()
    const onRowsChange = props.onRowsChange as (
      rows: Array<Record<string, unknown>>,
      data: { indexes: number[] }
    ) => void

    act(() => {
      onRowsChange([{ id: 1, name: 'Alice', avatar: null, __rowIndex: 0 }], { indexes: [0] })
    })

    expect(useTableDataStore.getState().tabs['tab-1']?.editState).toBeNull()
  })

  it('committed same-row edits update the visible grid row before save', () => {
    setupConnection()
    setupTabState({
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, name: 'Alice', avatar: null },
        currentValues: { id: 1, name: 'Alice', avatar: null },
        modifiedColumns: new Set<string>(),
        isNewRow: false,
      },
    })
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)

    act(() => {
      useTableDataStore.getState().updateCellValue('tab-1', 'name', 'Bob')
    })

    const propsAfterTyping = getLatestGridProps()
    const onRowsChange = propsAfterTyping.onRowsChange as (
      rows: Array<Record<string, unknown>>,
      data: { indexes: number[]; column: { key: string } }
    ) => void

    act(() => {
      onRowsChange(
        [
          { id: 1, name: 'Bob', avatar: null, __rowIndex: 0 },
          { id: 2, name: null, avatar: '[BLOB 32 bytes]', __rowIndex: 1 },
        ],
        { indexes: [0], column: { key: 'name' } }
      )
    })

    const latestProps = getLatestGridProps()
    const latestRows = latestProps.rows as Array<Record<string, unknown>>

    expect(useTableDataStore.getState().tabs['tab-1']?.rows[0]?.[1]).toBe('Bob')
    expect(latestRows[0].name).toBe('Bob')
  })

  it('committed primary-key edits still sync the visible grid row before save', () => {
    setupConnection()
    setupTabState({
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, name: 'Alice', avatar: null },
        currentValues: { id: 10, name: 'Alice', avatar: null },
        modifiedColumns: new Set<string>(['id']),
        isNewRow: false,
      },
    })
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)

    const props = getLatestGridProps()
    const onRowsChange = props.onRowsChange as (
      rows: Array<Record<string, unknown>>,
      data: { indexes: number[]; column: { key: string } }
    ) => void

    act(() => {
      onRowsChange(
        [
          { id: 10, name: 'Alice', avatar: null, __rowIndex: 0, __editingRowKey: { id: 1 } },
          { id: 2, name: null, avatar: '[BLOB 32 bytes]', __rowIndex: 1 },
        ],
        { indexes: [0], column: { key: 'id' } }
      )
    })

    expect(useTableDataStore.getState().tabs['tab-1']?.rows[0]?.[0]).toBe(10)
  })

  it('after a primary-key edit commits, the same row remains the active editing row for follow-up edits', async () => {
    setupConnection()
    setupTabState({
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, name: 'Alice', avatar: null },
        currentValues: { id: 10, name: 'Alice', avatar: null },
        modifiedColumns: new Set<string>(['id']),
        isNewRow: false,
      },
    })
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)

    const props = getLatestGridProps()
    const onRowsChange = props.onRowsChange as (
      rows: Array<Record<string, unknown>>,
      data: { indexes: number[]; column: { key: string } }
    ) => void
    const onCellClick = props.onCellClick as (
      args: {
        row: Record<string, unknown>
        column: { key: string; idx: number }
        rowIdx: number
      },
      event: { preventGridDefault: () => void }
    ) => Promise<void>

    act(() => {
      onRowsChange(
        [
          { id: 10, name: 'Alice', avatar: null, __rowIndex: 0, __editingRowKey: { id: 1 } },
          { id: 2, name: null, avatar: '[BLOB 32 bytes]', __rowIndex: 1 },
        ],
        { indexes: [0], column: { key: 'id' } }
      )
    })

    const latestProps = getLatestGridProps()
    const latestRows = latestProps.rows as Array<Record<string, unknown>>

    await act(async () => {
      await onCellClick(
        {
          row: latestRows[0],
          column: { key: 'name', idx: 1 },
          rowIdx: 0,
        },
        { preventGridDefault: vi.fn() }
      )
    })

    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState?.rowKey).toEqual({ id: 10 })
    expect(state?.editState?.currentValues.id).toBe(10)
  })

  it('cell clipboard edit pastes into editable table-data cells', async () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)

    const props = getLatestGridProps()
    const onCellKeyDown = props.onCellKeyDown as (
      args: {
        mode: 'SELECT'
        row: Record<string, unknown>
        rowIdx: number
        column: { key: string; idx: number; editable?: boolean }
        selectCell: (position: { rowIdx: number; idx: number }) => void
      },
      event: {
        key: string
        ctrlKey?: boolean
        metaKey?: boolean
        shiftKey?: boolean
        preventGridDefault: () => void
        isGridDefaultPrevented: () => boolean
      }
    ) => void

    const prevClipboard = navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: vi.fn().mockResolvedValue('Pasted Name'), writeText: vi.fn() },
    })

    await act(async () => {
      onCellKeyDown(
        {
          mode: 'SELECT',
          row: { id: 1, name: 'Alice', avatar: null, __rowIndex: 0 },
          rowIdx: 0,
          column: { key: 'name', idx: 1, editable: true },
          selectCell: vi.fn(),
        },
        {
          key: 'v',
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
          preventGridDefault: vi.fn(),
          isGridDefaultPrevented: () => false,
        }
      )
    })

    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: prevClipboard })

    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState?.currentValues.name).toBe('Pasted Name')
    expect(state?.rows[0]?.[1]).toBe('Pasted Name')
  })

  it('cell clipboard edit cuts editable table-data cells to NULL', async () => {
    setupConnection()
    setupTabState()
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)

    const props = getLatestGridProps()
    const onCellKeyDown = props.onCellKeyDown as (
      args: {
        mode: 'SELECT'
        row: Record<string, unknown>
        rowIdx: number
        column: { key: string; idx: number; editable?: boolean }
        selectCell: (position: { rowIdx: number; idx: number }) => void
      },
      event: {
        key: string
        ctrlKey?: boolean
        metaKey?: boolean
        shiftKey?: boolean
        preventGridDefault: () => void
        isGridDefaultPrevented: () => boolean
      }
    ) => void

    const prevClipboard = navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined), readText: vi.fn() },
    })

    await act(async () => {
      onCellKeyDown(
        {
          mode: 'SELECT',
          row: { id: 1, name: 'Alice', avatar: null, __rowIndex: 0 },
          rowIdx: 0,
          column: { key: 'name', idx: 1, editable: true },
          selectCell: vi.fn(),
        },
        {
          key: 'x',
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
          preventGridDefault: vi.fn(),
          isGridDefaultPrevented: () => false,
        }
      )
    })

    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: prevClipboard })

    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState?.currentValues.name).toBeNull()
    expect(state?.rows[0]?.[1]).toBeNull()
  })

  it('Add Row prepopulates column defaults in the new grid row', () => {
    setupConnection()
    setupTabState({
      columns: [
        testColumns[0],
        testColumns[1],
        {
          name: 'status',
          dataType: 'ENUM',
          isNullable: false,
          isPrimaryKey: false,
          isUniqueKey: false,
          hasDefault: true,
          columnDefault: 'active',
          isBinary: false,
          isAutoIncrement: false,
          enumValues: ['active', 'disabled'],
        } as TableDataColumnMeta,
      ],
      rows: [
        [1, 'Alice', 'disabled'],
        [2, 'Bob', 'active'],
      ],
    })
    render(
      <>
        <TableDataToolbar tabId="tab-1" />
        <TableDataGrid tabId="tab-1" isReadOnly={false} />
      </>
    )

    fireEvent.click(screen.getByTestId('btn-add-row'))

    const latestProps = getLatestGridProps()
    const rowData = latestProps.rows as Array<Record<string, unknown>>
    const newRow = rowData[rowData.length - 1]

    expect(newRow.status).toBe('active')
    expect(useTableDataStore.getState().tabs['tab-1']?.editState?.currentValues.status).toBe(
      'active'
    )
  })

  it('cell editor wrapper allows editor contents to shrink within the cell', () => {
    expect(sharedStyles.cellEditorWrapper).toBeDefined()
  })

  it('ignores stale cell-stopped events from the previously edited row after switching rows', async () => {
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
    const rowData = props.rows as Array<Record<string, unknown>>
    const onCellClick = props.onCellClick as (
      args: {
        row: Record<string, unknown>
        column: { key: string; idx: number }
        rowIdx: number
      },
      event: { preventGridDefault: () => void }
    ) => Promise<void>

    // Switch to row 2
    await act(async () => {
      await onCellClick(
        {
          row: rowData[1],
          column: { key: 'name', idx: 1 },
          rowIdx: 1,
        },
        { preventGridDefault: vi.fn() }
      )
    })

    // Now editState should be for row 2
    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState?.rowKey).toEqual({ id: 2 })
    // The value for name on row 2 should be its own value, not row 1's
    expect(state?.editState?.currentValues.name).toBeNull()
    expect(state?.editState?.modifiedColumns.size).toBe(0)
  })

  // --- renderEditCell stability (focus-loss regression) ---

  it('renderEditCell references stay stable when editState changes (focus-loss regression)', () => {
    setupConnection()
    setupTabState({
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, name: 'Alice', avatar: null },
        currentValues: { id: 1, name: 'Alice', avatar: null },
        modifiedColumns: new Set<string>(),
        isNewRow: false,
      },
    })
    render(<TableDataGrid tabId="tab-1" isReadOnly={false} />)

    const props1 = getLatestGridProps()
    const cols1 = props1.columns as Array<{ key: string; renderEditCell?: unknown }>
    const nameEditCell1 = cols1.find((c) => c.key === 'name')?.renderEditCell

    // Simulate a keystroke: editState changes (new currentValues, new modifiedColumns)
    act(() => {
      useTableDataStore.getState().updateCellValue('tab-1', 'name', 'Alice2')
    })

    const props2 = getLatestGridProps()
    const cols2 = props2.columns as Array<{ key: string; renderEditCell?: unknown }>
    const nameEditCell2 = cols2.find((c) => c.key === 'name')?.renderEditCell

    // CRITICAL: renderEditCell must be the SAME function reference.
    // If it changes, React unmounts the old editor and mounts a new one → focus lost.
    expect(nameEditCell2).toBe(nameEditCell1)
  })
})
