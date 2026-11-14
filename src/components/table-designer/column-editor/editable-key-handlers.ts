import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { TableDesignerStore } from '../../../stores/table-designer-store'
import {
  REVERTIBLE_COLUMN_FIELDS,
  editStartKey,
  isLastEditableCell,
  type ActiveCell,
} from '../column-editor-model'
import { traversalDirection, type EditableKeyHandler } from './column-editor-dom'
import type { useColumnCellFocus } from './use-column-cell-focus'
import type { EditStartValues } from './use-edit-start-values'

interface EditableKeyHandlersInput {
  tabId: string
  columnCount: number
  store: Pick<TableDesignerStore, 'addColumn' | 'updateColumn'>
  editStart: EditStartValues
  cellFocus: ReturnType<typeof useColumnCellFocus>
}

function revertEditableField(input: EditableKeyHandlersInput, cell: ActiveCell): void {
  const { editStart, store, tabId } = input
  const originalValue = editStart.editStartValue(editStartKey(cell))
  if (originalValue === undefined) return
  const revertField = REVERTIBLE_COLUMN_FIELDS[cell.cellKey]
  if (revertField) {
    store.updateColumn(tabId, {
      index: cell.rowIndex,
      field: revertField.field,
      value: revertField.parseBaseline(originalValue),
    })
  }
  editStart.forgetEditStart(cell)
}

function appendColumnAndFocusName(
  input: EditableKeyHandlersInput,
  event: ReactKeyboardEvent<HTMLElement>
): void {
  input.store.addColumn(input.tabId)
  event.currentTarget.blur()
  input.cellFocus.setPendingFocusCell({ rowIndex: input.columnCount, cellKey: 'name' })
}

function handleTabKey(
  input: EditableKeyHandlersInput,
  event: ReactKeyboardEvent<HTMLElement>,
  cell: ActiveCell
): void {
  event.preventDefault()
  input.editStart.forgetEditStart(cell)
  const nextCell = input.cellFocus.findAdjacentCell(cell, traversalDirection(event))
  if (nextCell) {
    event.currentTarget.blur()
    input.cellFocus.focusCell(nextCell)
    return
  }
  const isTabbingPastLastCell = !event.shiftKey && isLastEditableCell(cell, input.columnCount)
  if (isTabbingPastLastCell) {
    appendColumnAndFocusName(input, event)
  }
}

function handleEnterKey(
  input: EditableKeyHandlersInput,
  event: ReactKeyboardEvent<HTMLElement>,
  cell: ActiveCell
): void {
  event.preventDefault()
  input.editStart.forgetEditStart(cell)
  event.currentTarget.blur()
  const nextRowCell = input.cellFocus.findSameCellInNextRow(cell)
  if (nextRowCell) {
    input.cellFocus.focusCell(nextRowCell)
  }
}

function handleEscapeKey(
  input: EditableKeyHandlersInput,
  event: ReactKeyboardEvent<HTMLElement>,
  cell: ActiveCell
): void {
  event.preventDefault()
  revertEditableField(input, cell)
  event.currentTarget.blur()
}

const EDITABLE_KEY_HANDLERS: Record<string, typeof handleTabKey> = {
  Tab: handleTabKey,
  Enter: handleEnterKey,
  Escape: handleEscapeKey,
}

export function editableKeyDownHandler(input: EditableKeyHandlersInput): EditableKeyHandler {
  return (event, cell) => EDITABLE_KEY_HANDLERS[event.key]?.(input, event, cell)
}
