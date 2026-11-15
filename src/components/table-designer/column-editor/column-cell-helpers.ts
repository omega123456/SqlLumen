import type { MouseEvent as ReactMouseEvent } from 'react'
import type { TableDesignerColumnDef } from '../../../types/schema'
import {
  isModifiedCell,
  type ActiveCell,
  type ColumnFieldKey,
  type EditableCellKey,
} from '../column-editor-model'
import type { ColumnCellProps, ColumnRowModel } from './column-row-types'

export function stopClick(event: ReactMouseEvent) {
  event.stopPropagation()
}

export function cellOf(row: ColumnRowModel, cellKey: EditableCellKey): ActiveCell {
  return { rowIndex: row.columnIndex, cellKey: cellKey }
}

export function updateField(
  { row, controller }: ColumnCellProps,
  field: keyof TableDesignerColumnDef,
  value: unknown
) {
  controller.updateColumn({ index: row.columnIndex, field: field, value: value })
}

export function isCellModified(
  { row, controller }: ColumnCellProps,
  field: ColumnFieldKey
): boolean {
  return isModifiedCell(controller.tabState, row.column, field)
}

export function ariaInvalidValue(error: string | undefined): 'true' | 'false' {
  return error ? 'true' : 'false'
}
