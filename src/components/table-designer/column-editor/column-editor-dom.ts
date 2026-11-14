import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import type { TableDesignerColumnDef } from '../../../types/schema'
import type { ActiveCell, RowDrag, TraversalDirection } from '../column-editor-model'

export type EditableKeyHandler = (event: ReactKeyboardEvent<HTMLElement>, cell: ActiveCell) => void

export function cellSelector(cell: ActiveCell): string {
  return `[data-row-index="${cell.rowIndex}"][data-cell-key="${cell.cellKey}"]`
}

export function isDisabledFormControl(element: HTMLElement): boolean {
  const isFormControl =
    element instanceof HTMLInputElement ||
    element instanceof HTMLButtonElement ||
    element instanceof HTMLSelectElement
  return isFormControl && element.disabled
}

export function isTextEntryInput(element: HTMLElement): element is HTMLInputElement {
  return element instanceof HTMLInputElement && element.type !== 'checkbox'
}

export function traversalDirection(event: ReactKeyboardEvent<HTMLElement>): TraversalDirection {
  return event.shiftKey ? -1 : 1
}

export function openOverrideTrigger(triggerRef: RefObject<HTMLButtonElement | null>) {
  const trigger = triggerRef.current
  if (!trigger) return
  trigger.focus()
  trigger.click()
}

export function dragRowHeightStyle(drag: RowDrag | null): CSSProperties | undefined {
  if (!drag) return undefined
  return { '--drag-row-height': `${drag.rowHeight}px` } as CSSProperties
}

export function rowKeyFor(column: TableDesignerColumnDef, columnIndex: number): string {
  return `${column.originalName || 'new'}-${columnIndex}`
}
