import { useRef } from 'react'
import { InfoIcon } from '@phosphor-icons/react'
import { getTemporalColumnType } from '../../../lib/date-utils'
import { joinClassNames } from '../../../lib/class-names'
import { isNullish } from '../../../lib/value-checks'
import { FormFieldEditor, type FormFieldEditorProps, type FormFieldProps } from './FormFieldEditors'
import {
  FormFieldActions,
  FormFieldInlineButtons,
  FormFieldLabel,
  FormFieldPicker,
} from './FormFieldParts'
import {
  currentFieldValue,
  resolveFieldEditability,
  resolveFormFieldKind,
  shouldShowLock,
} from './form-field-values'

const VALUE_CELL_FRAME = 'flex min-w-0 *:min-w-0 *:flex-1'

const VALUE_CELL_CLASSES: Record<number, string> = {
  0: VALUE_CELL_FRAME,
  1: joinClassNames([VALUE_CELL_FRAME, 'relative *:first:pr-9']),
  2: joinClassNames([VALUE_CELL_FRAME, 'relative *:first:pr-16']),
}

export function FormField(field: FormFieldProps) {
  const { col: column, colIdx: columnIndex, openPickerState } = field
  const rawValue = currentFieldValue(field.editState, column.key, field.currentRow[columnIndex])
  const valueCellRef = useRef<HTMLDivElement>(null)
  const isNull = isNullish(rawValue)
  const temporalType = getTemporalColumnType(column.dataType)
  const editability = resolveFieldEditability(column, field.hasEditCapability, temporalType)
  const { isEditable, isTemporalEditable } = editability
  const fieldKind = resolveFormFieldKind(column, editability)

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
    <div className="contents" data-testid={`form-field-${column.displayName}`}>
      <FormFieldLabel field={field} showLock={shouldShowLock(field)} />

      <div className={VALUE_CELL_CLASSES[inFieldButtonCount]} ref={valueCellRef}>
        <FormFieldEditor kind={fieldKind} {...editor} />
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
          className="col-start-2 -col-end-1 -mt-1 flex items-center gap-1.5 text-caption text-light-primary dark:text-dark-primary"
          data-testid={`modified-note-${column.displayName}`}
        >
          <InfoIcon size={14} weight="fill" />
          <span>Unsaved change detected</span>
        </div>
      )}
    </div>
  )
}
