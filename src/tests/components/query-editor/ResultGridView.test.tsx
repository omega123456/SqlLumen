import React from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LegacyResultGridView as ResultGridView,
  rowsFromSource,
} from '../../helpers/result-grid-test-utils'
import { useQueryStore, DEFAULT_RESULT_STATE } from '../../../stores/query-store'
import type { ColumnMeta } from '../../../types/schema'
import type { GridRowSource } from '../../../components/shared/glide/grid-row-source'
import { ipc } from '../../ipc-mock'

type Row = Record<string, unknown>
import * as CanvasBaseGridViewModule from '../../../components/shared/glide/CanvasBaseGridView'
import * as blobViewerDialogModule from '../../../components/dialogs/BlobViewerDialog'

let capturedBlobDialogProps: Record<string, unknown> | null = null

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
  const captured = mockCanvasBaseGridView.mock.lastCall?.[0] as Record<string, unknown> | undefined
  return {
    ...captured,
    rows: rowsFromSource(captured?.rowSource as Parameters<typeof rowsFromSource>[0]),
  } as unknown as {
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
    onCellDoubleClick?: (rowData: Record<string, unknown>, columnKey: string) => void
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
        <div
          data-testid="mock-result-grid"
          data-row-count={(props.rowSource as { rowCount?: number })?.rowCount ?? 0}
        />
      ) as unknown as React.ReactElement
  )
  const mockFn = mockCanvasBaseGridView as unknown as (
    props: Record<string, unknown>
  ) => React.ReactElement
  Object.defineProperty(CanvasBaseGridViewModule, 'CanvasBaseGridView', {
    value: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) =>
      mockFn({ ...props, ref })
    ),
    writable: true,
    configurable: true,
  })

  capturedBlobDialogProps = null
  Object.defineProperty(blobViewerDialogModule, 'BlobViewerDialog', {
    value: (props: Record<string, unknown>) => {
      capturedBlobDialogProps = props
      return props.isOpen
        ? ((<div data-testid="blob-viewer-dialog" />) as unknown as React.ReactElement)
        : null
    },
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
    const props = getGridProps()
    expect(props.columns.map((column) => column.displayName)).toEqual(['id', 'name'])
    expect(props.rows[0]).toMatchObject({ col_0: 1, col_1: 'Ada', __rowIdx: 0, __baseIdx: 0 })
  })

  it('serves rows through a windowed row source backed by the page cache', async () => {
    render(<ResultGridView {...baseProps} />)
    const source = (mockCanvasBaseGridView.mock.lastCall?.[0] as { rowSource: GridRowSource<Row> })
      .rowSource
    expect(source.kind).toBe('windowed')
    expect(source.isLoaded(0)).toBe(true)
    expect(source.isLoaded(5)).toBe(false)
    // Objects are reused for unchanged cached rows.
    expect(source.getRow(1)).toBe(source.getRow(1))
    // The visible range drives page loads (all rows are already loaded here).
    source.onVisibleRangeChange?.([0, 2])
    expect(ipc.calls('fetch_result_window')).toHaveLength(0)
    // Off-window reads resolve through the page cache.
    await expect(source.readRange?.([0, 2])).resolves.toEqual([
      expect.objectContaining({ __rowIdx: 0, col_1: 'Ada' }),
      expect.objectContaining({ __rowIdx: 1, col_1: 'Bob' }),
    ])
    const listener = vi.fn()
    const unsubscribe = source.subscribe?.(listener)
    unsubscribe?.()
  })

  it('serves the clone draft as a virtual row after the last view row', async () => {
    render(
      <ResultGridView
        {...baseProps}
        draftRow={[null, 'Draft']}
        editState={{
          rowKey: { id: null },
          originalValues: { name: 'Draft' },
          currentValues: { name: 'Edited draft' },
          modifiedColumns: new Set(['name']),
          isNewRow: true,
        }}
        editingRowIndex={2}
        editColumnBindings={
          new Map([
            [0, 'id'],
            [1, 'name'],
          ])
        }
      />
    )
    const source = (mockCanvasBaseGridView.mock.lastCall?.[0] as { rowSource: GridRowSource<Row> })
      .rowSource
    expect(source.rowCount).toBe(3)
    expect(source.getRow(2)).toMatchObject({ __rowIdx: 2, __baseIdx: -1, col_1: 'Edited draft' })
    const rows = await source.readRange?.([1, 3])
    expect(rows?.map((row) => row.col_1)).toEqual(['Bob', 'Edited draft'])
  })

  it('enables the checkbox row marker in edit mode', () => {
    render(<ResultGridView {...baseProps} editMode="users" />)
    const props = mockCanvasBaseGridView.mock.lastCall?.[0] as { rowMarkers: string }
    expect(props.rowMarkers).toBe('checkbox')
  })

  it('enables the checkbox row marker in read-only mode', () => {
    render(<ResultGridView {...baseProps} editMode={null} />)
    const props = mockCanvasBaseGridView.mock.lastCall?.[0] as { rowMarkers: string }
    expect(props.rowMarkers).toBe('checkbox')
  })

  it('forwards checked rows to the store as view ranges (the draft row excluded)', () => {
    const setCheckedRanges = vi.spyOn(useQueryStore.getState(), 'setCheckedRanges')
    render(<ResultGridView {...baseProps} />)
    const props = mockCanvasBaseGridView.mock.lastCall?.[0] as {
      onRowMarkerRangesChange: (ranges: Array<readonly [number, number]>) => void
    }
    act(() => {
      props.onRowMarkerRangesChange([
        [0, 1],
        [1, 5],
        [7, 9],
      ])
    })
    expect(setCheckedRanges).toHaveBeenCalledWith('tab-1', [
      [0, 1],
      [1, 2],
    ])
  })

  it('clears stale checked rows from the active result on mount', () => {
    act(() => {
      useQueryStore.setState({
        tabs: {
          'tab-1': {
            results: [{ ...DEFAULT_RESULT_STATE, checkedRanges: [[0, 2]] }],
            activeResultIndex: 0,
          },
        },
      } as unknown as Parameters<typeof useQueryStore.setState>[0])
    })
    render(<ResultGridView {...baseProps} />)
    expect(useQueryStore.getState().tabs['tab-1'].results[0].checkedRanges).toEqual([])
  })

  it('bumps resetSelectionKey when the store checked set clears after a delete', () => {
    function seedCheckedIndices(indices: number[]) {
      act(() => {
        useQueryStore.setState({
          tabs: {
            'tab-1': {
              results: [
                {
                  ...DEFAULT_RESULT_STATE,
                  checkedRanges: indices.map((index) => [index, index + 1] as const),
                },
              ],
              activeResultIndex: 0,
            },
          },
        } as unknown as Parameters<typeof useQueryStore.setState>[0])
      })
    }

    const { rerender } = render(<ResultGridView {...baseProps} />)
    seedCheckedIndices([0, 1])
    rerender(<ResultGridView {...baseProps} />)
    const initialKey = (mockCanvasBaseGridView.mock.lastCall?.[0] as { resetSelectionKey: number })
      .resetSelectionKey

    // The toolbar clears checkedRowIndices to [] on delete.
    seedCheckedIndices([])
    rerender(<ResultGridView {...baseProps} />)
    const clearedKey = (mockCanvasBaseGridView.mock.lastCall?.[0] as { resetSelectionKey: number })
      .resetSelectionKey

    expect(clearedKey).toBe(initialKey + 1)
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

  describe('BLOB cells', () => {
    const blobColumns: ColumnMeta[] = [
      { name: 'id', dataType: 'INT' },
      { name: 'photo', dataType: 'BLOB' },
    ]
    // 'SGVsbG8=' decodes to the bytes for "Hello".
    const blobRows = [
      [1, 'SGVsbG8='],
      [2, null],
    ]
    const blobProps = { ...baseProps, columns: blobColumns, rows: blobRows }

    it('marks binary columns as isBinary derived from dataType', () => {
      render(<ResultGridView {...blobProps} />)
      const props = mockCanvasBaseGridView.mock.lastCall?.[0] as {
        columns: Array<{ key: string; isBinary: boolean }>
      }
      expect(props.columns[0].isBinary).toBe(false)
      expect(props.columns[1].isBinary).toBe(true)
    })

    it('opens the dialog in view mode for read-only query results', () => {
      render(<ResultGridView {...blobProps} />)
      const props = getGridProps()
      act(() => {
        props.onCellDoubleClick?.({ col_0: 1, col_1: 'SGVsbG8=', __rowIdx: 0 }, 'col_1')
      })
      expect(screen.getByTestId('blob-viewer-dialog')).toBeInTheDocument()
      expect(capturedBlobDialogProps).toMatchObject({
        mode: 'view',
        columnLabel: 'photo',
        initialBase64: 'SGVsbG8=',
      })
      // View-only: no edit/staging affordances are wired in.
      expect(capturedBlobDialogProps?.onApply).toBeUndefined()
      expect(capturedBlobDialogProps?.loader).toBeUndefined()
    })

    it('opens the dialog in edit mode for editable bound blob columns', () => {
      const onStartEditing = vi.fn()
      const onSyncCellValue = vi.fn()
      render(
        <ResultGridView
          {...blobProps}
          onStartEditing={onStartEditing}
          onSyncCellValue={onSyncCellValue}
          editMode="users"
          editableColumnMap={
            new Map([
              [0, false],
              [1, false],
            ])
          }
          editTableColumns={[
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
              name: 'photo',
              dataType: 'BLOB',
              isBooleanAlias: false,
              isNullable: true,
              isPrimaryKey: false,
              isUniqueKey: false,
              hasDefault: false,
              columnDefault: null,
              isBinary: true,
              isAutoIncrement: false,
            },
          ]}
          editColumnBindings={
            new Map([
              [0, 'id'],
              [1, 'photo'],
            ])
          }
        />
      )
      const props = getGridProps()
      act(() => {
        // The grid hands over the materialized row (with its base index).
        props.onCellDoubleClick?.(props.rows[0], 'col_1')
      })
      expect(capturedBlobDialogProps).toMatchObject({
        mode: 'edit',
        columnLabel: 'photo',
        initialBase64: 'SGVsbG8=',
      })
      expect(typeof capturedBlobDialogProps?.onApply).toBe('function')

      act(() => {
        ;(capturedBlobDialogProps?.onApply as ((value: unknown) => void) | undefined)?.({
          __sqllumen_blob__: true,
          kind: 'bytes',
          base64: 'VXBkYXRlZA==',
        })
      })

      expect(onStartEditing).toHaveBeenCalledWith(0, {
        row: [1, 'SGVsbG8='],
        baseIndex: 0,
      })
      expect(onSyncCellValue).toHaveBeenCalledWith(1, {
        __sqllumen_blob__: true,
        kind: 'bytes',
        base64: 'VXBkYXRlZA==',
      })
    })

    it('seeds a NULL value when the binary cell is null', () => {
      render(<ResultGridView {...blobProps} />)
      const props = getGridProps()
      act(() => {
        props.onCellDoubleClick?.({ col_0: 2, col_1: null, __rowIdx: 1 }, 'col_1')
      })
      expect(capturedBlobDialogProps).toMatchObject({
        mode: 'view',
        initialBase64: null,
      })
    })

    it('does not open the dialog for non-binary columns', () => {
      render(<ResultGridView {...blobProps} />)
      const props = getGridProps()
      act(() => {
        props.onCellDoubleClick?.({ col_0: 1, col_1: 'SGVsbG8=', __rowIdx: 0 }, 'col_0')
      })
      expect(screen.queryByTestId('blob-viewer-dialog')).not.toBeInTheDocument()
      expect(capturedBlobDialogProps).toBeNull()
    })
  })
})
