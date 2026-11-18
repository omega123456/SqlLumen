import type { ColumnMeta, TableDataColumnMeta, RowEditState } from '../types/schema'
import { coerceValueForColumn } from '../stores/table-data-store'
import { isSameTextIgnoringCase } from './value-checks'
import { isInlineEditableColumn } from './column-capabilities'
export {
  buildQueryEditColumnBindings,
  buildBoundColumnIndexMap,
  findAmbiguousColumns,
} from './query-edit-utils/column-bindings'

export type { ColumnBindingInputs } from './query-edit-utils/column-bindings'

export type QueryEditColumnBindings = Map<number, string>

interface ResultColumnEditability {
  boundName: string | undefined
  resultColumnName: string
  hasExplicitBindings: boolean
  ambiguousNames: Set<string>
  tableColumnLookup: Map<string, TableDataColumnMeta>
}

function isEditableResultColumn(check: ResultColumnEditability): boolean {
  const { boundName } = check
  const isUnbound = !boundName
  if (check.hasExplicitBindings && isUnbound) return false
  const resultColumnNameLower = check.resultColumnName.toLowerCase()
  const isAmbiguousName = check.ambiguousNames.has(resultColumnNameLower)
  if (isUnbound && isAmbiguousName) return false
  const tableColumn = check.tableColumnLookup.get(boundName?.toLowerCase() ?? resultColumnNameLower)
  if (!tableColumn) return false
  return isInlineEditableColumn(tableColumn)
}

export interface EditableColumnMapInputs {
  resultColumns: ColumnMeta[]
  tableColumns: TableDataColumnMeta[]
  ambiguousNames: Set<string>
  columnBindings?: QueryEditColumnBindings
}

export function buildEditableColumnMap({
  resultColumns,
  tableColumns,
  ambiguousNames,
  columnBindings,
}: EditableColumnMapInputs): Map<number, boolean> {
  const map = new Map<number, boolean>()
  const hasExplicitBindings = columnBindings !== undefined

  const tableColumnLookup = new Map<string, TableDataColumnMeta>()
  for (const tc of tableColumns) {
    tableColumnLookup.set(tc.name.toLowerCase(), tc)
  }

  for (let columnIndex = 0; columnIndex < resultColumns.length; columnIndex++) {
    const isEditable = isEditableResultColumn({
      boundName: columnBindings?.get(columnIndex),
      resultColumnName: resultColumns[columnIndex].name,
      hasExplicitBindings: hasExplicitBindings,
      ambiguousNames: ambiguousNames,
      tableColumnLookup: tableColumnLookup,
    })
    map.set(columnIndex, isEditable)
  }

  return map
}

export interface KeyColumnValidationInputs {
  primaryKeyColumns: string[]
  resultColumns: ColumnMeta[]
  ambiguousNames: Set<string>
  boundColumnIndexMap?: Map<string, number>
}

export function validateKeyColumnsPresent({
  primaryKeyColumns,
  resultColumns,
  ambiguousNames,
  boundColumnIndexMap,
}: KeyColumnValidationInputs): { valid: boolean; missingColumns: string[] } {
  if (boundColumnIndexMap) {
    const missingColumns = primaryKeyColumns.filter(
      (primaryKey) => !boundColumnIndexMap.has(primaryKey.toLowerCase())
    )
    return {
      valid: missingColumns.length === 0,
      missingColumns: missingColumns,
    }
  }

  const resultColumnNamesLower = new Set(resultColumns.map((column) => column.name.toLowerCase()))
  const missingColumns: string[] = []

  for (const primaryKey of primaryKeyColumns) {
    const primaryKeyLower = primaryKey.toLowerCase()
    const isUsableKeyColumn =
      resultColumnNamesLower.has(primaryKeyLower) && !ambiguousNames.has(primaryKeyLower)
    if (!isUsableKeyColumn) {
      missingColumns.push(primaryKey)
    }
  }

  return {
    valid: missingColumns.length === 0,
    missingColumns: missingColumns,
  }
}

export interface RowEditStateInputs {
  row: unknown[]
  resultColumns: ColumnMeta[]
  editableMap: Map<number, boolean>
  primaryKeyColumnNames: string[]
  columnBindings?: QueryEditColumnBindings
  boundColumnIndexMap?: Map<string, number>
}

export function buildRowEditState({
  row,
  resultColumns,
  editableMap,
  primaryKeyColumnNames,
  columnBindings,
  boundColumnIndexMap,
}: RowEditStateInputs): RowEditState {
  const originalValues: Record<string, unknown> = {}
  const currentValues: Record<string, unknown> = {}
  const rowKey: Record<string, unknown> = {}

  for (let columnIndex = 0; columnIndex < resultColumns.length; columnIndex++) {
    const columnName = columnBindings?.get(columnIndex) ?? resultColumns[columnIndex].name
    if (editableMap.get(columnIndex)) {
      originalValues[columnName] = row[columnIndex]
      currentValues[columnName] = row[columnIndex]
    }
  }

  for (const primaryKeyColumn of primaryKeyColumnNames) {
    const index =
      boundColumnIndexMap?.get(primaryKeyColumn.toLowerCase()) ??
      resultColumns.findIndex((column) => isSameTextIgnoringCase(column.name, primaryKeyColumn))
    if (index !== -1) {
      rowKey[primaryKeyColumn] = row[index]
    }
  }

  return {
    rowKey: rowKey,
    originalValues: originalValues,
    currentValues: currentValues,
    modifiedColumns: new Set<string>(),
    isNewRow: false,
  }
}

export function buildUpdatePayload(
  editState: RowEditState,
  primaryKeyColumnNames: string[],
  columns?: TableDataColumnMeta[]
): {
  pkColumns: string[]
  originalPkValues: Record<string, unknown>
  updatedValues: Record<string, unknown>
} {
  const columnsByName = columns
    ? new Map(columns.map((column) => [column.name, column]))
    : undefined

  const originalPrimaryKeyValues: Record<string, unknown> = {}
  for (const primaryKey of primaryKeyColumnNames) {
    originalPrimaryKeyValues[primaryKey] = editState.rowKey[primaryKey]
  }

  const updatedValues: Record<string, unknown> = {}
  for (const column of editState.modifiedColumns) {
    const rawValue = editState.currentValues[column]
    const columnMeta = columnsByName?.get(column)
    updatedValues[column] = columnMeta
      ? coerceValueForColumn(rawValue, columnMeta.dataType)
      : rawValue
  }

  return {
    pkColumns: primaryKeyColumnNames,
    originalPkValues: originalPrimaryKeyValues,
    updatedValues: updatedValues,
  }
}

export function buildInsertPayload(
  editState: RowEditState,
  tableColumns: TableDataColumnMeta[]
): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  const insertEligibleColumns = editState.insertEligibleColumns

  for (const column of tableColumns) {
    if (column.isAutoIncrement) {
      continue
    }

    const isModified = editState.modifiedColumns.has(column.name)
    const isInsertEligible = insertEligibleColumns?.has(column.name) ?? false
    const isPayloadColumn = isModified || isInsertEligible
    if (!isPayloadColumn) {
      continue
    }

    const currentValue = editState.currentValues[column.name]
    if (currentValue !== undefined) {
      values[column.name] = coerceValueForColumn(currentValue, column.dataType)
    }
  }

  return values
}
