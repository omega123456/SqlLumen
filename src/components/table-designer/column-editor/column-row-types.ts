import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import type { DefaultValueModel, TableDesignerColumnDef } from '../../../types/schema'
import type { DesignerFieldEdit, TableDesignerTabState } from '../../../stores/table-designer-store'
import type { ActiveCell } from '../column-editor-model'

export interface DefaultCellControls {
  overrideIndex: number | null
  overrideTriggerRef: RefObject<HTMLButtonElement | null>
  captureBaseline: (columnIndex: number, defaultValue: DefaultValueModel) => void
  scheduleBlur: (columnIndex: number) => void
  openOverride: (columnIndex: number) => void
  closeOverride: () => void
  handleOverrideOpenChange: (open: boolean) => void
}

export interface ColumnRowController {
  tabId: string
  tabState: TableDesignerTabState
  updateColumn: (edit: DesignerFieldEdit<TableDesignerColumnDef>) => void
  activateCell: (cell: ActiveCell) => void
  focusCellLater: (cell: ActiveCell) => void
  rememberEditStart: (cell: ActiveCell, value: string) => void
  forgetEditStart: (cell: ActiveCell) => void
  handleEditableKeyDown: (event: ReactKeyboardEvent<HTMLElement>, cell: ActiveCell) => void
  deleteColumn: (columnIndex: number) => void
  defaultCell: DefaultCellControls
}

export interface ColumnRowModel {
  column: TableDesignerColumnDef
  columnIndex: number
  isSelected: boolean
}

export interface ColumnCellProps {
  row: ColumnRowModel
  controller: ColumnRowController
}
