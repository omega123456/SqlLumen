import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataGridView } from '../../../../components/shared/data-view/DataGridView'
import * as CanvasBaseGridViewModule from '../../../../components/shared/glide/CanvasBaseGridView'
import * as blobViewerDialogModule from '../../../../components/dialogs/BlobViewerDialog'
import * as FkLookupDialogModule from '../../../../components/shared/FkLookupDialog'
import type { GridRowSource } from '../../../../components/shared/glide/grid-row-source'
import { useQueryStore } from '../../../../stores/query-store'
import { updateView } from '../../../../stores/data-view/route-registry'
import { useToastStore } from '../../../../stores/toast-store'
import { AUTO_SIZE_SAMPLE_LIMIT, getAutoSizedColumnWidth } from '../../../../lib/grid-column-style'
import type { ColumnMeta, RowEditState, TableDataColumnMeta } from '../../../../types/schema'
import { expectToast, ipc } from '../../../ipc-mock'
import { makeForeignKeyColumn, makeTableColumnMeta } from '../../../helpers/column-meta-fixtures'
import {
  dataViewResult,
  seedDataView,
  type DataViewFixture,
} from '../../../helpers/data-view-test-utils'

type Row = Record<string, unknown>

type ClickGuardResult = {
  proceed: boolean
  targetRowIdx: number
  targetColIdx: number
  enableEditor: boolean
  restoreFocus?: boolean
}

interface CapturedGridProps {
  rows: Row[]
  rowSource: GridRowSource<Row>
  columns: Array<{
    key: string
    displayName: string
    editable: boolean
    isBinary: boolean
    editorType?: string
    tableColumnMeta?: TableDataColumnMeta
  }>
  rowMarkers: string
  isEditMode: boolean
  initialCheckedRanges: Array<readonly [number, number]>
  resetSelectionKey: number
  editState: { currentValues: Row; originalValues: Row; isNewRow?: boolean } | null
  editableColumnKeys: Set<string>
  isModifiedCell: (row: Row, columnKey: string) => boolean
  onSortChange: (column: string | null, direction: 'ASC' | 'DESC' | null) => void
  onRowMarkerRangesChange: (ranges: Array<readonly [number, number]>) => void
  onCellClickGuard: (args: {
    rowIdx: number
    columnKey: string
    rowData: Row
    source?: 'grid-pointer' | 'keyboard'
  }) => Promise<ClickGuardResult>
  onCellClipboardEdit: (args: {
    rowIdx: number
    columnKey: string
    rowData: Row
    action: 'copy' | 'cut' | 'paste'
    text?: string | null
  }) => Promise<void>
  onCellSelectionChange?: (args: { rowIdx: number; columnKey: string; rowData: Row }) => void
  onCellDoubleClick?: (rowData: Row, columnKey: string) => void
  onFkCellAction: (args: {
    rowIdx: number
    columnKey: string
    rowData: Row
    source?: 'grid-pointer' | 'keyboard'
  }) => Promise<void>
  onSelectedCellChange: (position: { rowIdx: number; idx: number }) => void
  onRowsChange?: unknown
  onRowChanging: (from: number, to: number) => Promise<boolean>
  onCellValueChange: (rowIdx: number, columnKey: string, value: unknown) => void
  autoSizeConfig: {
    computeWidth: (column: { key: string; displayName: string }, rows: Row[]) => number
  }
  rowKeyGetter: (row: Row) => string
  getRowClass: (row: Row) => string | undefined
  selectedCellPosition: { rowIdx: number; idx: number } | null
  scrollToRowIndex: number | null
  testId: string
}

const originalCanvasBaseGridView = CanvasBaseGridViewModule.CanvasBaseGridView
let mockCanvasBaseGridView: ReturnType<typeof vi.fn>
let capturedBlobDialogProps: Record<string, unknown> | null = null

function rowsFromSource(source: GridRowSource<Row> | undefined): Row[] {
  if (!source) return []
  return Array.from({ length: source.rowCount }, (_, index) => source.getRow(index)!)
}

function gridProps(): CapturedGridProps {
  const captured = mockCanvasBaseGridView.mock.lastCall?.[0] as Record<string, unknown>
  const rowSource = captured.rowSource as GridRowSource<Row>
  return { ...captured, rows: rowsFromSource(rowSource) } as unknown as CapturedGridProps
}

function lastSetResultViewPayload(): unknown {
  const payloads = ipc.payloads('set_result_view')
  return payloads[payloads.length - 1]
}

function renderGrid(fixture: DataViewFixture) {
  const source = seedDataView(fixture)
  render(<DataGridView source={source} />)
  return source
}

const readOnlyColumns: ColumnMeta[] = [
  { name: 'id', dataType: 'INT' },
  { name: 'name', dataType: 'VARCHAR' },
]

const readOnlyFixture: DataViewFixture = {
  columns: readOnlyColumns,
  rows: [
    [1, 'Ada'],
    [2, 'Bob'],
  ],
}

const nameColumn: TableDataColumnMeta = makeTableColumnMeta({
  name: 'name',
  dataType: 'varchar',
  isPrimaryKey: true,
  isNullable: false,
})

const cleanEditState: RowEditState = {
  rowKey: { name: 'Ada' },
  originalValues: { name: 'Ada' },
  currentValues: { name: 'Ada' },
  modifiedColumns: new Set(),
  isNewRow: false,
}

const dirtyEditState: RowEditState = { ...cleanEditState, modifiedColumns: new Set(['name']) }

const editFixture: DataViewFixture = {
  columns: [{ name: 'name', dataType: 'VARCHAR' }],
  rows: [['Ada'], ['Bob']],
  selectedRowIndex: 0,
  editMode: 'people',
  editableColumnMap: new Map([[0, true]]),
  editState: cleanEditState,
  editingRowIndex: 0,
  editTableColumns: [nameColumn],
  editColumnBindings: new Map([[0, 'name']]),
}

function editableColumnFixture(column: TableDataColumnMeta, value: string): DataViewFixture {
  return {
    ...editFixture,
    columns: [{ name: column.name, dataType: column.dataType.toUpperCase() }],
    rows: [[value]],
    editState: {
      rowKey: { [column.name]: value },
      originalValues: { [column.name]: value },
      currentValues: { [column.name]: value },
      modifiedColumns: new Set(),
      isNewRow: false,
    },
    editTableColumns: [column],
    editColumnBindings: new Map([[0, column.name]]),
  }
}

async function clickCell(rowIdx: number, source?: 'keyboard'): Promise<ClickGuardResult> {
  const props = gridProps()
  let result: ClickGuardResult | undefined
  await act(async () => {
    result = await props.onCellClickGuard({
      rowIdx: rowIdx,
      columnKey: 'col_0',
      rowData: props.rows[rowIdx],
      source: source,
    })
  })
  return result!
}

function failRowSaves() {
  ipc.override('update_table_row', () => {
    throw new Error('save failed')
  })
}

beforeEach(() => {
  useQueryStore.setState({ tabs: {} })
  useToastStore.setState({ toasts: [] })
  mockCanvasBaseGridView = vi.fn(
    (props: Record<string, unknown>) =>
      (
        <div
          data-testid="mock-grid"
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

describe('DataGridView rows', () => {
  it('serves the view rows through a windowed row source backed by the page cache', async () => {
    renderGrid({
      ...readOnlyFixture,
      rows: [
        [1, 'Ada'],
        [2, undefined],
      ],
    })

    expect(screen.getByTestId('mock-grid')).toHaveAttribute('data-row-count', '2')
    const props = gridProps()
    expect(props.testId).toBe('result-grid')
    expect(props.scrollToRowIndex).toBeNull()
    expect(props.columns.map((column) => column.displayName)).toEqual(['id', 'name'])
    expect(props.rows[0]).toMatchObject({ col_0: 1, col_1: 'Ada', __rowIdx: 0, __baseIdx: 0 })
    expect(props.rows[1]).toMatchObject({ col_1: null })
    const source = props.rowSource
    expect(source.kind).toBe('windowed')
    expect(source.isLoaded(5)).toBe(false)
    expect(source.getRow(1)).toBe(source.getRow(1))
    source.onVisibleRangeChange?.([0, 2])
    expect(ipc.payloads('fetch_result_window')).toHaveLength(0)
    await expect(source.readRange?.([0, 2])).resolves.toEqual([
      expect.objectContaining({ __rowIdx: 0, col_1: 'Ada' }),
      expect.objectContaining({ __rowIdx: 1, col_1: null }),
    ])
    source.subscribe?.(vi.fn())?.()
  })

  it('serves the clone draft as a virtual row after the last view row', async () => {
    renderGrid({
      ...readOnlyFixture,
      draftRow: [null, 'Draft'],
      editMode: 'users',
      editState: {
        rowKey: { id: null },
        originalValues: { name: 'Draft' },
        currentValues: { name: 'Edited draft' },
        modifiedColumns: new Set(['name']),
        isNewRow: true,
      },
      editingRowIndex: 2,
      editColumnBindings: new Map([
        [0, 'id'],
        [1, 'name'],
      ]),
    })

    const source = gridProps().rowSource
    expect(source.rowCount).toBe(3)
    expect(source.getRow(2)).toMatchObject({ __rowIdx: 2, __baseIdx: -1, col_1: 'Edited draft' })
    const rows = await source.readRange?.([1, 3])
    expect(rows?.map((row) => row.col_1)).toEqual(['Bob', 'Edited draft'])
    expect(gridProps().editState?.isNewRow).toBe(true)
    expect(gridProps().scrollToRowIndex).toBe(2)
  })

  it('overlays current edit values onto the edited row only and keeps other row objects', () => {
    const source = renderGrid({
      ...editFixture,
      rows: [['Ada'], ['Bob'], ['Cy']],
      editState: null,
      editingRowIndex: null,
    })
    const before = gridProps().rows

    act(() => {
      updateView(source.ref, {
        edit: {
          rowIndex: 1,
          baseIndex: 1,
          state: { ...dirtyEditState, currentValues: { name: 'Bobby' } },
        },
      })
    })
    const editing = gridProps().rows
    expect(editing[0]).toBe(before[0])
    expect(editing[2]).toBe(before[2])
    expect(editing[1]).toEqual({ __rowIdx: 1, __baseIdx: 1, col_0: 'Bobby' })
    expect(gridProps().isModifiedCell(editing[1], 'col_0')).toBe(true)
    expect(gridProps().isModifiedCell(editing[0], 'col_0')).toBe(false)
    expect(gridProps().isModifiedCell(editing[1], 'col_99')).toBe(false)
  })

  it('auto-sizes columns from the sampled rows only', () => {
    const rows = Array.from({ length: 150 }, (_, i) => [i === 120 ? 'x'.repeat(200) : 'ab'])
    renderGrid({ ...editFixture, rows: rows, editState: null, editingRowIndex: null })

    const props = gridProps()
    const width = props.autoSizeConfig.computeWidth(
      { key: 'col_0', displayName: 'name' },
      props.rows
    )

    const sampled = rows.slice(0, AUTO_SIZE_SAMPLE_LIMIT).map((row) => [row[0]])
    expect(width).toBe(
      getAutoSizedColumnWidth({
        column: nameColumn,
        columnIndex: 0,
        rows: sampled,
        displayName: 'name',
        headerIconWidthPx: 0,
      })
    )
  })
})

describe('DataGridView checked rows', () => {
  it('uses checkbox row markers and forwards checked rows as view ranges without the draft row', () => {
    renderGrid(readOnlyFixture)
    expect(gridProps().rowMarkers).toBe('checkbox')

    act(() => {
      gridProps().onRowMarkerRangesChange([
        [0, 1],
        [1, 5],
        [7, 9],
      ])
    })

    expect(dataViewResult().checked.ranges).toEqual([
      [0, 1],
      [1, 2],
    ])
  })

  it('seeds the grid with the stored checked rows and bumps resetSelectionKey when they clear', () => {
    renderGrid({ ...readOnlyFixture, checkedRanges: [[0, 2]] })
    expect(gridProps().initialCheckedRanges).toEqual([[0, 2]])
    const initialKey = gridProps().resetSelectionKey

    seedDataView({ ...readOnlyFixture, checkedRanges: [] })

    expect(gridProps().resetSelectionKey).toBe(initialKey + 1)
  })
})

describe('DataGridView sort', () => {
  it('requests a view sort by column name and clears it with the sorted column', async () => {
    renderGrid(readOnlyFixture)

    await act(async () => gridProps().onSortChange('col_1', 'DESC'))
    expect(lastSetResultViewPayload()).toMatchObject({
      viewSpec: { sort: { column: 'name', direction: 'desc' } },
    })

    seedDataView({ ...readOnlyFixture, sort: { column: 'name', direction: 'asc' } })
    await act(async () => gridProps().onSortChange(null, null))
    expect(lastSetResultViewPayload()).toMatchObject({ viewSpec: { sort: null } })

    await act(async () => gridProps().onSortChange('col_99', 'ASC'))
    expect(ipc.payloads('set_result_view')).toHaveLength(2)
  })
})

describe('DataGridView selection', () => {
  it('syncs selection immediately in edit mode, once per cell, and ignores invalid positions', () => {
    renderGrid({ ...editFixture, editState: null, editingRowIndex: null, selectedRowIndex: null })

    act(() => {
      gridProps().onSelectedCellChange({ rowIdx: 99, idx: 99 })
    })
    expect(dataViewResult().selection).toEqual({ rowIndex: null, cell: null })

    act(() => {
      gridProps().onSelectedCellChange({ rowIdx: 1, idx: 0 })
    })
    expect(dataViewResult().selection).toEqual({
      rowIndex: 1,
      cell: { columnKey: 'name', value: 'Bob' },
    })
  })

  it('defers read-only selection syncs and keeps only the latest one', () => {
    vi.useFakeTimers()
    renderGrid(readOnlyFixture)

    const props = gridProps()
    act(() => {
      props.onCellSelectionChange?.({ rowIdx: 0, columnKey: 'col_0', rowData: props.rows[0] })
      props.onCellSelectionChange?.({ rowIdx: 1, columnKey: 'col_1', rowData: props.rows[1] })
    })
    expect(dataViewResult().selection.rowIndex).toBeNull()

    act(() => {
      vi.advanceTimersByTime(75)
    })

    expect(dataViewResult().selection).toEqual({
      rowIndex: 1,
      cell: { columnKey: 'name', value: 'Bob' },
    })
  })

  it('passes the selected cell position and row classes for read-only and editing rows', () => {
    renderGrid({ ...readOnlyFixture, selectedRowIndex: 1 })
    let props = gridProps()
    expect(props.isEditMode).toBe(false)
    expect(props.selectedCellPosition).toEqual({ rowIdx: 1, idx: 0 })
    expect(props.rowKeyGetter(props.rows[1])).toBe('1')
    expect(props.getRowClass(props.rows[1])).toBe('grid-row-precision-selected')

    seedDataView({ ...editFixture, selectedCell: { columnKey: 'name', value: 'Ada' } })
    props = gridProps()
    expect(props.selectedCellPosition).toEqual({ rowIdx: 0, idx: 0 })
    expect(props.getRowClass(props.rows[0])).toBe('grid-editing-row grid-row-precision-selected')
  })
})

describe('DataGridView editing', () => {
  it('commits per-cell edits through the store and ignores unknown column keys', () => {
    renderGrid(editFixture)
    expect(gridProps().onRowsChange).toBeUndefined()

    act(() => {
      gridProps().onCellValueChange(0, 'info', 'x')
    })
    expect(dataViewResult().edit.state?.currentValues).toEqual({ name: 'Ada' })

    act(() => {
      gridProps().onCellValueChange(0, 'col_0', 'Grace')
    })
    expect(dataViewResult().edit.state?.currentValues).toEqual({ name: 'Grace' })
  })

  it('syncs only the changed cell of a multi-column row', () => {
    renderGrid({
      ...editFixture,
      columns: readOnlyColumns,
      rows: [[1, 'Ada']],
      editState: {
        rowKey: { id: 1 },
        originalValues: { name: 'Ada' },
        currentValues: { name: 'Ada' },
        modifiedColumns: new Set(),
        isNewRow: false,
      },
      editTableColumns: [
        makeTableColumnMeta({ name: 'id', dataType: 'int', isPrimaryKey: true, isNullable: false }),
        makeTableColumnMeta({ name: 'name', dataType: 'varchar' }),
      ],
      editableColumnMap: new Map([
        [0, false],
        [1, true],
      ]),
      editColumnBindings: new Map([
        [0, 'id'],
        [1, 'name'],
      ]),
    })

    act(() => {
      gridProps().onCellValueChange(0, 'col_1', 'Grace')
    })

    expect(dataViewResult().edit.state?.currentValues).toEqual({ name: 'Grace' })
    expect(dataViewResult().edit.state?.modifiedColumns).toEqual(new Set(['name']))
  })

  it('keeps edit mode off and columns read-only without an edit target', () => {
    renderGrid({ ...editFixture, editMode: null })
    expect(gridProps().isEditMode).toBe(false)
    expect(gridProps().columns[0].editable).toBe(false)
  })

  it('passes the edit state and wires editable columns through the Glide editor contract', () => {
    renderGrid(editFixture)
    const props = gridProps()
    expect(props.isEditMode).toBe(true)
    expect(props.editState?.currentValues).toEqual({ col_0: 'Ada' })
    expect(props.editState?.originalValues).toEqual({ col_0: 'Ada' })
    expect(props.editableColumnKeys.has('col_0')).toBe(true)
    const editableColumn = props.columns[0]
    expect(editableColumn.editable).toBe(true)
    expect(editableColumn.editorType).toBe('text')
    expect(editableColumn.tableColumnMeta).toEqual(nameColumn)
    expect(editableColumn).not.toHaveProperty('disablePadding')
    expect(editableColumn).not.toHaveProperty('disableStyling')
  })

  it.each([
    [
      makeTableColumnMeta({ name: 'status', dataType: 'enum', enumValues: ['a', 'b'] }),
      'a',
      'enum',
    ],
    [makeTableColumnMeta({ name: 'payload', dataType: 'JSON' }), '{"name":"Ada"}', 'json'],
    [
      makeTableColumnMeta({ name: 'created_at', dataType: 'datetime' }),
      '2026-01-15 10:30:00',
      'datetime',
    ],
  ])('marks editable %s columns for the matching editor type', (column, value, editorType) => {
    renderGrid(editableColumnFixture(column, value))
    expect(gridProps().columns[0].editorType).toBe(editorType)
  })

  it('starts editing and selects the row when an editable cell is clicked or reached by keyboard', async () => {
    renderGrid({ ...editFixture, editState: null, editingRowIndex: null })

    await expect(clickCell(0)).resolves.toEqual({
      proceed: true,
      targetRowIdx: 0,
      targetColIdx: 0,
      enableEditor: false,
    })
    expect(dataViewResult().edit).toMatchObject({ rowIndex: 0, baseIndex: 0 })
    expect(dataViewResult().selection.rowIndex).toBe(0)

    await expect(clickCell(1, 'keyboard')).resolves.toEqual({
      proceed: true,
      targetRowIdx: 1,
      targetColIdx: 0,
      enableEditor: false,
    })
    expect(dataViewResult().edit).toMatchObject({ rowIndex: 1, baseIndex: 1 })
    expect(dataViewResult().selection.rowIndex).toBe(1)
  })

  it('selects but does not edit non-editable cells', async () => {
    renderGrid({ ...editFixture, editableColumnMap: new Map([[0, false]]) })

    await expect(clickCell(0)).resolves.toEqual({
      proceed: true,
      targetRowIdx: 0,
      targetColIdx: 0,
      enableEditor: false,
    })
  })

  it('keeps focus on the edited row when saving it fails during a pointer or keyboard row switch', async () => {
    failRowSaves()
    renderGrid({ ...editFixture, editState: dirtyEditState })

    await expect(clickCell(1)).resolves.toEqual({
      proceed: false,
      targetRowIdx: 0,
      targetColIdx: 0,
      enableEditor: true,
      restoreFocus: true,
    })
    await expect(clickCell(1, 'keyboard')).resolves.toEqual({
      proceed: false,
      targetRowIdx: 0,
      targetColIdx: 0,
      enableEditor: false,
      restoreFocus: true,
    })
    expect(ipc.calls('update_table_row')).toHaveLength(2)
  })

  it('blocks the row switch with the invalid date toast when an edited date is invalid', async () => {
    const createdAtColumn = makeTableColumnMeta({ name: 'created_at', dataType: 'date' })
    renderGrid({
      ...editableColumnFixture(createdAtColumn, '2025-01-01'),
      rows: [['2025-01-01'], ['2025-01-02']],
      editState: {
        rowKey: { created_at: '2025-01-01' },
        originalValues: { created_at: '2025-01-01' },
        currentValues: { created_at: 'not-a-date' },
        modifiedColumns: new Set(['created_at']),
        isNewRow: false,
      },
    })

    const result = await clickCell(1)

    expect(ipc.calls('update_table_row')).toHaveLength(0)
    expect(result.proceed).toBe(false)
    expect(result.targetRowIdx).toBe(0)
    await expectToast('error', 'Invalid date value')
  })

  it('auto-saves on row change only when there are modified columns', async () => {
    renderGrid({ ...editFixture, editState: dirtyEditState })
    await act(async () => {
      await expect(gridProps().onRowChanging(0, 1)).resolves.toBe(true)
    })
    expect(ipc.calls('update_table_row')).toHaveLength(1)

    seedDataView(editFixture)
    await act(async () => {
      await expect(gridProps().onRowChanging(0, 1)).resolves.toBe(true)
    })
    expect(ipc.calls('update_table_row')).toHaveLength(1)
  })
})

describe('DataGridView clipboard edits', () => {
  async function clipboardEdit(rowIdx: number, action: 'cut' | 'paste', text: string) {
    const props = gridProps()
    await act(async () => {
      await props.onCellClipboardEdit({
        rowIdx: rowIdx,
        columnKey: 'col_0',
        rowData: props.rows[rowIdx],
        action: action,
        text: text,
      })
    })
  }

  it('ignores clipboard edits for non-editable columns', async () => {
    renderGrid({ ...editFixture, editableColumnMap: new Map([[0, false]]) })
    await clipboardEdit(0, 'paste', 'Ignored')
    expect(dataViewResult().edit.state?.currentValues).toEqual({ name: 'Ada' })
  })

  it('cuts editable cells by syncing null', async () => {
    renderGrid(editFixture)
    await clipboardEdit(0, 'cut', 'Ignored')
    expect(dataViewResult().edit.state?.currentValues).toEqual({ name: null })
  })

  it('starts editing the target row and pastes text into it', async () => {
    renderGrid(editFixture)
    await clipboardEdit(1, 'paste', 'Charlie')
    expect(dataViewResult().edit).toMatchObject({ rowIndex: 1, baseIndex: 1 })
    expect(dataViewResult().edit.state?.currentValues).toEqual({ name: 'Charlie' })
  })

  it('blocks clipboard edits when saving the current row fails', async () => {
    failRowSaves()
    renderGrid({ ...editFixture, editState: dirtyEditState })
    await clipboardEdit(1, 'paste', 'Blocked')
    expect(ipc.calls('update_table_row')).toHaveLength(1)
    expect(dataViewResult().edit.rowIndex).toBe(0)
  })
})

describe('DataGridView BLOB cells', () => {
  const blobFixture: DataViewFixture = {
    columns: [
      { name: 'id', dataType: 'INT' },
      { name: 'photo', dataType: 'BLOB' },
    ],
    rows: [
      [1, 'SGVsbG8='],
      [2, null],
    ],
  }

  it('marks binary columns and opens read-only cells in view mode, seeding NULL cells as null', () => {
    renderGrid(blobFixture)
    const props = gridProps()
    expect(props.columns.map((column) => column.isBinary)).toEqual([false, true])

    act(() => {
      props.onCellDoubleClick?.({ col_0: 1, col_1: 'SGVsbG8=', __rowIdx: 0 }, 'col_0')
    })
    expect(screen.queryByTestId('blob-viewer-dialog')).not.toBeInTheDocument()

    act(() => {
      props.onCellDoubleClick?.({ col_0: 1, col_1: 'SGVsbG8=', __rowIdx: 0 }, 'col_1')
    })
    expect(screen.getByTestId('blob-viewer-dialog')).toBeInTheDocument()
    expect(capturedBlobDialogProps).toMatchObject({
      mode: 'view',
      columnLabel: 'photo',
      initialBase64: 'SGVsbG8=',
    })
    expect(capturedBlobDialogProps?.onApply).toBeUndefined()
    expect(capturedBlobDialogProps?.loader).toBeUndefined()

    act(() => {
      props.onCellDoubleClick?.({ col_0: 2, col_1: null, __rowIdx: 1 }, 'col_1')
    })
    expect(capturedBlobDialogProps).toMatchObject({ mode: 'view', initialBase64: null })
  })

  it('opens editable bound BLOB columns in edit mode and stages the applied bytes', () => {
    renderGrid({
      ...blobFixture,
      editMode: 'users',
      editableColumnMap: new Map([
        [0, false],
        [1, false],
      ]),
      editTableColumns: [
        makeTableColumnMeta({ name: 'id', dataType: 'INT', isPrimaryKey: true, isNullable: false }),
        makeTableColumnMeta({ name: 'photo', dataType: 'BLOB', isBinary: true }),
      ],
      editColumnBindings: new Map([
        [0, 'id'],
        [1, 'photo'],
      ]),
    })
    const props = gridProps()
    act(() => {
      props.onCellDoubleClick?.(props.rows[0], 'col_1')
    })
    expect(capturedBlobDialogProps).toMatchObject({
      mode: 'edit',
      columnLabel: 'photo',
      initialBase64: 'SGVsbG8=',
    })

    const applied = { __sqllumen_blob__: true, kind: 'bytes', base64: 'VXBkYXRlZA==' }
    act(() => {
      ;(capturedBlobDialogProps?.onApply as (value: unknown) => void)(applied)
    })

    expect(dataViewResult().edit).toMatchObject({ rowIndex: 0, baseIndex: 0 })
    expect(dataViewResult().edit.state?.currentValues.photo).toEqual(applied)
  })
})

describe('DataGridView foreign-key lookup', () => {
  const roleForeignKey = makeForeignKeyColumn({
    columnName: 'role_id',
    referencedDatabase: 'appdb',
    referencedTable: 'roles',
    referencedColumn: 'id',
    constraintName: 'fk_users_role',
  })

  const lookupFixture: DataViewFixture = {
    columns: [
      { name: 'id', dataType: 'INT' },
      { name: 'role', dataType: 'INT' },
    ],
    rows: [
      [1, 5],
      [2, 6],
    ],
    editMode: 'appdb.users',
    editDatabase: 'appdb',
    editTable: 'users',
    editableColumnMap: new Map([
      [0, false],
      [1, true],
    ]),
    editTableColumns: [
      makeTableColumnMeta({ name: 'id', dataType: 'int', isPrimaryKey: true, isNullable: false }),
      makeTableColumnMeta({ name: 'role_id', dataType: 'int' }),
    ],
    editForeignKeys: [roleForeignKey],
    editColumnBindings: new Map([
      [0, 'id'],
      [1, 'role_id'],
    ]),
  }

  async function openLookup(
    columnKey = 'col_1',
    source: 'grid-pointer' | 'keyboard' = 'grid-pointer'
  ) {
    await act(async () => {
      await gridProps().onFkCellAction({
        rowIdx: 0,
        columnKey: columnKey,
        rowData: { __rowIdx: 0, __baseIdx: 0, col_0: 1, col_1: 5 },
        source: source,
      })
    })
  }

  beforeEach(() => {
    vi.spyOn(FkLookupDialogModule, 'FkLookupDialog').mockImplementation((props) => {
      const dialogProps = props as unknown as Record<string, unknown>
      const apply = dialogProps.onApply as (value: unknown) => void
      return (
        <div data-testid="fk-lookup-dialog-mock">
          <div data-testid="fk-lookup-database">{String(dialogProps.database)}</div>
          <div data-testid="fk-lookup-source-table">{String(dialogProps.sourceTable)}</div>
          <div data-testid="fk-lookup-source-column">{String(dialogProps.sourceColumn)}</div>
          <button
            data-testid="fk-lookup-apply-same"
            onClick={() => apply(dialogProps.currentValue)}
          >
            Apply Same
          </button>
          <button data-testid="fk-lookup-apply-new" onClick={() => apply(9)}>
            Apply New
          </button>
        </div>
      ) as unknown as React.ReactElement
    })
  })

  it('opens the lookup from the in-cell action and applies a new value', async () => {
    const user = userEvent.setup()
    renderGrid(lookupFixture)

    await openLookup()

    expect(screen.getByTestId('fk-lookup-database')).toHaveTextContent('appdb')
    expect(screen.getByTestId('fk-lookup-source-table')).toHaveTextContent('users')
    expect(screen.getByTestId('fk-lookup-source-column')).toHaveTextContent('role_id')
    expect(dataViewResult().selection.rowIndex).toBe(0)

    await user.click(screen.getByTestId('fk-lookup-apply-new'))

    expect(dataViewResult().edit).toMatchObject({ rowIndex: 0, baseIndex: 0 })
    expect(dataViewResult().edit.state?.currentValues.role_id).toBe(9)
    await waitFor(() => {
      expect(screen.queryByTestId('fk-lookup-dialog-mock')).not.toBeInTheDocument()
    })
  })

  it('opens from the keyboard shortcut path and ignores columns without a foreign key', async () => {
    renderGrid(lookupFixture)

    await openLookup('col_0')
    expect(screen.queryByTestId('fk-lookup-dialog-mock')).not.toBeInTheDocument()

    await openLookup('col_1', 'keyboard')
    expect(screen.getByTestId('fk-lookup-dialog-mock')).toBeInTheDocument()
  })

  it('keeps the dirty row and skips the lookup when saving it fails', async () => {
    failRowSaves()
    renderGrid({
      ...lookupFixture,
      editingRowIndex: 1,
      editState: {
        rowKey: { id: 2 },
        originalValues: { id: 2, role_id: 6 },
        currentValues: { id: 2, role_id: 8 },
        modifiedColumns: new Set(['role_id']),
        isNewRow: false,
      },
    })

    await openLookup()

    expect(ipc.calls('update_table_row')).toHaveLength(1)
    expect(dataViewResult().edit.rowIndex).toBe(1)
    expect(screen.queryByTestId('fk-lookup-dialog-mock')).not.toBeInTheDocument()
  })

  it('reselects the row and writes nothing when the same value is applied', async () => {
    const user = userEvent.setup()
    renderGrid(lookupFixture)

    await openLookup()
    await user.click(screen.getByTestId('fk-lookup-apply-same'))

    expect(dataViewResult().edit.state).toBeNull()
    await waitFor(() => {
      expect(screen.queryByTestId('fk-lookup-dialog-mock')).not.toBeInTheDocument()
    })
  })
})
