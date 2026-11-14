import type { TableDesignerTabState } from '../../../stores/table-designer-store'
import type { TableDesignerColumnDef, TableDesignerForeignKeyDef } from '../../../types/schema'
import { isEven } from '../../../lib/units'
import styles from '../ForeignKeyEditor.module.css'

export const REFERENCED_TARGET_SEPARATOR = '\u0000'

function makeReferencedTargetKey(database: string, table: string): string {
  return `${database}${REFERENCED_TARGET_SEPARATOR}${table}`
}

const EMPTY_COLUMNS: TableDesignerColumnDef[] = []
const EMPTY_FOREIGN_KEYS: TableDesignerForeignKeyDef[] = []
export const EMPTY_TEXT_FALLBACK = '—'

export interface ForeignKeyEditorSource {
  columns: TableDesignerColumnDef[]
  foreignKeys: TableDesignerForeignKeyDef[]
  connectionId: string | undefined
  databaseName: string | undefined
}

export function foreignKeyEditorSource(
  tabState: TableDesignerTabState | undefined
): ForeignKeyEditorSource {
  if (!tabState) {
    return {
      columns: EMPTY_COLUMNS,
      foreignKeys: EMPTY_FOREIGN_KEYS,
      connectionId: undefined,
      databaseName: undefined,
    }
  }
  return {
    columns: tabState.currentSchema.columns,
    foreignKeys: tabState.currentSchema.foreignKeys,
    connectionId: tabState.connectionId,
    databaseName: tabState.databaseName,
  }
}

export function resolveEffectiveSelectedRow(
  selectedRow: number | null,
  rowCount: number
): number | null {
  if (selectedRow === null) return null
  if (selectedRow >= rowCount) return null
  return selectedRow
}

export function canDeleteForeignKeyAt(
  foreignKeys: TableDesignerForeignKeyDef[],
  index: number | null
): boolean {
  if (index === null) return false
  if (index >= foreignKeys.length) return false
  return !foreignKeys[index]?.isComposite
}

export function selectionAfterDelete(current: number | null, deletedIndex: number): number | null {
  if (current === null) {
    return null
  }

  if (current === deletedIndex) {
    return deletedIndex > 0 ? deletedIndex - 1 : null
  }

  if (current > deletedIndex) {
    return current - 1
  }

  return current
}

export function rowStripeClassName(isSelected: boolean, index: number): string {
  if (isSelected) return styles.selectedRow
  return isEven(index) ? styles.evenRow : styles.oddRow
}

export function cellInputClassName(isSelected: boolean): string {
  return isSelected ? styles.activeInput : styles.inactiveInput
}

export function cellSelectClassName(): string {
  return styles.cellSelect
}

export function referencedTargetKeyFor(
  referencedDatabase: string,
  referencedTable: string
): string {
  if (referencedDatabase === '') return ''
  if (referencedTable === '') return ''
  return makeReferencedTargetKey(referencedDatabase, referencedTable)
}

export function stopRowSelection(event: React.MouseEvent): void {
  event.stopPropagation()
}

function referencedDatabaseOf(
  foreignKey: TableDesignerForeignKeyDef,
  databaseName: string
): string {
  return (foreignKey.referencedDatabase || databaseName).trim()
}

export function referencedDatabasesFor(
  foreignKeys: TableDesignerForeignKeyDef[],
  databaseName: string
): string[] {
  const databases = foreignKeys
    .map((foreignKey) => referencedDatabaseOf(foreignKey, databaseName))
    .filter((referencedDatabase) => referencedDatabase !== '')
  return Array.from(new Set(databases))
}

export function referencedTargetsFor(
  foreignKeys: TableDesignerForeignKeyDef[],
  databaseName: string
): string[] {
  const targets = foreignKeys
    .map((foreignKey) =>
      referencedTargetKeyFor(
        referencedDatabaseOf(foreignKey, databaseName),
        foreignKey.referencedTable.trim()
      )
    )
    .filter((targetKey) => targetKey !== '')
  return Array.from(new Set(targets))
}
