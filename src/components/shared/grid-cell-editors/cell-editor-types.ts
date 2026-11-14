import type { TableDataColumnMeta, ForeignKeyColumnInfo } from '../../../types/schema'
import type { SyncCellValue, UpdateCellValue } from '../editor-callbacks-context'

export interface CellEditorBaseProps {
  row: Record<string, unknown>
  column: { key: string }
  onRowChange: (row: Record<string, unknown>, commitChanges?: boolean) => void
  onClose: (commitChanges?: boolean, shouldFocusCell?: boolean) => void
  isNullable?: boolean
  columnMeta?: TableDataColumnMeta
  foreignKey?: ForeignKeyColumnInfo
  tabId?: string
  updateCellValue?: UpdateCellValue
  syncCellValue?: SyncCellValue
  initialInputValue?: string
  cancelRestoreValue?: unknown
  selectAllOnFocus?: boolean
}
