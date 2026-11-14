import { CalendarBlankIcon, ClockIcon, CopySimpleIcon, LockIcon } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import { getTemporalColumnType } from '../../../lib/date-utils'
import { isNullish } from '../../../lib/value-checks'
import { DateTimePicker } from '../../table-data/DateTimePicker'
import { FkLookupTriggerButton } from '../FkLookupTriggerButton'
import type { FormFieldEditorProps, FormFieldProps } from './FormFieldEditors'
import { displayValue, keyLabelSuffix } from './form-field-values'
import styles from '../BaseFormView.module.css'

export function FormFieldLabel({ field, showLock }: { field: FormFieldProps; showLock: boolean }) {
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

export function FormFieldInlineButtons({
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

export function FormFieldActions({ editor }: { editor: FormFieldEditorProps }) {
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

export function FormFieldPicker({ editor, temporalType, anchorEl }: FormFieldPickerProps) {
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
