import { useRef, type CSSProperties } from 'react'
import { InfoIcon } from '@phosphor-icons/react'
import { getTemporalColumnType } from '../../../lib/date-utils'
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
import styles from '../BaseFormView.module.css'

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
    <div className={styles.fieldGroup} data-testid={`form-field-${column.displayName}`}>
      <FormFieldLabel field={field} showLock={shouldShowLock(field)} />

      <div
        className={`${styles.fieldValueCell} ${hasInFieldButtons ? styles.fieldValueCellWithButtons : ''}`}
        style={{ '--in-field-buttons': inFieldButtonCount } as CSSProperties}
        ref={valueCellRef}
      >
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
