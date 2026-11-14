import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { useFkLookup } from '../fk-lookup-context'
import type { CellEditorBaseProps } from './cell-editor-types'

export type ForeignKeyLookup = ReturnType<typeof useFkLookup>

const FOREIGN_KEY_LOOKUP_KEY = 'F4'

function isForeignKeyLookupKey(event: ReactKeyboardEvent): boolean {
  const hasModifier = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
  return event.key === FOREIGN_KEY_LOOKUP_KEY && !hasModifier
}

interface ForeignKeyLookupRequest {
  props: CellEditorBaseProps
  foreignKeyLookup: ForeignKeyLookup
  currentValue: unknown
}

export function openForeignKeyLookupFromKey(
  event: ReactKeyboardEvent,
  request: ForeignKeyLookupRequest
): boolean {
  const { props, foreignKeyLookup } = request
  if (!isForeignKeyLookupKey(event)) return false
  if (!props.foreignKey) return false
  if (!foreignKeyLookup) return false
  event.preventDefault()
  event.stopPropagation()
  props.onClose(true, false)
  foreignKeyLookup.onFkLookup({
    columnKey: props.column.key,
    currentValue: request.currentValue,
    foreignKey: props.foreignKey,
    rowData: props.row,
    source: 'keyboard',
  })
  return true
}

export function nullToggleClassName(isNull: boolean): string {
  return `td-null-toggle ${isNull ? 'td-null-active' : ''}`
}

export function isSingleLineCommitKey(event: ReactKeyboardEvent): boolean {
  return event.key === 'Tab' || event.key === 'Enter'
}

export function isMultilineCommitKey(event: ReactKeyboardEvent): boolean {
  return event.key === 'Enter' && !event.shiftKey
}
