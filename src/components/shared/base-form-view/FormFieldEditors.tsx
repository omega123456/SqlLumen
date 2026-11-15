import { useMemo, type ReactElement } from 'react'
import { EyeIcon } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import { Dropdown } from '../../common/Dropdown'
import { TextInput } from '../../common/TextInput'
import { formatCellValue } from '../../../lib/result-cell-utils'
import { ENUM_NULL_SENTINEL } from '../enum-field-utils'
import type { BaseFormViewProps, GridColumnDescriptor } from '../../../types/shared-data-view'
import { JsonFormField } from '../JsonFormField'
import {
  buildEnumDropdownOptions,
  displayValue,
  getBlobFieldDisplayValue,
  jsonFieldValue,
  type FormFieldKind,
} from './form-field-values'

export interface FormFieldProps {
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

export interface FormFieldEditorProps {
  field: FormFieldProps
  rawValue: unknown
  isNull: boolean
  isEditable: boolean
  isTemporalEditable: boolean
  openPicker: (fallbackAnchor: HTMLElement) => void
}

const READONLY_FIELD_VALUE_CLASS_NAME =
  'h-control min-w-0 flex-1 overflow-hidden rounded-control border border-light-stroke-control bg-light-fill-subtle-pressed px-2.5 font-mono text-size-mono leading-7.5 text-ellipsis whitespace-nowrap text-light-text-disabled select-text dark:border-dark-stroke-control dark:bg-dark-fill-subtle-pressed dark:text-dark-text-disabled'

function fieldInputTestId(column: GridColumnDescriptor): string {
  return `form-input-${column.displayName}`
}

function BlobFieldEditor({ field, rawValue }: FormFieldEditorProps) {
  const { col: column, onBlobView, currentRowData, blobViewDisabled } = field
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <div className={READONLY_FIELD_VALUE_CLASS_NAME} data-testid={fieldInputTestId(column)}>
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
    <div className={READONLY_FIELD_VALUE_CLASS_NAME} data-testid={fieldInputTestId(field.col)}>
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
      fieldState={{ modified: field.isModified, isNull: isNull }}
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
      fieldState={{ modified: field.isModified, isNull: isNull }}
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

interface FormFieldEditorSwitchProps extends FormFieldEditorProps {
  kind: FormFieldKind
}

export function FormFieldEditor({ kind, ...editor }: FormFieldEditorSwitchProps) {
  const FieldEditor = FORM_FIELD_EDITORS[kind]
  return <FieldEditor {...editor} />
}
