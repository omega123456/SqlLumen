import { getTemporalColumnType, getTodayMysqlString } from '../../../lib/date-utils'
import { isJsonSqlType } from '../../../lib/grid-column-style'
import type { DropdownOption } from '../../common/Dropdown'
import styles from '../BaseFormView.module.css'
import { ENUM_NULL_SENTINEL } from '../../table-data/enum-field-utils'
import {
  base64ByteLength,
  blobPlaceholder,
  isBlobEnvelope,
  isBlobPlaceholderText,
} from '../../../lib/blob-utils'
import { isNullish } from '../../../lib/value-checks'
import type { FormFieldProps } from './FormFieldEditors'
import type {
  BaseFormViewProps,
  GridColumnDescriptor,
  KnownTotalBaseFormViewProps,
  UnknownTotalBaseFormViewProps,
} from '../../../types/shared-data-view'

export function displayValue(value: unknown): string {
  if (isNullish(value)) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function getJsonFormDefaultValue(currentValue: unknown): string {
  const isNonBlankText = typeof currentValue === 'string' && currentValue.trim() !== ''
  if (isNonBlankText) {
    return currentValue
  }

  return '{}'
}

export function getBlobFieldDisplayValue(value: unknown): string {
  if (value == null) return '(BLOB data)'
  if (typeof value === 'string') {
    if (isBlobPlaceholderText(value)) return value
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

export interface RecordCounts {
  knownTotalRows: number | null
  totalRows: number | null
  isLastRecord: boolean
}

export function resolveRecordCounts(props: RecordCountProps): RecordCounts {
  if (props.recordCountMode === 'unknown') {
    return { knownTotalRows: null, totalRows: props.totalRows ?? null, isLastRecord: false }
  }
  return {
    knownTotalRows: props.totalRows,
    totalRows: props.totalRows,
    isLastRecord: props.isLastRecord,
  }
}

export function currentFieldValue(
  editState: BaseFormViewProps['editState'],
  columnKey: string,
  rowValue: unknown
): unknown {
  if (!editState) return rowValue
  return columnKey in editState.currentValues ? editState.currentValues[columnKey] : rowValue
}

export function hasEnumValues(column: GridColumnDescriptor): boolean {
  return (column.enumValues?.length ?? 0) > 0
}

export function resolveNonNullDefault(column: GridColumnDescriptor, rowValue: unknown): unknown {
  const temporalType = getTemporalColumnType(column.dataType)
  if (temporalType) return getTodayMysqlString(temporalType)
  if (hasEnumValues(column)) return column.enumValues?.[0]
  if (isJsonSqlType(column.dataType)) return getJsonFormDefaultValue(rowValue)
  return ''
}

export function keyLabelSuffix(column: GridColumnDescriptor): string {
  if (column.isPrimaryKey) return '(Primary Key)'
  if (column.isUniqueKey) return '(Unique Key)'
  return ''
}

export function buildEnumDropdownOptions(column: GridColumnDescriptor): DropdownOption[] {
  const valueOptions = (column.enumValues ?? []).map((enumValue) => ({
    value: enumValue,
    label: enumValue,
  }))
  if (!column.isNullable) return valueOptions
  return [{ value: ENUM_NULL_SENTINEL, label: 'NULL' }, ...valueOptions]
}

export function fieldStateClassName(isModified: boolean, isNull: boolean): string {
  return [isModified ? styles.fieldModified : '', isNull ? styles.fieldNull : '']
    .filter(Boolean)
    .join(' ')
}

export function jsonFieldValue(rawValue: unknown): string | null {
  const isJsonText = typeof rawValue === 'string' || rawValue === null
  if (isJsonText) return rawValue
  return displayValue(rawValue)
}

export function collectModifiedKeys(editState: BaseFormViewProps['editState']): Set<string> {
  const keys = new Set<string>()
  if (!editState) return keys
  const allKeys = new Set([
    ...Object.keys(editState.currentValues),
    ...Object.keys(editState.originalValues),
  ])
  for (const key of allKeys) {
    const isChangedValue = editState.currentValues[key] !== editState.originalValues[key]
    if (isChangedValue) keys.add(key)
  }
  return keys
}

export type FormFieldKind = 'blob' | 'json' | 'readonly' | 'enum' | 'text'

export interface FieldEditability {
  isEditable: boolean
  isTemporalEditable: boolean
  isEnumEditable: boolean
}

export function resolveFieldEditability(
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

export function resolveFormFieldKind(
  column: GridColumnDescriptor,
  editability: FieldEditability
): FormFieldKind {
  if (column.isBinary) return 'blob'
  if (isJsonSqlType(column.dataType)) return 'json'
  if (!editability.isEditable) return 'readonly'
  if (editability.isEnumEditable) return 'enum'
  return 'text'
}

export function shouldShowLock(field: FormFieldProps): boolean {
  const column = field.col
  const isLockedColumn = !column.editable && !column.blobViewerEditable
  return isLockedColumn && field.hasEditCapability && field.editState !== null
}
