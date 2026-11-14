import { useCallback } from 'react'
import type { EditableGridCell, Item } from '@glideapps/glide-data-grid'
import {
  isPendingTypingActivationCommit,
  isUnchangedEditorCommit,
  resolveEditedCellValue,
  withCellValue,
  type EditedCellIdentity,
} from './grid-cell-editing'
import type { GridEditorRefs, GridViewModel } from './grid-view-model'

export type CellEditHandler = (cell: Item, newValue: EditableGridCell) => void

function isNoOpEditorCommit(editorRefs: GridEditorRefs, edit: EditedCellIdentity): boolean {
  const isPendingTypingActivation = isPendingTypingActivationCommit(
    editorRefs.pendingTypingActivationRef.current,
    edit
  )
  if (isPendingTypingActivation) {
    editorRefs.pendingTypingActivationRef.current = null
    return false
  }
  return isUnchangedEditorCommit(editorRefs.editorSessionBaselineRef.current, edit)
}

export function useGridCellEditCommit(model: GridViewModel): CellEditHandler {
  const { gridColumns, isWindowed } = model
  const { onCellValueChange, onRowsChange, rows: rowsProp } = model.props
  const editorRefs = model.refs.editor
  return useCallback(
    ([columnIndex, rowIndex]: Item, newValue: EditableGridCell) => {
      const column = gridColumns[columnIndex]
      if (!column) return
      const next = resolveEditedCellValue(column, newValue)
      if (next === undefined) return
      const edit = { rowIndex: rowIndex, columnKey: column.key, value: next }
      const isNoOpCommit = isNoOpEditorCommit(editorRefs, edit)
      if (!isNoOpCommit) {
        onCellValueChange?.(rowIndex, column.key, next)
      }
      if (!onRowsChange) return
      if (isWindowed) return
      const nextRows = isNoOpCommit ? rowsProp : withCellValue(rowsProp, edit)
      onRowsChange(nextRows, { indexes: [rowIndex], column: column })
    },
    [editorRefs, gridColumns, isWindowed, onCellValueChange, onRowsChange, rowsProp]
  )
}
