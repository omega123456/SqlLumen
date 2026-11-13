import type { DefaultValueModel, TableDesignerColumnDef } from '../../types/schema'
import type { TableDesignerTabState } from '../../stores/table-designer-store'
import {
  normalizeTypeModifier,
  NUMERIC_TYPES,
  TYPES_WITHOUT_LENGTH,
} from './table-designer-type-constants'
import { isIndexInBounds } from '../../lib/value-checks'

const TYPES_WITHOUT_LENGTH_SET = new Set(TYPES_WITHOUT_LENGTH)
const NUMERIC_TYPE_SET = new Set(NUMERIC_TYPES)
const UNSIGNED = 'UNSIGNED'
const MODIFIER_TOKEN_SEPARATOR = ' '
const MODIFIER_WHITESPACE = /\s+/

export type Signedness = 'SIGNED' | 'UNSIGNED'

export type ColumnFieldKey = keyof Pick<
  TableDesignerColumnDef,
  | 'name'
  | 'type'
  | 'typeModifier'
  | 'length'
  | 'nullable'
  | 'isPrimaryKey'
  | 'isAutoIncrement'
  | 'defaultValue'
  | 'comment'
>

export type EditableCellKey = 'name' | 'type' | 'length' | 'signedness' | 'default' | 'comment'

export type TextCellKey = 'name' | 'length' | 'comment'

export interface ActiveCell {
  rowIndex: number
  cellKey: EditableCellKey
}

export interface RowDrag {
  from: number
  to: number
  rowHeight: number
}

export interface RowDropTarget {
  from: number
  offset: number
  rowHeight: number
  columnCount: number
}

export interface SelectionMoves {
  canMoveUp: boolean
  canMoveDown: boolean
  canDelete: boolean
}

interface RevertibleColumnField {
  field: keyof TableDesignerColumnDef
  parseBaseline: (originalValue: string) => unknown
}

const keepBaselineText = (originalValue: string): unknown => originalValue

export const REVERTIBLE_COLUMN_FIELDS: Partial<Record<EditableCellKey, RevertibleColumnField>> = {
  name: { field: 'name', parseBaseline: keepBaselineText },
  length: { field: 'length', parseBaseline: keepBaselineText },
  signedness: { field: 'typeModifier', parseBaseline: keepBaselineText },
  comment: { field: 'comment', parseBaseline: keepBaselineText },
  default: {
    field: 'defaultValue',
    parseBaseline: (originalValue) => JSON.parse(originalValue) as DefaultValueModel,
  },
}

export const EDITABLE_CELL_ORDER: EditableCellKey[] = [
  'name',
  'type',
  'length',
  'signedness',
  'default',
  'comment',
]

const DEFAULT_VALUE_FACTORIES: Record<string, (text: string) => DefaultValueModel> = {
  NO_DEFAULT: () => ({ tag: 'NO_DEFAULT' }),
  NULL_DEFAULT: () => ({ tag: 'NULL_DEFAULT' }),
  LITERAL: (text) => ({ tag: 'LITERAL', value: text }),
  EXPRESSION: (text) => ({ tag: 'EXPRESSION', value: text }),
}

export function editStartKey(cell: ActiveCell): string {
  return `${cell.rowIndex}:${cell.cellKey}`
}

export function isTypeWithoutLength(type: string): boolean {
  return TYPES_WITHOUT_LENGTH_SET.has(type.toUpperCase())
}

export function isNumericType(type: string): boolean {
  return NUMERIC_TYPE_SET.has(type.trim().toUpperCase())
}

function isSignednessNeutralToken(token: string): boolean {
  return token !== '' && token.toUpperCase() !== UNSIGNED
}

function stripSignedness(modifier: string | null | undefined): string {
  return (modifier ?? '')
    .trim()
    .split(MODIFIER_WHITESPACE)
    .filter(isSignednessNeutralToken)
    .join(MODIFIER_TOKEN_SEPARATOR)
}

export function applySignedness(
  modifier: string | null | undefined,
  nextSignedness: Signedness
): string {
  const preserved = stripSignedness(modifier)
  if (nextSignedness !== UNSIGNED) return preserved
  return [UNSIGNED, preserved].filter(Boolean).join(MODIFIER_TOKEN_SEPARATOR)
}

export function toSignedness(value: string): Signedness {
  return value === UNSIGNED ? 'UNSIGNED' : 'SIGNED'
}

function cloneComparable(value: unknown): string {
  return JSON.stringify(value)
}

function isOriginalColumnFor(originalColumn: TableDesignerColumnDef, originalKey: string): boolean {
  return originalColumn.name === originalKey || originalColumn.originalName === originalKey
}

function findOriginalColumn(
  tabState: TableDesignerTabState,
  column: TableDesignerColumnDef
): TableDesignerColumnDef | null {
  if (tabState.mode !== 'alter') return null
  if (!tabState.originalSchema) return null

  const originalKey = column.originalName || column.name
  if (!originalKey) return null

  const originalColumn = tabState.originalSchema.columns.find((candidate) =>
    isOriginalColumnFor(candidate, originalKey)
  )
  return originalColumn ?? null
}

function isTypeModifierChanged(
  column: TableDesignerColumnDef,
  originalColumn: TableDesignerColumnDef
): boolean {
  const currentModifier = normalizeTypeModifier(column.type, column.typeModifier)
  const originalModifier = normalizeTypeModifier(originalColumn.type, originalColumn.typeModifier)
  return currentModifier !== originalModifier
}

export function isModifiedCell(
  tabState: TableDesignerTabState,
  column: TableDesignerColumnDef,
  field: ColumnFieldKey
): boolean {
  const originalColumn = findOriginalColumn(tabState, column)
  if (!originalColumn) return tabState.mode === 'alter'
  if (field === 'typeModifier') return isTypeModifierChanged(column, originalColumn)
  return cloneComparable(column[field]) !== cloneComparable(originalColumn[field])
}

export function defaultValueForMode(mode: string, text: string): DefaultValueModel {
  const createDefault = DEFAULT_VALUE_FACTORIES[mode] ?? DEFAULT_VALUE_FACTORIES.EXPRESSION
  return createDefault(text)
}

export function isTextDefaultMode(mode: string): boolean {
  return mode === 'LITERAL' || mode === 'EXPRESSION'
}

export function defaultValueText(defaultValue: DefaultValueModel): string {
  return 'value' in defaultValue ? defaultValue.value : ''
}

export function canAutoIncrement(column: TableDesignerColumnDef): boolean {
  return column.isPrimaryKey && isNumericType(column.type)
}

export function mustClearAutoIncrementForType(
  column: TableDesignerColumnDef,
  nextType: string
): boolean {
  const canKeepAutoIncrement = isNumericType(nextType) && column.isPrimaryKey
  return column.isAutoIncrement && !canKeepAutoIncrement
}

function getDragShift(rowIndex: number, fromIndex: number, toIndex: number): number {
  const isPassedByForwardDrag = fromIndex < rowIndex && rowIndex <= toIndex
  if (isPassedByForwardDrag) return -1
  const isPassedByBackwardDrag = toIndex <= rowIndex && rowIndex < fromIndex
  if (isPassedByBackwardDrag) return 1
  return 0
}

export function dragShiftFor(drag: RowDrag | null, rowIndex: number): number {
  if (!drag) return 0
  return getDragShift(rowIndex, drag.from, drag.to)
}

export function getSelectionAfterReorder(
  selectedIndex: number | null,
  fromIndex: number,
  toIndex: number
): number | null {
  if (selectedIndex === null) return null
  if (selectedIndex === fromIndex) return toIndex
  return selectedIndex + getDragShift(selectedIndex, fromIndex, toIndex)
}

export function getSelectionAfterDelete(
  selectedIndex: number | null,
  deletedIndex: number
): number | null {
  if (selectedIndex === null) return null
  if (selectedIndex === deletedIndex) return deletedIndex > 0 ? deletedIndex - 1 : null
  if (selectedIndex > deletedIndex) return selectedIndex - 1
  return selectedIndex
}

export function dropIndexFor({ from, offset, rowHeight, columnCount }: RowDropTarget): number {
  const lastIndex = columnCount - 1
  const unclampedIndex = from + Math.round(offset / rowHeight)
  return Math.min(Math.max(unclampedIndex, 0), lastIndex)
}

export function clampSelection(selectedIndex: number | null, columnCount: number): number | null {
  if (selectedIndex === null) return null
  if (columnCount === 0) return null
  return Math.min(selectedIndex, columnCount - 1)
}

export function selectionMoves(selectedIndex: number | null, columnCount: number): SelectionMoves {
  if (selectedIndex === null) return { canMoveUp: false, canMoveDown: false, canDelete: false }
  return {
    canMoveUp: selectedIndex > 0,
    canMoveDown: selectedIndex < columnCount - 1,
    canDelete: selectedIndex < columnCount,
  }
}

export type TraversalDirection = -1 | 1

export interface CellTraversal {
  from: ActiveCell
  direction: TraversalDirection
  columnCount: number
}

const CELLS_PER_ROW = EDITABLE_CELL_ORDER.length
const LAST_EDITABLE_CELL_KEY: EditableCellKey = 'comment'

function cellAtAbsoluteIndex(absoluteIndex: number): ActiveCell {
  return {
    rowIndex: Math.floor(absoluteIndex / CELLS_PER_ROW),
    cellKey: EDITABLE_CELL_ORDER[absoluteIndex % CELLS_PER_ROW],
  }
}

function absoluteIndexOf(cell: ActiveCell): number {
  return cell.rowIndex * CELLS_PER_ROW + EDITABLE_CELL_ORDER.indexOf(cell.cellKey)
}

export function cellsInDirection({ from, direction, columnCount }: CellTraversal): ActiveCell[] {
  const totalCells = columnCount * CELLS_PER_ROW
  const cells: ActiveCell[] = []
  let absoluteIndex = absoluteIndexOf(from) + direction
  while (isIndexInBounds(absoluteIndex, totalCells)) {
    cells.push(cellAtAbsoluteIndex(absoluteIndex))
    absoluteIndex += direction
  }
  return cells
}

export function sameCellsBelow(from: ActiveCell, columnCount: number): ActiveCell[] {
  const cells: ActiveCell[] = []
  for (let rowIndex = from.rowIndex + 1; rowIndex < columnCount; rowIndex += 1) {
    cells.push({ rowIndex: rowIndex, cellKey: from.cellKey })
  }
  return cells
}

export function isLastEditableCell(cell: ActiveCell, columnCount: number): boolean {
  const isLastRow = cell.rowIndex === columnCount - 1
  return isLastRow && cell.cellKey === LAST_EDITABLE_CELL_KEY
}
