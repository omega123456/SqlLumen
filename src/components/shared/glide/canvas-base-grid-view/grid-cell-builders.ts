import {
  GridCellKind,
  type BooleanCell,
  type EditableGridCell,
  type GridCell,
  type TextCell,
} from '@glideapps/glide-data-grid'
import {
  buildBlobCell,
  buildNullCell,
  buildTextCell,
  classifyCellValue,
} from '../glide-cell-content'
import type { GridColumn } from '../glide-grid-types'
import type { GridRow, PendingTypingActivation } from './canvas-grid-types'
import { isEnumColumn, isSetColumn } from './grid-columns'
import { buildEnumDropdownCell, buildSetMultiSelectCell } from './grid-list-cells'

export interface DataCellInput {
  row: GridRow
  rowIndex: number
  column: GridColumn<GridRow>
  flags: ReturnType<typeof classifyCellValue>
  editable: boolean
  pendingTypingActivation: PendingTypingActivation | null
}

export function nullableCellString(value: unknown): string | null {
  return value == null ? null : String(value)
}

export function buildEmptyTextCell(): GridCell {
  return buildTextCell('', classifyCellValue('', ''))
}

export function buildCheckboxCell(rawValue: unknown): BooleanCell {
  return {
    kind: GridCellKind.Boolean,
    data: rawValue === true,
    allowOverlay: false,
    readonly: false,
  }
}

export function cellCopyData(cell: GridCell): string {
  if (!('copyData' in cell)) return ''
  return typeof cell.copyData === 'string' ? cell.copyData : ''
}

export function isReadOnlyCell(cell: GridCell): boolean {
  return 'readonly' in cell && cell.readonly === true
}

function matchingTypingActivation(
  pending: PendingTypingActivation | null,
  rowIndex: number,
  columnKey: string
): PendingTypingActivation | null {
  const isForThisCell = pending?.rowIndex === rowIndex && pending.columnKey === columnKey
  return isForThisCell ? pending : null
}

function buildEditableTextCell(input: DataCellInput): GridCell {
  const { row, rowIndex, column, flags } = input
  const rawValue = row[column.key]
  const baseCell = flags.isNull
    ? buildNullCell(flags.copyValue)
    : buildTextCell(flags.displayValue, flags, flags.copyValue)
  const activation = matchingTypingActivation(input.pendingTypingActivation, rowIndex, column.key)
  const cancelRestore = activation ? { cancelRestoreValue: activation.cancelRestoreValue } : {}
  return {
    ...baseCell,
    readonly: false,
    allowOverlay: true,
    data: nullableCellString(rawValue) ?? '',
    glideEditorData: {
      row: row,
      columnKey: column.key,
      columnLabel: column.displayName,
      columnMeta: column.tableColumnMeta,
      isNullable: column.isNullable === true,
      foreignKey: column.foreignKey,
      initialInputValue: activation?.value,
      ...cancelRestore,
      selectAllOnFocus: activation === null,
    },
  } as TextCell & { glideEditorData: unknown }
}

export function buildDataCell(input: DataCellInput): GridCell {
  const { row, column, flags, editable } = input
  const rawValue = row[column.key]
  if (flags.isBlob) return buildBlobCell(flags.displayValue, flags.copyValue)
  const isReadOnlyNull = flags.isNull && !editable
  if (isReadOnlyNull) return buildNullCell(flags.copyValue)
  if (isEnumColumn(column)) {
    return buildEnumDropdownCell(column, nullableCellString(rawValue), editable)
  }
  if (isSetColumn(column)) {
    return buildSetMultiSelectCell(column, nullableCellString(rawValue), editable)
  }
  if (editable) return buildEditableTextCell(input)
  return buildTextCell(flags.displayValue, flags, flags.copyValue)
}

export function clearedValueFor(column: GridColumn<GridRow>): string | null {
  if (column.isNullable === true) return null
  if (isEnumColumn(column)) return column.enumValues[0] ?? ''
  return ''
}

export function buildClearedCell(
  column: GridColumn<GridRow>,
  clearedValue: string | null
): EditableGridCell | undefined {
  if (isEnumColumn(column)) return buildEnumDropdownCell(column, clearedValue, true)
  if (isSetColumn(column)) return buildSetMultiSelectCell(column, clearedValue, true)
  const text = clearedValue ?? ''
  const baseCell = buildTextCell(
    text,
    classifyCellValue(clearedValue, column.key),
    clearedValue ?? 'NULL'
  )
  if (baseCell.kind !== GridCellKind.Text) return undefined
  return { ...baseCell, readonly: false, allowOverlay: true, data: text }
}
