import type { TableDataColumnMeta, ForeignKeyColumnInfo } from '../../../types/schema'
import type { SyncCellValue, UpdateCellValue } from '../editor-callbacks-context'

export interface CellEditorBaseProps {
  // grid editor protocol
  row: Record<string, unknown>
  column: { key: string }
  onRowChange: (row: Record<string, unknown>, commitChanges?: boolean) => void
  onClose: (commitChanges?: boolean, shouldFocusCell?: boolean) => void
  // Editor-specific
  isNullable?: boolean
  columnMeta?: TableDataColumnMeta
  /** FK metadata — when set, a FK trigger button is rendered in the editor. */
  foreignKey?: ForeignKeyColumnInfo
  // Store callbacks (provided via closures in column defs)
  tabId?: string
  updateCellValue?: UpdateCellValue
  syncCellValue?: SyncCellValue
  initialInputValue?: string
  cancelRestoreValue?: unknown
  selectAllOnFocus?: boolean
}
