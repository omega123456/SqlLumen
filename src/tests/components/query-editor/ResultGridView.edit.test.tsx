import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'

// Store captured BaseGridView props for assertions
let lastBaseGridProps: Record<string, unknown> = {}

// Mock the shared BaseGridView component (ResultGridView wraps it)
vi.mock('../../../components/shared/BaseGridView', async () => {
  const React = await import('react')
  const MockBaseGridView = React.forwardRef(function MockBaseGridView(
    props: Record<string, unknown>,
    ref: React.Ref<unknown>
  ) {
    void ref
    lastBaseGridProps = props
    const rows = (props.rows as Array<Record<string, unknown>>) ?? []
    return React.createElement(
      'div',
      { 'data-testid': props.testId ?? 'base-grid-view' },
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
  })
  return { BaseGridView: MockBaseGridView }
})

import { ResultGridView } from '../../../components/query-editor/ResultGridView'
import type { RowEditState, TableDataColumnMeta } from '../../../types/schema'
import type {
  GridColumnDescriptor,
  CellClickGuardArgs,
  CellClickGuardResult,
} from '../../../types/shared-data-view'

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

function getLatestBaseGridProps(): Record<string, unknown> {
  return lastBaseGridProps
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
    lastBaseGridProps = {}
  })

  it('sets editable: false on all columns when editMode is null (read-only)', () => {
    render(<ResultGridView {...baseProps} />)
    const props = getLatestBaseGridProps()
    const colDefs = props.columns as GridColumnDescriptor[]
    colDefs.forEach((col) => {
      expect(col.editable).toBe(false)
    })
  })

  it('sets editable: true on columns marked as editable in editableColumnMap', () => {
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
    const props = getLatestBaseGridProps()
    const colDefs = props.columns as GridColumnDescriptor[]
    expect(colDefs[0].editable).toBe(false) // id — not editable
    expect(colDefs[1].editable).toBe(true) // name — editable
    expect(colDefs[2].editable).toBe(true) // email — editable
  })

  it('passes tableColumnMeta only for editable columns', () => {
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
    const props = getLatestBaseGridProps()
    const colDefs = props.columns as GridColumnDescriptor[]
    expect(colDefs[0].tableColumnMeta).toBeUndefined() // id — not editable
    expect(colDefs[1].tableColumnMeta).toBeDefined() // name — editable
    expect(colDefs[2].tableColumnMeta).toBeDefined() // email — editable
  })

  it('passes showReadOnlyHeaders=true when editMode is active', () => {
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
    const props = getLatestBaseGridProps()
    expect(props.showReadOnlyHeaders).toBe(true)
  })

  it('passes showReadOnlyHeaders=false when editMode is null', () => {
    render(<ResultGridView {...baseProps} />)
    const props = getLatestBaseGridProps()
    expect(props.showReadOnlyHeaders).toBe(false)
  })

  it('passes tableColumnMeta for enum columns', () => {
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
    const props = getLatestBaseGridProps()
    const colDefs = props.columns as GridColumnDescriptor[]
    // Editable columns should have tableColumnMeta for editor factory
    expect(colDefs[1].tableColumnMeta).toBeDefined()
    expect(colDefs[2].tableColumnMeta).toBeDefined()
    expect(colDefs[2].tableColumnMeta?.dataType).toBe('ENUM')
  })

  it('calls onStartEditing when an editable cell is clicked via guard', async () => {
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
    const props = getLatestBaseGridProps()
    const onCellClickGuard = props.onCellClickGuard as (
      args: CellClickGuardArgs
    ) => Promise<CellClickGuardResult>

    expect(onCellClickGuard).toBeDefined()

    let result: CellClickGuardResult
    await act(async () => {
      result = await onCellClickGuard({
        rowIdx: 0,
        columnKey: 'col_1',
        rowData: { __rowIdx: 0, col_0: 1, col_1: 'Alice' },
      })
    })

    expect(onStartEditing).toHaveBeenCalledWith(0)
    expect(result!.proceed).toBe(true)
    expect(result!.enableEditor).toBe(true)
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
    const props = getLatestBaseGridProps()
    const onCellClickGuard = props.onCellClickGuard as (
      args: CellClickGuardArgs
    ) => Promise<CellClickGuardResult>

    let result: CellClickGuardResult
    await act(async () => {
      result = await onCellClickGuard({
        rowIdx: 0,
        columnKey: 'col_0',
        rowData: { __rowIdx: 0, col_0: 1 },
      })
    })

    // Non-editable column should not trigger editing
    expect(onStartEditing).not.toHaveBeenCalled()
    // But proceed should be true (for row selection)
    expect(result!.proceed).toBe(true)
    expect(result!.enableEditor).toBe(false)
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
    const props = getLatestBaseGridProps()
    const onCellClickGuard = props.onCellClickGuard as (
      args: CellClickGuardArgs
    ) => Promise<CellClickGuardResult>

    // Click a cell on a DIFFERENT row (row 1 instead of current row 0)
    await act(async () => {
      await onCellClickGuard({
        rowIdx: 1,
        columnKey: 'col_1',
        rowData: { __rowIdx: 1 },
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
    const props = getLatestBaseGridProps()
    const onCellClickGuard = props.onCellClickGuard as (
      args: CellClickGuardArgs
    ) => Promise<CellClickGuardResult>

    // Click a cell on the SAME row (row 0)
    await act(async () => {
      await onCellClickGuard({
        rowIdx: 0,
        columnKey: 'col_2',
        rowData: { __rowIdx: 0 },
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
    const props = getLatestBaseGridProps()
    const onCellClickGuard = props.onCellClickGuard as (
      args: CellClickGuardArgs
    ) => Promise<CellClickGuardResult>

    let result: CellClickGuardResult
    await act(async () => {
      result = await onCellClickGuard({
        rowIdx: 1,
        columnKey: 'col_1',
        rowData: { __rowIdx: 1 },
      })
    })

    expect(onAutoSave).toHaveBeenCalled()
    expect(onStartEditing).not.toHaveBeenCalled()
    expect(result!.proceed).toBe(false)
  })

  it('isModifiedCell detects modified columns via editState ref', () => {
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
    const props = getLatestBaseGridProps()
    const isModifiedCell = props.isModifiedCell as (
      rowData: Record<string, unknown>,
      columnKey: string
    ) => boolean

    // 'name' column (col_1) on the editing row should be modified
    expect(isModifiedCell({ __rowIdx: 0, col_1: 'Modified' }, 'col_1')).toBe(true)

    // 'email' column (col_2) on the editing row should NOT be modified
    expect(isModifiedCell({ __rowIdx: 0, col_2: 'test' }, 'col_2')).toBe(false)

    // Different row should not be modified
    expect(isModifiedCell({ __rowIdx: 1, col_1: 'Bob' }, 'col_1')).toBe(false)
  })

  it('isModifiedCell returns false in read-only mode', () => {
    render(<ResultGridView {...baseProps} />)
    const props = getLatestBaseGridProps()
    const isModifiedCell = props.isModifiedCell as (
      rowData: Record<string, unknown>,
      columnKey: string
    ) => boolean
    // In read-only mode (editMode=null), should always return false
    expect(isModifiedCell({ __rowIdx: 0, col_0: 1 }, 'col_0')).toBe(false)
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
    const props = getLatestBaseGridProps()
    const rowData = props.rows as Array<Record<string, unknown>>
    // Row 0 should have the updated value
    expect(rowData[0].col_1).toBe('Alice Updated')
    // Row 1 should be unchanged
    expect(rowData[1].col_1).toBe('Bob')
  })

  // --- getRowClass editing row tests ---

  it('getRowClass returns rdg-editing-row for editing row', () => {
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
    const props = getLatestBaseGridProps()
    const getRowClass = props.getRowClass as (row: Record<string, unknown>) => string | undefined

    expect(getRowClass({ __rowIdx: 1 })).toContain('rdg-editing-row')
    expect(getRowClass({ __rowIdx: 0 })).toBeUndefined()
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
    const props = getLatestBaseGridProps()
    const getRowClass = props.getRowClass as (row: Record<string, unknown>) => string | undefined

    const result = getRowClass({ __rowIdx: 1 })
    expect(result).toContain('rdg-editing-row')
    expect(result).toContain('rdg-row-precision-selected')
  })

  // --- onRowsChange tests (cell editor store sync) ---

  it('onRowsChange translates col_N changes to onSyncCellValue with real column name', () => {
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
    const props = getLatestBaseGridProps()
    const onRowsChange = props.onRowsChange as (
      rows: Record<string, unknown>[],
      data: { indexes: number[] }
    ) => void

    // Simulate RDG calling onRowsChange with a modified row
    const modifiedRows = [
      { __rowIdx: 0, col_0: 1, col_1: 'Alice Modified', col_2: 'alice@example.com' },
      { __rowIdx: 1, col_0: 2, col_1: 'Bob', col_2: null },
      { __rowIdx: 2, col_0: 3, col_1: 'Charlie', col_2: 'charlie@example.com' },
    ]
    onRowsChange(modifiedRows, { indexes: [0] })

    // Should call onSyncCellValue with the real column name
    expect(onSyncCellValue).toHaveBeenCalledWith('name', 'Alice Modified')
  })

  it('does not call onCellClick edit logic in read-only mode', async () => {
    const onStartEditing = vi.fn()
    const onRowSelected = vi.fn()
    render(
      <ResultGridView
        {...baseProps}
        onStartEditing={onStartEditing}
        onRowSelected={onRowSelected}
      />
    )
    const props = getLatestBaseGridProps()
    const onCellClickGuard = props.onCellClickGuard as (
      args: CellClickGuardArgs
    ) => Promise<CellClickGuardResult>

    let result: CellClickGuardResult
    await act(async () => {
      result = await onCellClickGuard({
        rowIdx: 0,
        columnKey: 'col_0',
        rowData: { __rowIdx: 0, col_0: 1 },
      })
    })

    expect(onStartEditing).not.toHaveBeenCalled()
    // Read-only guard still calls onRowSelected
    expect(onRowSelected).toHaveBeenCalledWith(0)
    // proceed=true so BaseGridView calls selectCell (cell focus), but enableEditor=false
    expect(result!.proceed).toBe(true)
    expect(result!.enableEditor).toBe(false)
  })

  // --- column descriptor stability tests (focus-loss regression) ---

  it('column descriptors stay stable when editState changes (focus-loss regression)', () => {
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

    const props1 = getLatestBaseGridProps()
    const cols1 = props1.columns as GridColumnDescriptor[]

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

    const props2 = getLatestBaseGridProps()
    const cols2 = props2.columns as GridColumnDescriptor[]

    // CRITICAL: columns must be the SAME array reference.
    // If they change, BaseGridView recomputes rdgColumns, which changes renderEditCell
    // references → React unmounts/remounts the editor → focus lost.
    expect(cols2).toBe(cols1)
  })

  // --- editState adaptation tests ---

  it('adapts rich RowEditState to shared RowEditState with col_N keys', () => {
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { name: 'Alice', email: 'alice@test.com' },
      currentValues: { name: 'Alice Updated', email: 'alice@test.com' },
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
    const props = getLatestBaseGridProps()
    const sharedEditState = props.editState as {
      rowKey: string
      currentValues: Record<string, unknown>
      originalValues: Record<string, unknown>
    }

    expect(sharedEditState).not.toBeNull()
    expect(sharedEditState.rowKey).toBe(JSON.stringify({ id: 1 }))
    expect(sharedEditState.currentValues).toEqual({
      col_1: 'Alice Updated',
      col_2: 'alice@test.com',
    })
    expect(sharedEditState.originalValues).toEqual({
      col_1: 'Alice',
      col_2: 'alice@test.com',
    })
  })

  it('passes null editState when no editing is active', () => {
    render(<ResultGridView {...baseProps} />)
    const props = getLatestBaseGridProps()
    expect(props.editState).toBeNull()
  })
})
