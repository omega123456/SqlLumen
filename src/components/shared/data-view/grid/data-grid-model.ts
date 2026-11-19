import { columnKey, columnIndexFromKey } from '../../../../lib/col-key-utils'
import {
  AUTO_SIZE_SAMPLE_LIMIT,
  getAutoSizedColumnWidth,
  DEFAULT_COLUMN_WIDTH_PX,
  HEADER_ICON_WIDTH_PX,
} from '../../../../lib/grid-column-style'
import type { ResolvedQueryResultColumn } from '../../../../lib/query-result-column-utils'
import type { ColumnMeta, RowEditState } from '../../../../types/schema'
import type {
  DataViewLocation,
  GridColumnDescriptor,
  RowEditState as SharedRowEditState,
} from '../../../../types/shared-data-view'
import type {
  DataViewEditSession,
  DataViewEditTarget,
} from '../../../../stores/data-view/data-view-types'
import { rowClassNameOf } from '../row-class-names'
import type { GridCellPosition } from '../../glide/glide-grid-types'

const MISSING_INDEX = -1

export interface RowPlacement {
  position: number
  baseIndex: number
}

function indexOrMissing(value: unknown): number {
  return typeof value === 'number' ? value : MISSING_INDEX
}

export function rowPlacementOf(row: Record<string, unknown>): RowPlacement {
  return { position: indexOrMissing(row.__rowIdx), baseIndex: indexOrMissing(row.__baseIdx) }
}

export function isEditedRow({ position, baseIndex }: RowPlacement, edit: DataViewEditSession) {
  if (edit.rowIndex === null) return false
  if (baseIndex >= 0) return baseIndex === edit.baseIndex
  return position === edit.rowIndex
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
    const columnIndex = boundColumnIndexLookup.get(columnName)
    if (columnIndex === undefined) continue
    valuesByColumnKey[columnKey(columnIndex)] = value
  }
  return valuesByColumnKey
}

export function toSharedEditState(
  editState: RowEditState | null,
  boundColumnIndexLookup: Map<string, number>
): SharedRowEditState | null {
  if (!editState) return null
  return {
    rowKey: JSON.stringify(editState.rowKey),
    currentValues: rekeyByBoundColumn(editState.currentValues, boundColumnIndexLookup),
    originalValues: rekeyByBoundColumn(editState.originalValues, boundColumnIndexLookup),
    isNewRow: editState.isNewRow,
  }
}

export function editLocationOf(
  connectionId: string,
  editTarget: DataViewEditTarget
): DataViewLocation | null {
  const tableName = editTarget.tableName
  if (!tableName) return null
  const editTable = editTarget.tables[tableName]
  return {
    connectionId: connectionId,
    database: editTable?.database ?? '',
    table: editTable?.table ?? tableName,
  }
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
  edit: DataViewEditSession
}

export function dataRowClass(
  row: Record<string, unknown>,
  { selectedRowIndex, edit }: RowClassInputs
): string | undefined {
  const isSelected = selectedRowIndex !== null && row.__rowIdx === selectedRowIndex
  return rowClassNameOf({
    isEditing: isEditedRow(rowPlacementOf(row), edit),
    isNewRow: edit.state?.isNewRow === true,
    isSelected: isSelected,
  })
}

export interface AutoSizeInputs {
  resolvedColumns: ResolvedQueryResultColumn[]
  editTarget: DataViewEditTarget
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

function isBlobViewerEditable(inputs: AutoSizeInputs, index: number): boolean {
  const isBinaryColumn = inputs.resolvedColumns[index]?.effectiveTableMeta.isBinary === true
  const isEditTargetSet = inputs.editTarget.tableName !== null
  return isBinaryColumn && isEditTargetSet && inputs.editTarget.bindings.has(index)
}

function showsLockIcon(inputs: AutoSizeInputs, index: number): boolean {
  const isEditable = inputs.editTarget.editableColumns.get(index) ?? false
  if (isEditable) return false
  return !isBlobViewerEditable(inputs, index)
}

export function computeDataColumnWidth(
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
