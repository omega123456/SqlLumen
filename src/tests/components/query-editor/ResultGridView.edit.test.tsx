import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'

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
        editable?: boolean
        cellClass?: string
        headerClass?: string
        headerComponent?: string
        cellEditor?: string
      }>
      const rowData = props.rowData as Array<Record<string, unknown>>

      return React.createElement(
        'div',
        { 'data-testid': 'ag-grid-inner' },
        React.createElement(
          'div',
          { 'data-testid': 'ag-grid-headers' },
          colDefs?.map((col) =>
            React.createElement('span', { key: col.field, 'data-field': col.field }, col.headerName)
          )
        ),
        React.createElement(
          'div',
          { 'data-testid': 'ag-grid-rows' },
          rowData?.map((row: Record<string, unknown>, i: number) =>
            React.createElement(
              'div',
              { key: i, 'data-testid': `ag-grid-row-${i}` },
              ...Object.entries(row).map(([key, val]) =>
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

import { ResultGridView } from '../../../components/query-editor/ResultGridView'
import { ReadOnlyColumnHeader } from '../../../components/query-editor/ResultGridView'
import { AgGridReact } from 'ag-grid-react'
import type { RowEditState, TableDataColumnMeta } from '../../../types/schema'

const columns = [
  { name: 'id', dataType: 'INT' },
  { name: 'name', dataType: 'VARCHAR' },
  { name: 'email', dataType: 'VARCHAR' },
]

const rows: unknown[][] = [
  [1, 'Alice', 'alice@example.com'],
  [2, 'Bob', null],
  [3, 'Charlie', 'charlie@example.com'],
]

const editTableColumns: TableDataColumnMeta[] = [
  {
    name: 'id',
    dataType: 'INT',
    isBooleanAlias: false,
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
    isBooleanAlias: false,
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isAutoIncrement: false,
  },
  {
    name: 'email',
    dataType: 'VARCHAR',
    isBooleanAlias: false,
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isAutoIncrement: false,
  },
]

function getLatestAgGridProps(): Record<string, unknown> {
  const mockCalls = (AgGridReact as unknown as ReturnType<typeof vi.fn>).mock.calls
  return mockCalls[mockCalls.length - 1][0] as Record<string, unknown>
}

describe('ResultGridView edit mode', () => {
  const baseProps = {
    columns,
    rows,
    sortColumn: null as string | null,
    sortDirection: null as 'asc' | 'desc' | null,
    onSortChanged: vi.fn(),
    onRowSelected: vi.fn(),
    selectedRowIndex: null as number | null,
    currentPage: 1,
    pageSize: 1000,
    tabId: 'tab-42',
    editMode: null as string | null,
    editableColumnMap: new Map<number, boolean>(),
    editState: null as RowEditState | null,
    editingRowIndex: null as number | null,
    editTableColumns: [] as TableDataColumnMeta[],
    onStartEditing: vi.fn(),
    onUpdateCellValue: vi.fn(),
    onSyncCellValue: vi.fn(),
    onAutoSave: vi.fn().mockResolvedValue(true),
    onRequestNavigationAction: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not set editable on columns when editMode is null (read-only)', () => {
    render(<ResultGridView {...baseProps} />)
    const props = getLatestAgGridProps()
    const colDefs = props.columnDefs as Array<{ editable?: boolean }>
    colDefs.forEach((col) => {
      expect(col.editable).toBeUndefined()
    })
  })

  it('sets editable=true on columns marked as editable in editableColumnMap', () => {
    const editableMap = new Map<number, boolean>([
      [0, false], // id — not editable
      [1, true], // name — editable
      [2, true], // email — editable
    ])
    render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={editableMap}
        editTableColumns={editTableColumns}
      />
    )
    const props = getLatestAgGridProps()
    const colDefs = props.columnDefs as Array<{ editable?: boolean; field: string }>
    expect(colDefs[0].editable).toBe(false) // id
    expect(colDefs[1].editable).toBe(true) // name
    expect(colDefs[2].editable).toBe(true) // email
  })

  it('assigns col-readonly class to non-editable columns in edit mode', () => {
    const editableMap = new Map<number, boolean>([
      [0, false],
      [1, true],
      [2, true],
    ])
    render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={editableMap}
        editTableColumns={editTableColumns}
      />
    )
    const props = getLatestAgGridProps()
    const colDefs = props.columnDefs as Array<{ cellClass?: string }>
    expect(colDefs[0].cellClass).toContain('col-readonly')
    expect(colDefs[1].cellClass).not.toContain('col-readonly')
    expect(colDefs[2].cellClass).not.toContain('col-readonly')
  })

  it('assigns col-editable class to editable columns in edit mode', () => {
    const editableMap = new Map<number, boolean>([
      [0, false],
      [1, true],
      [2, true],
    ])
    render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={editableMap}
        editTableColumns={editTableColumns}
      />
    )
    const props = getLatestAgGridProps()
    const colDefs = props.columnDefs as Array<{ cellClass?: string }>
    expect(colDefs[1].cellClass).toContain('col-editable')
    expect(colDefs[2].cellClass).toContain('col-editable')
  })

  it('assigns readOnlyColumnHeader to non-editable columns', () => {
    const editableMap = new Map<number, boolean>([
      [0, false],
      [1, true],
      [2, true],
    ])
    render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={editableMap}
        editTableColumns={editTableColumns}
      />
    )
    const props = getLatestAgGridProps()
    const colDefs = props.columnDefs as Array<{
      headerComponent?: string
      headerClass?: string
    }>
    expect(colDefs[0].headerComponent).toBe('readOnlyColumnHeader')
    expect(colDefs[0].headerClass).toBe('col-readonly')
    expect(colDefs[1].headerComponent).toBeUndefined()
    expect(colDefs[2].headerComponent).toBeUndefined()
  })

  it('assigns nullableCellEditor to non-enum editable columns', () => {
    const editableMap = new Map<number, boolean>([
      [0, false],
      [1, true],
      [2, true],
    ])
    render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={editableMap}
        editTableColumns={editTableColumns}
      />
    )
    const props = getLatestAgGridProps()
    const colDefs = props.columnDefs as Array<{ cellEditor?: string }>
    expect(colDefs[1].cellEditor).toBe('nullableCellEditor')
    expect(colDefs[2].cellEditor).toBe('nullableCellEditor')
  })

  it('assigns enumCellEditor to enum columns', () => {
    const enumTableColumns: TableDataColumnMeta[] = [
      ...editTableColumns.slice(0, 2),
      {
        name: 'email',
        dataType: 'ENUM',
        isBooleanAlias: false,
        enumValues: ['a@test.com', 'b@test.com'],
        isNullable: true,
        isPrimaryKey: false,
        isUniqueKey: false,
        hasDefault: false,
        columnDefault: null,
        isBinary: false,
        isAutoIncrement: false,
      },
    ]
    const editableMap = new Map<number, boolean>([
      [0, false],
      [1, true],
      [2, true],
    ])
    render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={editableMap}
        editTableColumns={enumTableColumns}
      />
    )
    const props = getLatestAgGridProps()
    const colDefs = props.columnDefs as Array<{ cellEditor?: string }>
    expect(colDefs[2].cellEditor).toBe('enumCellEditor')
  })

  it('calls onStartEditing when an editable cell is clicked', async () => {
    const onStartEditing = vi.fn()
    const editableMap = new Map<number, boolean>([
      [0, false],
      [1, true],
      [2, true],
    ])
    render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={editableMap}
        editTableColumns={editTableColumns}
        onStartEditing={onStartEditing}
      />
    )
    const props = getLatestAgGridProps()
    const onCellClicked = props.onCellClicked as (event: {
      colDef: { field: string; editable: boolean }
      node: { rowIndex: number }
      api: { startEditingCell: ReturnType<typeof vi.fn> }
    }) => Promise<void>

    expect(onCellClicked).toBeDefined()

    await act(async () => {
      await onCellClicked({
        colDef: { field: 'col_1', editable: true },
        node: { rowIndex: 0 },
        api: { startEditingCell: vi.fn() },
      })
    })

    expect(onStartEditing).toHaveBeenCalledWith(0)
  })

  it('does not call onStartEditing for non-editable cell clicks', async () => {
    const onStartEditing = vi.fn()
    const editableMap = new Map<number, boolean>([
      [0, false],
      [1, true],
      [2, true],
    ])
    render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={editableMap}
        editTableColumns={editTableColumns}
        onStartEditing={onStartEditing}
      />
    )
    const props = getLatestAgGridProps()
    const onCellClicked = props.onCellClicked as (event: {
      colDef: { field: string; editable: boolean }
      node: { rowIndex: number }
      api: { startEditingCell: ReturnType<typeof vi.fn> }
    }) => Promise<void>

    await act(async () => {
      await onCellClicked({
        colDef: { field: 'col_0', editable: false },
        node: { rowIndex: 0 },
        api: { startEditingCell: vi.fn() },
      })
    })

    expect(onStartEditing).not.toHaveBeenCalled()
  })

  it('calls onAutoSave when switching rows with modifications', async () => {
    const onAutoSave = vi.fn().mockResolvedValue(true)
    const onStartEditing = vi.fn()
    const editableMap = new Map<number, boolean>([
      [0, false],
      [1, true],
      [2, true],
    ])
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { name: 'Alice' },
      currentValues: { name: 'Alice Updated' },
      modifiedColumns: new Set(['name']),
      isNewRow: false,
    }

    render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={editableMap}
        editTableColumns={editTableColumns}
        editState={editState}
        editingRowIndex={0}
        onAutoSave={onAutoSave}
        onStartEditing={onStartEditing}
      />
    )
    const props = getLatestAgGridProps()
    const onCellClicked = props.onCellClicked as (event: {
      colDef: { field: string; editable: boolean }
      node: { rowIndex: number }
      api: { startEditingCell: ReturnType<typeof vi.fn> }
    }) => Promise<void>

    // Click a cell on a DIFFERENT row (row 1 instead of current row 0)
    await act(async () => {
      await onCellClicked({
        colDef: { field: 'col_1', editable: true },
        node: { rowIndex: 1 },
        api: { startEditingCell: vi.fn() },
      })
    })

    expect(onAutoSave).toHaveBeenCalled()
    expect(onStartEditing).toHaveBeenCalledWith(1)
  })

  it('does not call onAutoSave when clicking same row', async () => {
    const onAutoSave = vi.fn().mockResolvedValue(true)
    const editableMap = new Map<number, boolean>([
      [0, false],
      [1, true],
      [2, true],
    ])
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { name: 'Alice' },
      currentValues: { name: 'Alice Updated' },
      modifiedColumns: new Set(['name']),
      isNewRow: false,
    }

    render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={editableMap}
        editTableColumns={editTableColumns}
        editState={editState}
        editingRowIndex={0}
        onAutoSave={onAutoSave}
      />
    )
    const props = getLatestAgGridProps()
    const onCellClicked = props.onCellClicked as (event: {
      colDef: { field: string; editable: boolean }
      node: { rowIndex: number }
      api: { startEditingCell: ReturnType<typeof vi.fn> }
    }) => Promise<void>

    // Click a cell on the SAME row (row 0)
    await act(async () => {
      await onCellClicked({
        colDef: { field: 'col_2', editable: true },
        node: { rowIndex: 0 },
        api: { startEditingCell: vi.fn() },
      })
    })

    expect(onAutoSave).not.toHaveBeenCalled()
  })

  it('does not start editing new row when auto-save fails', async () => {
    const onAutoSave = vi.fn().mockResolvedValue(false) // save failed
    const onStartEditing = vi.fn()
    const editableMap = new Map<number, boolean>([
      [0, false],
      [1, true],
      [2, true],
    ])
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { name: 'Alice' },
      currentValues: { name: 'Alice Updated' },
      modifiedColumns: new Set(['name']),
      isNewRow: false,
    }

    render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={editableMap}
        editTableColumns={editTableColumns}
        editState={editState}
        editingRowIndex={0}
        onAutoSave={onAutoSave}
        onStartEditing={onStartEditing}
      />
    )
    const props = getLatestAgGridProps()
    const onCellClicked = props.onCellClicked as (event: {
      colDef: { field: string; editable: boolean }
      node: { rowIndex: number }
      api: { startEditingCell: ReturnType<typeof vi.fn> }
    }) => Promise<void>

    await act(async () => {
      await onCellClicked({
        colDef: { field: 'col_1', editable: true },
        node: { rowIndex: 1 },
        api: { startEditingCell: vi.fn() },
      })
    })

    expect(onAutoSave).toHaveBeenCalled()
    expect(onStartEditing).not.toHaveBeenCalled()
  })

  it('sets suppressCellFocus to false when in edit mode', () => {
    const editableMap = new Map<number, boolean>([
      [0, false],
      [1, true],
    ])
    render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={editableMap}
        editTableColumns={editTableColumns}
      />
    )
    const props = getLatestAgGridProps()
    expect(props.suppressCellFocus).toBe(false)
  })

  it('sets suppressCellFocus to true when not in edit mode', () => {
    render(<ResultGridView {...baseProps} />)
    const props = getLatestAgGridProps()
    expect(props.suppressCellFocus).toBe(true)
  })

  it('sets suppressClickEdit to true always', () => {
    render(<ResultGridView {...baseProps} />)
    const props = getLatestAgGridProps()
    expect(props.suppressClickEdit).toBe(true)
  })

  it('has cell-modified cellClassRule that detects modified columns', () => {
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { name: 'Alice' },
      currentValues: { name: 'Modified' },
      modifiedColumns: new Set(['name']),
      isNewRow: false,
    }
    render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={
          new Map<number, boolean>([
            [0, false],
            [1, true],
            [2, true],
          ])
        }
        editTableColumns={editTableColumns}
        editState={editState}
        editingRowIndex={0}
      />
    )
    const props = getLatestAgGridProps()
    const defaultColDef = props.defaultColDef as {
      cellClassRules: Record<
        string,
        (params: {
          colDef?: { field?: string }
          node?: { rowIndex?: number }
          value?: unknown
        }) => boolean
      >
    }

    // 'name' column (col_1) on the editing row should be modified
    expect(
      defaultColDef.cellClassRules['cell-modified']({
        colDef: { field: 'col_1' },
        node: { rowIndex: 0 },
      })
    ).toBe(true)

    // 'email' column (col_2) on the editing row should NOT be modified
    expect(
      defaultColDef.cellClassRules['cell-modified']({
        colDef: { field: 'col_2' },
        node: { rowIndex: 0 },
      })
    ).toBe(false)

    // Different row should not be modified
    expect(
      defaultColDef.cellClassRules['cell-modified']({
        colDef: { field: 'col_1' },
        node: { rowIndex: 1 },
      })
    ).toBe(false)
  })

  it('overlays editState values on the editing row in rowData', () => {
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { name: 'Alice' },
      currentValues: { name: 'Alice Updated' },
      modifiedColumns: new Set(['name']),
      isNewRow: false,
    }
    render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={
          new Map<number, boolean>([
            [0, false],
            [1, true],
            [2, true],
          ])
        }
        editTableColumns={editTableColumns}
        editState={editState}
        editingRowIndex={0}
      />
    )
    const props = getLatestAgGridProps()
    const rowData = props.rowData as Array<Record<string, unknown>>
    // Row 0 should have the updated value
    expect(rowData[0].col_1).toBe('Alice Updated')
    // Row 1 should be unchanged
    expect(rowData[1].col_1).toBe('Bob')
  })

  it('preserves existing cell classes in edit mode (non-regression)', () => {
    const editableMap = new Map<number, boolean>([
      [0, false],
      [1, true],
    ])
    render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={editableMap}
        editTableColumns={editTableColumns}
      />
    )
    const props = getLatestAgGridProps()
    const colDefs = props.columnDefs as Array<{ cellClass?: string }>
    // Non-editable INT column should have mono-muted + col-readonly
    expect(colDefs[0].cellClass).toContain('td-cell-mono-muted')
    expect(colDefs[0].cellClass).toContain('col-readonly')
    // Editable VARCHAR column should have body + primary + col-editable
    expect(colDefs[1].cellClass).toContain('col-editable')
  })

  // --- handleCellEditingStopped tests ---

  it('handleCellEditingStopped calls onUpdateCellValue when value changes', () => {
    const onUpdateCellValue = vi.fn()
    const editableMap = new Map<number, boolean>([
      [0, false],
      [1, true],
      [2, true],
    ])
    render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={editableMap}
        editTableColumns={editTableColumns}
        onUpdateCellValue={onUpdateCellValue}
      />
    )
    const props = getLatestAgGridProps()
    const onCellEditingStopped = props.onCellEditingStopped as (event: {
      colDef?: { field?: string }
      oldValue?: unknown
      newValue?: unknown
    }) => void

    expect(onCellEditingStopped).toBeDefined()

    onCellEditingStopped({
      colDef: { field: 'col_1' },
      oldValue: 'Alice',
      newValue: 'Alice Updated',
    })

    expect(onUpdateCellValue).toHaveBeenCalledWith('name', 'Alice Updated')
  })

  it('handleCellEditingStopped does not call onUpdateCellValue when value unchanged', () => {
    const onUpdateCellValue = vi.fn()
    const editableMap = new Map<number, boolean>([
      [0, false],
      [1, true],
      [2, true],
    ])
    render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={editableMap}
        editTableColumns={editTableColumns}
        onUpdateCellValue={onUpdateCellValue}
      />
    )
    const props = getLatestAgGridProps()
    const onCellEditingStopped = props.onCellEditingStopped as (event: {
      colDef?: { field?: string }
      oldValue?: unknown
      newValue?: unknown
    }) => void

    onCellEditingStopped({
      colDef: { field: 'col_1' },
      oldValue: 'Alice',
      newValue: 'Alice',
    })

    expect(onUpdateCellValue).not.toHaveBeenCalled()
  })

  it('handleCellEditingStopped returns early when no field', () => {
    const onUpdateCellValue = vi.fn()
    const editableMap = new Map<number, boolean>([
      [0, false],
      [1, true],
    ])
    render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={editableMap}
        editTableColumns={editTableColumns}
        onUpdateCellValue={onUpdateCellValue}
      />
    )
    const props = getLatestAgGridProps()
    const onCellEditingStopped = props.onCellEditingStopped as (event: {
      colDef?: { field?: string }
      oldValue?: unknown
      newValue?: unknown
    }) => void

    // No field on colDef
    onCellEditingStopped({
      colDef: {},
      oldValue: 'a',
      newValue: 'b',
    })
    expect(onUpdateCellValue).not.toHaveBeenCalled()

    // No colDef at all
    onCellEditingStopped({
      oldValue: 'a',
      newValue: 'b',
    })
    expect(onUpdateCellValue).not.toHaveBeenCalled()
  })

  // --- getRowClass editing row tests ---

  it('getRowClass returns result-editing-row for editing row', () => {
    const editableMap = new Map<number, boolean>([
      [0, false],
      [1, true],
    ])
    render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={editableMap}
        editTableColumns={editTableColumns}
        editingRowIndex={1}
      />
    )
    const props = getLatestAgGridProps()
    const getRowClass = props.getRowClass as (params: {
      rowIndex: number | undefined
    }) => string | undefined

    expect(getRowClass({ rowIndex: 1 })).toContain('result-editing-row')
    expect(getRowClass({ rowIndex: 0 })).toBeUndefined()
  })

  it('getRowClass combines editing and selected classes', () => {
    const editableMap = new Map<number, boolean>([
      [0, false],
      [1, true],
    ])
    render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={editableMap}
        editTableColumns={editTableColumns}
        editingRowIndex={1}
        selectedRowIndex={1}
      />
    )
    const props = getLatestAgGridProps()
    const getRowClass = props.getRowClass as (params: {
      rowIndex: number | undefined
    }) => string | undefined

    const result = getRowClass({ rowIndex: 1 })
    expect(result).toContain('result-editing-row')
    expect(result).toContain('ag-row-precision-selected')
  })

  // --- gridContext translation tests ---

  it('gridContext.tabId is truthy so cell editors can call updateCellValue and syncCellValue', () => {
    const editableMap = new Map<number, boolean>([
      [0, false],
      [1, true],
    ])
    render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={editableMap}
        editTableColumns={editTableColumns}
      />
    )
    const props = getLatestAgGridProps()
    const context = props.context as { tabId: string }
    // Cell editors guard their store sync calls with `if (tabId && ...)`.
    // An empty string is falsy and silently disables all store syncing,
    // which causes edits to revert when clicking the next column.
    expect(context.tabId).toBeTruthy()
  })

  it('gridContext.updateCellValue translates col_N to real column name', () => {
    const onUpdateCellValue = vi.fn()
    const editableMap = new Map<number, boolean>([
      [0, false],
      [1, true],
    ])
    render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={editableMap}
        editTableColumns={editTableColumns}
        onUpdateCellValue={onUpdateCellValue}
      />
    )
    const props = getLatestAgGridProps()
    const context = props.context as {
      updateCellValue: (tabId: string, fieldName: string, value: unknown) => void
      syncCellValue: (
        tabId: string,
        rowData: Record<string, unknown> | undefined,
        fieldName: string,
        value: unknown
      ) => void
    }

    // updateCellValue should translate col_1 → 'name'
    context.updateCellValue('', 'col_1', 'New Value')
    expect(onUpdateCellValue).toHaveBeenCalledWith('name', 'New Value')
  })

  it('gridContext.syncCellValue translates col_N to real column name', () => {
    const onSyncCellValue = vi.fn()
    const editableMap = new Map<number, boolean>([
      [0, false],
      [1, true],
    ])
    render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={editableMap}
        editTableColumns={editTableColumns}
        onSyncCellValue={onSyncCellValue}
      />
    )
    const props = getLatestAgGridProps()
    const context = props.context as {
      syncCellValue: (
        tabId: string,
        rowData: Record<string, unknown> | undefined,
        fieldName: string,
        value: unknown
      ) => void
    }

    // syncCellValue should translate col_2 → 'email'
    context.syncCellValue('', undefined, 'col_2', 'new@email.com')
    expect(onSyncCellValue).toHaveBeenCalledWith('email', 'new@email.com')
  })

  it('does not set onCellClicked or onCellEditingStopped in read-only mode', () => {
    render(<ResultGridView {...baseProps} />)
    const props = getLatestAgGridProps()
    expect(props.onCellClicked).toBeUndefined()
    expect(props.onCellEditingStopped).toBeUndefined()
  })

  it('sets stopEditingWhenCellsLoseFocus to true in edit mode', () => {
    const editableMap = new Map<number, boolean>([
      [0, false],
      [1, true],
    ])
    render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={editableMap}
        editTableColumns={editTableColumns}
      />
    )
    const props = getLatestAgGridProps()
    expect(props.stopEditingWhenCellsLoseFocus).toBe(true)
  })

  it('sets stopEditingWhenCellsLoseFocus to false in read-only mode', () => {
    render(<ResultGridView {...baseProps} />)
    const props = getLatestAgGridProps()
    expect(props.stopEditingWhenCellsLoseFocus).toBe(false)
  })

  it('handleCellClicked defers startEditingCell via setTimeout', async () => {
    vi.useFakeTimers()
    const startEditingCellMock = vi.fn()
    const editableMap = new Map<number, boolean>([
      [0, false],
      [1, true],
    ])
    render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={editableMap}
        editTableColumns={editTableColumns}
      />
    )
    const props = getLatestAgGridProps()
    const onCellClicked = props.onCellClicked as (event: {
      colDef: { field: string }
      node: { rowIndex: number }
      api: { startEditingCell: ReturnType<typeof vi.fn> }
    }) => Promise<void>

    await act(async () => {
      await onCellClicked({
        colDef: { field: 'col_1' },
        node: { rowIndex: 0 },
        api: { startEditingCell: startEditingCellMock },
      })
    })

    // startEditingCell should not have been called yet (deferred)
    expect(startEditingCellMock).not.toHaveBeenCalled()

    // Advance timers to trigger the deferred call
    await act(async () => {
      vi.runAllTimers()
    })

    expect(startEditingCellMock).toHaveBeenCalledWith({ rowIndex: 0, colKey: 'col_1' })
    vi.useRealTimers()
  })

  it('handleCellClicked cancels pending timer on rapid clicks', async () => {
    vi.useFakeTimers()
    const startEditingCellMock1 = vi.fn()
    const startEditingCellMock2 = vi.fn()
    const editableMap = new Map<number, boolean>([
      [0, false],
      [1, true],
      [2, true],
    ])
    render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={editableMap}
        editTableColumns={editTableColumns}
      />
    )
    const props = getLatestAgGridProps()
    const onCellClicked = props.onCellClicked as (event: {
      colDef: { field: string }
      node: { rowIndex: number }
      api: { startEditingCell: ReturnType<typeof vi.fn> }
    }) => Promise<void>

    // First click — sets a pending timer
    await act(async () => {
      await onCellClicked({
        colDef: { field: 'col_1' },
        node: { rowIndex: 0 },
        api: { startEditingCell: startEditingCellMock1 },
      })
    })

    // Second click before timer fires — should cancel the first timer
    await act(async () => {
      await onCellClicked({
        colDef: { field: 'col_2' },
        node: { rowIndex: 0 },
        api: { startEditingCell: startEditingCellMock2 },
      })
    })

    // Advance timers
    await act(async () => {
      vi.runAllTimers()
    })

    // First click's startEditingCell should NOT have been called (cancelled)
    expect(startEditingCellMock1).not.toHaveBeenCalled()
    // Second click's startEditingCell should have been called
    expect(startEditingCellMock2).toHaveBeenCalledWith({ rowIndex: 0, colKey: 'col_2' })
    vi.useRealTimers()
  })

  it('handleCellClicked returns early when event has no colDef field', async () => {
    const onStartEditing = vi.fn()
    const editableMap = new Map<number, boolean>([
      [0, false],
      [1, true],
    ])
    render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={editableMap}
        editTableColumns={editTableColumns}
        onStartEditing={onStartEditing}
      />
    )
    const props = getLatestAgGridProps()
    const onCellClicked = props.onCellClicked as (event: Record<string, unknown>) => Promise<void>

    await act(async () => {
      await onCellClicked({ colDef: {}, node: { rowIndex: 0 }, api: {} })
    })
    expect(onStartEditing).not.toHaveBeenCalled()
  })

  it('handleCellClicked returns early when node rowIndex is null', async () => {
    const onStartEditing = vi.fn()
    const editableMap = new Map<number, boolean>([
      [0, false],
      [1, true],
    ])
    render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={editableMap}
        editTableColumns={editTableColumns}
        onStartEditing={onStartEditing}
      />
    )
    const props = getLatestAgGridProps()
    const onCellClicked = props.onCellClicked as (event: Record<string, unknown>) => Promise<void>

    await act(async () => {
      await onCellClicked({
        colDef: { field: 'col_1' },
        node: { rowIndex: null },
        api: {},
      })
    })
    expect(onStartEditing).not.toHaveBeenCalled()
  })
})

describe('ReadOnlyColumnHeader', () => {
  it('renders display name and lock icon', () => {
    const { container } = render(
      <ReadOnlyColumnHeader
        displayName="id"
        progressSort={vi.fn()}
        column={{
          isSortAscending: () => false,
          isSortDescending: () => false,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }}
      />
    )
    expect(container.textContent).toContain('id')
  })

  it('shows ascending sort indicator', () => {
    const { container } = render(
      <ReadOnlyColumnHeader
        displayName="id"
        progressSort={vi.fn()}
        column={{
          isSortAscending: () => true,
          isSortDescending: () => false,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }}
      />
    )
    const ascIcon = container.querySelector('.ag-icon-asc')
    expect(ascIcon).toBeTruthy()
  })

  it('shows descending sort indicator', () => {
    const { container } = render(
      <ReadOnlyColumnHeader
        displayName="id"
        progressSort={vi.fn()}
        column={{
          isSortAscending: () => false,
          isSortDescending: () => true,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }}
      />
    )
    const descIcon = container.querySelector('.ag-icon-desc')
    expect(descIcon).toBeTruthy()
  })

  it('calls progressSort on click', () => {
    const progressSort = vi.fn()
    const { container } = render(
      <ReadOnlyColumnHeader
        displayName="id"
        progressSort={progressSort}
        column={{
          isSortAscending: () => false,
          isSortDescending: () => false,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }}
      />
    )
    const wrapper = container.firstElementChild
    if (wrapper) {
      wrapper.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    }
    expect(progressSort).toHaveBeenCalledWith(false)
  })

  it('updates sort state when sortChanged event fires', () => {
    let sortListener: (() => void) | null = null
    let isAscending = false

    const { container } = render(
      <ReadOnlyColumnHeader
        displayName="id"
        progressSort={vi.fn()}
        column={{
          isSortAscending: () => isAscending,
          isSortDescending: () => false,
          addEventListener: (_event: string, listener: () => void) => {
            sortListener = listener
          },
          removeEventListener: vi.fn(),
        }}
      />
    )

    // Initially no sort icon
    expect(container.querySelector('.ag-icon-asc')).toBeNull()

    // Simulate sort change
    isAscending = true
    act(() => {
      sortListener?.()
    })

    // Should now show ascending icon
    expect(container.querySelector('.ag-icon-asc')).toBeTruthy()
  })
})
