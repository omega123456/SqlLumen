import {
  GridCellKind,
  type EditableGridCell,
  type GridCell,
  type TextCell,
} from '@glideapps/glide-data-grid'
import type { DropdownCellType, MultiSelectCellType } from '@glideapps/glide-data-grid-cells'
import type { CellClickGuardResult, RowEditState } from '../../../../types/shared-data-view'
import { serializeSetCellValue } from '../../enum-field-utils'
import type { GridCellPosition, GridColumn } from '../glide-grid-types'
import type {
  EditorSessionBaseline,
  GlideKeyDownEvent,
  GridRow,
  PendingTypingActivation,
} from './canvas-grid-types'
import { isEnumColumn, isSetColumn } from './grid-columns'
import {
  isDropdownCustomCell,
  isDropdownNullSelection,
  isMultiSelectCustomCell,
} from './grid-list-cells'

export interface EditedCellIdentity {
  rowIndex: number
  columnKey: string
  value: unknown
}

export interface EditorSessionBaselineInput {
  row: GridRow | undefined
  column: GridColumn<GridRow> | undefined
  rowIndex: number
  editState: RowEditState | null
}

export interface TypingActivationRequest {
  cell: GridCellPosition
  row: GridRow
  columnKey: string
  typedValue: string
  cancelRestoreValue: unknown
}

type TextCellWithEditorData = TextCell & { glideEditorData?: { columnKey?: string } }

export function isTypingActivationKey(event: GlideKeyDownEvent): boolean {
  const hasCommandModifier = event.altKey || event.ctrlKey || event.metaKey
  if (hasCommandModifier) return false
  const isSingleCharacter = event.key.length === 1
  if (!isSingleCharacter) return false
  return event.key !== '\r' && event.key !== '\n'
}

function normalizeEditorValue(value: unknown): unknown {
  if (Array.isArray(value)) return value
  return value == null ? null : String(value)
}

function areEditorArraysEqual(left: unknown[], right: unknown[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => Object.is(value, right[index]))
}

function areEditorValuesEqual(left: unknown, right: unknown): boolean {
  const isEitherArray = Array.isArray(left) || Array.isArray(right)
  if (!isEitherArray) return Object.is(left, right)
  if (!Array.isArray(left)) return false
  if (!Array.isArray(right)) return false
  return areEditorArraysEqual(left, right)
}

export function resolveEditorBaselineValue(
  row: GridRow,
  columnKey: string,
  editState: RowEditState | null
): unknown {
  if (Object.prototype.hasOwnProperty.call(editState?.currentValues ?? {}, columnKey)) {
    return editState?.currentValues[columnKey]
  }

  if (Object.prototype.hasOwnProperty.call(editState?.originalValues ?? {}, columnKey)) {
    return editState?.originalValues[columnKey]
  }

  return row[columnKey]
}

function isEnumNullSelection(
  column: GridColumn<GridRow>,
  selectedValue: string | null | undefined
): boolean {
  return isEnumColumn(column) && isDropdownNullSelection(column, selectedValue)
}

function resolveDropdownEditValue(column: GridColumn<GridRow>, cell: DropdownCellType): unknown {
  const selectedValue = cell.data.value
  if (isEnumNullSelection(column, selectedValue)) return null
  return selectedValue ?? null
}

function resolveMultiSelectEditValue(
  column: GridColumn<GridRow>,
  cell: MultiSelectCellType
): unknown {
  const selectedValues = cell.data.values ?? null
  if (isSetColumn(column)) return serializeSetCellValue(selectedValues)
  return selectedValues
}

function resolveTextEditValue(cell: TextCell): string | null {
  const isClearedToNull = cell.data === '' && cell.copyData === 'NULL'
  return isClearedToNull ? null : cell.data
}

export function resolveEditedCellValue(
  column: GridColumn<GridRow>,
  cell: EditableGridCell
): unknown {
  if (isDropdownCustomCell(cell)) return resolveDropdownEditValue(column, cell)
  if (isMultiSelectCustomCell(cell)) return resolveMultiSelectEditValue(column, cell)
  if (cell.kind === GridCellKind.Boolean) return cell.data === true
  if (cell.kind === GridCellKind.Text) return resolveTextEditValue(cell)
  return undefined
}

export function isPendingTypingActivationCommit(
  pending: PendingTypingActivation | null,
  edit: EditedCellIdentity
): boolean {
  const isSameCell = pending?.rowIndex === edit.rowIndex && pending.columnKey === edit.columnKey
  return isSameCell && pending.value === edit.value
}

export function isUnchangedEditorCommit(
  baseline: EditorSessionBaseline | null,
  edit: EditedCellIdentity
): boolean {
  const isSameCell = baseline?.rowIndex === edit.rowIndex && baseline.columnKey === edit.columnKey
  return isSameCell && areEditorValuesEqual(baseline.value, edit.value)
}

export function withCellValue(rows: GridRow[], edit: EditedCellIdentity): GridRow[] {
  return rows.map((row, index) =>
    index === edit.rowIndex ? { ...row, [edit.columnKey]: edit.value } : row
  )
}

export function buildEditorSessionBaseline(
  input: EditorSessionBaselineInput
): EditorSessionBaseline | null {
  const { row, column, rowIndex, editState } = input
  if (!column) return null
  if (!row) return null
  return {
    rowIndex: rowIndex,
    columnKey: column.key,
    value: normalizeEditorValue(resolveEditorBaselineValue(row, column.key, editState)),
  }
}

export function canStartTypedEdit(
  guard: CellClickGuardResult,
  column: GridColumn<GridRow> | undefined,
  editableColumnKeys: ReadonlySet<string> | undefined
): column is GridColumn<GridRow> {
  return guard.enableEditor && column !== undefined && editableColumnKeys?.has(column.key) === true
}

export function editorColumnKey(cell: GridCell): string | undefined {
  if (cell.kind !== GridCellKind.Text) return undefined
  return (cell as TextCellWithEditorData).glideEditorData?.columnKey
}
