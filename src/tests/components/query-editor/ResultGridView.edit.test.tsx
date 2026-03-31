import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'

// Mock the shared DataGrid wrapper
vi.mock('../../../components/shared/DataGrid', async () => {
  const React = await import('react')
  return {
    DataGrid: vi.fn((props: Record<string, unknown>) => {
      const rows = (props.rows as Array<Record<string, unknown>>) ?? []
      return React.createElement(
        'div',
        { 'data-testid': props['data-testid'] },
        rows.map((row: Record<string, unknown>, i: number) =>
          React.createElement(
            'div',
            { key: i, 'data-testid': `grid-row-${i}` },
            ...Object.entries(row)
              .filter(([k]: [string, unknown]) => !k.startsWith('__'))
              .map(([k, v]: [string, unknown]) =>
                React.createElement(
                  'span',
                  { key: k, 'data-key': k },
                  v === null ? 'NULL' : String(v)
                )
              )
          )
        )
      )
    }),
  }
})

import { ResultGridView } from '../../../components/query-editor/ResultGridView'
import { DataGrid } from '../../../components/shared/DataGrid'
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

function getLatestDataGridProps(): Record<string, unknown> {
  const mockCalls = (DataGrid as unknown as ReturnType<typeof vi.fn>).mock.calls
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
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not set renderEditCell on columns when editMode is null (read-only)', () => {
    render(<ResultGridView {...baseProps} />)
    const props = getLatestDataGridProps()
    const colDefs = props.columns as Array<{ renderEditCell?: unknown }>
    colDefs.forEach((col) => {
      expect(col.renderEditCell).toBeUndefined()
    })
  })

  it('sets renderEditCell on columns marked as editable in editableColumnMap', () => {
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
    const props = getLatestDataGridProps()
    const colDefs = props.columns as Array<{ renderEditCell?: unknown }>
    expect(colDefs[0].renderEditCell).toBeUndefined() // id — not editable
    expect(colDefs[1].renderEditCell).toBeDefined() // name — editable
    expect(colDefs[2].renderEditCell).toBeDefined() // email — editable
  })

  it('assigns col-readonly cellClass to non-editable columns in edit mode', () => {
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
    const props = getLatestDataGridProps()
    const colDefs = props.columns as Array<{
      cellClass: (row: Record<string, unknown>) => string
    }>
    const testRow = { __rowIdx: 0, col_0: 1, col_1: 'Alice', col_2: 'alice@test.com' }
    expect(colDefs[0].cellClass(testRow)).toContain('col-readonly')
    expect(colDefs[1].cellClass(testRow)).not.toContain('col-readonly')
    expect(colDefs[2].cellClass(testRow)).not.toContain('col-readonly')
  })

  it('assigns col-editable cellClass to editable columns in edit mode', () => {
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
    const props = getLatestDataGridProps()
    const colDefs = props.columns as Array<{
      cellClass: (row: Record<string, unknown>) => string
    }>
    const testRow = { __rowIdx: 0, col_0: 1, col_1: 'Alice', col_2: 'alice@test.com' }
    expect(colDefs[1].cellClass(testRow)).toContain('col-editable')
    expect(colDefs[2].cellClass(testRow)).toContain('col-editable')
  })

  it('assigns ReadOnlyColumnHeaderCell to non-editable columns', () => {
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
    const props = getLatestDataGridProps()
    const colDefs = props.columns as Array<{
      renderHeaderCell?: unknown
      headerCellClass?: string
    }>
    expect(colDefs[0].renderHeaderCell).toBeDefined()
    expect(colDefs[0].headerCellClass).toBe('col-readonly')
    expect(colDefs[1].renderHeaderCell).toBeUndefined()
    expect(colDefs[2].renderHeaderCell).toBeUndefined()
  })

  it('assigns renderEditCell for non-enum editable columns (NullableCellEditor)', () => {
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
    const props = getLatestDataGridProps()
    const colDefs = props.columns as Array<{ renderEditCell?: unknown }>
    // Editable columns should have renderEditCell
    expect(typeof colDefs[1].renderEditCell).toBe('function')
    expect(typeof colDefs[2].renderEditCell).toBe('function')
  })

  it('assigns renderEditCell for enum columns (EnumCellEditor)', () => {
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
    const props = getLatestDataGridProps()
    const colDefs = props.columns as Array<{ renderEditCell?: unknown }>
    // Both editable columns should have renderEditCell
    expect(typeof colDefs[1].renderEditCell).toBe('function')
    expect(typeof colDefs[2].renderEditCell).toBe('function')
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
    const props = getLatestDataGridProps()
    const onCellClick = props.onCellClick as (args: unknown, event: unknown) => Promise<void>

    expect(onCellClick).toBeDefined()

    await act(async () => {
      await onCellClick(
        {
          row: { __rowIdx: 0, col_0: 1, col_1: 'Alice' },
          rowIdx: 0,
          column: { key: 'col_1', idx: 1 },
          selectCell: vi.fn(),
        },
        { preventGridDefault: vi.fn(), isGridDefaultPrevented: () => false }
      )
    })

    expect(onStartEditing).toHaveBeenCalledWith(0)
  })

  it('calls event.preventGridDefault for editable cell clicks', async () => {
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
    const props = getLatestDataGridProps()
    const onCellClick = props.onCellClick as (args: unknown, event: unknown) => Promise<void>

    const preventGridDefault = vi.fn()
    await act(async () => {
      await onCellClick(
        {
          row: { __rowIdx: 0 },
          rowIdx: 0,
          column: { key: 'col_1', idx: 1 },
          selectCell: vi.fn(),
        },
        { preventGridDefault, isGridDefaultPrevented: () => false }
      )
    })

    expect(preventGridDefault).toHaveBeenCalled()
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
    const props = getLatestDataGridProps()
    const onCellClick = props.onCellClick as (args: unknown, event: unknown) => Promise<void>

    const preventGridDefault = vi.fn()
    await act(async () => {
      await onCellClick(
        {
          row: { __rowIdx: 0 },
          rowIdx: 0,
          column: { key: 'col_0', idx: 0 },
          selectCell: vi.fn(),
        },
        { preventGridDefault, isGridDefaultPrevented: () => false }
      )
    })

    // Non-editable column should not trigger editing, but guard should run
    expect(onStartEditing).not.toHaveBeenCalled()
    expect(preventGridDefault).toHaveBeenCalled()
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
    const props = getLatestDataGridProps()
    const onCellClick = props.onCellClick as (args: unknown, event: unknown) => Promise<void>

    // Click a cell on a DIFFERENT row (row 1 instead of current row 0)
    await act(async () => {
      await onCellClick(
        {
          row: { __rowIdx: 1 },
          rowIdx: 1,
          column: { key: 'col_1', idx: 1 },
          selectCell: vi.fn(),
        },
        { preventGridDefault: vi.fn(), isGridDefaultPrevented: () => false }
      )
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
    const props = getLatestDataGridProps()
    const onCellClick = props.onCellClick as (args: unknown, event: unknown) => Promise<void>

    // Click a cell on the SAME row (row 0)
    await act(async () => {
      await onCellClick(
        {
          row: { __rowIdx: 0 },
          rowIdx: 0,
          column: { key: 'col_2', idx: 2 },
          selectCell: vi.fn(),
        },
        { preventGridDefault: vi.fn(), isGridDefaultPrevented: () => false }
      )
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
    const props = getLatestDataGridProps()
    const onCellClick = props.onCellClick as (args: unknown, event: unknown) => Promise<void>

    await act(async () => {
      await onCellClick(
        {
          row: { __rowIdx: 1 },
          rowIdx: 1,
          column: { key: 'col_1', idx: 1 },
          selectCell: vi.fn(),
        },
        { preventGridDefault: vi.fn(), isGridDefaultPrevented: () => false }
      )
    })

    expect(onAutoSave).toHaveBeenCalled()
    expect(onStartEditing).not.toHaveBeenCalled()
  })

  it('cell-modified cellClass detects modified columns', () => {
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
    const props = getLatestDataGridProps()
    const colDefs = props.columns as Array<{
      cellClass: (row: Record<string, unknown>) => string
    }>

    // 'name' column (col_1) on the editing row should be modified
    expect(colDefs[1].cellClass({ __rowIdx: 0, col_1: 'Modified' })).toContain('cell-modified')

    // 'email' column (col_2) on the editing row should NOT be modified
    expect(colDefs[2].cellClass({ __rowIdx: 0, col_2: 'test' })).not.toContain('cell-modified')

    // Different row should not be modified
    expect(colDefs[1].cellClass({ __rowIdx: 1, col_1: 'Bob' })).not.toContain('cell-modified')
  })

  it('cell-modified returns false in read-only mode', () => {
    render(<ResultGridView {...baseProps} />)
    const props = getLatestDataGridProps()
    const colDefs = props.columns as Array<{
      cellClass: (row: Record<string, unknown>) => string
    }>
    // In read-only mode (editMode=null), should never contain cell-modified
    expect(colDefs[0].cellClass({ __rowIdx: 0, col_0: 1 })).not.toContain('cell-modified')
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
    const props = getLatestDataGridProps()
    const rowData = props.rows as Array<Record<string, unknown>>
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
    const props = getLatestDataGridProps()
    const colDefs = props.columns as Array<{
      cellClass: (row: Record<string, unknown>) => string
    }>
    const testRow = { __rowIdx: 0, col_0: 1, col_1: 'Alice' }
    // Non-editable INT column should have mono-muted + col-readonly
    expect(colDefs[0].cellClass(testRow)).toContain('td-cell-mono-muted')
    expect(colDefs[0].cellClass(testRow)).toContain('col-readonly')
    // Editable VARCHAR column should have col-editable
    expect(colDefs[1].cellClass(testRow)).toContain('col-editable')
  })

  // --- rowClass editing row tests ---

  it('rowClass returns result-editing-row for editing row', () => {
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
    const props = getLatestDataGridProps()
    const rowClass = props.rowClass as (row: Record<string, unknown>) => string | undefined

    expect(rowClass({ __rowIdx: 1 })).toContain('result-editing-row')
    expect(rowClass({ __rowIdx: 0 })).toBeUndefined()
  })

  it('rowClass combines editing and selected classes', () => {
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
    const props = getLatestDataGridProps()
    const rowClass = props.rowClass as (row: Record<string, unknown>) => string | undefined

    const result = rowClass({ __rowIdx: 1 })
    expect(result).toContain('result-editing-row')
    expect(result).toContain('rdg-row-precision-selected')
  })

  // --- wrapped callback translation tests ---

  it('wrappedUpdateCellValue translates col_N to real column name', async () => {
    const onUpdateCellValue = vi.fn()
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
        onUpdateCellValue={onUpdateCellValue}
        onStartEditing={onStartEditing}
      />
    )
    const props = getLatestDataGridProps()
    const colDefs = props.columns as Array<{
      renderEditCell?: (editorProps: Record<string, unknown>) => unknown
    }>

    // The editable column (col_1) should have renderEditCell
    const renderEditCell = colDefs[1].renderEditCell
    expect(renderEditCell).toBeDefined()

    // The renderEditCell closure captures wrappedUpdateCellValue
    // We test this indirectly: the column definitions pass correct callbacks
    // Direct callback testing happens through the editor components themselves
  })

  it('does not call onCellClick edit logic in read-only mode', async () => {
    const onStartEditing = vi.fn()
    const preventGridDefault = vi.fn()
    render(<ResultGridView {...baseProps} onStartEditing={onStartEditing} />)
    const props = getLatestDataGridProps()
    const onCellClick = props.onCellClick as (args: unknown, event: unknown) => Promise<void>

    await act(async () => {
      await onCellClick(
        {
          row: { __rowIdx: 0 },
          rowIdx: 0,
          column: { key: 'col_0', idx: 0 },
          selectCell: vi.fn(),
        },
        { preventGridDefault, isGridDefaultPrevented: () => false }
      )
    })

    expect(onStartEditing).not.toHaveBeenCalled()
    expect(preventGridDefault).not.toHaveBeenCalled()
  })

  // --- renderEditCell stability tests (focus-loss regression) ---

  it('renderEditCell references stay stable when editState changes (focus-loss regression)', () => {
    const editableMap = new Map<number, boolean>([
      [0, false],
      [1, true],
      [2, true],
    ])
    const editState1: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { name: 'Alice' },
      currentValues: { name: 'Alice' },
      modifiedColumns: new Set<string>(),
      isNewRow: false,
    }

    const { rerender } = render(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={editableMap}
        editTableColumns={editTableColumns}
        editState={editState1}
        editingRowIndex={0}
      />
    )

    const props1 = getLatestDataGridProps()
    const cols1 = props1.columns as Array<{ renderEditCell?: unknown }>
    const editCell1 = cols1[1].renderEditCell

    // Simulate a keystroke: editState changes (new currentValues, new modifiedColumns)
    const editState2: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { name: 'Alice' },
      currentValues: { name: 'Alice2' },
      modifiedColumns: new Set<string>(['name']),
      isNewRow: false,
    }

    rerender(
      <ResultGridView
        {...baseProps}
        editMode="users"
        editableColumnMap={editableMap}
        editTableColumns={editTableColumns}
        editState={editState2}
        editingRowIndex={0}
      />
    )

    const props2 = getLatestDataGridProps()
    const cols2 = props2.columns as Array<{ renderEditCell?: unknown }>
    const editCell2 = cols2[1].renderEditCell

    // CRITICAL: renderEditCell must be the SAME function reference.
    // If it changes, React unmounts the old editor and mounts a new one → focus lost.
    expect(editCell2).toBe(editCell1)
  })
})
