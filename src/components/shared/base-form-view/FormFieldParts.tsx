import { CalendarBlankIcon, ClockIcon, CopySimpleIcon, LockIcon } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import { joinClassNames } from '../../../lib/class-names'
import { FOCUS_RING } from '../../../lib/focus-ring'
import { getTemporalColumnType } from '../../../lib/date-utils'
import { isNullish } from '../../../lib/value-checks'
import { DateTimePicker } from '../DateTimePicker'
import { FkLookupTriggerButton } from '../FkLookupTriggerButton'
import type { FormFieldEditorProps, FormFieldProps } from './FormFieldEditors'
import { displayValue, fieldLabelSuffix } from './form-field-values'

export function FormFieldLabel({ field, showLock }: { field: FormFieldProps; showLock: boolean }) {
  const column = field.col
  const labelSuffix = fieldLabelSuffix(column)
  return (
    <div className="flex min-w-0 flex-col items-end text-right">
      <span className="flex max-w-full items-center gap-1.5 text-row wrap-anywhere text-light-on-surface-variant dark:text-dark-on-surface-variant">
        {field.isModified && (
          <span
            className="size-1.5 shrink-0 rounded-round bg-light-primary dark:bg-dark-primary"
            data-testid={`modified-dot-${column.displayName}`}
          />
        )}
        {showLock && (
          <LockIcon
            size={12}
            className="shrink-0 text-light-outline dark:text-dark-outline"
            data-testid={`lock-icon-${column.displayName}`}
          />
        )}
        {column.displayName}
      </span>
      {labelSuffix && (
        <span className="text-caption text-light-outline dark:text-dark-outline">
          {labelSuffix}
        </span>
      )}
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
  const { field, rawValue } = editor
  const column = field.col
  const isTimePicker = temporalType === 'TIME'
  return (
    <div className="absolute top-1/2 right-0.5 flex -translate-y-1/2">
      {editor.isTemporalEditable && (
        <Button
          variant="subtle"
          size="sm"
          iconOnly
          onClick={(event) => editor.openPicker(event.currentTarget)}
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
          className={joinClassNames([
            'flex size-7 shrink-0 cursor-default items-center justify-center rounded-control bg-transparent text-light-on-surface hover:bg-light-fill-subtle-hover active:bg-light-fill-subtle-pressed dark:text-dark-on-surface dark:hover:bg-dark-fill-subtle-hover dark:active:bg-dark-fill-subtle-pressed',
            FOCUS_RING,
          ])}
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
    <div className="flex min-h-control items-center gap-0.5">
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
          variant={isNull ? 'subtleToggled' : 'subtleMuted'}
          size="sm"
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
  const { field, rawValue } = editor
  return (
    <DateTimePicker
      value={isNullish(rawValue) ? null : displayValue(rawValue)}
      columnType={temporalType}
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
