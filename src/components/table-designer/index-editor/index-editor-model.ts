import type {
  TableDesignerStore,
  TableDesignerTabState,
} from '../../../stores/table-designer-store'
import type { TableDesignerIndexDef } from '../../../types/schema'
import type { DropdownOption } from '../../common/Dropdown'
import { isEven } from '../../../lib/units'
import styles from '../IndexEditor.module.css'

export const MAX_LISTED_COLUMN_LABELS = 2

export type SelectedRow = 'primary' | number | null

export interface VisibleIndexRow {
  index: TableDesignerIndexDef
  storeIndex: number
}

export function formatSelectedColumnsSummary(selectedOptions: DropdownOption[]): string {
  const count = selectedOptions.length
  if (count <= 0) {
    return 'Select columns'
  }
  if (count <= MAX_LISTED_COLUMN_LABELS) {
    return selectedOptions.map((option) => option.label).join(', ')
  }
  return `${count} selected`
}

export function derivePrimaryIndex(tabState: TableDesignerTabState): TableDesignerIndexDef {
  const primaryColumns = tabState.currentSchema.columns
    .filter((column) => column.isPrimaryKey)
    .map((column) => column.name)
    .filter((name) => name !== '')

  return {
    name: 'PRIMARY',
    indexType: 'PRIMARY',
    columns: primaryColumns,
  }
}

function cloneComparable(value: unknown): string {
  return JSON.stringify(value)
}

function isSameIndex(left: TableDesignerIndexDef, right: TableDesignerIndexDef): boolean {
  return left.name === right.name || cloneComparable(left) === cloneComparable(right)
}

export function isNewIndex(tabState: TableDesignerTabState, index: TableDesignerIndexDef): boolean {
  if (tabState.mode !== 'alter') return false
  if (!tabState.originalSchema) return false

  const originalIndexes = tabState.originalSchema.indexes.filter(
    (originalIndex) => originalIndex.indexType !== 'PRIMARY'
  )

  return !originalIndexes.some((originalIndex) => isSameIndex(originalIndex, index))
}

export interface IndexRowPosition {
  storeIndex: number
  visibleIndex: number
  isSelected: boolean
  isNew: boolean
}

export interface IndexRowContext {
  tabId: string
  columnNames: string[]
  validationErrors: Record<string, string>
  updateIndex: TableDesignerStore['updateIndex']
  onSelect: (storeIndex: number) => void
  onDelete: (storeIndex: number) => void
}

export function indexRowStripeClassName(isSelected: boolean, displayIndex: number): string {
  if (isSelected) return styles.selectedRow
  return isEven(displayIndex) ? styles.evenRow : styles.oddRow
}

export function indexInputClassName(isSelected: boolean): string {
  return isSelected ? styles.activeInput : styles.inactiveInput
}

export function errorClassName(error: string | undefined): string {
  return error ? styles.inputError : ''
}

export function ariaInvalidFor(error: string | undefined): 'true' | 'false' {
  return error ? 'true' : 'false'
}

export function stopRowSelection(event: React.MouseEvent): void {
  event.stopPropagation()
}

export function visibleIndexesOf(tabState: TableDesignerTabState | undefined): VisibleIndexRow[] {
  if (!tabState) {
    return []
  }
  return tabState.currentSchema.indexes
    .map((index, storeIndex) => ({ index, storeIndex }))
    .filter(({ index }) => index.indexType !== 'PRIMARY')
}

function isVisibleStoreIndex(visibleIndexes: VisibleIndexRow[], storeIndex: number): boolean {
  return visibleIndexes.some((row) => row.storeIndex === storeIndex)
}

export function resolveEffectiveSelectedRow(
  selectedRow: SelectedRow,
  visibleIndexes: VisibleIndexRow[]
): SelectedRow {
  if (selectedRow === null) return selectedRow
  if (selectedRow === 'primary') return selectedRow
  return isVisibleStoreIndex(visibleIndexes, selectedRow) ? selectedRow : null
}

export function canDeleteSelectedIndex(
  selectedRow: SelectedRow,
  visibleIndexes: VisibleIndexRow[]
): boolean {
  if (selectedRow === null) return false
  if (selectedRow === 'primary') return false
  return isVisibleStoreIndex(visibleIndexes, selectedRow)
}
