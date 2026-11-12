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

import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react'
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
import { base64ByteLength, blobPlaceholder, isBlobEnvelope } from '../../lib/blob-utils'
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
  if (typeof value === 'string') {
    // Table-data rows arrive with a backend-baked `[BLOB - <size>]` placeholder;
    // query-result rows inline the bytes as base64, so derive the size here to
    // keep both surfaces identical.
    if (value.startsWith('[BLOB')) return value
    return blobPlaceholder(base64ByteLength(value))
  }
  if (isBlobEnvelope(value)) {
    if (value.kind === 'null') return '(BLOB data)'
    if (value.kind === 'empty') return blobPlaceholder(0, true)
    if (typeof value.base64 === 'string') {
      return blobPlaceholder(base64ByteLength(value.base64), true)
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
    (columnKey: string, value: unknown) => {
      ensureEditing()
      onUpdateCell?.(columnKey, value)
    },
    [ensureEditing, onUpdateCell]
  )

  const handleNullToggle = useCallback(
    (column: GridColumnDescriptor, columnIndex: number) => {
      if (!currentRow) return
      ensureEditing()

      // Determine current value for this column
      const currentValue =
        editState && column.key in editState.currentValues
          ? editState.currentValues[column.key]
          : currentRow[columnIndex]

      if (currentValue === null) {
        // Toggling NULL off — set an appropriate default value
        const temporalType = getTemporalColumnType(column.dataType)
        if (temporalType) {
          onUpdateCell?.(column.key, getTodayMysqlString(temporalType))
        } else if (column.enumValues && column.enumValues.length > 0) {
          onUpdateCell?.(column.key, column.enumValues[0])
        } else if (isJsonSqlType(column.dataType)) {
          onUpdateCell?.(column.key, getJsonFormDefaultValue(currentRow[columnIndex]))
        } else {
          onUpdateCell?.(column.key, '')
        }
      } else {
        // Toggling NULL on — close picker if it's open for this field
        setOpenPickerState((previous) => (previous?.field === column.key ? null : previous))
        onUpdateCell?.(column.key, null)
      }
    },
    [currentRow, ensureEditing, editState, onUpdateCell, setOpenPickerState]
  )

  const handleCopy = useCallback(async (value: unknown) => {
    const { displayValue: text } = formatCellValue(value)
    try {
      await writeClipboardText(text)
    } catch (error) {
      logFrontend(
        'error',
        ['[base-form-view] clipboard write failed:', error].map(String).join(' ')
      )
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
      {/* Record navigation (prototype `.p-form .nav`) */}
      <div className={styles.recordNav}>
        <Button
          variant="subtle"
          size="sm"
          iconOnly
          disabled={isFirstRecord}
          onClick={onNavigatePrev}
          aria-label="Previous record"
          title="Previous record"
          data-testid="btn-form-previous"
        >
          <CaretLeftIcon size={16} />
        </Button>
        <span className={styles.recordTitle} data-testid="form-record-label">
          Record <b>{(currentAbsoluteIndex + 1).toLocaleString()}</b>
          {recordCountMode === 'known' && ` of ${knownTotalProps.totalRows.toLocaleString()}`}
        </span>
        <Button
          variant="subtle"
          size="sm"
          iconOnly
          disabled={isLoading || (recordCountMode === 'known' ? isLastRecord : false)}
          onClick={onNavigateNext}
          aria-label="Next record"
          title="Next record"
          data-testid="btn-form-next"
        >
          <CaretRightIcon size={16} />
        </Button>

        {hasEditCapability && (
          <div className={styles.formButtons}>
            <Button
              size="sm"
              disabled={!hasModifications}
              onClick={handleDiscard}
              data-testid="btn-form-discard"
            >
              Discard
            </Button>
            <Button
              variant="accent"
              size="sm"
              disabled={!hasModifications}
              onClick={handleSave}
              data-testid="btn-form-save"
            >
              Save changes
            </Button>
          </div>
        )}
      </div>

      {/* Form fields (prototype `.p-form .rows`) */}
      <div className={styles.formRows}>
        {columns.map((column, columnIndex) => (
          <FormField
            key={column.key}
            col={column}
            colIdx={columnIndex}
            currentRow={currentRow}
            currentRowData={currentRowData}
            editState={editState}
            isModified={modifiedKeys.has(column.key)}
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
  onInputChange: (columnKey: string, value: unknown) => void
  onNullToggle: (column: GridColumnDescriptor, columnIndex: number) => void
  onCopy: (value: unknown) => void
  workspaceTabId?: string
  onBlobView?: (column: GridColumnDescriptor, rowData: Record<string, unknown> | null) => void
  blobViewDisabled?: boolean
  blobViewDisabledReason?: string
}

function FormField({
  col: column,
  colIdx: columnIndex,
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
    editState && column.key in editState.currentValues
      ? editState.currentValues[column.key]
      : currentRow[columnIndex]

  const valueCellRef = useRef<HTMLDivElement>(null)
  const isNull = isNullish(rawValue)
  const isBlobField = column.isBinary
  const temporalType = getTemporalColumnType(column.dataType)
  const isEditable = column.editable && hasEditCapability && !isBlobField
  const isTemporalEditable = temporalType !== null && isEditable
  const isEnumEditable = !!(column.enumValues && column.enumValues.length > 0) && isEditable
  const isJsonColumn = isJsonSqlType(column.dataType)

  const enumDropdownOptions: DropdownOption[] = useMemo(() => {
    const out: DropdownOption[] = []
    if (column.isNullable) {
      out.push({ value: ENUM_NULL_SENTINEL, label: 'NULL' })
    }
    for (const ev of column.enumValues ?? []) {
      out.push({ value: ev, label: ev })
    }
    return out
  }, [column.enumValues, column.isNullable])
  const isFieldReadonly = !isEditable

  // Label suffix — PK takes priority over UK
  let labelSuffix = ''
  if (column.isPrimaryKey) labelSuffix = '(Primary Key)'
  else if (column.isUniqueKey) labelSuffix = '(Unique Key)'

  // Lock icon: non-editable column in edit mode with active editState
  const showLock =
    !column.editable && !column.blobViewerEditable && hasEditCapability && editState !== null
  const showForeignKeyTrigger = !!(column.foreignKey && currentRowData)
  const inFieldButtonCount = Number(isTemporalEditable) + Number(showForeignKeyTrigger)
  const hasInFieldButtons = inFieldButtonCount > 0

  return (
    <div className={styles.fieldGroup} data-testid={`form-field-${column.displayName}`}>
      {/* Label cell (prototype `.p-form label`) */}
      <div className={styles.fieldLabelCell}>
        <span className={styles.fieldLabel}>
          {isModified && (
            <span
              className={styles.modifiedDot}
              data-testid={`modified-dot-${column.displayName}`}
            />
          )}
          {showLock && (
            <LockIcon
              size={12}
              className={styles.lockIcon}
              data-testid={`lock-icon-${column.displayName}`}
            />
          )}
          {column.displayName}
        </span>
        {labelSuffix && <span className={styles.fieldLabelSuffix}>{labelSuffix}</span>}
      </div>

      {/* Value cell */}
      <div
        className={`${styles.fieldValueCell} ${hasInFieldButtons ? styles.fieldValueCellWithButtons : ''}`}
        style={{ '--in-field-buttons': inFieldButtonCount } as CSSProperties}
        ref={valueCellRef}
      >
        {isBlobField ? (
          <div className={styles.fieldBlobRow}>
            <div
              className={styles.fieldBlobReadonly}
              data-testid={`form-input-${column.displayName}`}
            >
              {getBlobFieldDisplayValue(rawValue)}
            </div>
            {onBlobView && (
              <Button
                size="sm"
                onClick={() => onBlobView(column, currentRowData)}
                disabled={blobViewDisabled}
                title={blobViewDisabled ? blobViewDisabledReason : undefined}
                data-testid={`btn-blob-view-${column.displayName}`}
              >
                <EyeIcon size={16} />
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
            onChange={(nextValue) => onInputChange(column.key, nextValue)}
            testId={`form-input-${column.displayName}`}
          />
        ) : isFieldReadonly ? (
          <div
            className={styles.fieldInputReadonly}
            data-testid={`form-input-${column.displayName}`}
          >
            {formatCellValue(rawValue).displayValue}
          </div>
        ) : isEnumEditable ? (
          <Dropdown
            id={`form-enum-${column.key}`}
            ariaLabel={column.displayName}
            options={enumDropdownOptions}
            value={isNull ? ENUM_NULL_SENTINEL : displayValue(rawValue)}
            onChange={(nextValue) => {
              if (nextValue === ENUM_NULL_SENTINEL) {
                onEnsureEditing()
                onInputChange(column.key, null)
                return
              }
              onInputChange(column.key, nextValue)
            }}
            data-testid={`form-input-${column.displayName}`}
            triggerClassName={[
              isModified ? tiStyles.formFieldModified : '',
              isNull ? tiStyles.formFieldNull : '',
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
                  inputFocusedRef.current[column.key] = true
                }, 0)
              }
            }}
            onBlur={() => {
              if (isTemporalEditable) {
                inputFocusedRef.current[column.key] = false
              }
            }}
            onClick={
              isTemporalEditable
                ? (event) => {
                    // Don't open picker when the field is NULL
                    if (isNull) {
                      return
                    }
                    // Open picker only on the click that first grants focus
                    if (!inputFocusedRef.current[column.key]) {
                      onSetOpenPickerState({
                        field: column.key,
                        anchorEl: valueCellRef.current ?? event.currentTarget,
                      })
                    }
                  }
                : undefined
            }
            onChange={(event) => onInputChange(column.key, event.target.value)}
            data-testid={`form-input-${column.displayName}`}
          />
        )}
        {hasInFieldButtons && (
          <div className={styles.fieldInlineButtons}>
            {isTemporalEditable && (
              <Button
                variant="subtle"
                size="sm"
                iconOnly
                disabled={isNull}
                onClick={(event) => {
                  if (isNull) return
                  onSetOpenPickerState({
                    field: column.key,
                    anchorEl: valueCellRef.current ?? event.currentTarget,
                  })
                }}
                data-testid={`calendar-btn-${column.displayName}`}
                aria-label={temporalType === 'TIME' ? 'Open time picker' : 'Open date picker'}
              >
                {temporalType === 'TIME' ? (
                  <ClockIcon size={16} />
                ) : (
                  <CalendarBlankIcon size={16} />
                )}
              </Button>
            )}

            {showForeignKeyTrigger && currentRowData && column.foreignKey && (
              <FkLookupTriggerButton
                foreignKey={column.foreignKey}
                columnKey={column.key}
                currentValue={rawValue}
                rowData={currentRowData}
                className={styles.fieldFkButton}
              />
            )}
          </div>
        )}
      </div>

      {/* Trailing actions */}
      <div className={styles.fieldActions}>
        <Button
          variant="subtle"
          size="sm"
          iconOnly
          onClick={() => onCopy(rawValue)}
          title={`Copy ${column.displayName}`}
          aria-label={`Copy ${column.displayName}`}
          data-testid={`btn-copy-${column.displayName}`}
        >
          <CopySimpleIcon size={16} />
        </Button>
        {column.isNullable && isEditable && (
          <Button
            variant="subtle"
            size="sm"
            className={`${styles.fieldNullBtn} ${isNull ? styles.fieldNullBtnActive : ''}`}
            onClick={() => onNullToggle(column, columnIndex)}
            data-testid={`btn-null-${column.displayName}`}
          >
            {isNull ? 'Set value' : 'Set NULL'}
          </Button>
        )}
      </div>

      {/* Date/time picker popup (rendered via portal) */}
      {openPickerState?.field === column.key && temporalType && (
        <DateTimePicker
          value={isNullish(rawValue) ? null : displayValue(rawValue)}
          columnType={temporalType}
          disabled={isNull}
          anchorEl={openPickerState.anchorEl}
          onApply={(value) => {
            onInputChange(column.key, value)
            onSetOpenPickerState(null)
          }}
          onCancel={() => onSetOpenPickerState(null)}
          workspaceTabId={workspaceTabId}
        />
      )}

      {/* Modified indicator note */}
      {isModified && (
        <div
          className={styles.fieldModifiedNote}
          data-testid={`modified-note-${column.displayName}`}
        >
          <InfoIcon size={14} weight="fill" />
          <span>Unsaved change detected</span>
        </div>
      )}
    </div>
  )
}
