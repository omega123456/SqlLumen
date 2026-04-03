/**
 * Tests for the shared BaseGridView component.
 *
 * Mocks the DataGrid wrapper and verifies that BaseGridView correctly:
 * - Passes columns and rows through
 * - Resets column widths when columns change
 * - Derives sort state from props
 * - Handles cell click guard (proceed/block)
 * - Keeps column definitions stable when editState changes (editStateRef pattern)
 * - Shows ReadOnlyColumnHeaderCell for non-editable columns
 * - Calls getRowClass callback
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

const { mockWriteClipboardText, mockReadClipboardText } = vi.hoisted(() => ({
  mockWriteClipboardText: vi.fn().mockResolvedValue(undefined),
  mockReadClipboardText: vi.fn().mockResolvedValue('Pasted Value'),
}))

vi.mock('../../../lib/context-menu-utils', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>
  return {
    ...original,
    writeClipboardText: mockWriteClipboardText,
    readClipboardText: mockReadClipboardText,
  }
})

// ---------------------------------------------------------------------------
// Mock the shared DataGrid wrapper
// ---------------------------------------------------------------------------

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
        { 'data-testid': props['data-testid'] },
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

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { BaseGridView } from '../../../components/shared/BaseGridView'
import { writeClipboardText } from '../../../lib/context-menu-utils'
import type {
  CellClickGuardResult,
  GridColumnDescriptor,
  RowEditState,
} from '../../../types/shared-data-view'
import type { TableDataColumnMeta } from '../../../types/schema'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLatestGridProps(): Record<string, unknown> {
  const mockCalls = mockDataGridFn.mock.calls
  expect(mockCalls.length).toBeGreaterThanOrEqual(1)
  return mockCalls[mockCalls.length - 1][0] as Record<string, unknown>
}

function getGridSelectionHandlers() {
  const props = getLatestGridProps()
  return {
    onSelectedCellChange: props.onSelectedCellChange as (args: {
      rowIdx: number
      row: Record<string, unknown>
      column: { key: string; idx: number; editable?: boolean }
    }) => void,
    onCellClick: props.onCellClick as (
      args: {
        row: Record<string, unknown>
        rowIdx: number
        column: { key: string; idx: number }
      },
      event: { preventGridDefault: () => void }
    ) => Promise<void>,
  }
}

function makeColumn(
  key: string,
  dataType: string,
  overrides: Partial<GridColumnDescriptor> = {}
): GridColumnDescriptor {
  return {
    key,
    displayName: key,
    dataType,
    editable: false,
    isBinary: false,
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    ...overrides,
  }
}

function makeTableColumnMeta(
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

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const testColumns: GridColumnDescriptor[] = [
  makeColumn('id', 'bigint', { isPrimaryKey: true, editable: true }),
  makeColumn('name', 'varchar', { editable: true }),
  makeColumn('avatar', 'blob', { isBinary: true }),
]

const testRows: Record<string, unknown>[] = [
  { id: 1, name: 'Alice', avatar: null },
  { id: 2, name: null, avatar: '[BLOB 32 bytes]' },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BaseGridView', () => {
  // -----------------------------------------------------------------------
  // Basic rendering
  // -----------------------------------------------------------------------

  it('renders with default data-testid="base-grid-view"', () => {
    render(<BaseGridView columns={testColumns} rows={testRows} editState={null} />)
    expect(screen.getByTestId('base-grid-view')).toBeInTheDocument()
  })

  it('renders with custom testId', () => {
    render(<BaseGridView columns={testColumns} rows={testRows} editState={null} testId="my-grid" />)
    expect(screen.getByTestId('my-grid')).toBeInTheDocument()
  })

  it('passes correct number of column defs to DataGrid', () => {
    render(<BaseGridView columns={testColumns} rows={testRows} editState={null} />)
    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{ key: string }>
    expect(colDefs).toHaveLength(3)
  })

  it('passes rows through to DataGrid unchanged', () => {
    render(<BaseGridView columns={testColumns} rows={testRows} editState={null} />)
    const props = getLatestGridProps()
    const rowData = props.rows as Array<Record<string, unknown>>
    expect(rowData).toHaveLength(2)
    expect(rowData).toBe(testRows) // Same reference — no transformation
  })

  it('maps displayName to column name property', () => {
    const cols = [makeColumn('col_key', 'varchar', { displayName: 'Display Name' })]
    render(<BaseGridView columns={cols} rows={[]} editState={null} />)
    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{ key: string; name: string }>
    expect(colDefs[0].key).toBe('col_key')
    expect(colDefs[0].name).toBe('Display Name')
  })

  it('sets resizable: true on all columns', () => {
    render(<BaseGridView columns={testColumns} rows={testRows} editState={null} />)
    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{ resizable: boolean }>
    colDefs.forEach((col) => expect(col.resizable).toBe(true))
  })

  it('sets sortable: true when onSortChange is provided', () => {
    render(
      <BaseGridView columns={testColumns} rows={testRows} editState={null} onSortChange={vi.fn()} />
    )
    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{ sortable: boolean }>
    colDefs.forEach((col) => expect(col.sortable).toBe(true))
  })

  it('sets sortable: false when onSortChange is not provided', () => {
    render(<BaseGridView columns={testColumns} rows={testRows} editState={null} />)
    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{ sortable: boolean }>
    colDefs.forEach((col) => expect(col.sortable).toBe(false))
  })

  it('renders with empty columns and rows', () => {
    render(<BaseGridView columns={[]} rows={[]} editState={null} />)
    expect(screen.getByTestId('base-grid-view')).toBeInTheDocument()
  })

  it('has renderCell on all columns (TableDataCellRenderer)', () => {
    render(<BaseGridView columns={testColumns} rows={testRows} editState={null} />)
    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{ renderCell: unknown }>
    colDefs.forEach((col) => {
      expect(col.renderCell).toBeDefined()
      expect(typeof col.renderCell).toBe('function')
    })
  })

  // -----------------------------------------------------------------------
  // Column width reset when columns change
  // -----------------------------------------------------------------------

  it('resets column widths when columns change', () => {
    const { rerender } = render(
      <BaseGridView columns={testColumns} rows={testRows} editState={null} />
    )

    // Simulate RDG controlling resized column widths
    const props1 = getLatestGridProps()
    const onColumnWidthsChange = props1.onColumnWidthsChange as (
      widths: Map<string, { type: 'resized' | 'measured'; width: number }>
    ) => void

    act(() => {
      onColumnWidthsChange(new Map([['id', { type: 'resized', width: 300 }]]))
    })

    // Verify the controlled width map is applied
    const props2 = getLatestGridProps()
    const widths2 = props2.columnWidths as Map<
      string,
      { type: 'resized' | 'measured'; width: number }
    >
    expect(widths2.get('id')?.width).toBe(300)

    // Change columns — widths should reset
    const newColumns = [makeColumn('email', 'varchar')]
    rerender(<BaseGridView columns={newColumns} rows={[]} editState={null} />)

    const props3 = getLatestGridProps()
    const widths3 = props3.columnWidths as Map<
      string,
      { type: 'resized' | 'measured'; width: number }
    >
    expect(widths3.size).toBe(0)
  })

  it('preserves column widths when the same columns are re-rendered', () => {
    const { rerender } = render(
      <BaseGridView columns={testColumns} rows={testRows} editState={null} />
    )

    // Simulate RDG controlling resized column widths
    const props1 = getLatestGridProps()
    const onColumnWidthsChange = props1.onColumnWidthsChange as (
      widths: Map<string, { type: 'resized' | 'measured'; width: number }>
    ) => void

    act(() => {
      onColumnWidthsChange(new Map([['name', { type: 'resized', width: 250 }]]))
    })

    // Re-render with same columns (same reference)
    rerender(<BaseGridView columns={testColumns} rows={testRows} editState={null} />)

    const props2 = getLatestGridProps()
    const widths2 = props2.columnWidths as Map<
      string,
      { type: 'resized' | 'measured'; width: number }
    >
    expect(widths2.get('name')?.width).toBe(250)
  })

  // -----------------------------------------------------------------------
  // Auto-sized column widths
  // -----------------------------------------------------------------------

  it('applies auto-sized widths when autoSizeConfig is enabled', () => {
    const computeWidth = vi.fn().mockReturnValue(400)

    render(
      <BaseGridView
        columns={testColumns}
        rows={testRows}
        editState={null}
        autoSizeConfig={{ enabled: true, computeWidth }}
      />
    )

    expect(computeWidth).toHaveBeenCalledTimes(testColumns.length)
    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{ key: string; width: number }>
    colDefs.forEach((col) => {
      expect(col.width).toBe(400)
    })
  })

  it('does not compute auto widths when autoSizeConfig is disabled', () => {
    const computeWidth = vi.fn()

    render(
      <BaseGridView
        columns={testColumns}
        rows={testRows}
        editState={null}
        autoSizeConfig={{ enabled: false, computeWidth }}
      />
    )

    expect(computeWidth).not.toHaveBeenCalled()
  })

  it('does not recompute auto widths when editState is active (rows change during editing)', () => {
    const computeWidth = vi.fn().mockReturnValue(200)

    const editState: RowEditState = {
      rowKey: 'row-1',
      currentValues: { id: 1, name: 'Alice' },
      originalValues: { id: 1, name: 'Alice' },
    }

    // First render: editState is null → auto widths are computed
    const { rerender } = render(
      <BaseGridView
        columns={testColumns}
        rows={testRows}
        editState={null}
        autoSizeConfig={{ enabled: true, computeWidth }}
      />
    )

    const initialCallCount = computeWidth.mock.calls.length
    expect(initialCallCount).toBe(testColumns.length) // computed once for each column

    // Re-render with editState active and different rows → should NOT recompute
    const editedRows = [
      { id: 1, name: 'Alice Edited', avatar: null },
      { id: 2, name: null, avatar: '[BLOB 32 bytes]' },
    ]

    rerender(
      <BaseGridView
        columns={testColumns}
        rows={editedRows}
        editState={editState}
        autoSizeConfig={{ enabled: true, computeWidth }}
      />
    )

    // computeWidth should NOT have been called again
    expect(computeWidth.mock.calls.length).toBe(initialCallCount)

    // Column definitions should still use the cached auto widths
    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{ key: string; width: number }>
    colDefs.forEach((col) => {
      expect(col.width).toBe(200) // cached value
    })
  })

  it('recomputes auto widths when editState goes from active to null', () => {
    const computeWidth = vi.fn().mockReturnValue(200)

    const editState: RowEditState = {
      rowKey: 'row-1',
      currentValues: { id: 1, name: 'Alice' },
      originalValues: { id: 1, name: 'Alice' },
    }

    // Start with editState active — auto widths won't be computed initially
    // (no prior cached values, so ref is {})
    const { rerender } = render(
      <BaseGridView
        columns={testColumns}
        rows={testRows}
        editState={editState}
        autoSizeConfig={{ enabled: true, computeWidth }}
      />
    )

    // editState is active on first render, so computeWidth is NOT called
    expect(computeWidth).not.toHaveBeenCalled()

    // Now clear editState → should recompute
    computeWidth.mockReturnValue(350)
    rerender(
      <BaseGridView
        columns={testColumns}
        rows={testRows}
        editState={null}
        autoSizeConfig={{ enabled: true, computeWidth }}
      />
    )

    expect(computeWidth).toHaveBeenCalledTimes(testColumns.length)

    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{ key: string; width: number }>
    colDefs.forEach((col) => {
      expect(col.width).toBe(350)
    })
  })

  // -----------------------------------------------------------------------
  // Sort column derivation from props
  // -----------------------------------------------------------------------

  it('derives sortColumns from sortColumn/sortDirection ASC', () => {
    render(
      <BaseGridView
        columns={testColumns}
        rows={testRows}
        editState={null}
        sortColumn="name"
        sortDirection="ASC"
        onSortChange={vi.fn()}
      />
    )
    const props = getLatestGridProps()
    const sortColumns = props.sortColumns as Array<{ columnKey: string; direction: string }>
    expect(sortColumns).toEqual([{ columnKey: 'name', direction: 'ASC' }])
  })

  it('derives sortColumns from sortColumn/sortDirection DESC', () => {
    render(
      <BaseGridView
        columns={testColumns}
        rows={testRows}
        editState={null}
        sortColumn="id"
        sortDirection="DESC"
        onSortChange={vi.fn()}
      />
    )
    const props = getLatestGridProps()
    const sortColumns = props.sortColumns as Array<{ columnKey: string; direction: string }>
    expect(sortColumns).toEqual([{ columnKey: 'id', direction: 'DESC' }])
  })

  it('has empty sortColumns when no sort is active', () => {
    render(<BaseGridView columns={testColumns} rows={testRows} editState={null} />)
    const props = getLatestGridProps()
    const sortColumns = props.sortColumns as Array<{ columnKey: string; direction: string }>
    expect(sortColumns).toEqual([])
  })

  it('has empty sortColumns when sortColumn is set but sortDirection is null', () => {
    render(
      <BaseGridView
        columns={testColumns}
        rows={testRows}
        editState={null}
        sortColumn="name"
        sortDirection={null}
      />
    )
    const props = getLatestGridProps()
    const sortColumns = props.sortColumns as Array<{ columnKey: string; direction: string }>
    expect(sortColumns).toEqual([])
  })

  it('handleSortColumnsChange calls onSortChange with column key and direction', () => {
    const onSortChange = vi.fn()
    render(
      <BaseGridView
        columns={testColumns}
        rows={testRows}
        editState={null}
        onSortChange={onSortChange}
      />
    )
    const props = getLatestGridProps()
    const onSortColumnsChange = props.onSortColumnsChange as (
      cols: Array<{ columnKey: string; direction: string }>
    ) => void

    onSortColumnsChange([{ columnKey: 'name', direction: 'ASC' }])
    expect(onSortChange).toHaveBeenCalledWith('name', 'ASC')
  })

  it('handleSortColumnsChange enforces single-sort by keeping only the last column', () => {
    const onSortChange = vi.fn()
    render(
      <BaseGridView
        columns={testColumns}
        rows={testRows}
        editState={null}
        onSortChange={onSortChange}
      />
    )
    const props = getLatestGridProps()
    const onSortColumnsChange = props.onSortColumnsChange as (
      cols: Array<{ columnKey: string; direction: string }>
    ) => void

    onSortColumnsChange([
      { columnKey: 'id', direction: 'ASC' },
      { columnKey: 'name', direction: 'DESC' },
    ])
    expect(onSortChange).toHaveBeenCalledWith('name', 'DESC')
  })

  it('handleSortColumnsChange calls onSortChange with nulls when sort is cleared', () => {
    const onSortChange = vi.fn()
    render(
      <BaseGridView
        columns={testColumns}
        rows={testRows}
        editState={null}
        onSortChange={onSortChange}
      />
    )
    const props = getLatestGridProps()
    const onSortColumnsChange = props.onSortColumnsChange as (
      cols: Array<{ columnKey: string; direction: string }>
    ) => void

    onSortColumnsChange([])
    expect(onSortChange).toHaveBeenCalledWith(null, null)
  })

  it('does not pass onSortColumnsChange when onSortChange is not provided', () => {
    render(<BaseGridView columns={testColumns} rows={testRows} editState={null} />)
    const props = getLatestGridProps()
    expect(props.onSortColumnsChange).toBeUndefined()
  })

  // -----------------------------------------------------------------------
  // Cell click handler — guard returns proceed=false
  // -----------------------------------------------------------------------

  it('does not call selectCell when guard returns proceed=false', async () => {
    const guard = vi.fn().mockResolvedValue({
      proceed: false,
      targetRowIdx: 0,
      targetColIdx: 0,
      enableEditor: false,
    })

    render(
      <BaseGridView
        columns={testColumns}
        rows={testRows}
        editState={null}
        onCellClickGuard={guard}
      />
    )

    const props = getLatestGridProps()
    const onCellClick = props.onCellClick as (
      args: {
        row: Record<string, unknown>
        rowIdx: number
        column: { key: string; idx: number }
      },
      event: { preventGridDefault: () => void }
    ) => Promise<void>

    const mockPrevent = vi.fn()

    await act(async () => {
      await onCellClick(
        {
          row: testRows[0],
          rowIdx: 0,
          column: { key: 'name', idx: 1 },
        },
        { preventGridDefault: mockPrevent }
      )
    })

    expect(mockPrevent).toHaveBeenCalled()
    expect(guard).toHaveBeenCalledWith({
      rowIdx: 0,
      columnKey: 'name',
      rowData: testRows[0],
    })
    expect(mockSelectCell).not.toHaveBeenCalled()
  })

  it('restores cell focus when guard blocks navigation but requests focus restoration', async () => {
    const guard = vi.fn().mockResolvedValue({
      proceed: false,
      targetRowIdx: 0,
      targetColIdx: 1,
      enableEditor: true,
      restoreFocus: true,
    })

    render(
      <BaseGridView
        columns={testColumns}
        rows={testRows}
        editState={null}
        onCellClickGuard={guard}
      />
    )

    const props = getLatestGridProps()
    const onCellClick = props.onCellClick as (
      args: {
        row: Record<string, unknown>
        rowIdx: number
        column: { key: string; idx: number }
      },
      event: { preventGridDefault: () => void }
    ) => Promise<void>

    await act(async () => {
      await onCellClick(
        {
          row: testRows[1],
          rowIdx: 1,
          column: { key: 'name', idx: 1 },
        },
        { preventGridDefault: vi.fn() }
      )
    })

    expect(mockSelectCell).toHaveBeenCalledWith(
      { rowIdx: 0, idx: 1 },
      { enableEditor: true, shouldFocusCell: true }
    )
  })

  it('uses the guard-provided restore target when the prior selection is on a different row', async () => {
    const guard = vi.fn().mockResolvedValue({
      proceed: false,
      targetRowIdx: 1,
      targetColIdx: 0,
      enableEditor: false,
      restoreFocus: true,
    })

    render(
      <BaseGridView
        columns={testColumns}
        rows={testRows}
        editState={null}
        onCellClickGuard={guard}
      />
    )

    const { onSelectedCellChange, onCellClick } = getGridSelectionHandlers()

    act(() => {
      onSelectedCellChange({
        rowIdx: 0,
        row: testRows[0],
        column: { key: 'name', idx: 1, editable: true },
      })
    })

    await act(async () => {
      await onCellClick(
        {
          row: testRows[1],
          rowIdx: 1,
          column: { key: 'id', idx: 0 },
        },
        { preventGridDefault: vi.fn() }
      )
    })

    expect(mockSelectCell).toHaveBeenCalledWith(
      { rowIdx: 1, idx: 0 },
      { enableEditor: false, shouldFocusCell: true }
    )
  })

  it('restores the editing cell when RDG updates selection before the guarded click runs', async () => {
    const guard = vi.fn().mockResolvedValue({
      proceed: false,
      targetRowIdx: 0,
      targetColIdx: 1,
      enableEditor: true,
      restoreFocus: true,
    })

    render(
      <BaseGridView
        columns={testColumns}
        rows={testRows}
        editState={null}
        onCellClickGuard={guard}
      />
    )

    const { onSelectedCellChange, onCellClick } = getGridSelectionHandlers()

    act(() => {
      onSelectedCellChange({
        rowIdx: 0,
        row: testRows[0],
        column: { key: 'name', idx: 1, editable: true },
      })
    })

    act(() => {
      onSelectedCellChange({
        rowIdx: 1,
        row: testRows[1],
        column: { key: 'id', idx: 0, editable: false },
      })
    })

    await act(async () => {
      await onCellClick(
        {
          row: testRows[1],
          rowIdx: 1,
          column: { key: 'id', idx: 0 },
        },
        { preventGridDefault: vi.fn() }
      )
    })

    expect(mockSelectCell).toHaveBeenCalledWith(
      { rowIdx: 0, idx: 1 },
      { enableEditor: true, shouldFocusCell: true }
    )
  })

  it('restores the prior column when the guard sends focus back to the same row', async () => {
    const guard = vi.fn().mockResolvedValue({
      proceed: false,
      targetRowIdx: 1,
      targetColIdx: 0,
      enableEditor: false,
      restoreFocus: true,
    })

    render(
      <BaseGridView
        columns={testColumns}
        rows={testRows}
        editState={null}
        onCellClickGuard={guard}
      />
    )

    const { onSelectedCellChange, onCellClick } = getGridSelectionHandlers()

    act(() => {
      onSelectedCellChange({
        rowIdx: 1,
        row: testRows[1],
        column: { key: 'name', idx: 1, editable: true },
      })
    })

    act(() => {
      onSelectedCellChange({
        rowIdx: 1,
        row: testRows[1],
        column: { key: 'id', idx: 0, editable: false },
      })
    })

    await act(async () => {
      await onCellClick(
        {
          row: testRows[1],
          rowIdx: 1,
          column: { key: 'id', idx: 0 },
        },
        { preventGridDefault: vi.fn() }
      )
    })

    expect(mockSelectCell).toHaveBeenCalledWith(
      { rowIdx: 1, idx: 1 },
      { enableEditor: false, shouldFocusCell: true }
    )
  })

  it('restores the editing cell when selection changes during an async guard failure', async () => {
    type RestoreFocusGuardResult = CellClickGuardResult & {
      proceed: false
      restoreFocus: true
    }

    let resolveGuard: ((value: RestoreFocusGuardResult) => void) | null = null

    const guard = vi.fn(
      () =>
        new Promise<RestoreFocusGuardResult>((resolve) => {
          resolveGuard = resolve
        })
    )

    render(
      <BaseGridView
        columns={testColumns}
        rows={testRows}
        editState={null}
        onCellClickGuard={guard}
      />
    )

    const { onSelectedCellChange, onCellClick } = getGridSelectionHandlers()

    act(() => {
      onSelectedCellChange({
        rowIdx: 0,
        row: testRows[0],
        column: { key: 'name', idx: 1, editable: true },
      })
    })

    await act(async () => {
      const clickPromise = onCellClick(
        {
          row: testRows[1],
          rowIdx: 1,
          column: { key: 'id', idx: 0 },
        },
        { preventGridDefault: vi.fn() }
      )

      onSelectedCellChange({
        rowIdx: 1,
        row: testRows[1],
        column: { key: 'id', idx: 0, editable: false },
      })

      expect(resolveGuard).not.toBeNull()
      resolveGuard!({
        proceed: false,
        targetRowIdx: 0,
        targetColIdx: 1,
        enableEditor: true,
        restoreFocus: true,
      })

      await clickPromise
    })

    expect(mockSelectCell).toHaveBeenCalledWith(
      { rowIdx: 0, idx: 1 },
      { enableEditor: true, shouldFocusCell: true }
    )
  })

  it('ignores stale guard results when a newer guarded click occurs', async () => {
    type DeferredGuard = {
      resolve: (value: CellClickGuardResult) => void
    }

    const deferredGuards: DeferredGuard[] = []
    const guard = vi.fn(
      () =>
        new Promise<CellClickGuardResult>((resolve) => {
          deferredGuards.push({
            resolve,
          })
        })
    )

    render(
      <BaseGridView
        columns={testColumns}
        rows={testRows}
        editState={null}
        onCellClickGuard={guard}
      />
    )

    const { onSelectedCellChange, onCellClick } = getGridSelectionHandlers()

    act(() => {
      onSelectedCellChange({
        rowIdx: 0,
        row: testRows[0],
        column: { key: 'name', idx: 1, editable: true },
      })
    })

    const firstClick = onCellClick(
      {
        row: testRows[1],
        rowIdx: 1,
        column: { key: 'id', idx: 0 },
      },
      { preventGridDefault: vi.fn() }
    )

    act(() => {
      onSelectedCellChange({
        rowIdx: 1,
        row: testRows[1],
        column: { key: 'id', idx: 0, editable: false },
      })
    })

    const secondClick = onCellClick(
      {
        row: testRows[1],
        rowIdx: 1,
        column: { key: 'name', idx: 1 },
      },
      { preventGridDefault: vi.fn() }
    )

    expect(deferredGuards).toHaveLength(2)

    await act(async () => {
      deferredGuards[1].resolve({
        proceed: true,
        targetRowIdx: 1,
        targetColIdx: 1,
        enableEditor: true,
      })
      await secondClick
    })

    await act(async () => {
      deferredGuards[0].resolve({
        proceed: false,
        targetRowIdx: 0,
        targetColIdx: 1,
        enableEditor: true,
        restoreFocus: true,
      })
      await firstClick
    })

    expect(mockSelectCell).toHaveBeenNthCalledWith(1, { rowIdx: 1, idx: 1 }, { enableEditor: true })
    expect(mockSelectCell).toHaveBeenCalledTimes(1)
  })

  // -----------------------------------------------------------------------
  // Cell click handler — guard returns proceed=true
  // -----------------------------------------------------------------------

  it('calls selectCell when guard returns proceed=true', async () => {
    const guard = vi.fn().mockResolvedValue({
      proceed: true,
      targetRowIdx: 1,
      targetColIdx: 2,
      enableEditor: true,
    })

    render(
      <BaseGridView
        columns={testColumns}
        rows={testRows}
        editState={null}
        onCellClickGuard={guard}
      />
    )

    const props = getLatestGridProps()
    const onCellClick = props.onCellClick as (
      args: {
        row: Record<string, unknown>
        rowIdx: number
        column: { key: string; idx: number }
      },
      event: { preventGridDefault: () => void }
    ) => Promise<void>

    await act(async () => {
      await onCellClick(
        {
          row: testRows[0],
          rowIdx: 0,
          column: { key: 'id', idx: 0 },
        },
        { preventGridDefault: vi.fn() }
      )
    })

    expect(mockSelectCell).toHaveBeenCalledWith({ rowIdx: 1, idx: 2 }, { enableEditor: true })
  })

  it('does not call preventGridDefault when no guard is provided', async () => {
    render(<BaseGridView columns={testColumns} rows={testRows} editState={null} />)

    const props = getLatestGridProps()
    const onCellClick = props.onCellClick as (
      args: {
        row: Record<string, unknown>
        rowIdx: number
        column: { key: string; idx: number }
      },
      event: { preventGridDefault: () => void }
    ) => Promise<void>

    const mockPrevent = vi.fn()

    await act(async () => {
      await onCellClick(
        {
          row: testRows[0],
          rowIdx: 0,
          column: { key: 'id', idx: 0 },
        },
        { preventGridDefault: mockPrevent }
      )
    })

    expect(mockPrevent).not.toHaveBeenCalled()
    expect(mockSelectCell).not.toHaveBeenCalled()
  })

  // -----------------------------------------------------------------------
  // Editor stability test (editStateRef pattern — anti-focus-loss)
  // -----------------------------------------------------------------------

  it('column definitions stay stable when editState changes (editStateRef pattern)', () => {
    const editStateA: RowEditState = {
      rowKey: 'row-1',
      currentValues: { id: 1, name: 'Alice' },
      originalValues: { id: 1, name: 'Alice' },
    }

    const { rerender } = render(
      <BaseGridView columns={testColumns} rows={testRows} editState={editStateA} />
    )

    const props1 = getLatestGridProps()
    const columns1 = props1.columns

    // Simulate editState change (e.g. user types in a cell)
    const editStateB: RowEditState = {
      rowKey: 'row-1',
      currentValues: { id: 1, name: 'Alice2' },
      originalValues: { id: 1, name: 'Alice' },
    }

    rerender(<BaseGridView columns={testColumns} rows={testRows} editState={editStateB} />)

    const props2 = getLatestGridProps()
    const columns2 = props2.columns

    // CRITICAL: column definitions must be the SAME reference.
    // If they change, React will unmount/remount editors → focus lost.
    expect(columns2).toBe(columns1)
  })

  it('column definitions stay stable when isModifiedCell callback changes', () => {
    const isModified1 = vi.fn().mockReturnValue(false)
    const isModified2 = vi.fn().mockReturnValue(true)

    const { rerender } = render(
      <BaseGridView
        columns={testColumns}
        rows={testRows}
        editState={null}
        isModifiedCell={isModified1}
      />
    )

    const cols1 = getLatestGridProps().columns

    rerender(
      <BaseGridView
        columns={testColumns}
        rows={testRows}
        editState={null}
        isModifiedCell={isModified2}
      />
    )

    const cols2 = getLatestGridProps().columns

    // Column definitions should be the SAME reference
    expect(cols2).toBe(cols1)
  })

  // -----------------------------------------------------------------------
  // cellClass behaviour
  // -----------------------------------------------------------------------

  it('cellClass includes rdg-editable-cell for editable columns', () => {
    const cols = [makeColumn('name', 'varchar', { editable: true })]
    render(<BaseGridView columns={cols} rows={[{ name: 'Alice' }]} editState={null} />)

    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{
      key: string
      cellClass: (row: Record<string, unknown>) => string
    }>
    expect(colDefs[0].cellClass({ name: 'Alice' })).toContain('rdg-editable-cell')
    expect(colDefs[0].cellClass({ name: 'Alice' })).not.toContain('rdg-readonly-cell')
  })

  it('cellClass includes rdg-readonly-cell for non-editable columns', () => {
    const cols = [makeColumn('avatar', 'blob', { editable: false })]
    render(<BaseGridView columns={cols} rows={[{ avatar: null }]} editState={null} />)

    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{
      key: string
      cellClass: (row: Record<string, unknown>) => string
    }>
    expect(colDefs[0].cellClass({ avatar: null })).toContain('rdg-readonly-cell')
    expect(colDefs[0].cellClass({ avatar: null })).not.toContain('rdg-editable-cell')
  })

  it('cellClass includes rdg-modified-cell when isModifiedCell returns true', () => {
    const isModifiedCell = vi.fn().mockReturnValue(true)
    const editState: RowEditState = {
      rowKey: 'row-1',
      currentValues: { name: 'Modified' },
      originalValues: { name: 'Original' },
    }

    const cols = [makeColumn('name', 'varchar', { editable: true })]
    render(
      <BaseGridView
        columns={cols}
        rows={[{ name: 'Modified' }]}
        editState={editState}
        isModifiedCell={isModifiedCell}
      />
    )

    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{
      cellClass: (row: Record<string, unknown>) => string
    }>
    expect(colDefs[0].cellClass({ name: 'Modified' })).toContain('rdg-modified-cell')
    expect(isModifiedCell).toHaveBeenCalledWith({ name: 'Modified' }, 'name')
  })

  it('cellClass does NOT include rdg-modified-cell when editState is null', () => {
    const isModifiedCell = vi.fn().mockReturnValue(true)
    const cols = [makeColumn('name', 'varchar', { editable: true })]
    render(
      <BaseGridView
        columns={cols}
        rows={[{ name: 'Alice' }]}
        editState={null}
        isModifiedCell={isModifiedCell}
      />
    )

    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{
      cellClass: (row: Record<string, unknown>) => string
    }>
    expect(colDefs[0].cellClass({ name: 'Alice' })).not.toContain('rdg-modified-cell')
  })

  it('cellClass includes base type class from getGridCellClass', () => {
    const cols = [makeColumn('id', 'bigint', { isPrimaryKey: true })]
    render(<BaseGridView columns={cols} rows={[{ id: 1 }]} editState={null} />)

    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{
      cellClass: (row: Record<string, unknown>) => string
    }>
    // bigint PK → td-cell-mono-muted
    expect(colDefs[0].cellClass({ id: 1 })).toContain('td-cell-mono-muted')
  })

  // -----------------------------------------------------------------------
  // showReadOnlyHeaders
  // -----------------------------------------------------------------------

  it('adds ReadOnlyColumnHeaderCell for non-editable columns when showReadOnlyHeaders is true', () => {
    const cols = [
      makeColumn('id', 'bigint', { editable: true }),
      makeColumn('avatar', 'blob', { editable: false }),
    ]
    render(
      <BaseGridView columns={cols} rows={testRows} editState={null} showReadOnlyHeaders={true} />
    )

    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{
      key: string
      renderHeaderCell?: unknown
      headerCellClass?: string
    }>

    // Editable column should NOT have renderHeaderCell
    expect(colDefs[0].renderHeaderCell).toBeUndefined()

    // Non-editable column should have renderHeaderCell (ReadOnlyColumnHeaderCell)
    expect(colDefs[1].renderHeaderCell).toBeDefined()
    expect(typeof colDefs[1].renderHeaderCell).toBe('function')
    expect(colDefs[1].headerCellClass).toBe('rdg-readonly-cell')
  })

  it('does not add ReadOnlyColumnHeaderCell when showReadOnlyHeaders is false/undefined', () => {
    const cols = [makeColumn('avatar', 'blob', { editable: false })]
    render(<BaseGridView columns={cols} rows={testRows} editState={null} />)

    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{
      renderHeaderCell?: unknown
      headerCellClass?: string
    }>
    expect(colDefs[0].renderHeaderCell).toBeUndefined()
    expect(colDefs[0].headerCellClass).toBeUndefined()
  })

  // -----------------------------------------------------------------------
  // Row class callback
  // -----------------------------------------------------------------------

  it('passes getRowClass through to DataGrid rowClass', () => {
    const getRowClass = vi.fn().mockReturnValue('custom-row-class')
    render(
      <BaseGridView
        columns={testColumns}
        rows={testRows}
        editState={null}
        getRowClass={getRowClass}
      />
    )

    const props = getLatestGridProps()
    const rowClass = props.rowClass as (row: Record<string, unknown>) => string | undefined

    // Call it directly to verify the callback is wired through
    const result = rowClass({ id: 1, name: 'Alice' })
    expect(result).toBe('custom-row-class')
    expect(getRowClass).toHaveBeenCalledWith({ id: 1, name: 'Alice' })
  })

  it('rowClass is undefined when getRowClass is not provided', () => {
    render(<BaseGridView columns={testColumns} rows={testRows} editState={null} />)

    const props = getLatestGridProps()
    expect(props.rowClass).toBeUndefined()
  })

  // -----------------------------------------------------------------------
  // Row key getter
  // -----------------------------------------------------------------------

  it('passes rowKeyGetter prop through to DataGrid', () => {
    const rowKeyGetter = vi.fn().mockReturnValue('key-1')
    render(
      <BaseGridView
        columns={testColumns}
        rows={testRows}
        editState={null}
        rowKeyGetter={rowKeyGetter}
      />
    )

    const props = getLatestGridProps()
    expect(props.rowKeyGetter).toBe(rowKeyGetter)
  })

  it('does not pass rowKeyGetter when not provided', () => {
    render(<BaseGridView columns={testColumns} rows={testRows} editState={null} />)

    const props = getLatestGridProps()
    expect(props.rowKeyGetter).toBeUndefined()
  })

  // -----------------------------------------------------------------------
  // onRowsChange delegation
  // -----------------------------------------------------------------------

  it('delegates onRowsChange to consumer prop', () => {
    const onRowsChange = vi.fn()
    render(
      <BaseGridView
        columns={testColumns}
        rows={testRows}
        editState={null}
        onRowsChange={onRowsChange}
      />
    )

    const props = getLatestGridProps()
    const gridOnRowsChange = props.onRowsChange as (
      rows: Record<string, unknown>[],
      data: { indexes: number[] }
    ) => void

    const newRows = [{ id: 1, name: 'Updated' }]
    const data = { indexes: [0] }

    act(() => {
      gridOnRowsChange(newRows, data)
    })

    expect(onRowsChange).toHaveBeenCalledWith(newRows, data)
  })

  // -----------------------------------------------------------------------
  // onColumnResize delegation
  // -----------------------------------------------------------------------

  it('calls onColumnResize prop with column key and width', () => {
    const onColumnResize = vi.fn()
    render(
      <BaseGridView
        columns={testColumns}
        rows={testRows}
        editState={null}
        onColumnResize={onColumnResize}
      />
    )

    const props = getLatestGridProps()
    const gridOnColumnResize = props.onColumnResize as (col: { key: string }, width: number) => void

    act(() => {
      gridOnColumnResize({ key: 'name' }, 350)
    })

    expect(onColumnResize).toHaveBeenCalledWith('name', 350)
  })

  it('opens the next editable cell editor after tab navigation', () => {
    render(<BaseGridView columns={testColumns} rows={testRows} editState={null} />)

    const props = getLatestGridProps()
    const onCellKeyDown = props.onCellKeyDown as (
      args: {
        mode: 'EDIT'
        row: Record<string, unknown>
        rowIdx: number
        column: { key: string; idx: number; editable?: boolean }
        navigate: () => void
        onClose: (commitChanges?: boolean, shouldFocusCell?: boolean) => void
      },
      event: {
        key: string
        shiftKey?: boolean
        ctrlKey?: boolean
        metaKey?: boolean
        preventGridDefault: () => void
        isGridDefaultPrevented: () => boolean
      }
    ) => void
    const onSelectedCellChange = props.onSelectedCellChange as (args: {
      rowIdx: number
      row: Record<string, unknown>
      column: { key: string; idx: number; editable?: boolean }
    }) => void

    act(() => {
      onCellKeyDown(
        {
          mode: 'EDIT',
          row: testRows[0],
          rowIdx: 0,
          column: { key: 'id', idx: 0, editable: true },
          navigate: vi.fn(),
          onClose: vi.fn(),
        },
        {
          key: 'Tab',
          shiftKey: false,
          ctrlKey: false,
          metaKey: false,
          preventGridDefault: vi.fn(),
          isGridDefaultPrevented: () => false,
        }
      )

      onSelectedCellChange({
        rowIdx: 0,
        row: testRows[0],
        column: { key: 'name', idx: 1, editable: true },
      })
    })

    expect(mockSelectCell).toHaveBeenCalledWith(
      { rowIdx: 0, idx: 1 },
      { enableEditor: true, shouldFocusCell: true }
    )
  })

  it('copies the selected cell value with the keyboard shortcut', async () => {
    render(<BaseGridView columns={testColumns} rows={testRows} editState={null} />)

    const props = getLatestGridProps()
    const onSelectedCellChange = props.onSelectedCellChange as (args: {
      rowIdx: number
      row: Record<string, unknown>
      column: { key: string; idx: number; editable?: boolean }
    }) => void
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

    act(() => {
      onSelectedCellChange({
        rowIdx: 0,
        row: testRows[0],
        column: { key: 'name', idx: 1, editable: true },
      })
    })

    await act(async () => {
      onCellKeyDown(
        {
          mode: 'SELECT',
          row: testRows[0],
          rowIdx: 0,
          column: { key: 'name', idx: 1, editable: true },
          selectCell: vi.fn(),
        },
        {
          key: 'c',
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
          preventGridDefault: vi.fn(),
          isGridDefaultPrevented: () => false,
        }
      )
    })

    expect(writeClipboardText).toHaveBeenCalledWith('Alice')
  })

  it('shows a cell context menu and disables cut/paste for read-only cells', () => {
    const readOnlyColumns = [makeColumn('name', 'varchar', { editable: false })]

    render(<BaseGridView columns={readOnlyColumns} rows={[{ name: 'Alice' }]} editState={null} />)

    const props = getLatestGridProps()
    const onCellContextMenu = props.onCellContextMenu as (
      args: {
        rowIdx: number
        row: Record<string, unknown>
        column: { key: string; idx: number; editable?: boolean }
      },
      event: {
        clientX: number
        clientY: number
        preventDefault: () => void
        preventGridDefault: () => void
      }
    ) => void

    act(() => {
      onCellContextMenu(
        {
          rowIdx: 0,
          row: { name: 'Alice' },
          column: { key: 'name', idx: 0, editable: false },
        },
        {
          clientX: 40,
          clientY: 50,
          preventDefault: vi.fn(),
          preventGridDefault: vi.fn(),
        }
      )
    })

    expect(screen.getByTestId('grid-cell-context-menu')).toBeInTheDocument()
    expect(screen.getByTestId('grid-cell-context-copy')).toBeEnabled()
    expect(screen.getByTestId('grid-cell-context-cut')).toBeDisabled()
    expect(screen.getByTestId('grid-cell-context-paste')).toBeDisabled()
  })

  // -----------------------------------------------------------------------
  // Editable columns with tableColumnMeta get renderEditCell
  // -----------------------------------------------------------------------

  it('attaches renderEditCell for editable columns with tableColumnMeta', () => {
    const cols = [
      makeColumn('name', 'varchar', {
        editable: true,
        tableColumnMeta: makeTableColumnMeta('name', 'varchar'),
      }),
    ]
    render(<BaseGridView columns={cols} rows={[{ name: 'Alice' }]} editState={null} />)

    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{ key: string; renderEditCell?: unknown }>
    expect(colDefs[0].renderEditCell).toBeDefined()
    expect(typeof colDefs[0].renderEditCell).toBe('function')
  })

  it('does not attach renderEditCell for non-editable columns', () => {
    const cols = [
      makeColumn('avatar', 'blob', {
        editable: false,
        tableColumnMeta: makeTableColumnMeta('avatar', 'blob', { isBinary: true }),
      }),
    ]
    render(<BaseGridView columns={cols} rows={[{ avatar: null }]} editState={null} />)

    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{ key: string; renderEditCell?: unknown }>
    expect(colDefs[0].renderEditCell).toBeUndefined()
  })

  it('does not attach renderEditCell for editable columns without tableColumnMeta', () => {
    const cols = [makeColumn('name', 'varchar', { editable: true })]
    render(<BaseGridView columns={cols} rows={[{ name: 'Alice' }]} editState={null} />)

    const props = getLatestGridProps()
    const colDefs = props.columns as Array<{ key: string; renderEditCell?: unknown }>
    expect(colDefs[0].renderEditCell).toBeUndefined()
  })

  // -----------------------------------------------------------------------
  // Optional insert/delete capabilities (contract props)
  // -----------------------------------------------------------------------

  it('accepts optional insert/delete capability props without affecting rendering', () => {
    const onInsertRow = vi.fn()
    const onDeleteRow = vi.fn()
    render(
      <BaseGridView
        columns={testColumns}
        rows={testRows}
        editState={null}
        onInsertRow={onInsertRow}
        onDeleteRow={onDeleteRow}
        canInsert={true}
        canDelete={true}
      />
    )
    // The grid renders fine with these props — they're part of the shared contract
    expect(screen.getByTestId('base-grid-view')).toBeInTheDocument()
    // The grid itself doesn't call these — they're for toolbar/parent consumption
    expect(onInsertRow).not.toHaveBeenCalled()
    expect(onDeleteRow).not.toHaveBeenCalled()
  })
})
