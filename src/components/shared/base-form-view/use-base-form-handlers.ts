import { useCallback, useState } from 'react'
import { logFrontendError } from '../../../lib/app-log-commands'
import { writeClipboardText } from '../../../lib/context-menu-utils'
import { formatCellValue } from '../../../lib/result-cell-utils'
import type { BaseFormViewProps, GridColumnDescriptor } from '../../../types/shared-data-view'
import { currentFieldValue, resolveNonNullDefault } from './form-field-values'

export interface OpenPickerState {
  field: string
  anchorEl: HTMLElement
}

type BaseFormHandlerProps = Pick<
  BaseFormViewProps,
  'currentRow' | 'editState' | 'onEnsureEditing' | 'onUpdateCell' | 'onSave' | 'onDiscard'
>

async function copyCellValue(value: unknown): Promise<void> {
  const { displayValue: text } = formatCellValue(value)
  try {
    await writeClipboardText(text)
  } catch (error) {
    logFrontendError('[base-form-view] clipboard write failed:', error)
  }
}

function closePickerForField(columnKey: string) {
  return (previous: OpenPickerState | null) => (previous?.field === columnKey ? null : previous)
}

function useFieldEditHandlers(props: BaseFormHandlerProps) {
  const { onEnsureEditing, onUpdateCell } = props
  const ensureEditing = useCallback(() => {
    onEnsureEditing?.()
  }, [onEnsureEditing])

  const handleInputFocus = useCallback(() => {
    ensureEditing()
  }, [ensureEditing])

  const handleInputChange = useCallback(
    (columnKey: string, value: unknown) => {
      ensureEditing()
      onUpdateCell?.(columnKey, value)
    },
    [ensureEditing, onUpdateCell]
  )
  return { ensureEditing, handleInputFocus, handleInputChange }
}

export function useBaseFormHandlers(props: BaseFormHandlerProps) {
  const { currentRow, editState, onUpdateCell, onSave, onDiscard } = props
  const [openPickerState, setOpenPickerState] = useState<OpenPickerState | null>(null)
  const fieldEdits = useFieldEditHandlers(props)
  const { ensureEditing } = fieldEdits

  const handleNullToggle = useCallback(
    (column: GridColumnDescriptor, columnIndex: number) => {
      if (!currentRow) return
      ensureEditing()
      const rowValue = currentRow[columnIndex]
      const isNullValue = currentFieldValue(editState, column.key, rowValue) === null
      if (isNullValue) {
        onUpdateCell?.(column.key, resolveNonNullDefault(column, rowValue))
        return
      }
      setOpenPickerState(closePickerForField(column.key))
      onUpdateCell?.(column.key, null)
    },
    [currentRow, ensureEditing, editState, onUpdateCell, setOpenPickerState]
  )

  const handleCopy = copyCellValue

  const handleSave = useCallback(() => {
    onSave?.()
  }, [onSave])

  const handleDiscard = useCallback(() => {
    onDiscard?.()
  }, [onDiscard])

  return {
    ...fieldEdits,
    openPickerState,
    setOpenPickerState,
    handleNullToggle,
    handleCopy,
    handleSave,
    handleDiscard,
  }
}
