import { useCallback, type KeyboardEvent, type RefObject } from 'react'
import { isTargetInside } from '../../../lib/input-events'
import type { CellEditorParams, CellEditorResult } from '../useCellEditor'

const COMMIT_KEYS: ReadonlySet<string> = new Set(['Tab', 'Enter'])

export interface DateTimeEditorHandlerInputs {
  props: CellEditorParams
  editor: CellEditorResult
  pickerOpen: boolean
  setPickerOpen: (isOpen: boolean) => void
}

function useEditorKeyDown({
  props,
  editor,
  pickerOpen,
  setPickerOpen,
}: DateTimeEditorHandlerInputs) {
  const { isNull, value, restoreOriginalValue } = editor
  return useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (pickerOpen) {
          event.stopPropagation()
          setPickerOpen(false)
          return
        }
        restoreOriginalValue()
        props.onClose(false, false)
        return
      }
      if (!COMMIT_KEYS.has(event.key)) return
      const committedValue = isNull ? null : value
      props.onRowChange({ ...props.row, [props.column.key]: committedValue }, true)
      props.onClose(true, true)
      event.preventDefault()
    },
    [isNull, pickerOpen, props, restoreOriginalValue, value, setPickerOpen]
  )
}

export function useDateTimeEditorHandlers(
  inputs: DateTimeEditorHandlerInputs,
  containerRef: RefObject<HTMLDivElement | null>,
  pickerPopupRef: RefObject<HTMLDivElement | null>
) {
  const { props, editor, setPickerOpen } = inputs
  const { isNull, handleChange } = editor
  const baseHandleToggleNull = editor.handleToggleNull
  const { onClose } = props
  return {
    handleKeyDown: useEditorKeyDown(inputs),
    handleToggleNull: useCallback(() => {
      if (!isNull) setPickerOpen(false)
      baseHandleToggleNull()
    }, [baseHandleToggleNull, isNull, setPickerOpen]),
    handlePickerApply: useCallback(
      (pickedValue: string) => {
        handleChange(pickedValue)
        setPickerOpen(false)
        onClose(true, false)
      },
      [handleChange, onClose, setPickerOpen]
    ),
    handleCalendarClick: useCallback(() => setPickerOpen(true), [setPickerOpen]),
    handleInputBlur: useCallback(
      (relatedTarget: EventTarget | null) => {
        if (isTargetInside(containerRef.current, relatedTarget)) return
        if (isTargetInside(pickerPopupRef.current, relatedTarget)) return
        onClose(true, false)
      },
      [onClose, containerRef, pickerPopupRef]
    ),
  }
}
