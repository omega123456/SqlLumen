import React from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResultGridView } from '../../../components/query-editor/ResultGridView'
import { useQueryStore } from '../../../stores/query-store'
import type { ColumnMeta } from '../../../types/schema'
import * as CanvasBaseGridViewModule from '../../../components/shared/glide/CanvasBaseGridView'

// CanvasBaseGridView is a forwardRef object — vi.spyOn can't intercept it.
// Use Object.defineProperty to replace it per-test (same pattern as TableDataFormView.test.tsx).

const originalCanvasBaseGridView = CanvasBaseGridViewModule.CanvasBaseGridView
let mockCanvasBaseGridView: ReturnType<typeof vi.fn>

const columns: ColumnMeta[] = [
  { name: 'id', dataType: 'INT' },
  { name: 'name', dataType: 'VARCHAR' },
]

const baseProps = {
  columns,
  rows: [
    [1, 'Ada'],
    [2, 'Bob'],
  ],
  sortColumn: null,
  sortDirection: null,
  onSortChanged: vi.fn(),
  onRowSelected: vi.fn(),
  selectedRowIndex: null,
  tabId: 'tab-1',
  editMode: null,
  editableColumnMap: new Map<number, boolean>(),
  editState: null,
  editingRowIndex: null,
  editTableColumns: [],
  editColumnBindings: new Map<number, string>(),
  onStartEditing: vi.fn(),
  onUpdateCellValue: vi.fn(),
  onSyncCellValue: vi.fn(),
  onAutoSave: vi.fn(async () => true),
}

function getGridProps() {
  return mockCanvasBaseGridView.mock.lastCall?.[0] as {
    rows: Array<Record<string, unknown>>
    columns: Array<{ key: string; displayName: string; editable: boolean }>
    onSortChange: (column: string | null, direction: 'ASC' | 'DESC' | null) => void
    onCellClickGuard: (args: {
      rowIdx: number
      columnKey: string
      rowData: Record<string, unknown>
    }) => Promise<unknown>
    onCellSelectionChange?: (args: {
      rowIdx: number
      columnKey: string
      rowData: Record<string, unknown>
    }) => void
    onSelectedCellChange: (pos: { rowIdx: number; idx: number }) => void
    rowKeyGetter: (row: Record<string, unknown>) => string
    getRowClass: (row: Record<string, unknown>) => string | undefined
    selectedCellPosition: { rowIdx: number; idx: number } | null
    selectedRowClassName?: string
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useQueryStore.setState({ tabs: {} })

  mockCanvasBaseGridView = vi.fn(
    (props: Record<string, unknown>) =>
      (
        <div data-testid="mock-result-grid" data-row-count={(props.rows as unknown[])?.length ?? 0} />
      ) as unknown as React.ReactElement
  )
  const mockFn = mockCanvasBaseGridView as unknown as (props: Record<string, unknown>) => React.ReactElement
  Object.defineProperty(CanvasBaseGridViewModule, 'CanvasBaseGridView', {
    value: React.forwardRef(
      (props: Record<string, unknown>, ref: React.Ref<unknown>) => mockFn({ ...props, ref })
    ),
    writable: true,
    configurable: true,
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  Object.defineProperty(CanvasBaseGridViewModule, 'CanvasBaseGridView', {
    value: originalCanvasBaseGridView,
    writable: true,
    configurable: true,
  })
})

describe('ResultGridView', () => {
  it('renders column headers and rows from query results', () => {
    render(<ResultGridView {...baseProps} />)
    expect(screen.getByTestId('mock-result-grid')).toHaveAttribute('data-row-count', '2')
    const props = mockCanvasBaseGridView.mock.lastCall?.[0] as {
      columns: Array<{ key: string; displayName: string }>
      rows: Array<Record<string, unknown>>
    }
    expect(props.columns.map((column) => column.displayName)).toEqual(['id', 'name'])
    expect(props.rows[0]).toMatchObject({ col_0: 1, col_1: 'Ada', __rowIdx: 0 })
  })

  it('fires onSortChanged when sort is triggered', () => {
    const onSortChanged = vi.fn()
    render(<ResultGridView {...baseProps} onSortChanged={onSortChanged} />)
    const props = getGridProps()
    props.onSortChange('col_1', 'DESC')
    expect(onSortChanged).toHaveBeenCalledWith('name', 'desc')
  })

  it('clears sort using the previously sorted column name', () => {
    const onSortChanged = vi.fn()
    render(
      <ResultGridView
        {...baseProps}
        sortColumn="name"
        sortDirection="asc"
        onSortChanged={onSortChanged}
      />
    )

    getGridProps().onSortChange(null, null)

    expect(onSortChanged).toHaveBeenCalledWith('name', null)
  })

  it('ignores sort changes for an unknown column key', () => {
    const onSortChanged = vi.fn()
    render(<ResultGridView {...baseProps} onSortChanged={onSortChanged} />)

    getGridProps().onSortChange('col_99', 'ASC')

    expect(onSortChanged).not.toHaveBeenCalled()
  })

  it('shows empty state by passing no rows', () => {
    render(<ResultGridView {...baseProps} rows={[]} />)
    expect(screen.getByTestId('mock-result-grid')).toHaveAttribute('data-row-count', '0')
  })

  it('handles null and undefined cell values gracefully', () => {
    render(<ResultGridView {...baseProps} rows={[[null, undefined]]} />)
    const props = getGridProps()
    expect(props.rows[0]).toMatchObject({ col_0: null, col_1: null })
  })

  it('syncs selection immediately when the selected cell changes', () => {
    const onRowSelected = vi.fn()
    const setSelectedCellSpy = vi.spyOn(useQueryStore.getState(), 'setSelectedCell')

    render(<ResultGridView {...baseProps} onRowSelected={onRowSelected} />)

    act(() => {
      getGridProps().onSelectedCellChange({ rowIdx: 1, idx: 1 })
    })

    expect(onRowSelected).toHaveBeenCalledWith(1)
    expect(setSelectedCellSpy).toHaveBeenCalledWith('tab-1', {
      columnKey: 'name',
      value: 'Bob',
    })
  })

  it('skips duplicate selection syncs for the same cell', () => {
    const onRowSelected = vi.fn()
    const setSelectedCellSpy = vi.spyOn(useQueryStore.getState(), 'setSelectedCell')

    render(<ResultGridView {...baseProps} onRowSelected={onRowSelected} />)

    act(() => {
      getGridProps().onSelectedCellChange({ rowIdx: 1, idx: 1 })
      getGridProps().onSelectedCellChange({ rowIdx: 1, idx: 1 })
    })

    expect(onRowSelected).toHaveBeenCalledTimes(1)
    expect(setSelectedCellSpy).toHaveBeenCalledTimes(1)
  })

  it('ignores invalid selected cell positions', () => {
    const onRowSelected = vi.fn()
    const setSelectedCellSpy = vi.spyOn(useQueryStore.getState(), 'setSelectedCell')

    render(<ResultGridView {...baseProps} onRowSelected={onRowSelected} />)

    act(() => {
      getGridProps().onSelectedCellChange({ rowIdx: 99, idx: 99 })
    })

    expect(onRowSelected).not.toHaveBeenCalled()
    expect(setSelectedCellSpy).not.toHaveBeenCalled()
  })

  it('schedules delayed read-only selection syncs and keeps only the latest one', () => {
    vi.useFakeTimers()

    const onRowSelected = vi.fn()
    const setSelectedCellSpy = vi.spyOn(useQueryStore.getState(), 'setSelectedCell')

    render(<ResultGridView {...baseProps} onRowSelected={onRowSelected} />)

    const props = getGridProps()
    act(() => {
      props.onCellSelectionChange?.({ rowIdx: 0, columnKey: 'col_0', rowData: props.rows[0] })
      props.onCellSelectionChange?.({ rowIdx: 1, columnKey: 'col_1', rowData: props.rows[1] })
    })

    expect(onRowSelected).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(75)
    })

    expect(onRowSelected).toHaveBeenCalledTimes(1)
    expect(onRowSelected).toHaveBeenCalledWith(1)
    expect(setSelectedCellSpy).toHaveBeenCalledWith('tab-1', {
      columnKey: 'name',
      value: 'Bob',
    })
  })

  it('passes row-selection props for read-only mode', () => {
    render(<ResultGridView {...baseProps} selectedRowIndex={1} />)

    const props = getGridProps()

    expect(props.selectedCellPosition).toEqual({ rowIdx: 1, idx: 0 })
    expect(props.selectedRowClassName).toBe('grid-row-precision-selected')
    expect(props.rowKeyGetter(props.rows[1])).toBe('1')
    expect(props.getRowClass(props.rows[1])).toBe('grid-row-precision-selected')
  })
})
