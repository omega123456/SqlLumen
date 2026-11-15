import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import { isTargetInside } from '../../../lib/input-events'
import { isNullish } from '../../../lib/value-checks'
import type { DropdownOption } from '../../common/Dropdown'
import { ENUM_NULL_SENTINEL, getEnumFallbackValue } from '../enum-field-utils'
import { useCellStoreSync } from '../editor-callbacks-context'
import { useFkLookup } from '../fk-lookup-context'
import type { CellEditorBaseProps } from './cell-editor-types'
import { isSingleLineCommitKey, openForeignKeyLookupFromKey } from './cell-editor-keys'

function isDropdownPortalTarget(node: Node | null): boolean {
  if (!(node instanceof HTMLElement)) return false
  return node.getAttribute('role') === 'listbox' || node.closest('[role="listbox"]') !== null
}

function isFocusInsideEnumEditor(wrapper: HTMLDivElement | null, target: EventTarget | null) {
  if (!(target instanceof Node)) return false
  return isTargetInside(wrapper, target) || isDropdownPortalTarget(target)
}

function buildEnumOptions(enumValues: string[], isNullable: boolean): DropdownOption[] {
  const valueOptions = enumValues.map((enumValue) => ({ value: enumValue, label: enumValue }))
  if (!isNullable) return valueOptions
  return [{ value: ENUM_NULL_SENTINEL, label: 'NULL' }, ...valueOptions]
}

function resolveEnumInitialState(props: CellEditorBaseProps) {
  const rawValue = props.row[props.column.key]
  const initialNull = isNullish(rawValue)
  const initialValue = initialNull ? null : String(rawValue)
  return {
    initialNull: initialNull,
    initialValue: initialValue,
    fallbackValue: initialValue ?? getEnumFallbackValue(props.columnMeta),
  }
}

function useEnumValueState(
  props: CellEditorBaseProps,
  triggerRef: RefObject<HTMLButtonElement | null>
) {
  const { row, column, onRowChange } = props
  const fieldName = column.key
  const initial = resolveEnumInitialState(props)
  const { fallbackValue } = initial
  const [isNull, setIsNull] = useState(initial.initialNull)
  const [value, setValue] = useState(fallbackValue)
  const syncToStore = useCellStoreSync(props)

  const handleChange = useCallback(
    (nextValue: string) => {
      setIsNull(false)
      setValue(nextValue)
      onRowChange({ ...row, [fieldName]: nextValue })
      syncToStore(nextValue)
    },
    [onRowChange, row, fieldName, syncToStore]
  )

  const handleToggleNull = useCallback(() => {
    if (!isNull) {
      setIsNull(true)
      onRowChange({ ...row, [fieldName]: null })
      syncToStore(null)
      return
    }
    setIsNull(false)
    setValue(fallbackValue)
    onRowChange({ ...row, [fieldName]: fallbackValue })
    syncToStore(fallbackValue)
    setTimeout(() => triggerRef.current?.focus(), 0)
  }, [fallbackValue, isNull, onRowChange, row, fieldName, syncToStore, triggerRef])

  return {
    initial,
    isNull,
    setIsNull,
    value,
    setValue,
    syncToStore,
    handleChange,
    handleToggleNull,
  }
}

type EnumValueState = ReturnType<typeof useEnumValueState>

function useEnumCommitKeys(props: CellEditorBaseProps, state: EnumValueState) {
  const { row, column, onRowChange, onClose } = props
  const fieldName = column.key
  const foreignKeyLookup = useFkLookup()
  const { isNull, value, setIsNull, setValue, syncToStore } = state
  const { initialNull, initialValue, fallbackValue } = state.initial
  const currentValue = isNull ? null : value
  return useCallback(
    (event: ReactKeyboardEvent) => {
      const lookupRequest = {
        props: props,
        foreignKeyLookup: foreignKeyLookup,
        currentValue: currentValue,
      }
      if (openForeignKeyLookupFromKey(event, lookupRequest)) return
      if (isSingleLineCommitKey(event)) {
        onRowChange({ ...row, [fieldName]: currentValue }, true)
        onClose(true, true)
        event.preventDefault()
        return
      }
      if (event.key !== 'Escape') return
      setIsNull(initialNull)
      setValue(fallbackValue)
      syncToStore(initialValue)
      onClose(false, false)
      event.preventDefault()
    },
    [
      currentValue,
      fallbackValue,
      fieldName,
      foreignKeyLookup,
      initialNull,
      initialValue,
      onClose,
      onRowChange,
      props,
      row,
      setIsNull,
      setValue,
      syncToStore,
    ]
  )
}

function useEnumTriggerBlur(
  onClose: CellEditorBaseProps['onClose'],
  wrapperRef: RefObject<HTMLDivElement | null>
) {
  return useCallback(
    (event: React.FocusEvent<HTMLButtonElement>) => {
      if (isFocusInsideEnumEditor(wrapperRef.current, event.relatedTarget)) return
      queueMicrotask(() => {
        if (isFocusInsideEnumEditor(wrapperRef.current, document.activeElement)) return
        onClose(true, false)
      })
    },
    [onClose, wrapperRef]
  )
}

export function useEnumCellEditor(props: CellEditorBaseProps) {
  const { row, column, onRowChange, onClose } = props
  const fieldName = column.key
  const isNullable = props.isNullable === true
  const triggerRef = useRef<HTMLButtonElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const state = useEnumValueState(props, triggerRef)
  const { setIsNull, syncToStore, handleChange } = state
  const handleCommitKeys = useEnumCommitKeys(props, state)
  const handleTriggerBlur = useEnumTriggerBlur(onClose, wrapperRef)

  useEffect(() => {
    triggerRef.current?.focus()
  }, [])

  const enumValues = props.columnMeta?.enumValues
  const enumOptions = useMemo(
    () => buildEnumOptions(enumValues ?? [], isNullable),
    [enumValues, isNullable]
  )

  const handleDropdownChange = (nextValue: string) => {
    if (nextValue === ENUM_NULL_SENTINEL) {
      setIsNull(true)
      onRowChange({ ...row, [fieldName]: null })
      syncToStore(null)
      onClose(true, true)
      return
    }
    handleChange(nextValue)
    onClose(true, true)
  }

  return {
    triggerRef: triggerRef,
    wrapperRef: wrapperRef,
    isNull: state.isNull,
    value: state.value,
    enumOptions: enumOptions,
    handleDropdownChange: handleDropdownChange,
    handleCommitKeys: handleCommitKeys,
    handleTriggerBlur: handleTriggerBlur,
    handleToggleNull: state.handleToggleNull,
  }
}
