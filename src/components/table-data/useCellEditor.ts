/**
 * useCellEditor — shared hook for react-data-grid cell editors with NULL toggle support.
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
import type { TableDataColumnMeta } from '../../types/schema'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Props that react-data-grid passes to editor components. */
export interface RdgEditorProps {
  row: Record<string, unknown>
  column: { key: string }
  onRowChange: (row: Record<string, unknown>, commitChanges?: boolean) => void
  onClose: (commitChanges?: boolean, shouldFocusCell?: boolean) => void
}

export interface CellEditorParams extends RdgEditorProps {
  isNullable: boolean
  columnMeta: TableDataColumnMeta
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

export function useCellEditor(
  params: CellEditorParams,
  callbacks: CellEditorCallbacks
): CellEditorResult {
  const col = params.columnMeta
  const temporalType = getTemporalColumnType(col.dataType)

  const { row, column, onRowChange } = params
  const fieldName = column.key
  const rawValue = row[fieldName]

  const initialNull = rawValue === null || rawValue === undefined
  const initialValue = initialNull ? null : rawValue

  const [isNull, setIsNull] = useState(initialNull)
  const [value, setValue] = useState<string | null>(initialNull ? null : String(rawValue ?? ''))

  const inputRef = useRef<HTMLInputElement>(null)

  const { updateCellValue, syncCellValue, tabId } = callbacks

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
      // Preview change in grid
      onRowChange({ ...row, [fieldName]: nextValue })
      // Sync to store
      if (tabId && fieldName) {
        updateCellValue(tabId, fieldName, nextValue)
        syncCellValue(tabId, row, fieldName, nextValue)
      }
    },
    [fieldName, onRowChange, row, syncCellValue, tabId, updateCellValue]
  )

  const handleToggleNull = useCallback(() => {
    if (isNull) {
      // Turning NULL off — pre-fill with today's date/time for temporal columns
      const prefill = temporalType ? getTodayMysqlString(temporalType) : ''
      setIsNull(false)
      setValue(prefill)
      // Preview change in grid
      onRowChange({ ...row, [fieldName]: prefill })
      if (tabId && fieldName) {
        updateCellValue(tabId, fieldName, prefill)
        syncCellValue(tabId, row, fieldName, prefill)
      }
      setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      // Turning NULL on
      setIsNull(true)
      setValue(null)
      // Preview change in grid
      onRowChange({ ...row, [fieldName]: null })
      if (tabId && fieldName) {
        updateCellValue(tabId, fieldName, null)
        syncCellValue(tabId, row, fieldName, null)
      }
    }
  }, [fieldName, isNull, onRowChange, row, syncCellValue, tabId, temporalType, updateCellValue])

  const restoreOriginalValue = useCallback(() => {
    setIsNull(initialNull)
    setValue(initialNull ? null : String(initialValue ?? ''))
    // Preview restored value in grid
    onRowChange({ ...row, [fieldName]: initialValue })
    if (tabId && fieldName) {
      updateCellValue(tabId, fieldName, initialValue)
      syncCellValue(tabId, row, fieldName, initialValue)
    }
  }, [
    fieldName,
    initialNull,
    initialValue,
    onRowChange,
    row,
    syncCellValue,
    tabId,
    updateCellValue,
  ])

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
