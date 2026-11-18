import { columnKey } from '../../../lib/col-key-utils'
import type { CachedRow } from '../../../lib/result-window-cache'
import type {
  DataViewLocation,
  RowEditState as SharedRowEditState,
} from '../../../types/shared-data-view'
import type {
  ColumnMeta,
  ForeignKeyColumnInfo,
  TableDataColumnMeta,
  RowEditState,
} from '../../../types/schema'

export interface ResultFormViewProps {
  columns: ColumnMeta[]
  resultIndex: number
  queryId: string | null
  viewVersion: number
  viewRowCount: number
  draftRow?: unknown[] | null
  selectedRowIndex: number | null
  onNavigate: (direction: 'prev' | 'next') => void
  tabId: string
  editMode?: string | null
  editableColumnMap?: Map<number, boolean>
  editState?: RowEditState | null
  editingRowIndex?: number | null
  editingBaseIndex?: number | null
  editTableColumns?: TableDataColumnMeta[]
  editForeignKeys?: ForeignKeyColumnInfo[]
  editColumnBindings?: Map<number, string>
  onStartEdit?: (rowIndex: number, row?: CachedRow) => void
  onUpdateCell?: (columnIndex: number, value: unknown) => void
  onSyncCell?: (columnIndex: number, value: unknown) => void
  onSaveRow?: () => Promise<boolean>
  onDiscardRow?: () => void
  onRowSelected?: (rowIndex: number) => void
  editLocation?: DataViewLocation | null
  isActive?: boolean
}

const EMPTY_EDITABLE_MAP = new Map<number, boolean>()
const EMPTY_TABLE_COLUMNS: TableDataColumnMeta[] = []
const EMPTY_FOREIGN_KEYS: ForeignKeyColumnInfo[] = []
const EMPTY_BINDINGS = new Map<number, string>()

export interface FormEditProps {
  editMode: string | null
  editableColumnMap: Map<number, boolean>
  editState: RowEditState | null
  editingRowIndex: number | null
  editTableColumns: TableDataColumnMeta[]
  editForeignKeys: ForeignKeyColumnInfo[]
  editColumnBindings: Map<number, string>
}

export function resolveFormEditProps(props: ResultFormViewProps): FormEditProps {
  return {
    editMode: props.editMode ?? null,
    editableColumnMap: props.editableColumnMap ?? EMPTY_EDITABLE_MAP,
    editState: props.editState ?? null,
    editingRowIndex: props.editingRowIndex ?? null,
    editTableColumns: props.editTableColumns ?? EMPTY_TABLE_COLUMNS,
    editForeignKeys: props.editForeignKeys ?? EMPTY_FOREIGN_KEYS,
    editColumnBindings: props.editColumnBindings ?? EMPTY_BINDINGS,
  }
}

export interface FormRowPosition {
  totalRows: number
  currentIndex: number
  clampedIndex: number
  isDraftPosition: boolean
}

export function resolveFormRowPosition(props: ResultFormViewProps): FormRowPosition {
  const hasDraftRow = props.draftRow != null
  const totalRows = props.viewRowCount + (hasDraftRow ? 1 : 0)
  const currentIndex = props.selectedRowIndex ?? 0
  const clampedIndex = Math.max(0, Math.min(currentIndex, totalRows - 1))
  return {
    totalRows: totalRows,
    currentIndex: currentIndex,
    clampedIndex: clampedIndex,
    isDraftPosition: hasDraftRow && clampedIndex === props.viewRowCount,
  }
}

export interface FetchedRow {
  key: string
  row: CachedRow
}

export function fetchedRowFor(fetched: FetchedRow | null, fetchKey: string): CachedRow | null {
  if (fetched?.key !== fetchKey) return null
  return fetched.row
}

export function patchFetchedRow(
  current: FetchedRow | null,
  baseIndex: number,
  apply: (row: unknown[]) => unknown[]
): FetchedRow | null {
  if (!isFetchedRowAt(current, baseIndex)) return current
  return { ...current, row: { baseIndex: baseIndex, row: apply(current.row.row) } }
}

function isFetchedRowAt(current: FetchedRow | null, baseIndex: number): current is FetchedRow {
  if (!current) return false
  return current.row.baseIndex === baseIndex
}

interface RowEditOverlay {
  editState: RowEditState | null
  editingRowIndex: number | null
  editColumnBindings: Map<number, string>
}

interface FormRowDataInputs {
  currentCached: CachedRow | null
  columnCount: number
  clampedIndex: number
  rowEdit: RowEditOverlay
}

function applyEditedValues(rowData: Record<string, unknown>, inputs: FormRowDataInputs): void {
  const edit = inputs.rowEdit
  if (edit.editingRowIndex !== inputs.clampedIndex) return
  if (!edit.editState) return
  const currentValues = edit.editState.currentValues
  for (let columnIndex = 0; columnIndex < inputs.columnCount; columnIndex++) {
    const boundName = edit.editColumnBindings.get(columnIndex)
    const hasEditedValue = boundName !== undefined && boundName in currentValues
    if (hasEditedValue) {
      rowData[columnKey(columnIndex)] = currentValues[boundName]
    }
  }
}

export function buildFormRowData(inputs: FormRowDataInputs): Record<string, unknown> | null {
  const currentRow = inputs.currentCached?.row ?? null
  if (currentRow === null) return null

  const rowData: Record<string, unknown> = {
    __rowIdx: inputs.clampedIndex,
    __baseIdx: inputs.currentCached?.baseIndex ?? -1,
  }
  for (let columnIndex = 0; columnIndex < inputs.columnCount; columnIndex++) {
    rowData[columnKey(columnIndex)] = currentRow[columnIndex] ?? null
  }
  applyEditedValues(rowData, inputs)
  return rowData
}

export function toSharedEditState(
  editState: RowEditState,
  columnCount: number,
  editColumnBindings: Map<number, string>
): SharedRowEditState {
  const currentValues: Record<string, unknown> = {}
  const originalValues: Record<string, unknown> = {}

  for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
    const columnName = editColumnBindings.get(columnIndex)
    if (!columnName) continue
    const key = columnKey(columnIndex)
    if (columnName in editState.currentValues) {
      currentValues[key] = editState.currentValues[columnName]
    }
    if (columnName in editState.originalValues) {
      originalValues[key] = editState.originalValues[columnName]
    }
  }

  return {
    rowKey: JSON.stringify(editState.rowKey),
    currentValues: currentValues,
    originalValues: originalValues,
    isNewRow: editState.isNewRow,
  }
}
