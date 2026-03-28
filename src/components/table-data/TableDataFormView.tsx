/**
 * TableDataFormView — editable single-record form for the table data browser.
 *
 * Displays one row at a time with editable inputs for each column.
 * Supports NULL toggle, modified-field indicators, copy-to-clipboard,
 * record navigation (including cross-page), and save/discard actions.
 *
 * Uses the same edit state in the store as the grid view, so switching
 * between views preserves in-progress edits.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  CaretLeft,
  CaretRight,
  CopySimple,
  Info,
  CalendarBlank,
  Clock,
} from '@phosphor-icons/react'
import { useTableDataStore, isSameRowKey } from '../../stores/table-data-store'
import { useConnectionStore } from '../../stores/connection-store'
import { useToastStore } from '../../stores/toast-store'
import { writeClipboardText } from '../../lib/context-menu-utils'
import { getTemporalColumnType, getTodayMysqlString } from '../../lib/date-utils'
import { getTemporalValidationResult } from '../../lib/table-data-save-utils'
import { DateTimePicker } from './DateTimePicker'
import { ENUM_NULL_SENTINEL, getEnumFallbackValue, isEnumColumn } from './enum-field-utils'
import type { TableDataColumnMeta } from '../../types/schema'
import styles from './TableDataFormView.module.css'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a PK-based row key from a positional row array. */
function getRowKeyFromArray(
  row: unknown[],
  columns: TableDataColumnMeta[],
  pkColumns: string[]
): Record<string, unknown> {
  const key: Record<string, unknown> = {}
  for (const pkCol of pkColumns) {
    const idx = columns.findIndex((c) => c.name === pkCol)
    if (idx !== -1) {
      key[pkCol] = row[idx]
    }
  }
  return key
}

/** Build a values map from a positional row array and column metadata. */
function rowToValues(row: unknown[], columns: TableDataColumnMeta[]): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (let i = 0; i < columns.length; i++) {
    values[columns[i].name] = row[i]
  }
  return values
}

/** Format a cell value for display in the form. */
function displayValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined
}

function escapeForAttributeSelector(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }

  return value.replace(/(["\\])/g, '\\$1')
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface TableDataFormViewProps {
  tabId: string
}

export function TableDataFormView({ tabId }: TableDataFormViewProps) {
  const tabState = useTableDataStore((state) => state.tabs[tabId])
  const startEditing = useTableDataStore((state) => state.startEditing)
  const updateCellValue = useTableDataStore((state) => state.updateCellValue)
  const saveCurrentRow = useTableDataStore((state) => state.saveCurrentRow)
  const discardCurrentRow = useTableDataStore((state) => state.discardCurrentRow)
  const requestNavigationAction = useTableDataStore((state) => state.requestNavigationAction)
  const fetchPage = useTableDataStore((state) => state.fetchPage)
  const setSelectedRow = useTableDataStore((state) => state.setSelectedRow)

  // Connection read-only check
  const connectionId = tabState?.connectionId ?? ''
  const activeConnection = useConnectionStore((state) => state.activeConnections[connectionId])
  const isConnectionReadOnly = activeConnection?.profile?.readOnly ?? false

  const columns = tabState?.columns ?? []
  const rows = tabState?.rows ?? []
  const totalRows = tabState?.totalRows ?? 0
  const currentPage = tabState?.currentPage ?? 1
  const totalPages = tabState?.totalPages ?? 1
  const pageSize = tabState?.pageSize ?? 1000
  const primaryKey = tabState?.primaryKey ?? null
  const editState = tabState?.editState ?? null
  const selectedRowKey = tabState?.selectedRowKey ?? null
  const isLoading = tabState?.isLoading ?? false

  const hasPk = primaryKey !== null
  const isEditable = !isConnectionReadOnly && hasPk

  const pkColumns = primaryKey?.keyColumns ?? []

  // --- Date/time picker state ---
  const [openPickerState, setOpenPickerState] = useState<{
    field: string
    anchorEl: HTMLElement
  } | null>(null)

  // --- Focus-tracking ref for first-click-open on temporal fields ---
  // Tracks whether each temporal input was already focused before a click,
  // so the picker only auto-opens on the initial focus-granting click.
  const inputFocusedRef = useRef<Record<string, boolean>>({})

  // Find local index of selected row
  const localIndex = useMemo(() => {
    if (!selectedRowKey || rows.length === 0) return 0
    const idx = rows.findIndex((row) => {
      const key = getRowKeyFromArray(row, columns, pkColumns)
      return isSameRowKey(key, selectedRowKey)
    })
    return idx >= 0 ? idx : 0
  }, [selectedRowKey, rows, columns, pkColumns])

  const absolutePosition = (currentPage - 1) * pageSize + localIndex + 1
  const currentRow = rows.length > 0 ? rows[localIndex] : null

  // Determine if this is the very first / last record across all pages
  const isFirstRecord = currentPage === 1 && localIndex === 0
  const isLastRecord = currentPage >= totalPages && localIndex >= rows.length - 1

  // Current row key
  const currentRowKey = useMemo(() => {
    if (editState?.isNewRow) return editState.rowKey
    if (!currentRow || pkColumns.length === 0) return null
    return getRowKeyFromArray(currentRow, columns, pkColumns)
  }, [editState, currentRow, columns, pkColumns])

  // Is the current row being edited?
  const isEditingCurrentRow = useMemo(() => {
    if (!editState || !currentRowKey) return false
    return isSameRowKey(editState.rowKey, currentRowKey)
  }, [editState, currentRowKey])

  // --- Navigation ---

  const navigateRelative = useCallback(
    (direction: -1 | 1) => {
      if (!tabState || isLoading) return

      const absoluteIndex = (currentPage - 1) * pageSize + localIndex
      const newAbsoluteIndex = absoluteIndex + direction

      // Boundary check
      if (newAbsoluteIndex < 0 || newAbsoluteIndex >= totalRows) return

      const newPage = Math.floor(newAbsoluteIndex / pageSize) + 1
      const newLocalIndex = newAbsoluteIndex % pageSize

      const action = async () => {
        if (newPage !== currentPage) {
          await fetchPage(tabId, newPage)
        }
        const updatedState = useTableDataStore.getState().tabs[tabId]
        if (updatedState && updatedState.rows.length > 0) {
          // Use computed index, clamped to actual row count for safety
          const targetIndex = Math.min(newLocalIndex, updatedState.rows.length - 1)
          const targetRow = updatedState.rows[targetIndex]
          if (targetRow) {
            const newKey = getRowKeyFromArray(targetRow, updatedState.columns, pkColumns)
            setSelectedRow(tabId, newKey)
          }
        }
      }

      requestNavigationAction(tabId, action)
    },
    [
      tabState,
      isLoading,
      localIndex,
      currentPage,
      pageSize,
      totalRows,
      tabId,
      fetchPage,
      pkColumns,
      setSelectedRow,
      requestNavigationAction,
    ]
  )

  const navigatePrevious = useCallback(() => navigateRelative(-1), [navigateRelative])
  const navigateNext = useCallback(() => navigateRelative(1), [navigateRelative])

  // --- Editing ---

  const ensureEditing = useCallback(
    (rowKey: Record<string, unknown>, row: unknown[]) => {
      if (!isEditable) return
      // If already editing this row, skip
      if (editState && isSameRowKey(editState.rowKey, rowKey)) return
      const values = rowToValues(row, columns)
      startEditing(tabId, rowKey, values)
    },
    [isEditable, editState, columns, startEditing, tabId]
  )

  const handleInputFocus = useCallback(
    (colName: string) => {
      void colName // colName not needed for start editing — just ensure editing
      if (!currentRow || !currentRowKey) return
      ensureEditing(currentRowKey, currentRow)
    },
    [currentRow, currentRowKey, ensureEditing]
  )

  const handleInputChange = useCallback(
    (colName: string, value: string) => {
      if (!currentRow || !currentRowKey) return
      ensureEditing(currentRowKey, currentRow)
      updateCellValue(tabId, colName, value)
    },
    [currentRow, currentRowKey, ensureEditing, updateCellValue, tabId]
  )

  const handleNullToggle = useCallback(
    (col: TableDataColumnMeta) => {
      if (!currentRow || !currentRowKey) return
      ensureEditing(currentRowKey, currentRow)

      // Determine current value for this column
      const currentVal = isEditingCurrentRow
        ? editState?.currentValues[col.name]
        : currentRow[columns.findIndex((c) => c.name === col.name)]

      if (currentVal === null) {
        // Toggling NULL off — use today's date/time for temporal columns
        const temporalType = getTemporalColumnType(col.dataType)
        if (temporalType) {
          updateCellValue(tabId, col.name, getTodayMysqlString(temporalType))
        } else if (isEnumColumn(col)) {
          updateCellValue(tabId, col.name, getEnumFallbackValue(col))
        } else {
          updateCellValue(tabId, col.name, '')
        }
      } else {
        // Toggling NULL on — close picker if it's open for this field
        if (openPickerState?.field === col.name) {
          setOpenPickerState(null)
        }
        updateCellValue(tabId, col.name, null)
      }
    },
    [
      currentRow,
      currentRowKey,
      ensureEditing,
      isEditingCurrentRow,
      editState,
      columns,
      updateCellValue,
      tabId,
      openPickerState,
    ]
  )

  const handleCopy = useCallback(async (value: unknown) => {
    const text = value === null || value === undefined ? 'NULL' : displayValue(value)
    try {
      await writeClipboardText(text)
    } catch {
      // Clipboard unavailable — silently fail
    }
  }, [])

  const showError = useToastStore((s) => s.showError)
  const showSuccess = useToastStore((s) => s.showSuccess)

  const handleSave = useCallback(async () => {
    const validationError = getTemporalValidationResult(editState, columns)
    if (validationError) {
      showError('Invalid date value', `${validationError.columnName}: ${validationError.error}`)
      // Focus the problematic field
      const input = document.querySelector(
        `[data-testid="form-input-${escapeForAttributeSelector(validationError.columnName)}"]`
      ) as HTMLElement
      input?.focus()
      return // Block save
    }

    await saveCurrentRow(tabId)
    const newState = useTableDataStore.getState().tabs[tabId]
    if (newState?.saveError) {
      showError('Save failed', newState.saveError)
      return
    }

    // Show success toast if no saveError (check state after save)
    if (newState && !newState.saveError && !newState.editState) {
      showSuccess('Row saved', 'Changes saved successfully.')
    }
  }, [saveCurrentRow, tabId, editState, columns, showError, showSuccess])

  const handleDiscard = useCallback(() => {
    discardCurrentRow(tabId)
  }, [discardCurrentRow, tabId])

  // --- Derived state ---

  const hasModifications = editState !== null && editState.modifiedColumns.size > 0
  const canSave = isEditingCurrentRow && hasModifications
  const canDiscard = isEditingCurrentRow && editState !== null

  // Empty state
  if (rows.length === 0 && !isLoading) {
    return (
      <div className={styles.formView} data-testid="table-data-form-view">
        <div className={styles.emptyState}>No rows to display</div>
      </div>
    )
  }

  return (
    <div className={styles.formView} data-testid="table-data-form-view">
      {/* Record navigation header */}
      <div className={styles.recordNav} data-testid="form-record-nav">
        <h2 className={styles.recordTitle}>
          Record {absolutePosition} of {totalRows}
        </h2>

        <div className={styles.navGroup}>
          <div className={styles.navButtonGroup}>
            <button
              type="button"
              className={styles.navButton}
              disabled={isFirstRecord || isLoading}
              onClick={navigatePrevious}
              aria-label="Previous record"
              data-testid="btn-form-previous"
            >
              <CaretLeft size={14} weight="bold" />
              <span>Previous</span>
            </button>
            <button
              type="button"
              className={styles.navButton}
              disabled={isLastRecord || isLoading}
              onClick={navigateNext}
              aria-label="Next record"
              data-testid="btn-form-next"
            >
              <span>Next</span>
              <CaretRight size={14} weight="bold" />
            </button>
          </div>

          <div className={styles.formButtons}>
            <button
              type="button"
              className={styles.discardButton}
              disabled={!canDiscard}
              onClick={handleDiscard}
              data-testid="btn-form-discard"
            >
              Discard
            </button>
            <button
              type="button"
              className={styles.saveButton}
              disabled={!canSave}
              onClick={handleSave}
              data-testid="btn-form-save"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable form fields */}
      <div className={styles.formContent}>
        <div className={styles.formCard}>
          {columns.map((col, colIdx) => {
            // Determine the value to display
            const rawValue =
              isEditingCurrentRow && editState
                ? editState.currentValues[col.name]
                : currentRow
                  ? currentRow[colIdx]
                  : null

            const isNull = isNullish(rawValue)
            const isModified = isEditingCurrentRow
              ? (editState?.modifiedColumns.has(col.name) ?? false)
              : false
            const isBlobField = col.isBinary
            const isNullable = col.isNullable
            const isPk = col.isPrimaryKey
            const isUnique = col.isUniqueKey && !col.isPrimaryKey
            const isFieldReadonly = isBlobField || !isEditable
            const temporalType = getTemporalColumnType(col.dataType)
            const isTemporalEditable = temporalType !== null && !isFieldReadonly && !isBlobField
            const isEnumEditable = isEnumColumn(col) && !isFieldReadonly && !isBlobField

            // Label suffix
            let labelSuffix = ''
            if (isPk) labelSuffix = '(Primary Key)'
            else if (isUnique) labelSuffix = '(Unique Key)'

            return (
              <div
                key={col.name}
                className={styles.fieldGroup}
                data-testid={`form-field-${col.name}`}
              >
                {/* Label row */}
                <div className={styles.fieldLabelRow}>
                  <span className={styles.fieldLabel}>{col.name.toUpperCase()}</span>
                  {labelSuffix && <span className={styles.fieldLabelSuffix}>{labelSuffix}</span>}
                  {isNullable && isEditable && !isBlobField && (
                    <button
                      type="button"
                      className={`${styles.fieldNullBtn} ${isNull ? styles.fieldNullBtnActive : ''}`}
                      onClick={() => handleNullToggle(col)}
                      data-testid={`btn-form-null-${col.name}`}
                    >
                      NULL
                    </button>
                  )}
                </div>

                {/* Input row */}
                <div className={styles.fieldInputRow}>
                  {isBlobField ? (
                    <div
                      className={styles.fieldBlobReadonly}
                      data-testid={`form-input-${col.name}`}
                    >
                      {rawValue != null ? String(rawValue) : '(BLOB data)'}
                    </div>
                  ) : isFieldReadonly ? (
                    <div
                      className={styles.fieldInputReadonly}
                      data-testid={`form-input-${col.name}`}
                    >
                      {isNull ? 'NULL' : displayValue(rawValue)}
                    </div>
                  ) : isEnumEditable ? (
                    <select
                      className={[
                        styles.fieldInput,
                        styles.fieldSelect,
                        isModified ? styles.fieldInputModified : '',
                        isNull ? styles.fieldInputNull : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      value={isNull ? '' : displayValue(rawValue)}
                      onFocus={() => handleInputFocus(col.name)}
                      onChange={(e) => {
                        const nextValue = e.target.value
                        if (nextValue === ENUM_NULL_SENTINEL) {
                          if (!currentRow || !currentRowKey) return
                          ensureEditing(currentRowKey, currentRow)
                          updateCellValue(tabId, col.name, null)
                          return
                        }
                        handleInputChange(col.name, nextValue)
                      }}
                      data-testid={`form-input-${col.name}`}
                    >
                      {col.isNullable && <option value={ENUM_NULL_SENTINEL}>NULL</option>}
                      {col.enumValues.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      className={[
                        styles.fieldInput,
                        isModified ? styles.fieldInputModified : '',
                        isNull ? styles.fieldInputNull : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      value={displayValue(rawValue)}
                      onFocus={() => {
                        handleInputFocus(col.name)
                        // Mark as focused AFTER the focus event fires so the
                        // onClick handler can distinguish first-click vs re-click.
                        // Use setTimeout(0) so the flag is set after the synchronous
                        // onClick that may fire in the same event loop tick.
                        setTimeout(() => {
                          if (isTemporalEditable) {
                            inputFocusedRef.current[col.name] = true
                          }
                        }, 0)
                      }}
                      onBlur={() => {
                        if (isTemporalEditable) {
                          inputFocusedRef.current[col.name] = false
                        }
                      }}
                      onClick={
                        isTemporalEditable
                          ? (e) => {
                              // Don't open picker when the field is NULL
                              if (isNull) return
                              // Open picker only on the click that first grants focus
                              // (i.e., the input was not already focused before this click).
                              if (!inputFocusedRef.current[col.name]) {
                                const anchorEl = (e.currentTarget.parentElement ??
                                  e.currentTarget) as HTMLElement
                                setOpenPickerState({ field: col.name, anchorEl })
                              }
                            }
                          : undefined
                      }
                      onChange={(e) => handleInputChange(col.name, e.target.value)}
                      data-testid={`form-input-${col.name}`}
                    />
                  )}

                  {isTemporalEditable && (
                    <button
                      type="button"
                      className={styles.fieldCalendarBtn}
                      disabled={isNull}
                      onClick={(e) => {
                        if (isNull) return
                        const anchorEl = (e.currentTarget.parentElement ??
                          e.currentTarget) as HTMLElement
                        setOpenPickerState({ field: col.name, anchorEl })
                      }}
                      data-testid={`calendar-btn-${col.name}`}
                      aria-label={temporalType === 'TIME' ? 'Open time picker' : 'Open date picker'}
                    >
                      {temporalType === 'TIME' ? <Clock size={14} /> : <CalendarBlank size={14} />}
                    </button>
                  )}

                  <button
                    type="button"
                    className={styles.fieldCopyBtn}
                    onClick={() => handleCopy(rawValue)}
                    title={`Copy ${col.name}`}
                    aria-label={`Copy ${col.name}`}
                    data-testid={`btn-form-copy-${col.name}`}
                  >
                    <CopySimple size={14} />
                  </button>
                </div>

                {/* Date/time picker popup (rendered via portal) */}
                {openPickerState?.field === col.name && temporalType && (
                  <DateTimePicker
                    value={isNullish(rawValue) ? null : displayValue(rawValue)}
                    columnType={temporalType}
                    disabled={isNull}
                    anchorEl={openPickerState.anchorEl}
                    onApply={(val) => {
                      handleInputChange(col.name, val)
                      setOpenPickerState(null)
                    }}
                    onCancel={() => setOpenPickerState(null)}
                  />
                )}

                {/* Modified indicator */}
                {isModified && (
                  <div className={styles.fieldModifiedNote}>
                    <Info size={14} weight="fill" className={styles.fieldModifiedNoteIcon} />
                    <span>Unsaved change detected</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
