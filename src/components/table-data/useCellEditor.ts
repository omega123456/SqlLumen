/**
 * useCellEditor — shared hook for grid cell editors with NULL toggle support.
 *
 * Encapsulates the common logic shared between NullableCellEditor and
 * DateTimeCellEditor:
 * - Initial value/null state derivation from row data
 * - Focus-on-mount behavior
 * - Store syncing (updateCellValue on value change)
 * - Null toggle logic with temporal pre-fill
 * - Restore original value helper (for Escape handling)
 *
 * The hook does NOT handle Escape key events directly — each consumer
 * implements its own key handling (e.g., DateTimeCellEditor has two-stage
 * Escape: close picker first, then cancel edit).
 *
 * The hook is decoupled from any specific store — it receives its
 * update callbacks as parameters (typically provided via closures in
 * column definitions).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { getTemporalColumnType, getTodayMysqlString } from '../../lib/date-utils'
import { useCellStoreSync } from '../shared/editor-callbacks-context'
import type { TableDataColumnMeta } from '../../types/schema'
import { isNullish } from '../../lib/value-checks'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Props that grid adapters pass to editor components. */
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

/** Callbacks that the hook needs — typically provided via closures in column defs. */
export interface CellEditorCallbacks {
  tabId: string
  updateCellValue: (tabId: string, column: string, value: unknown) => void
  syncCellValue: (
    tabId: string,
    rowData: Record<string, unknown> | undefined,
    column: string,
    value: unknown
  ) => void
}

export interface CellEditorResult {
  /** Current string value (null when the cell is in NULL state). */
  value: string | null
  /** Set the value directly. Prefer handleChange for most cases. */
  setValue: (v: string | null) => void
  /** Whether the cell is currently in NULL state. */
  isNull: boolean
  /** Set the null state directly. Prefer handleToggleNull for most cases. */
  setIsNull: (v: boolean) => void
  /** Toggle NULL on/off. When turning NULL off, temporal columns get today's date. */
  handleToggleNull: () => void
  /** Update the value and sync to the store. Clears NULL state if active. */
  handleChange: (nextValue: string) => void
  /** Restore the original value from when editing started. */
  restoreOriginalValue: () => void
  /** Ref for the text input — auto-focused on mount. */
  inputRef: React.RefObject<HTMLInputElement | null>
  /** Whether the cell started in NULL state. */
  initialNull: boolean
  /** The original value from row data. */
  initialValue: unknown
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

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

export function useCellEditor(
  params: CellEditorParams,
  callbacks: CellEditorCallbacks
): CellEditorResult {
  const columnMeta = params.columnMeta
  const temporalType = getTemporalColumnType(columnMeta.dataType)

  const { row, column, onRowChange } = params
  const fieldName = column.key
  const rawValue = row[fieldName]

  const initialNull = rawValue === null || rawValue === undefined
  const initialValue = initialNull ? null : rawValue
  const initialInputValue = params.initialInputValue
  const startsNull = initialInputValue == null && initialNull

  const [isNull, setIsNull] = useState(startsNull)
  const [value, setValue] = useState<string | null>(initialEditorValue(rawValue, initialInputValue))

  const inputRef = useRef<HTMLInputElement>(null)

  // Resolve callbacks: prefer props when tabId is set, fallback to context
  // (BaseGridView passes NOOP callbacks with tabId='', so editors fall back
  // to the context provided by the wrapper component).
  const syncToStore = useCellStoreSync({
    row: row,
    column: column,
    tabId: callbacks.tabId,
    updateCellValue: callbacks.updateCellValue,
    syncCellValue: callbacks.syncCellValue,
  })

  const selectAllOnFocus = params.selectAllOnFocus ?? true
  useEffect(() => {
    placeCaretOnFocus(inputRef.current, selectAllOnFocus)
  }, [selectAllOnFocus])

  const previewAndSync = useCallback(
    (nextValue: unknown) => {
      onRowChange({ ...row, [fieldName]: nextValue })
      syncToStore(nextValue)
    },
    [fieldName, onRowChange, row, syncToStore]
  )

  const handleChange = useCallback(
    (nextValue: string) => {
      setIsNull(false)
      setValue(nextValue)
      previewAndSync(nextValue)
    },
    [previewAndSync]
  )

  const handleToggleNull = useCallback(() => {
    if (!isNull) {
      setIsNull(true)
      setValue(null)
      previewAndSync(null)
      return
    }
    // Turning NULL off — pre-fill with today's date/time for temporal columns
    const prefill = temporalType ? getTodayMysqlString(temporalType) : ''
    setIsNull(false)
    setValue(prefill)
    previewAndSync(prefill)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [isNull, previewAndSync, temporalType])

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
