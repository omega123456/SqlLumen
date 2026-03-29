/**
 * Form view — displays one row at a time from the query result.
 *
 * When edit mode is active (`editMode !== null`), columns that match the
 * selected table are rendered as editable inputs with NULL toggle and
 * modified-field indicators. Non-editable columns display with a lock icon.
 *
 * Record navigation (Previous / Next) auto-saves pending edits via
 * requestNavigationAction before moving to the next record.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  CaretLeft,
  CaretRight,
  CopySimple,
  LockSimple,
  Info,
  FloppyDisk,
  CalendarBlank,
  Clock,
} from '@phosphor-icons/react'
import { writeClipboardText } from '../../lib/context-menu-utils'
import { formatCellValue } from '../../lib/result-cell-utils'
import { getTemporalColumnType, getTodayMysqlString } from '../../lib/date-utils'
import type { TemporalColumnType } from '../../lib/date-utils'
import { useQueryStore } from '../../stores/query-store'
import {
  isEnumColumn,
  ENUM_NULL_SENTINEL,
  getEnumFallbackValue,
} from '../table-data/enum-field-utils'
import { DateTimePicker } from '../table-data/DateTimePicker'
import type { ColumnMeta, TableDataColumnMeta, RowEditState } from '../../types/schema'
import styles from './ResultFormView.module.css'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined
}

function displayValueStr(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ResultFormViewProps {
  columns: ColumnMeta[]
  /** Current page rows — array of arrays, indexed by column position. */
  rows: Array<Array<unknown>>
  /** Absolute index within the full result set (0-based), or null for first row. */
  selectedRowIndex: number | null
  totalRows: number
  currentPage: number
  totalPages: number
  /** Called with 'prev' or 'next' — parent handles page fetching + setSelectedRow. */
  onNavigate: (direction: 'prev' | 'next') => void
  tabId: string

  // --- Edit mode props (optional — null/empty when not in edit mode) ---

  /** Selected table name for editing, or null for read-only. */
  editMode?: string | null
  /** Column index → editable boolean for the selected edit table. */
  editableColumnMap?: Map<number, boolean>
  /** Current row edit state. */
  editState?: RowEditState | null
  /** Page-local row index of the editing row. */
  editingRowIndex?: number | null
  /** Column metadata from the edit table (for cell editor selection). */
  editTableColumns?: TableDataColumnMeta[]
  /** Start editing a row by its page-local index. */
  onStartEdit?: (rowIndex: number) => void
  /** Update a cell value in the edit state. */
  onUpdateCell?: (columnName: string, value: unknown) => void
  /** Save current row. */
  onSaveRow?: () => Promise<boolean>
  /** Discard current row edits. */
  onDiscardRow?: () => void
}

const EMPTY_EDITABLE_MAP = new Map<number, boolean>()
const EMPTY_TABLE_COLUMNS: TableDataColumnMeta[] = []

export function ResultFormView({
  columns,
  rows,
  selectedRowIndex,
  totalRows,
  currentPage,
  totalPages,
  onNavigate,
  tabId,
  editMode = null,
  editableColumnMap = EMPTY_EDITABLE_MAP,
  editState = null,
  editingRowIndex = null,
  editTableColumns = EMPTY_TABLE_COLUMNS,
  onStartEdit,
  onUpdateCell,
  onSaveRow,
  onDiscardRow,
}: ResultFormViewProps) {
  // Read pageSize from the store to compute the local row offset
  const pageSize = useQueryStore((state) => state.tabs[tabId]?.pageSize ?? 1000)

  // --- Date/time picker state ---
  const [openPickerState, setOpenPickerState] = useState<{
    field: string
    anchorEl: HTMLElement
  } | null>(null)

  // Focus-tracking ref for first-click-open on temporal fields
  const inputFocusedRef = useRef<Record<string, boolean>>({})

  const absoluteIndex = selectedRowIndex ?? 0
  const displayRecord = absoluteIndex + 1

  // Map absolute index to local index within the current page
  const pageStartOffset = (currentPage - 1) * pageSize
  const localIndex = absoluteIndex - pageStartOffset
  const clampedLocal = Math.max(0, Math.min(localIndex, rows.length - 1))
  const currentRow = rows.length > 0 ? (rows[clampedLocal] ?? []) : []

  const canGoPrev = absoluteIndex > 0
  const canGoNext = absoluteIndex < totalRows - 1

  const isInEditMode = editMode !== null

  // Suppress lint: totalPages is used for display / future guard
  void totalPages

  // Build table column lookup for enum/nullable info
  const tableColLookup = useMemo(() => {
    const map = new Map<string, TableDataColumnMeta>()
    for (const tc of editTableColumns) {
      map.set(tc.name.toLowerCase(), tc)
    }
    return map
  }, [editTableColumns])

  // Is the current row being actively edited?
  const isEditingCurrentRow = editState !== null && editingRowIndex === clampedLocal

  const hasModifications = isEditingCurrentRow && editState!.modifiedColumns.size > 0

  // --- Handlers ---

  const handleCopy = useCallback(async (value: unknown) => {
    const { displayValue } = formatCellValue(value)
    try {
      await writeClipboardText(displayValue)
    } catch (err) {
      console.warn('[result-form-view] clipboard write failed:', err)
    }
  }, [])

  const ensureEditing = useCallback(() => {
    if (!isInEditMode || !onStartEdit) return
    // If not already editing this row, start
    if (editingRowIndex !== clampedLocal) {
      onStartEdit(clampedLocal)
    }
  }, [isInEditMode, onStartEdit, editingRowIndex, clampedLocal])

  const handleInputFocus = useCallback(() => {
    ensureEditing()
  }, [ensureEditing])

  const handleInputChange = useCallback(
    (colName: string, value: string) => {
      ensureEditing()
      onUpdateCell?.(colName, value)
    },
    [ensureEditing, onUpdateCell]
  )

  const handleNullToggle = useCallback(
    (col: ColumnMeta, colIndex: number) => {
      ensureEditing()
      if (!onUpdateCell) return

      const tableCol = tableColLookup.get(col.name.toLowerCase())

      // Determine current value
      const currentVal =
        isEditingCurrentRow && editState ? editState.currentValues[col.name] : currentRow[colIndex]

      if (currentVal === null) {
        // Toggling NULL off — choose appropriate default value
        const temporalType: TemporalColumnType = tableCol
          ? getTemporalColumnType(tableCol.dataType)
          : null
        if (temporalType) {
          onUpdateCell(col.name, getTodayMysqlString(temporalType))
        } else if (tableCol && isEnumColumn(tableCol)) {
          onUpdateCell(col.name, getEnumFallbackValue(tableCol))
        } else {
          onUpdateCell(col.name, '')
        }
      } else {
        // Toggling NULL on — close picker if open for this field
        if (openPickerState?.field === col.name) {
          setOpenPickerState(null)
        }
        onUpdateCell(col.name, null)
      }
    },
    [
      ensureEditing,
      onUpdateCell,
      tableColLookup,
      isEditingCurrentRow,
      editState,
      currentRow,
      openPickerState,
    ]
  )

  const handleSave = useCallback(async () => {
    if (onSaveRow) {
      await onSaveRow()
    }
  }, [onSaveRow])

  const handleDiscard = useCallback(() => {
    onDiscardRow?.()
  }, [onDiscardRow])

  /** Wrap navigation with auto-save when in edit mode (plan: auto-save, not prompt). */
  const handleNavigate = useCallback(
    async (direction: 'prev' | 'next') => {
      if (isInEditMode && editState) {
        if (editState.modifiedColumns.size > 0 && onSaveRow) {
          // Auto-save pending modifications before navigating
          const success = await onSaveRow()
          if (!success) {
            // Save failed — stay on current record
            return
          }
        } else {
          // Active edit state with no modifications — discard silently
          onDiscardRow?.()
        }
      }
      onNavigate(direction)
    },
    [isInEditMode, editState, onSaveRow, onDiscardRow, onNavigate]
  )

  return (
    <div className={styles.container} data-testid="result-form-view">
      {/* Record navigation header */}
      <div className={styles.header}>
        <h2 className={styles.recordTitle}>
          Record {displayRecord} of {totalRows}
        </h2>
        <div className={styles.navGroup}>
          <div className={styles.navigation}>
            <button
              type="button"
              className={styles.navButton}
              disabled={!canGoPrev}
              onClick={() => handleNavigate('prev')}
              aria-label="Previous record"
              data-testid="prev-record-button"
            >
              <CaretLeft size={14} weight="bold" />
              <span>Previous</span>
            </button>
            <button
              type="button"
              className={styles.navButton}
              disabled={!canGoNext}
              onClick={() => handleNavigate('next')}
              aria-label="Next record"
              data-testid="next-record-button"
            >
              <span>Next</span>
              <CaretRight size={14} weight="bold" />
            </button>
          </div>

          {/* Save/Discard buttons — visible only in edit mode with active edits */}
          {isInEditMode && isEditingCurrentRow && (
            <div className={styles.formButtons} data-testid="form-edit-actions">
              <button
                type="button"
                className={styles.discardButton}
                disabled={!isEditingCurrentRow}
                onClick={handleDiscard}
                data-testid="form-discard-button"
              >
                Discard
              </button>
              <button
                type="button"
                className={styles.saveButton}
                disabled={!hasModifications}
                onClick={handleSave}
                data-testid="form-save-button"
              >
                <FloppyDisk size={14} weight="regular" />
                <span>Save Changes</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Field list — card container */}
      <div className={styles.card}>
        {columns.map((col, i) => {
          const isEditable = isInEditMode && editableColumnMap.get(i) === true
          const tableCol = tableColLookup.get(col.name.toLowerCase())
          const isNullable = tableCol?.isNullable ?? false
          const isEnum = tableCol ? isEnumColumn(tableCol) : false
          const temporalType: TemporalColumnType = tableCol
            ? getTemporalColumnType(tableCol.dataType)
            : null
          const isTemporalEditable = temporalType !== null && isEditable

          // Determine value: use edit state if editing this row, otherwise raw
          const rawValue =
            isEditingCurrentRow && editState ? editState.currentValues[col.name] : currentRow[i]

          const isNull = isNullish(rawValue)
          const isModified =
            isEditingCurrentRow && editState ? editState.modifiedColumns.has(col.name) : false

          // For read-only display (when not editable or not in edit mode)
          const { displayValue: readOnlyDisplay, isNull: isNullDisplay } = formatCellValue(
            isEditingCurrentRow && editState ? editState.currentValues[col.name] : currentRow[i]
          )

          return (
            <div
              key={`${col.name}-${i}`}
              className={`${styles.field} ${isInEditMode && !isEditable ? styles.fieldNonEditable : ''}`}
              data-testid={`form-field-${i}`}
            >
              {/* Label row */}
              <div className={styles.fieldLabelRow}>
                <label className={styles.fieldLabel}>
                  {isInEditMode && !isEditable && (
                    <LockSimple
                      size={10}
                      weight="bold"
                      className={styles.lockIcon}
                      data-testid={`lock-icon-${i}`}
                    />
                  )}
                  {col.name.toUpperCase()}
                </label>
                {isModified && (
                  <span className={styles.modifiedDot} data-testid={`modified-indicator-${i}`} />
                )}
                {isEditable && isNullable && (
                  <button
                    type="button"
                    className={`${styles.nullToggle} ${isNull ? styles.nullToggleActive : ''}`}
                    onClick={() => handleNullToggle(col, i)}
                    data-testid={`null-toggle-${i}`}
                    aria-label={`Toggle NULL for ${col.name}`}
                  >
                    NULL
                  </button>
                )}
              </div>

              {/* Value / Input row */}
              <div className={styles.fieldValueRow}>
                {isEditable ? (
                  // --- Editable field ---
                  isEnum && tableCol ? (
                    <select
                      className={`${styles.fieldInput} ${styles.fieldSelect} ${isModified ? styles.fieldInputModified : ''} ${isNull ? styles.fieldInputNull : ''}`}
                      value={isNull ? ENUM_NULL_SENTINEL : displayValueStr(rawValue)}
                      onFocus={handleInputFocus}
                      onChange={(e) => {
                        const nextValue = e.target.value
                        if (nextValue === ENUM_NULL_SENTINEL) {
                          ensureEditing()
                          onUpdateCell?.(col.name, null)
                          return
                        }
                        handleInputChange(col.name, nextValue)
                      }}
                      data-testid={`form-input-${i}`}
                    >
                      {isNullable && <option value={ENUM_NULL_SENTINEL}>NULL</option>}
                      {(tableCol.enumValues ?? []).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      className={`${styles.fieldInput} ${isModified ? styles.fieldInputModified : ''} ${isNull ? styles.fieldInputNull : ''}`}
                      value={isNull ? '' : displayValueStr(rawValue)}
                      placeholder={isNull ? 'NULL' : ''}
                      onFocus={() => {
                        handleInputFocus()
                        // Track focus state for temporal first-click-open
                        if (isTemporalEditable) {
                          setTimeout(() => {
                            inputFocusedRef.current[col.name] = true
                          }, 0)
                        }
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
                              if (!inputFocusedRef.current[col.name]) {
                                const anchorEl = (e.currentTarget.parentElement ??
                                  e.currentTarget) as HTMLElement
                                setOpenPickerState({ field: col.name, anchorEl })
                              }
                            }
                          : undefined
                      }
                      onChange={(e) => handleInputChange(col.name, e.target.value)}
                      data-testid={`form-input-${i}`}
                    />
                  )
                ) : (
                  // --- Read-only field ---
                  <span
                    className={`${styles.fieldValue} ${isNullDisplay ? styles.nullValue : ''}`}
                    data-testid={`field-value-${i}`}
                  >
                    {readOnlyDisplay}
                  </span>
                )}

                {/* Calendar/clock button for temporal editable fields */}
                {isTemporalEditable && (
                  <button
                    type="button"
                    className={styles.calendarButton}
                    disabled={isNull}
                    onClick={(e) => {
                      if (isNull) return
                      const anchorEl = (e.currentTarget.parentElement ??
                        e.currentTarget) as HTMLElement
                      setOpenPickerState({ field: col.name, anchorEl })
                    }}
                    data-testid={`calendar-btn-${i}`}
                    aria-label={temporalType === 'TIME' ? 'Open time picker' : 'Open date picker'}
                  >
                    {temporalType === 'TIME' ? <Clock size={14} /> : <CalendarBlank size={14} />}
                  </button>
                )}

                <button
                  type="button"
                  className={styles.copyButton}
                  onClick={() => handleCopy(rawValue)}
                  title={`Copy ${col.name}`}
                  aria-label={`Copy ${col.name}`}
                  data-testid={`copy-field-${i}`}
                >
                  <CopySimple size={14} />
                </button>
              </div>

              {/* Date/time picker popup (rendered via portal) */}
              {openPickerState?.field === col.name && temporalType && (
                <DateTimePicker
                  value={isNullish(rawValue) ? null : displayValueStr(rawValue)}
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

              {/* Modified indicator note */}
              {isModified && (
                <div className={styles.modifiedNote} data-testid={`modified-note-${i}`}>
                  <Info size={14} weight="fill" className={styles.modifiedNoteIcon} />
                  <span>Unsaved change detected</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
