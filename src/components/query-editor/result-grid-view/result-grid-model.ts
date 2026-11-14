import { isBinaryDataType } from '../../../lib/blob-utils'
import { columnKey, columnIndexFromKey } from '../../../lib/col-key-utils'
import {
  AUTO_SIZE_SAMPLE_LIMIT,
  getAutoSizedColumnWidth,
  DEFAULT_COLUMN_WIDTH_PX,
  HEADER_ICON_WIDTH_PX,
  isJsonSqlType,
} from '../../../lib/grid-column-style'
import type { resolveQueryResultColumns } from '../../../lib/query-result-column-utils'
import type { CachedRow } from '../../../lib/result-window-cache'
import type {
  ColumnMeta,
  ForeignKeyColumnInfo,
  RowEditState,
  TableDataColumnMeta,
} from '../../../types/schema'
import type {
  GridColumnDescriptor,
  RowEditState as SharedRowEditState,
} from '../../../types/shared-data-view'
import type { GridRowActions } from '../../shared/glide/CanvasBaseGridView'
import type { GridCellPosition } from '../../shared/glide/glide-grid-types'
import type { QueryResultBlobContext } from '../QueryResultBlobDialog'

export interface ResultGridViewProps {
  columns: ColumnMeta[]
  resultIndex: number
  queryId: string | null
  viewRowCount: number
  viewVersion: number
  draftRow: unknown[] | null
  sortColumn: string | null
  sortDirection: 'asc' | 'desc' | null
  onSortChanged: (column: string, direction: 'asc' | 'desc' | null) => void
  onRowSelected: (rowIndex: number) => void
  selectedRowIndex: number | null
  tabId: string
  editMode: string | null
  editableColumnMap: Map<number, boolean>
  editState: RowEditState | null
  editingRowIndex: number | null
  editingBaseIndex: number | null
  editTableColumns: TableDataColumnMeta[]
  editForeignKeys?: ForeignKeyColumnInfo[]
  editColumnBindings: Map<number, string>
  onStartEditing: (rowIndex: number, row?: CachedRow) => void
  onUpdateCellValue: (columnIndex: number, value: unknown) => void
  onSyncCellValue: (columnIndex: number, value: unknown) => void
  onAutoSave: () => Promise<boolean>
  rowActions?: GridRowActions
  isActive?: boolean
}

export type ResolvedResultColumn = ReturnType<typeof resolveQueryResultColumns>[number]

export interface GridBlobContext extends QueryResultBlobContext {
  rowIndex: number
  row: CachedRow
  columnIndex: number
}

export const READ_ONLY_SELECTED_ROW_CLASS = 'grid-row-precision-selected'
const EDITING_ROW_CLASS = 'grid-editing-row'
const MISSING_INDEX = -1

export function rowPositionOf(row: Record<string, unknown>): number {
  return typeof row.__rowIdx === 'number' ? row.__rowIdx : MISSING_INDEX
}

export function isEditingRowData(
  row: Record<string, unknown>,
  editingRowIndex: number | null,
  editingBaseIndex: number | null
): boolean {
  if (editingRowIndex === null) return false
  const baseIndex = typeof row.__baseIdx === 'number' ? row.__baseIdx : MISSING_INDEX
  if (baseIndex >= 0) return editingBaseIndex !== null && baseIndex === editingBaseIndex
  return row.__rowIdx === editingRowIndex
}

function resolveEditorType(
  meta: TableDataColumnMeta | undefined
): GridColumnDescriptor['editorType'] {
  if (!meta) return 'none'
  if (meta.enumValues?.length) return 'enum'
  if (isJsonSqlType(meta.dataType)) return 'json'
  if (meta.setValues?.length) return 'set'
  return 'text'
}

function resultColumnKeyFlags(meta: TableDataColumnMeta | undefined) {
  return {
    isNullable: meta?.isNullable ?? true,
    isPrimaryKey: meta?.isPrimaryKey ?? false,
    isUniqueKey: meta?.isUniqueKey ?? false,
  }
}

export interface ResultColumnContext {
  isEditing: boolean
  editColumnBindings: Map<number, string>
}

export function toResultGridColumn(
  column: ResolvedResultColumn,
  columnIndex: number,
  context: ResultColumnContext
): GridColumnDescriptor {
  const meta = column.tableColumnMeta
  const isBlob = column.effectiveTableMeta.isBinary
  const isBoundForEdit = context.isEditing && context.editColumnBindings.has(columnIndex)
  return {
    key: column.key,
    displayName: column.displayName,
    dataType: column.dataType,
    editable: column.editable,
    isBinary: isBinaryDataType(column.dataType),
    blobViewer: isBlob,
    blobViewerEditable: isBlob && isBoundForEdit,
    ...resultColumnKeyFlags(meta),
    enumValues: meta?.enumValues,
    setValues: meta?.setValues,
    tableColumnMeta: column.editable ? meta : undefined,
    foreignKey: column.foreignKey,
    editorType: resolveEditorType(meta),
  }
}

export function invertColumnBindings(editColumnBindings: Map<number, string>): Map<string, number> {
  const lookup = new Map<string, number>()
  for (const [index, columnName] of editColumnBindings) {
    lookup.set(columnName, index)
  }
  return lookup
}

export function rekeyByBoundColumn(
  valuesByColumnName: Record<string, unknown>,
  boundColumnIndexLookup: Map<string, number>
): Record<string, unknown> {
  const valuesByColumnKey: Record<string, unknown> = {}
  for (const [columnName, value] of Object.entries(valuesByColumnName)) {
    const columnIndex = boundColumnIndexLookup.get(columnName) ?? MISSING_INDEX
    if (columnIndex !== MISSING_INDEX) {
      valuesByColumnKey[columnKey(columnIndex)] = value
    }
  }
  return valuesByColumnKey
}

export function toSharedEditState(
  editState: RowEditState | null,
  boundColumnIndexLookup: Map<string, number>
): SharedRowEditState | null {
  if (!editState) return null
  const rowKey =
    typeof editState.rowKey === 'object'
      ? JSON.stringify(editState.rowKey)
      : String(editState.rowKey)
  return {
    rowKey: rowKey,
    currentValues: rekeyByBoundColumn(editState.currentValues, boundColumnIndexLookup),
    originalValues: rekeyByBoundColumn(editState.originalValues, boundColumnIndexLookup),
  }
}

export function editableColumnKeysOf(editableColumnMap: Map<number, boolean>): Set<string> {
  const keys = new Set<string>()
  for (const [index, editable] of editableColumnMap) {
    if (editable) keys.add(columnKey(index))
  }
  return keys
}

interface SelectedCellInputs {
  columns: ColumnMeta[]
  selectedCell: { columnKey: string } | null
  selectedRowIndex: number | null
}

export function selectedCellPositionOf({
  columns,
  selectedCell,
  selectedRowIndex,
}: SelectedCellInputs): GridCellPosition | null {
  if (selectedRowIndex == null) return null
  if (!selectedCell) return { rowIdx: selectedRowIndex, idx: 0 }
  const index = columns.findIndex((column) => column.name === selectedCell.columnKey)
  return { rowIdx: selectedRowIndex, idx: index >= 0 ? index : 0 }
}

interface RowClassInputs {
  selectedRowIndex: number | null
  editingRowIndex: number | null
  editingBaseIndex: number | null
}

export function resultRowClass(
  row: Record<string, unknown>,
  { selectedRowIndex, editingRowIndex, editingBaseIndex }: RowClassInputs
): string | undefined {
  const classes: string[] = []
  if (isEditingRowData(row, editingRowIndex, editingBaseIndex)) {
    classes.push(EDITING_ROW_CLASS)
  }
  const isSelectedRow = selectedRowIndex != null && row.__rowIdx === selectedRowIndex
  if (isSelectedRow) {
    classes.push(READ_ONLY_SELECTED_ROW_CLASS)
  }
  return classes.length > 0 ? classes.join(' ') : undefined
}

export interface AutoSizeInputs {
  resolvedColumns: ResolvedResultColumn[]
  editableColumnMap: Map<number, boolean>
  editMode: string | null
  editColumnBindings: Map<number, string>
}

function sampleColumnRows(
  gridRows: readonly Record<string, unknown>[],
  index: number
): unknown[][] {
  const sampleCount = Math.min(gridRows.length, AUTO_SIZE_SAMPLE_LIMIT)
  const columnRows: unknown[][] = new Array(sampleCount)
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    columnRows[sampleIndex] = [gridRows[sampleIndex][columnKey(index)]]
  }
  return columnRows
}

function showsLockIcon(inputs: AutoSizeInputs, index: number): boolean {
  const isEditable = inputs.editableColumnMap.get(index) ?? false
  const blobViewerEditable =
    inputs.resolvedColumns[index]?.effectiveTableMeta.isBinary === true &&
    inputs.editMode !== null &&
    inputs.editColumnBindings.has(index)
  return !isEditable && !blobViewerEditable
}

export function computeResultColumnWidth(
  inputs: AutoSizeInputs,
  column: GridColumnDescriptor,
  gridRows: readonly Record<string, unknown>[]
): number {
  const index = columnIndexFromKey(column.key)
  const tableMeta = inputs.resolvedColumns[index]?.effectiveTableMeta
  if (!tableMeta) return DEFAULT_COLUMN_WIDTH_PX
  return getAutoSizedColumnWidth({
    column: tableMeta,
    columnIndex: 0,
    rows: sampleColumnRows(gridRows, index),
    displayName: column.displayName,
    headerIconWidthPx: showsLockIcon(inputs, index) ? HEADER_ICON_WIDTH_PX : 0,
  })
}
