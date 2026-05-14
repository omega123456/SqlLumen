import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ResultGridView } from '../../../components/query-editor/ResultGridView'
import type { ColumnMeta, RowEditState, TableDataColumnMeta } from '../../../types/schema'
import { useQueryStore } from '../../../stores/query-store'

const mockCanvasBaseGridView = vi.hoisted(() =>
  vi.fn((props: Record<string, unknown>) => (
    <div data-testid="mock-result-grid" data-row-count={(props.rows as unknown[])?.length ?? 0} />
  ))
)

vi.mock('../../../components/shared/glide/CanvasBaseGridView', () => ({
  CanvasBaseGridView: mockCanvasBaseGridView,
}))

const columns: ColumnMeta[] = [{ name: 'name', dataType: 'VARCHAR' }]
const tableColumns: TableDataColumnMeta[] = [
  {
    name: 'name',
    dataType: 'varchar',
    isBooleanAlias: false,
    isNullable: false,
    isPrimaryKey: true,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isAutoIncrement: false,
  },
]
const editState: RowEditState = {
  rowKey: { name: 'Ada' },
  originalValues: { name: 'Ada' },
  currentValues: { name: 'Ada' },
  modifiedColumns: new Set(),
  isNewRow: false,
}

const props = {
  columns,
  rows: [['Ada']],
  sortColumn: null,
  sortDirection: null,
  onSortChanged: vi.fn(),
  onRowSelected: vi.fn(),
  selectedRowIndex: 0,
  tabId: 'tab-1',
  editMode: 'people',
  editableColumnMap: new Map([[0, true]]),
  editState,
  editingRowIndex: 0,
  editTableColumns: tableColumns,
  editColumnBindings: new Map([[0, 'name']]),
  onStartEditing: vi.fn(),
  onUpdateCellValue: vi.fn(),
  onSyncCellValue: vi.fn(),
  onAutoSave: vi.fn(async () => true),
}

function getGridProps() {
  return mockCanvasBaseGridView.mock.calls[mockCanvasBaseGridView.mock.calls.length - 1]?.[0] as {
    rows: Array<Record<string, unknown>>
    columns: Array<{
      editable: boolean
      editorType?: string
      tableColumnMeta?: TableDataColumnMeta
      disablePadding?: unknown
      disableStyling?: unknown
    }>
    editState: {
      currentValues: Record<string, unknown>
      originalValues: Record<string, unknown>
    } | null
    editableColumnKeys: Set<string>
    isModifiedCell: (row: Record<string, unknown>, columnKey: string) => boolean
    onCellClickGuard: (args: {
      rowIdx: number
      columnKey: string
      rowData: Record<string, unknown>
      source?: 'grid-pointer' | 'keyboard'
    }) => Promise<{
      proceed: boolean
      targetRowIdx: number
      targetColIdx: number
      enableEditor: boolean
      restoreFocus?: boolean
    }>
    onCellClipboardEdit: (args: {
      rowIdx: number
      columnKey: string
      rowData: Record<string, unknown>
      action: 'copy' | 'cut' | 'paste'
      text?: string | null
    }) => Promise<void>
    onRowsChange: (rows: Record<string, unknown>[], data: { indexes: number[] }) => void
    onRowChanging: (_from: number, _to: number) => Promise<boolean>
    onCellValueChange: (rowIdx: number, columnKey: string, value: unknown) => void
    getRowClass: (row: Record<string, unknown>) => string | undefined
    selectedRowClassName?: string
    showReadOnlyHeaders: boolean
  }
}

describe('ResultGridView editing', () => {
  it('cell editing triggers onSyncCellValue', () => {
    const onSyncCellValue = vi.fn()
    render(<ResultGridView {...props} onSyncCellValue={onSyncCellValue} />)
    const gridProps = getGridProps()
    gridProps.onCellValueChange(0, 'col_0', 'Grace')
    gridProps.onRowsChange([{ col_0: 'Grace', __rowIdx: 0 }], { indexes: [0] })
    expect(onSyncCellValue).toHaveBeenCalledWith(0, 'Grace')
  })

  it('cleanup-only no-op row changes do not reach the query sync path', () => {
    const onSyncCellValue = vi.fn()
    render(<ResultGridView {...props} onSyncCellValue={onSyncCellValue} />)
    const gridProps = getGridProps()

    gridProps.onRowsChange([{ col_0: 'Ada', __rowIdx: 0 }], { indexes: [0] })

    expect(onSyncCellValue).not.toHaveBeenCalled()
  })

  it('genuine row changes still reach the query sync path', () => {
    const onSyncCellValue = vi.fn()
    render(<ResultGridView {...props} onSyncCellValue={onSyncCellValue} />)
    const gridProps = getGridProps()

    gridProps.onRowsChange([{ col_0: 'Grace', __rowIdx: 0 }], { indexes: [0] })

    expect(onSyncCellValue).toHaveBeenCalledWith(0, 'Grace')
  })

  it('read-only mode prevents edit mode', () => {
    render(<ResultGridView {...props} editMode={null} />)
    const gridProps = getGridProps() as unknown as {
      isEditMode: boolean
      columns: Array<{ editable: boolean }>
    }
    expect(gridProps.isEditMode).toBe(false)
    expect(gridProps.columns[0].editable).toBe(false)
  })

  it('passes the current edit value to the grid edit state', () => {
    render(<ResultGridView {...props} />)
    const gridProps = getGridProps()
    expect(gridProps.editState.currentValues).toEqual({ col_0: 'Ada' })
    expect(gridProps.editState.originalValues).toEqual({ col_0: 'Ada' })
    expect(gridProps.editableColumnKeys.has('col_0')).toBe(true)
  })

  it('wires editable result columns through the shared Glide editor contract', () => {
    render(<ResultGridView {...props} />)

    const editableColumn = getGridProps().columns[0]
    expect(editableColumn.editable).toBe(true)
    expect(editableColumn.editorType).toBe('text')
    expect(editableColumn.tableColumnMeta).toEqual(tableColumns[0])
    expect(editableColumn).not.toHaveProperty('disablePadding')
    expect(editableColumn).not.toHaveProperty('disableStyling')
  })

  it('overlays current edit values onto the editing row data', () => {
    const editedState: RowEditState = {
      ...editState,
      currentValues: { name: 'Grace' },
      modifiedColumns: new Set(['name']),
    }

    render(<ResultGridView {...props} editState={editedState} />)

    expect(getGridProps().rows[0]).toMatchObject({ col_0: 'Grace', __rowIdx: 0 })
  })

  it('marks modified cells only for the active editing row and bound column', () => {
    const editedState: RowEditState = {
      ...editState,
      currentValues: { name: 'Grace' },
      modifiedColumns: new Set(['name']),
    }

    render(<ResultGridView {...props} editState={editedState} />)

    const gridProps = getGridProps()
    expect(gridProps.isModifiedCell(gridProps.rows[0], 'col_0')).toBe(true)
    expect(gridProps.isModifiedCell({ __rowIdx: 1, col_0: 'Other' }, 'col_0')).toBe(false)
    expect(gridProps.isModifiedCell(gridProps.rows[0], 'col_99')).toBe(false)
  })

  it('starts editing when an editable cell is clicked', async () => {
    const onStartEditing = vi.fn()
    const onRowSelected = vi.fn()

    render(
      <ResultGridView
        {...props}
        editingRowIndex={null}
        editState={null}
        onStartEditing={onStartEditing}
        onRowSelected={onRowSelected}
      />
    )

    const gridProps = getGridProps()
    const result = await gridProps.onCellClickGuard({
      rowIdx: 0,
      columnKey: 'col_0',
      rowData: gridProps.rows[0],
    })

    expect(result).toEqual({
      proceed: true,
      targetRowIdx: 0,
      targetColIdx: 0,
      enableEditor: false,
    })
    expect(onStartEditing).toHaveBeenCalledWith(0)
    expect(onRowSelected).toHaveBeenCalledWith(0)
  })

  it('keyboard navigation over editable cells selects without opening an editor or starting destination editing', async () => {
    const onStartEditing = vi.fn()
    const onRowSelected = vi.fn()

    render(
      <ResultGridView
        {...props}
        rows={[['Ada'], ['Bob']]}
        editingRowIndex={0}
        editState={editState}
        onStartEditing={onStartEditing}
        onRowSelected={onRowSelected}
      />
    )

    const gridProps = getGridProps()
    const result = await gridProps.onCellClickGuard({
      rowIdx: 1,
      columnKey: 'col_0',
      rowData: gridProps.rows[1],
      source: 'keyboard',
    })

    expect(result).toEqual({
      proceed: true,
      targetRowIdx: 1,
      targetColIdx: 0,
      enableEditor: false,
    })
    expect(onStartEditing).toHaveBeenCalledWith(1)
    expect(onRowSelected).toHaveBeenCalledWith(1)
  })

  it('tracks the actual selected column for keyboard typing activation', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          content: '',
          selectedText: '',
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: 'c1',
          results: [],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
          selectedCell: { columnKey: 'name', value: 'Ada' },
        },
      },
    })

    render(<ResultGridView {...props} selectedRowIndex={0} />)

    const gridProps = getGridProps() as unknown as {
      selectedCellPosition: { rowIdx: number; idx: number } | null
    }
    expect(gridProps.selectedCellPosition).toEqual({ rowIdx: 0, idx: 0 })
  })

  it('selects but does not edit non-editable cells', async () => {
    render(<ResultGridView {...props} editableColumnMap={new Map([[0, false]])} />)

    const gridProps = getGridProps()
    const result = await gridProps.onCellClickGuard({
      rowIdx: 0,
      columnKey: 'col_0',
      rowData: gridProps.rows[0],
    })

    expect(result).toEqual({
      proceed: true,
      targetRowIdx: 0,
      targetColIdx: 0,
      enableEditor: false,
    })
  })

  it('keeps focus on the current row when auto-save fails during row switch', async () => {
    const onAutoSave = vi.fn(async () => false)

    render(
      <ResultGridView
        {...props}
        rows={[['Ada'], ['Bob']]}
        editState={{ ...editState, modifiedColumns: new Set(['name']) }}
        onAutoSave={onAutoSave}
      />
    )

    const gridProps = getGridProps()
    const result = await gridProps.onCellClickGuard({
      rowIdx: 1,
      columnKey: 'col_0',
      rowData: gridProps.rows[1],
    })

    expect(onAutoSave).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      proceed: false,
      targetRowIdx: 0,
      targetColIdx: 0,
      enableEditor: true,
      restoreFocus: true,
    })
  })

  it('restores focus without opening an editor when keyboard navigation auto-save fails', async () => {
    const onAutoSave = vi.fn(async () => false)

    render(
      <ResultGridView
        {...props}
        rows={[['Ada'], ['Bob']]}
        editState={{ ...editState, modifiedColumns: new Set(['name']) }}
        onAutoSave={onAutoSave}
      />
    )

    const gridProps = getGridProps()
    const result = await gridProps.onCellClickGuard({
      rowIdx: 1,
      columnKey: 'col_0',
      rowData: gridProps.rows[1],
      source: 'keyboard',
    })

    expect(onAutoSave).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      proceed: false,
      targetRowIdx: 0,
      targetColIdx: 0,
      enableEditor: false,
      restoreFocus: true,
    })
  })

  it('scans changed rows and only syncs modified cells', () => {
    const onSyncCellValue = vi.fn()

    render(
      <ResultGridView
        {...props}
        columns={[
          { name: 'id', dataType: 'INT' },
          { name: 'name', dataType: 'VARCHAR' },
        ]}
        rows={[[1, 'Ada']]}
        editTableColumns={[
          {
            name: 'id',
            dataType: 'int',
            isBooleanAlias: false,
            isNullable: false,
            isPrimaryKey: true,
            isUniqueKey: false,
            hasDefault: false,
            columnDefault: null,
            isBinary: false,
            isAutoIncrement: false,
          },
          {
            name: 'name',
            dataType: 'varchar',
            isBooleanAlias: false,
            isNullable: true,
            isPrimaryKey: false,
            isUniqueKey: false,
            hasDefault: false,
            columnDefault: null,
            isBinary: false,
            isAutoIncrement: false,
          },
        ]}
        editableColumnMap={
          new Map([
            [0, false],
            [1, true],
          ])
        }
        editColumnBindings={
          new Map([
            [0, 'id'],
            [1, 'name'],
          ])
        }
        onSyncCellValue={onSyncCellValue}
      />
    )

    const gridProps = getGridProps()
    gridProps.onRowsChange([{ col_0: 1, col_1: 'Grace', __rowIdx: 0 }], { indexes: [0] })

    expect(onSyncCellValue).toHaveBeenCalledTimes(1)
    expect(onSyncCellValue).toHaveBeenCalledWith(1, 'Grace')
  })

  it('ignores clipboard edits for non-editable columns', async () => {
    const onSyncCellValue = vi.fn()

    render(
      <ResultGridView
        {...props}
        editableColumnMap={new Map([[0, false]])}
        onSyncCellValue={onSyncCellValue}
      />
    )

    const gridProps = getGridProps()
    await gridProps.onCellClipboardEdit({
      rowIdx: 0,
      columnKey: 'col_0',
      rowData: gridProps.rows[0],
      action: 'paste',
      text: 'Ignored',
    })

    expect(onSyncCellValue).not.toHaveBeenCalled()
  })

  it('cuts editable cells by syncing null', async () => {
    const onSyncCellValue = vi.fn()

    render(<ResultGridView {...props} onSyncCellValue={onSyncCellValue} />)

    const gridProps = getGridProps()
    await gridProps.onCellClipboardEdit({
      rowIdx: 0,
      columnKey: 'col_0',
      rowData: gridProps.rows[0],
      action: 'cut',
      text: 'Ignored',
    })

    expect(onSyncCellValue).toHaveBeenCalledWith(0, null)
  })

  it('starts editing and pastes text into editable cells on another row', async () => {
    const onStartEditing = vi.fn()
    const onSyncCellValue = vi.fn()

    render(
      <ResultGridView
        {...props}
        rows={[['Ada'], ['Bob']]}
        editingRowIndex={0}
        editState={editState}
        onStartEditing={onStartEditing}
        onSyncCellValue={onSyncCellValue}
      />
    )

    const gridProps = getGridProps()
    await gridProps.onCellClipboardEdit({
      rowIdx: 1,
      columnKey: 'col_0',
      rowData: gridProps.rows[1],
      action: 'paste',
      text: 'Charlie',
    })

    expect(onStartEditing).toHaveBeenCalledWith(1)
    expect(onSyncCellValue).toHaveBeenCalledWith(0, 'Charlie')
  })

  it('blocks clipboard edits when saving the current row fails', async () => {
    const onAutoSave = vi.fn(async () => false)
    const onSyncCellValue = vi.fn()

    render(
      <ResultGridView
        {...props}
        rows={[['Ada'], ['Bob']]}
        editingRowIndex={0}
        editState={{ ...editState, modifiedColumns: new Set(['name']) }}
        onAutoSave={onAutoSave}
        onSyncCellValue={onSyncCellValue}
      />
    )

    const gridProps = getGridProps()
    await gridProps.onCellClipboardEdit({
      rowIdx: 1,
      columnKey: 'col_0',
      rowData: gridProps.rows[1],
      action: 'paste',
      text: 'Blocked',
    })

    expect(onAutoSave).toHaveBeenCalledTimes(1)
    expect(onSyncCellValue).not.toHaveBeenCalled()
  })

  it('auto-saves on row change only when there are modified columns', async () => {
    const dirtySave = vi.fn(async () => true)
    const cleanSave = vi.fn(async () => true)

    render(
      <ResultGridView
        {...props}
        editState={{ ...editState, modifiedColumns: new Set(['name']) }}
        onAutoSave={dirtySave}
      />
    )

    await expect(getGridProps().onRowChanging(0, 1)).resolves.toBe(true)
    expect(dirtySave).toHaveBeenCalledTimes(1)

    render(<ResultGridView {...props} onAutoSave={cleanSave} />)

    await expect(getGridProps().onRowChanging(0, 1)).resolves.toBe(true)
    expect(cleanSave).not.toHaveBeenCalled()
  })

  it('applies editing and selected row classes together', () => {
    render(<ResultGridView {...props} />)

    const gridProps = getGridProps()
    expect(gridProps.getRowClass(gridProps.rows[0])).toBe(
      'grid-editing-row grid-row-precision-selected'
    )
    expect(gridProps.showReadOnlyHeaders).toBe(true)
    expect(gridProps.selectedRowClassName).toBeUndefined()
  })
})
