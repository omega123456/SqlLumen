import { logFrontendError } from '../../lib/app-log-commands'
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

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react'
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

type RecordCountProps =
  | Pick<KnownTotalBaseFormViewProps, 'recordCountMode' | 'totalRows' | 'isLastRecord'>
  | Pick<UnknownTotalBaseFormViewProps, 'recordCountMode' | 'totalRows' | 'isLastRecord'>

interface RecordCounts {
  knownTotalRows: number | null
  totalRows: number | null
  isLastRecord: boolean
}

function resolveRecordCounts(props: RecordCountProps): RecordCounts {
  if (props.recordCountMode === 'unknown') {
    return { knownTotalRows: null, totalRows: props.totalRows ?? null, isLastRecord: false }
  }
  return {
    knownTotalRows: props.totalRows,
    totalRows: props.totalRows,
    isLastRecord: props.isLastRecord,
  }
}

function currentFieldValue(
  editState: BaseFormViewProps['editState'],
  columnKey: string,
  rowValue: unknown
): unknown {
  if (editState && columnKey in editState.currentValues) return editState.currentValues[columnKey]
  return rowValue
}

function hasEnumValues(column: GridColumnDescriptor): boolean {
  return (column.enumValues?.length ?? 0) > 0
}

function resolveNonNullDefault(column: GridColumnDescriptor, rowValue: unknown): unknown {
  const temporalType = getTemporalColumnType(column.dataType)
  if (temporalType) return getTodayMysqlString(temporalType)
  if (hasEnumValues(column)) return column.enumValues?.[0]
  if (isJsonSqlType(column.dataType)) return getJsonFormDefaultValue(rowValue)
  return ''
}

function keyLabelSuffix(column: GridColumnDescriptor): string {
  if (column.isPrimaryKey) return '(Primary Key)'
  if (column.isUniqueKey) return '(Unique Key)'
  return ''
}

function buildEnumDropdownOptions(column: GridColumnDescriptor): DropdownOption[] {
  const valueOptions = (column.enumValues ?? []).map((enumValue) => ({
    value: enumValue,
    label: enumValue,
  }))
  if (!column.isNullable) return valueOptions
  return [{ value: ENUM_NULL_SENTINEL, label: 'NULL' }, ...valueOptions]
}

function fieldStateClassName(isModified: boolean, isNull: boolean): string {
  return [isModified ? tiStyles.formFieldModified : '', isNull ? tiStyles.formFieldNull : '']
    .filter(Boolean)
    .join(' ')
}

function jsonFieldValue(rawValue: unknown): string | null {
  if (typeof rawValue === 'string' || rawValue === null) return rawValue
  return displayValue(rawValue)
}

interface FormRecordNavProps {
  currentAbsoluteIndex: number
  isFirstRecord: boolean
  isLoading: boolean
  counts: RecordCounts
  onNavigatePrev: BaseFormViewProps['onNavigatePrev']
  onNavigateNext: BaseFormViewProps['onNavigateNext']
  editActions: {
    hasEditCapability: boolean
    hasModifications: boolean
    onDiscard: () => void
    onSave: () => void
  }
}

function FormRecordNav({
  currentAbsoluteIndex,
  isFirstRecord,
  isLoading,
  counts,
  onNavigatePrev,
  onNavigateNext,
  editActions,
}: FormRecordNavProps) {
  return (
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
        {counts.knownTotalRows !== null && ` of ${counts.knownTotalRows.toLocaleString()}`}
      </span>
      <Button
        variant="subtle"
        size="sm"
        iconOnly
        disabled={isLoading || counts.isLastRecord}
        onClick={onNavigateNext}
        aria-label="Next record"
        title="Next record"
        data-testid="btn-form-next"
      >
        <CaretRightIcon size={16} />
      </Button>

      {editActions.hasEditCapability && (
        <div className={styles.formButtons}>
          <Button
            size="sm"
            disabled={!editActions.hasModifications}
            onClick={editActions.onDiscard}
            data-testid="btn-form-discard"
          >
            Discard
          </Button>
          <Button
            variant="accent"
            size="sm"
            disabled={!editActions.hasModifications}
            onClick={editActions.onSave}
            data-testid="btn-form-save"
          >
            Save changes
          </Button>
        </div>
      )}
    </div>
  )
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
  const hasEditCapability = onSave != null && !readOnly
  const counts = resolveRecordCounts(rest)

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
      const rowValue = currentRow[columnIndex]
      if (currentFieldValue(editState, column.key, rowValue) === null) {
        onUpdateCell?.(column.key, resolveNonNullDefault(column, rowValue))
        return
      }
      setOpenPickerState((previous) => (previous?.field === column.key ? null : previous))
      onUpdateCell?.(column.key, null)
    },
    [currentRow, ensureEditing, editState, onUpdateCell, setOpenPickerState]
  )

  const handleCopy = useCallback(async (value: unknown) => {
    const { displayValue: text } = formatCellValue(value)
    try {
      await writeClipboardText(text)
    } catch (error) {
      logFrontendError('[base-form-view] clipboard write failed:', error)
    }
  }, [])

  const handleSave = useCallback(() => {
    onSave?.()
  }, [onSave])

  const handleDiscard = useCallback(() => {
    onDiscard?.()
  }, [onDiscard])

  // --- Empty state ---
  if (currentRow === null || counts.totalRows === 0) {
    return (
      <div className={styles.formView} data-testid={testId}>
        <div className={styles.emptyState}>No rows to display</div>
      </div>
    )
  }

  return (
    <div className={styles.formView} data-testid={testId}>
      <FormRecordNav
        currentAbsoluteIndex={currentAbsoluteIndex}
        isFirstRecord={isFirstRecord}
        isLoading={isLoading}
        counts={counts}
        onNavigatePrev={onNavigatePrev}
        onNavigateNext={onNavigateNext}
        editActions={{
          hasEditCapability: hasEditCapability,
          hasModifications: hasModifications,
          onDiscard: handleDiscard,
          onSave: handleSave,
        }}
      />

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

type FormFieldKind = 'blob' | 'json' | 'readonly' | 'enum' | 'text'

interface FormFieldEditorProps {
  field: FormFieldProps
  rawValue: unknown
  isNull: boolean
  isEditable: boolean
  isTemporalEditable: boolean
  openPicker: (fallbackAnchor: HTMLElement) => void
}

function fieldInputTestId(column: GridColumnDescriptor): string {
  return `form-input-${column.displayName}`
}

function BlobFieldEditor({ field, rawValue }: FormFieldEditorProps) {
  const { col: column, onBlobView, currentRowData, blobViewDisabled } = field
  return (
    <div className={styles.fieldBlobRow}>
      <div className={styles.fieldBlobReadonly} data-testid={fieldInputTestId(column)}>
        {getBlobFieldDisplayValue(rawValue)}
      </div>
      {onBlobView && (
        <Button
          size="sm"
          onClick={() => onBlobView(column, currentRowData)}
          disabled={blobViewDisabled}
          title={blobViewDisabled ? field.blobViewDisabledReason : undefined}
          data-testid={`btn-blob-view-${column.displayName}`}
        >
          <EyeIcon size={16} />
          View/Edit
        </Button>
      )}
    </div>
  )
}

function JsonFieldEditor({ field, rawValue, isNull, isEditable }: FormFieldEditorProps) {
  const column = field.col
  return (
    <JsonFormField
      value={jsonFieldValue(rawValue)}
      isEditable={isEditable}
      isNull={isNull}
      onChange={(nextValue) => field.onInputChange(column.key, nextValue)}
      testId={fieldInputTestId(column)}
    />
  )
}

function ReadonlyFieldValue({ field, rawValue }: FormFieldEditorProps) {
  return (
    <div className={styles.fieldInputReadonly} data-testid={fieldInputTestId(field.col)}>
      {formatCellValue(rawValue).displayValue}
    </div>
  )
}

function EnumFieldEditor({ field, rawValue, isNull }: FormFieldEditorProps) {
  const column = field.col
  const enumDropdownOptions = useMemo(() => buildEnumDropdownOptions(column), [column])
  const handleChange = (nextValue: string) => {
    if (nextValue === ENUM_NULL_SENTINEL) {
      field.onEnsureEditing()
      field.onInputChange(column.key, null)
      return
    }
    field.onInputChange(column.key, nextValue)
  }
  return (
    <Dropdown
      id={`form-enum-${column.key}`}
      ariaLabel={column.displayName}
      options={enumDropdownOptions}
      value={isNull ? ENUM_NULL_SENTINEL : displayValue(rawValue)}
      onChange={handleChange}
      data-testid={fieldInputTestId(column)}
      triggerClassName={fieldStateClassName(field.isModified, isNull)}
    />
  )
}

function TextFieldEditor({
  field,
  rawValue,
  isNull,
  isTemporalEditable,
  openPicker,
}: FormFieldEditorProps) {
  const { col: column, inputFocusedRef } = field
  const handleFocus = () => {
    field.onInputFocus()
    if (!isTemporalEditable) return
    setTimeout(() => {
      inputFocusedRef.current[column.key] = true
    }, 0)
  }
  const handleBlur = () => {
    if (!isTemporalEditable) return
    inputFocusedRef.current[column.key] = false
  }
  const openPickerOnFirstClick = (event: React.MouseEvent<HTMLInputElement>) => {
    if (isNull) return
    if (inputFocusedRef.current[column.key]) return
    openPicker(event.currentTarget)
  }
  return (
    <TextInput
      type="text"
      variant="formField"
      className={fieldStateClassName(field.isModified, isNull)}
      value={displayValue(rawValue)}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onClick={isTemporalEditable ? openPickerOnFirstClick : undefined}
      onChange={(event) => field.onInputChange(column.key, event.target.value)}
      data-testid={fieldInputTestId(column)}
    />
  )
}

const FORM_FIELD_EDITORS: Record<FormFieldKind, (props: FormFieldEditorProps) => ReactElement> = {
  blob: BlobFieldEditor,
  json: JsonFieldEditor,
  readonly: ReadonlyFieldValue,
  enum: EnumFieldEditor,
  text: TextFieldEditor,
}

interface FieldEditability {
  isEditable: boolean
  isTemporalEditable: boolean
  isEnumEditable: boolean
}

function resolveFieldEditability(
  column: GridColumnDescriptor,
  hasEditCapability: boolean,
  temporalType: ReturnType<typeof getTemporalColumnType>
): FieldEditability {
  const isEditable = column.editable && hasEditCapability && !column.isBinary
  return {
    isEditable: isEditable,
    isTemporalEditable: temporalType !== null && isEditable,
    isEnumEditable: hasEnumValues(column) && isEditable,
  }
}

function resolveFormFieldKind(
  column: GridColumnDescriptor,
  editability: FieldEditability
): FormFieldKind {
  if (column.isBinary) return 'blob'
  if (isJsonSqlType(column.dataType)) return 'json'
  if (!editability.isEditable) return 'readonly'
  if (editability.isEnumEditable) return 'enum'
  return 'text'
}

function FormFieldLabel({ field, showLock }: { field: FormFieldProps; showLock: boolean }) {
  const column = field.col
  const labelSuffix = keyLabelSuffix(column)
  return (
    <div className={styles.fieldLabelCell}>
      <span className={styles.fieldLabel}>
        {field.isModified && (
          <span className={styles.modifiedDot} data-testid={`modified-dot-${column.displayName}`} />
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
  )
}

interface FormFieldInlineButtonsProps {
  editor: FormFieldEditorProps
  temporalType: ReturnType<typeof getTemporalColumnType>
  showForeignKeyTrigger: boolean
}

function FormFieldInlineButtons({
  editor,
  temporalType,
  showForeignKeyTrigger,
}: FormFieldInlineButtonsProps) {
  const { field, rawValue, isNull } = editor
  const column = field.col
  const isTimePicker = temporalType === 'TIME'
  return (
    <div className={styles.fieldInlineButtons}>
      {editor.isTemporalEditable && (
        <Button
          variant="subtle"
          size="sm"
          iconOnly
          disabled={isNull}
          onClick={(event) => {
            if (isNull) return
            editor.openPicker(event.currentTarget)
          }}
          data-testid={`calendar-btn-${column.displayName}`}
          aria-label={isTimePicker ? 'Open time picker' : 'Open date picker'}
        >
          {isTimePicker ? <ClockIcon size={16} /> : <CalendarBlankIcon size={16} />}
        </Button>
      )}

      {showForeignKeyTrigger && field.currentRowData && column.foreignKey && (
        <FkLookupTriggerButton
          foreignKey={column.foreignKey}
          columnKey={column.key}
          currentValue={rawValue}
          rowData={field.currentRowData}
          className={styles.fieldFkButton}
        />
      )}
    </div>
  )
}

function FormFieldActions({ editor }: { editor: FormFieldEditorProps }) {
  const { field, rawValue, isNull } = editor
  const column = field.col
  const canToggleNull = column.isNullable === true && editor.isEditable
  return (
    <div className={styles.fieldActions}>
      <Button
        variant="subtle"
        size="sm"
        iconOnly
        onClick={() => field.onCopy(rawValue)}
        title={`Copy ${column.displayName}`}
        aria-label={`Copy ${column.displayName}`}
        data-testid={`btn-copy-${column.displayName}`}
      >
        <CopySimpleIcon size={16} />
      </Button>
      {canToggleNull && (
        <Button
          variant="subtle"
          size="sm"
          className={`${styles.fieldNullBtn} ${isNull ? styles.fieldNullBtnActive : ''}`}
          onClick={() => field.onNullToggle(column, field.colIdx)}
          data-testid={`btn-null-${column.displayName}`}
        >
          {isNull ? 'Set value' : 'Set NULL'}
        </Button>
      )}
    </div>
  )
}

interface FormFieldPickerProps {
  editor: FormFieldEditorProps
  temporalType: NonNullable<ReturnType<typeof getTemporalColumnType>>
  anchorEl: HTMLElement
}

function FormFieldPicker({ editor, temporalType, anchorEl }: FormFieldPickerProps) {
  const { field, rawValue, isNull } = editor
  return (
    <DateTimePicker
      value={isNullish(rawValue) ? null : displayValue(rawValue)}
      columnType={temporalType}
      disabled={isNull}
      anchorEl={anchorEl}
      onApply={(value) => {
        field.onInputChange(field.col.key, value)
        field.onSetOpenPickerState(null)
      }}
      onCancel={() => field.onSetOpenPickerState(null)}
      workspaceTabId={field.workspaceTabId}
    />
  )
}

function shouldShowLock(field: FormFieldProps): boolean {
  const column = field.col
  const isLockedColumn = !column.editable && !column.blobViewerEditable
  return isLockedColumn && field.hasEditCapability && field.editState !== null
}

function FormField(field: FormFieldProps) {
  const { col: column, colIdx: columnIndex, openPickerState } = field
  const rawValue = currentFieldValue(field.editState, column.key, field.currentRow[columnIndex])
  const valueCellRef = useRef<HTMLDivElement>(null)
  const isNull = isNullish(rawValue)
  const temporalType = getTemporalColumnType(column.dataType)
  const editability = resolveFieldEditability(column, field.hasEditCapability, temporalType)
  const { isEditable, isTemporalEditable } = editability
  const FieldEditor = FORM_FIELD_EDITORS[resolveFormFieldKind(column, editability)]

  const showForeignKeyTrigger = Boolean(column.foreignKey && field.currentRowData)
  const inFieldButtonCount = Number(isTemporalEditable) + Number(showForeignKeyTrigger)
  const hasInFieldButtons = inFieldButtonCount > 0
  const pickerAnchor = openPickerState?.field === column.key ? openPickerState.anchorEl : null

  const editor: FormFieldEditorProps = {
    field: field,
    rawValue: rawValue,
    isNull: isNull,
    isEditable: isEditable,
    isTemporalEditable: isTemporalEditable,
    openPicker: (fallbackAnchor) =>
      field.onSetOpenPickerState({
        field: column.key,
        anchorEl: valueCellRef.current ?? fallbackAnchor,
      }),
  }

  return (
    <div className={styles.fieldGroup} data-testid={`form-field-${column.displayName}`}>
      <FormFieldLabel field={field} showLock={shouldShowLock(field)} />

      <div
        className={`${styles.fieldValueCell} ${hasInFieldButtons ? styles.fieldValueCellWithButtons : ''}`}
        style={{ '--in-field-buttons': inFieldButtonCount } as CSSProperties}
        ref={valueCellRef}
      >
        <FieldEditor {...editor} />
        {hasInFieldButtons && (
          <FormFieldInlineButtons
            editor={editor}
            temporalType={temporalType}
            showForeignKeyTrigger={showForeignKeyTrigger}
          />
        )}
      </div>

      <FormFieldActions editor={editor} />

      {pickerAnchor && temporalType && (
        <FormFieldPicker editor={editor} temporalType={temporalType} anchorEl={pickerAnchor} />
      )}

      {field.isModified && (
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
