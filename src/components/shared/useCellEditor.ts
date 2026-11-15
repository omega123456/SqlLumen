import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { getTemporalColumnType, getTodayMysqlString } from '../../lib/date-utils'
import { useCellStoreSync } from './editor-callbacks-context'
import type { EditorCallbacksContextType } from './editor-callbacks-context'
import type { TableDataColumnMeta } from '../../types/schema'
import { isNullish } from '../../lib/value-checks'

export interface GridEditorProps {
  row: Record<string, unknown>
  column: { key: string }
  onRowChange: (row: Record<string, unknown>, commitChanges?: boolean) => void
  onClose: (commitChanges?: boolean, shouldFocusCell?: boolean) => void
}

export interface CellEditorParams extends GridEditorProps {
  isNullable: boolean
  columnMeta: TableDataColumnMeta
  initialInputValue?: string
  selectAllOnFocus?: boolean
}

export interface CellEditorResult {
  value: string | null
  setValue: (v: string | null) => void
  isNull: boolean
  setIsNull: (v: boolean) => void
  handleToggleNull: () => void
  handleChange: (nextValue: string) => void
  restoreOriginalValue: () => void
  inputRef: React.RefObject<HTMLInputElement | null>
  initialNull: boolean
  initialValue: unknown
}

function initialEditorValue(
  rawValue: unknown,
  initialInputValue: string | undefined
): string | null {
  if (initialInputValue != null) return initialInputValue
  if (isNullish(rawValue)) return null
  return String(rawValue)
}

function placeCaretOnFocus(input: HTMLInputElement | null, selectAll: boolean): void {
  input?.focus()
  if (selectAll) {
    input?.select()
    return
  }
  const currentLength = (input?.value ?? '').length
  input?.setSelectionRange(currentLength, currentLength)
}

function usePreviewAndSync(params: CellEditorParams, callbacks: EditorCallbacksContextType) {
  const { row, column, onRowChange } = params
  const fieldName = column.key
  const syncToStore = useCellStoreSync({
    row: row,
    column: column,
    tabId: callbacks.tabId,
    updateCellValue: callbacks.updateCellValue,
    syncCellValue: callbacks.syncCellValue,
  })
  return useCallback(
    (nextValue: unknown) => {
      onRowChange({ ...row, [fieldName]: nextValue })
      syncToStore(nextValue)
    },
    [fieldName, onRowChange, row, syncToStore]
  )
}

interface NullToggleInputs {
  isNull: boolean
  setIsNull: (isNull: boolean) => void
  setValue: (value: string | null) => void
  previewAndSync: (nextValue: unknown) => void
  temporalType: ReturnType<typeof getTemporalColumnType>
}

function useNullToggle(inputs: NullToggleInputs, inputRef: RefObject<HTMLInputElement | null>) {
  const { isNull, setIsNull, setValue, previewAndSync, temporalType } = inputs
  return useCallback(() => {
    if (!isNull) {
      setIsNull(true)
      setValue(null)
      previewAndSync(null)
      return
    }
    const prefill = temporalType ? getTodayMysqlString(temporalType) : ''
    setIsNull(false)
    setValue(prefill)
    previewAndSync(prefill)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [isNull, previewAndSync, temporalType, setIsNull, setValue, inputRef])
}

export function useCellEditor(
  params: CellEditorParams,
  callbacks: EditorCallbacksContextType
): CellEditorResult {
  const temporalType = getTemporalColumnType(params.columnMeta.dataType)
  const rawValue = params.row[params.column.key]
  const initialNull = rawValue === null || rawValue === undefined
  const initialValue = initialNull ? null : rawValue
  const initialInputValue = params.initialInputValue
  const startsNull = initialInputValue == null && initialNull
  const [isNull, setIsNull] = useState(startsNull)
  const [value, setValue] = useState<string | null>(initialEditorValue(rawValue, initialInputValue))
  const inputRef = useRef<HTMLInputElement>(null)
  const previewAndSync = usePreviewAndSync(params, callbacks)

  const selectAllOnFocus = params.selectAllOnFocus ?? true
  useEffect(() => {
    placeCaretOnFocus(inputRef.current, selectAllOnFocus)
  }, [selectAllOnFocus])

  const handleChange = useCallback(
    (nextValue: string) => {
      setIsNull(false)
      setValue(nextValue)
      previewAndSync(nextValue)
    },
    [previewAndSync]
  )
  const handleToggleNull = useNullToggle(
    {
      isNull: isNull,
      setIsNull: setIsNull,
      setValue: setValue,
      previewAndSync: previewAndSync,
      temporalType: temporalType,
    },
    inputRef
  )
  const restoreOriginalValue = useCallback(() => {
    setIsNull(initialNull)
    setValue(initialEditorValue(initialValue, undefined))
    previewAndSync(initialValue)
  }, [initialNull, initialValue, previewAndSync])

  return {
    value,
    setValue,
    isNull,
    setIsNull,
    handleToggleNull,
    handleChange,
    restoreOriginalValue,
    inputRef,
    initialNull,
    initialValue,
  }
}
