/**
 * useCellEditor — shared hook for AG Grid cell editors with NULL toggle support.
 *
 * Encapsulates the common logic shared between NullableCellEditor and
 * DateTimeCellEditor:
 * - Initial value/null state derivation from AG Grid params
 * - useImperativeHandle for the AG Grid cell editor interface
 * - Focus-on-mount behavior
 * - Store syncing (updateCellValue on value change)
 * - Null toggle logic with temporal pre-fill
 * - Restore original value helper (for Escape handling)
 *
 * The hook does NOT handle Escape key events directly — each consumer
 * implements its own key handling (e.g., DateTimeCellEditor has two-stage
 * Escape: close picker first, then cancel edit).
 */

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { ICellEditorParams } from 'ag-grid-community'
import { useTableDataStore } from '../../stores/table-data-store'
import { getTemporalColumnType, getTodayMysqlString } from '../../lib/date-utils'
import type { TableDataColumnMeta } from '../../types/schema'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CellEditorParams extends ICellEditorParams {
  isNullable: boolean
  columnMeta: TableDataColumnMeta
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
  /** The original value from AG Grid params. */
  initialValue: unknown
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCellEditor(
  params: CellEditorParams,
  ref: React.ForwardedRef<unknown>
): CellEditorResult {
  const col = params.columnMeta
  const temporalType = getTemporalColumnType(col.dataType)

  const initialNull = params.value === null || params.value === undefined
  const initialValue = initialNull ? null : params.value

  const [isNull, setIsNull] = useState(initialNull)
  const [value, setValue] = useState<string | null>(initialNull ? null : String(params.value ?? ''))

  const inputRef = useRef<HTMLInputElement>(null)

  const updateCellValue = useTableDataStore((state) => state.updateCellValue)
  const syncCellValue = useTableDataStore((state) => state.syncCellValue)
  const fieldName = params.colDef?.field
  const tabId = params.context?.tabId as string | undefined

  // Expose AG Grid cell editor interface
  useImperativeHandle(ref, () => ({
    getValue: () => (isNull ? null : value),
    isCancelBeforeStart: () => false,
    isCancelAfterEnd: () => false,
  }))

  // Auto-focus the text input on mount
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  const handleChange = useCallback(
    (nextValue: string) => {
      // setIsNull(false) is idempotent — safe to call even when already non-null
      setIsNull(false)
      setValue(nextValue)
      if (tabId && fieldName) {
        updateCellValue(tabId, fieldName, nextValue)
        syncCellValue(tabId, params.data, fieldName, nextValue)
      }
    },
    [fieldName, params.data, syncCellValue, tabId, updateCellValue]
  )

  const handleToggleNull = useCallback(() => {
    if (isNull) {
      // Turning NULL off — pre-fill with today's date/time for temporal columns
      const prefill = temporalType ? getTodayMysqlString(temporalType) : ''
      setIsNull(false)
      setValue(prefill)
      if (tabId && fieldName) {
        updateCellValue(tabId, fieldName, prefill)
        syncCellValue(tabId, params.data, fieldName, prefill)
      }
      setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      // Turning NULL on
      setIsNull(true)
      setValue(null)
      if (tabId && fieldName) {
        updateCellValue(tabId, fieldName, null)
        syncCellValue(tabId, params.data, fieldName, null)
      }
    }
  }, [fieldName, isNull, params.data, syncCellValue, tabId, temporalType, updateCellValue])

  const restoreOriginalValue = useCallback(() => {
    setIsNull(initialNull)
    setValue(initialNull ? null : String(initialValue ?? ''))
    if (tabId && fieldName) {
      updateCellValue(tabId, fieldName, initialValue)
      syncCellValue(tabId, params.data, fieldName, initialValue)
    }
  }, [fieldName, initialNull, initialValue, params.data, syncCellValue, tabId, updateCellValue])

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
