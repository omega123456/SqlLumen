import { logFrontend } from '../../lib/app-log-commands'
/**
 * BaseFormView — shared editable single-record form component.
 *
 * Displays one row at a time with editable inputs for each column.
 * Supports NULL toggle, modified-field indicators, copy-to-clipboard,
 * record navigation, and save/discard actions.
 *
 * This component is store-free — all state comes through props.
 * Consumers adapt their rich edit state into the shared RowEditState shape.
 *
 * Based on the TableDataFormView design.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  CaretLeftIcon,
  CaretRightIcon,
  CopySimpleIcon,
  LockIcon,
  InfoIcon,
  CalendarBlankIcon,
  ClockIcon,
  EyeIcon,
} from '@phosphor-icons/react'
import { Button } from '../common/Button'
import { formatCellValue } from '../../lib/result-cell-utils'
import { writeClipboardText } from '../../lib/context-menu-utils'
import { getTemporalColumnType, getTodayMysqlString } from '../../lib/date-utils'
import { isJsonSqlType } from '../../lib/grid-column-style'
import { Dropdown, type DropdownOption } from '../common/Dropdown'
import { DateTimePicker } from '../table-data/DateTimePicker'
import { TextInput } from '../common/TextInput'
import { FkLookupTriggerButton } from './FkLookupTriggerButton'
import { JsonFormField } from './JsonFormField'
import tiStyles from '../common/TextInput.module.css'
import { ENUM_NULL_SENTINEL } from '../table-data/enum-field-utils'
import { blobPlaceholder, isBlobEnvelope } from '../../lib/blob-utils'
import type {
  BaseFormViewProps,
  GridColumnDescriptor,
  KnownTotalBaseFormViewProps,
  UnknownTotalBaseFormViewProps,
} from '../../types/shared-data-view'
import styles from './BaseFormView.module.css'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a cell value for *input* fields (not display labels).
 *
 * Unlike `formatCellValue()` from result-cell-utils (which returns the string
 * "NULL" for null values, appropriate for read-only display), this helper
 * returns an empty string for null/undefined so that `<input value={…}>` and
 * enum `<Dropdown value={…}>` receive a valid controlled-component value.
 */
function displayValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined
}

function getJsonFormDefaultValue(currentValue: unknown): string {
  if (typeof currentValue === 'string' && currentValue.trim() !== '') {
    return currentValue
  }

  return '{}'
}

function getBlobFieldDisplayValue(value: unknown): string {
  if (value == null) return '(BLOB data)'
  if (typeof value === 'string') return value
  if (isBlobEnvelope(value)) {
    if (value.kind === 'null') return '(BLOB data)'
    if (value.kind === 'empty') return blobPlaceholder(0, true)
    if (typeof value.base64 === 'string') {
      const padding = value.base64.endsWith('==') ? 2 : value.base64.endsWith('=') ? 1 : 0
      const byteLength = Math.max(0, Math.floor((value.base64.length * 3) / 4) - padding)
      return blobPlaceholder(byteLength, true)
    }
  }
  return '(BLOB data)'
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BaseFormView({
  columns,
  currentRow,
  currentRowData = null,
  currentAbsoluteIndex,
  isFirstRecord,
  onNavigatePrev,
  onNavigateNext,
  isLoading = false,
  editState,
  onEnsureEditing,
  onUpdateCell,
  onSave,
  onDiscard,
  readOnly,
  testId = 'base-form-view',
  workspaceTabId,
  onBlobView,
  blobViewDisabled = false,
  blobViewDisabledReason,
  ...rest
}: BaseFormViewProps) {
  /** Whether the form has edit capability (onSave is the primary signal). */
  const hasEditCapability = onSave != null && !readOnly
  const recordCountMode = rest.recordCountMode ?? 'known'
  const knownTotalProps = rest as KnownTotalBaseFormViewProps
  const unknownTotalProps = rest as UnknownTotalBaseFormViewProps
  const isLastRecord = recordCountMode === 'known' ? knownTotalProps.isLastRecord : false
  const totalRows =
    recordCountMode === 'known' ? knownTotalProps.totalRows : (unknownTotalProps.totalRows ?? null)

  // --- Date/time picker state ---
  const [openPickerState, setOpenPickerState] = useState<{
    field: string
    anchorEl: HTMLElement
  } | null>(null)

  // Focus-tracking ref for first-click-open on temporal fields
  const inputFocusedRef = useRef<Record<string, boolean>>({})

  // --- Modification detection (single memoised pass) ---

  /** Set of column keys whose current value differs from the original. */
  const modifiedKeys = useMemo(() => {
    if (!editState) return new Set<string>()
    const keys = new Set<string>()
    const allKeys = new Set([
      ...Object.keys(editState.currentValues),
      ...Object.keys(editState.originalValues),
    ])
    for (const key of allKeys) {
      if (editState.currentValues[key] !== editState.originalValues[key]) {
        keys.add(key)
      }
    }
    return keys
  }, [editState])

  const hasModifications = modifiedKeys.size > 0

  // --- Handlers ---

  const ensureEditing = useCallback(() => {
    onEnsureEditing?.()
  }, [onEnsureEditing])

  const handleInputFocus = useCallback(() => {
    ensureEditing()
  }, [ensureEditing])

  const handleInputChange = useCallback(
    (colKey: string, value: unknown) => {
      ensureEditing()
      onUpdateCell?.(colKey, value)
    },
    [ensureEditing, onUpdateCell]
  )

  const handleNullToggle = useCallback(
    (col: GridColumnDescriptor, colIdx: number) => {
      if (!currentRow) return
      ensureEditing()

      // Determine current value for this column
      const currentVal =
        editState && col.key in editState.currentValues
          ? editState.currentValues[col.key]
          : currentRow[colIdx]

      if (currentVal === null) {
        // Toggling NULL off — set an appropriate default value
        const temporalType = getTemporalColumnType(col.dataType)
        if (temporalType) {
          onUpdateCell?.(col.key, getTodayMysqlString(temporalType))
        } else if (col.enumValues && col.enumValues.length > 0) {
          onUpdateCell?.(col.key, col.enumValues[0])
        } else if (isJsonSqlType(col.dataType)) {
          onUpdateCell?.(col.key, getJsonFormDefaultValue(currentRow[colIdx]))
        } else {
          onUpdateCell?.(col.key, '')
        }
      } else {
        // Toggling NULL on — close picker if it's open for this field
        setOpenPickerState((prev) => (prev?.field === col.key ? null : prev))
        onUpdateCell?.(col.key, null)
      }
    },
    [currentRow, ensureEditing, editState, onUpdateCell, setOpenPickerState]
  )

  const handleCopy = useCallback(async (value: unknown) => {
    const { displayValue: text } = formatCellValue(value)
    try {
      await writeClipboardText(text)
    } catch (err) {
      logFrontend('error', ['[base-form-view] clipboard write failed:', err].map(String).join(' '))
    }
  }, [])

  const handleSave = useCallback(() => {
    onSave?.()
  }, [onSave])

  const handleDiscard = useCallback(() => {
    onDiscard?.()
  }, [onDiscard])

  // --- Empty state ---
  if (currentRow === null || totalRows === 0) {
    return (
      <div className={styles.formView} data-testid={testId}>
        <div className={styles.emptyState}>No rows to display</div>
      </div>
    )
  }

  return (
    <div className={styles.formView} data-testid={testId}>
      {/* Record navigation header */}
      <div className={styles.recordNav}>
        <h2 className={styles.recordTitle}>
          {recordCountMode === 'known'
            ? `Record ${(currentAbsoluteIndex + 1).toLocaleString()} of ${knownTotalProps.totalRows.toLocaleString()}`
            : `Record ${(currentAbsoluteIndex + 1).toLocaleString()}`}
        </h2>

        <div className={styles.navGroup}>
          <div className={styles.navButtonGroup}>
            <button
              type="button"
              className={styles.navButton}
              disabled={isFirstRecord}
              onClick={onNavigatePrev}
              aria-label="Previous record"
              data-testid="btn-form-previous"
            >
              <CaretLeftIcon size={14} weight="bold" />
              <span>Previous</span>
            </button>
            <button
              type="button"
              className={styles.navButton}
              disabled={isLoading || (recordCountMode === 'known' ? isLastRecord : false)}
              onClick={onNavigateNext}
              aria-label="Next record"
              data-testid="btn-form-next"
            >
              <span>Next</span>
              <CaretRightIcon size={14} weight="bold" />
            </button>
          </div>

          {hasEditCapability && (
            <div className={styles.formButtons}>
              <button
                type="button"
                className={styles.discardButton}
                disabled={!hasModifications}
                onClick={handleDiscard}
                data-testid="btn-form-discard"
              >
                Discard
              </button>
              <button
                type="button"
                className={styles.saveButton}
                disabled={!hasModifications}
                onClick={handleSave}
                data-testid="btn-form-save"
              >
                Save Changes
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Scrollable form fields */}
      <div className={styles.formContent}>
        <div className={styles.formCard}>
          {columns.map((col, colIdx) => (
            <FormField
              key={col.key}
              col={col}
              colIdx={colIdx}
              currentRow={currentRow}
              currentRowData={currentRowData}
              editState={editState}
              isModified={modifiedKeys.has(col.key)}
              hasEditCapability={hasEditCapability}
              openPickerState={openPickerState}
              inputFocusedRef={inputFocusedRef}
              onSetOpenPickerState={setOpenPickerState}
              onEnsureEditing={ensureEditing}
              onInputFocus={handleInputFocus}
              onInputChange={handleInputChange}
              onNullToggle={handleNullToggle}
              onCopy={handleCopy}
              workspaceTabId={workspaceTabId}
              onBlobView={onBlobView}
              blobViewDisabled={blobViewDisabled}
              blobViewDisabledReason={blobViewDisabledReason}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// FormField — internal helper component for per-column rendering
// ---------------------------------------------------------------------------

interface FormFieldProps {
  col: GridColumnDescriptor
  colIdx: number
  currentRow: unknown[]
  currentRowData: Record<string, unknown> | null
  editState: BaseFormViewProps['editState']
  isModified: boolean
  hasEditCapability: boolean
  openPickerState: { field: string; anchorEl: HTMLElement } | null
  inputFocusedRef: React.RefObject<Record<string, boolean>>
  onSetOpenPickerState: (state: { field: string; anchorEl: HTMLElement } | null) => void
  onEnsureEditing: () => void
  onInputFocus: () => void
  onInputChange: (colKey: string, value: unknown) => void
  onNullToggle: (col: GridColumnDescriptor, colIdx: number) => void
  onCopy: (value: unknown) => void
  workspaceTabId?: string
  onBlobView?: (column: GridColumnDescriptor, rowData: Record<string, unknown> | null) => void
  blobViewDisabled?: boolean
  blobViewDisabledReason?: string
}

function FormField({
  col,
  colIdx,
  currentRow,
  currentRowData,
  editState,
  isModified,
  hasEditCapability,
  openPickerState,
  inputFocusedRef,
  onSetOpenPickerState,
  onEnsureEditing,
  onInputFocus,
  onInputChange,
  onNullToggle,
  onCopy,
  workspaceTabId,
  onBlobView,
  blobViewDisabled = false,
  blobViewDisabledReason,
}: FormFieldProps) {
  // Determine the value to display (edit state overlays raw row data)
  const rawValue =
    editState && col.key in editState.currentValues
      ? editState.currentValues[col.key]
      : currentRow[colIdx]

  const isNull = isNullish(rawValue)
  const isBlobField = col.isBinary
  const temporalType = getTemporalColumnType(col.dataType)
  const isEditable = col.editable && hasEditCapability && !isBlobField
  const isTemporalEditable = temporalType !== null && isEditable
  const isEnumEditable = !!(col.enumValues && col.enumValues.length > 0) && isEditable
  const isJsonColumn = isJsonSqlType(col.dataType)

  const enumDropdownOptions: DropdownOption[] = useMemo(() => {
    const out: DropdownOption[] = []
    if (col.isNullable) {
      out.push({ value: ENUM_NULL_SENTINEL, label: 'NULL' })
    }
    for (const ev of col.enumValues ?? []) {
      out.push({ value: ev, label: ev })
    }
    return out
  }, [col.enumValues, col.isNullable])
  const isFieldReadonly = !isEditable

  // Label suffix — PK takes priority over UK
  let labelSuffix = ''
  if (col.isPrimaryKey) labelSuffix = '(Primary Key)'
  else if (col.isUniqueKey) labelSuffix = '(Unique Key)'

  // Lock icon: non-editable column in edit mode with active editState
  const showLock =
    !col.editable &&
    !col.blobViewerEditable &&
    hasEditCapability &&
    editState !== null
  const showFkTrigger = !!(col.foreignKey && currentRowData)

  return (
    <div className={styles.fieldGroup} data-testid={`form-field-${col.displayName}`}>
      {/* Label row */}
      <div className={styles.fieldLabelRow}>
        <span className={styles.fieldLabel}>
          {showLock && (
            <LockIcon
              size={10}
              weight="bold"
              className={styles.lockIcon}
              data-testid={`lock-icon-${col.displayName}`}
            />
          )}
          {col.displayName}
        </span>
        {labelSuffix && <span className={styles.fieldLabelSuffix}>{labelSuffix}</span>}
        {col.isNullable && isEditable && (
          <button
            type="button"
            className={`${styles.fieldNullBtn} ${isNull ? styles.fieldNullBtnActive : ''}`}
            onClick={() => onNullToggle(col, colIdx)}
            data-testid={`btn-null-${col.displayName}`}
          >
            {isNull ? 'Set Value' : 'Set NULL'}
          </button>
        )}
        {isModified && (
          <span className={styles.modifiedDot} data-testid={`modified-dot-${col.displayName}`} />
        )}
      </div>

      {/* Value row */}
      <div
        className={[styles.fieldValueRow, isJsonColumn ? styles.fieldValueRowTall : '']
          .filter(Boolean)
          .join(' ')}
      >
        {isBlobField ? (
          <div className={styles.fieldBlobRow}>
            <div className={styles.fieldBlobReadonly} data-testid={`form-input-${col.displayName}`}>
              {getBlobFieldDisplayValue(rawValue)}
            </div>
            {onBlobView && (
              <Button
                variant="secondary"
                onClick={() => onBlobView(col, currentRowData)}
                className={styles.fieldBlobViewBtn}
                disabled={blobViewDisabled}
                title={blobViewDisabled ? blobViewDisabledReason : undefined}
                data-testid={`btn-blob-view-${col.displayName}`}
              >
                <EyeIcon size={14} />
                View/Edit
              </Button>
            )}
          </div>
        ) : isJsonColumn ? (
          <JsonFormField
            value={
              typeof rawValue === 'string' || rawValue === null ? rawValue : displayValue(rawValue)
            }
            isEditable={isEditable}
            isNull={isNull}
            onChange={(nextValue) => onInputChange(col.key, nextValue)}
            testId={`form-input-${col.displayName}`}
          />
        ) : isFieldReadonly ? (
          <div className={styles.fieldInputReadonly} data-testid={`form-input-${col.displayName}`}>
            {formatCellValue(rawValue).displayValue}
          </div>
        ) : isEnumEditable ? (
          <Dropdown
            id={`form-enum-${col.key}`}
            ariaLabel={col.displayName}
            options={enumDropdownOptions}
            value={isNull ? ENUM_NULL_SENTINEL : displayValue(rawValue)}
            onChange={(nextValue) => {
              if (nextValue === ENUM_NULL_SENTINEL) {
                onEnsureEditing()
                onInputChange(col.key, null)
                return
              }
              onInputChange(col.key, nextValue)
            }}
            onTriggerFocus={onInputFocus}
            data-testid={`form-input-${col.displayName}`}
            triggerClassName={[
              styles.fieldInput,
              styles.fieldSelect,
              isModified ? styles.fieldInputModified : '',
              isNull ? styles.fieldInputNull : '',
            ]
              .filter(Boolean)
              .join(' ')}
          />
        ) : (
          <TextInput
            type="text"
            variant="formField"
            className={[
              isModified ? tiStyles.formFieldModified : '',
              isNull ? tiStyles.formFieldNull : '',
            ]
              .filter(Boolean)
              .join(' ')}
            value={displayValue(rawValue)}
            onFocus={() => {
              onInputFocus()
              // Track focus state for temporal first-click-open
              if (isTemporalEditable) {
                setTimeout(() => {
                  inputFocusedRef.current[col.key] = true
                }, 0)
              }
            }}
            onBlur={() => {
              if (isTemporalEditable) {
                inputFocusedRef.current[col.key] = false
              }
            }}
            onClick={
              isTemporalEditable
                ? (e) => {
                    // Don't open picker when the field is NULL
                    if (isNull) {
                      return
                    }
                    // Open picker only on the click that first grants focus
                    if (!inputFocusedRef.current[col.key]) {
                      const anchorEl = (e.currentTarget.parentElement ??
                        e.currentTarget) as HTMLElement
                      onSetOpenPickerState({ field: col.key, anchorEl })
                    }
                  }
                : undefined
            }
            onChange={(e) => onInputChange(col.key, e.target.value)}
            data-testid={`form-input-${col.displayName}`}
          />
        )}

        {isTemporalEditable && (
          <button
            type="button"
            className={styles.fieldCalendarBtn}
            disabled={isNull}
            onClick={(e) => {
              if (isNull) return
              const anchorEl = (e.currentTarget.parentElement ?? e.currentTarget) as HTMLElement
              onSetOpenPickerState({ field: col.key, anchorEl })
            }}
            data-testid={`calendar-btn-${col.displayName}`}
            aria-label={temporalType === 'TIME' ? 'Open time picker' : 'Open date picker'}
          >
            {temporalType === 'TIME' ? <ClockIcon size={14} /> : <CalendarBlankIcon size={14} />}
          </button>
        )}

        {showFkTrigger && currentRowData && col.foreignKey && (
          <FkLookupTriggerButton
            foreignKey={col.foreignKey}
            columnKey={col.key}
            currentValue={rawValue}
            rowData={currentRowData}
            className={styles.fieldFkButton}
          />
        )}

        <button
          type="button"
          className={styles.fieldCopyBtn}
          onClick={() => onCopy(rawValue)}
          title={`Copy ${col.displayName}`}
          aria-label={`Copy ${col.displayName}`}
          data-testid={`btn-copy-${col.displayName}`}
        >
          <CopySimpleIcon size={14} />
        </button>
      </div>

      {/* Date/time picker popup (rendered via portal) */}
      {openPickerState?.field === col.key && temporalType && (
        <DateTimePicker
          value={isNullish(rawValue) ? null : displayValue(rawValue)}
          columnType={temporalType}
          disabled={isNull}
          anchorEl={openPickerState.anchorEl}
          onApply={(val) => {
            onInputChange(col.key, val)
            onSetOpenPickerState(null)
          }}
          onCancel={() => onSetOpenPickerState(null)}
          workspaceTabId={workspaceTabId}
        />
      )}

      {/* Modified indicator note */}
      {isModified && (
        <div className={styles.fieldModifiedNote} data-testid={`modified-note-${col.displayName}`}>
          <InfoIcon size={14} weight="fill" className={styles.fieldModifiedNoteIcon} />
          <span>Unsaved change detected</span>
        </div>
      )}
    </div>
  )
}
