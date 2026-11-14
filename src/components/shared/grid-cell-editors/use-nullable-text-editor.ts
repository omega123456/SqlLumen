import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import { isTargetInside } from '../../../lib/input-events'
import { isNullish } from '../../../lib/value-checks'
import { useCellStoreSync } from '../editor-callbacks-context'
import { useFkLookup } from '../fk-lookup-context'
import type { CellEditorBaseProps } from './cell-editor-types'
import { openForeignKeyLookupFromKey } from './cell-editor-keys'

export type EditorField = HTMLInputElement | HTMLTextAreaElement

export interface NullableTextEditorRefs {
  fieldRef: RefObject<EditorField | null>
  wrapperRef: RefObject<HTMLDivElement | null>
}

interface TextEditorInitialState {
  restoresToNull: boolean
  restoreValue: unknown
  isNull: boolean
  text: string
}

function initialEditingText(
  initialInputValue: string | undefined,
  restoresToNull: boolean,
  rawValue: unknown
): string {
  if (initialInputValue != null) return initialInputValue
  if (restoresToNull) return ''
  return String(rawValue ?? '')
}

function resolveTextEditorInitialState(props: CellEditorBaseProps): TextEditorInitialState {
  const rawValue = props.row[props.column.key]
  const hasCancelRestoreValue = Object.prototype.hasOwnProperty.call(props, 'cancelRestoreValue')
  const restoreSource = hasCancelRestoreValue ? props.cancelRestoreValue : rawValue
  const restoresToNull = isNullish(restoreSource)
  return {
    restoresToNull: restoresToNull,
    restoreValue: restoresToNull ? null : restoreSource,
    isNull: props.initialInputValue == null && restoresToNull,
    text: initialEditingText(props.initialInputValue, restoresToNull, rawValue),
  }
}

function focusEditorField(field: EditorField | null, selectAllOnFocus: boolean): void {
  field?.focus()
  if (selectAllOnFocus) {
    field?.select()
    return
  }
  const currentValue = field?.value ?? ''
  field?.setSelectionRange(currentValue.length, currentValue.length)
}

function useNullableTextValue(
  props: CellEditorBaseProps,
  fieldRef: NullableTextEditorRefs['fieldRef']
) {
  const { row, column, onRowChange } = props
  const fieldName = column.key
  const initialState = resolveTextEditorInitialState(props)
  const [isNull, setIsNull] = useState(initialState.isNull)
  const [value, setValue] = useState(initialState.text)
  const syncToStore = useCellStoreSync(props)

  const handleToggleNull = useCallback(() => {
    if (!isNull) {
      setIsNull(true)
      setValue('')
      onRowChange({ ...row, [fieldName]: null })
      syncToStore(null)
      return
    }
    setIsNull(false)
    onRowChange({ ...row, [fieldName]: '' })
    syncToStore('')
    setTimeout(() => fieldRef.current?.focus(), 0)
  }, [fieldName, fieldRef, isNull, onRowChange, row, syncToStore])

  const handleChange = useCallback(
    (nextValue: string) => {
      setIsNull(false)
      setValue(nextValue)
      onRowChange({ ...row, [fieldName]: nextValue })
      syncToStore(nextValue)
    },
    [fieldName, onRowChange, row, syncToStore]
  )

  return {
    initialState,
    isNull,
    setIsNull,
    value,
    setValue,
    syncToStore,
    handleToggleNull,
    handleChange,
  }
}

type NullableTextValue = ReturnType<typeof useNullableTextValue>

function useCancelTextEdit(props: CellEditorBaseProps, textValue: NullableTextValue) {
  const { row, column, onRowChange, onClose } = props
  const fieldName = column.key
  const { restoresToNull, restoreValue } = textValue.initialState
  const { setIsNull, setValue, syncToStore } = textValue
  const isCancellingRef = useRef(false)

  const cancelEdit = useCallback(() => {
    isCancellingRef.current = true
    setIsNull(restoresToNull)
    setValue(restoresToNull ? '' : String(restoreValue ?? ''))
    onRowChange({ ...row, [fieldName]: restoreValue }, false)
    syncToStore(restoreValue)
    onClose(false, false)
  }, [
    fieldName,
    onClose,
    onRowChange,
    restoreValue,
    restoresToNull,
    row,
    setIsNull,
    setValue,
    syncToStore,
  ])

  return { cancelEdit, isCancellingRef }
}

function useTextEditorKeyDown(
  props: CellEditorBaseProps,
  currentValue: unknown,
  cancelEdit: () => void
) {
  const { row, column, onRowChange, onClose } = props
  const fieldName = column.key
  const foreignKeyLookup = useFkLookup()
  return useCallback(
    (event: ReactKeyboardEvent, isCommitKey: boolean) => {
      const lookupRequest = {
        props: props,
        foreignKeyLookup: foreignKeyLookup,
        currentValue: currentValue,
      }
      if (openForeignKeyLookupFromKey(event, lookupRequest)) return
      if (isCommitKey) {
        onRowChange({ ...row, [fieldName]: currentValue }, true)
        onClose(true, true)
        event.preventDefault()
        return
      }
      if (event.key === 'Escape') {
        cancelEdit()
      }
    },
    [cancelEdit, currentValue, fieldName, foreignKeyLookup, onClose, onRowChange, props, row]
  )
}

export function useNullableTextEditor(props: CellEditorBaseProps, refs: NullableTextEditorRefs) {
  const { fieldRef, wrapperRef } = refs
  const { onClose } = props
  const selectAllOnFocus = props.selectAllOnFocus ?? true
  const textValue = useNullableTextValue(props, fieldRef)
  const { isNull, value } = textValue
  const { cancelEdit, isCancellingRef } = useCancelTextEdit(props, textValue)
  const handleKeyDown = useTextEditorKeyDown(props, isNull ? null : value, cancelEdit)

  useEffect(() => {
    focusEditorField(fieldRef.current, selectAllOnFocus)
  }, [fieldRef, selectAllOnFocus])

  const handleBlur = useCallback(
    (relatedTarget: EventTarget | null) => {
      if (isCancellingRef.current) return
      if (isTargetInside(wrapperRef.current, relatedTarget)) return
      onClose(true, false)
    },
    [isCancellingRef, onClose, wrapperRef]
  )

  return {
    isNull: isNull,
    displayValue: isNull ? '' : value,
    handleToggleNull: textValue.handleToggleNull,
    handleChange: textValue.handleChange,
    handleBlur: handleBlur,
    handleKeyDown: handleKeyDown,
  }
}
