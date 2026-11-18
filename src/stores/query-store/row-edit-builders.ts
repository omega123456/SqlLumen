import type { QueryTableEditInfo, RowEditState } from '../../types/schema'
import { showErrorToast, showWarningToast } from '../toast-store'
import { buildRowEditState } from '../../lib/query-edit-utils'
import { isPresentIndex } from '../../lib/value-checks'
import { isCopiedIntoClone } from '../../lib/new-row-values'
import type { SingleResultState } from './query-state-types'
import { cloneSourceRowIndex, hasUnsavedModifications } from './query-tab-selectors'
import { toDisplayedQueryCellValue } from './result-seeding'

export interface ClonedDraftRow {
  row: unknown[]
  modifiedColumns: Set<string>
  insertEligibleColumns: Set<string>
}

export function copiedBoundColumnNames(
  result: SingleResultState,
  table: Pick<QueryTableEditInfo, 'columns' | 'primaryKey'>
): Set<string> {
  const keyColumns = table.primaryKey?.keyColumns ?? []
  const copiedColumnNames = new Set<string>()
  for (const tableColumn of table.columns) {
    const isBound = result.editBoundColumnIndexMap.has(tableColumn.name.toLowerCase())
    const isCopiedBoundColumn = isBound && isCopiedIntoClone(tableColumn, keyColumns)
    if (isCopiedBoundColumn) copiedColumnNames.add(tableColumn.name)
  }
  return copiedColumnNames
}

interface CloneSelection {
  editMode: string
  sourceRowIndex: number
}

export function resolveCloneSelection(result: SingleResultState): CloneSelection | null {
  if (!result.editMode) return null
  if (hasUnsavedModifications(result)) {
    showErrorToast('Unsaved changes', 'Save or discard the current row before cloning another row.')
    return null
  }
  if (result.editState?.isNewRow) return null
  const sourceRowIndex = cloneSourceRowIndex(result)
  if (sourceRowIndex === null) return null
  return { editMode: result.editMode, sourceRowIndex: sourceRowIndex }
}

export function buildClonedEditState(
  result: SingleResultState,
  draft: ClonedDraftRow,
  keyColumns: string[]
): RowEditState {
  const editState = buildRowEditState({
    row: draft.row,
    resultColumns: result.columns,
    editableMap: result.editableColumnMap,
    primaryKeyColumnNames: keyColumns,
    columnBindings: result.editColumnBindings,
    boundColumnIndexMap: result.editBoundColumnIndexMap,
  })
  for (const columnName of draft.insertEligibleColumns) {
    const boundColumnIndex = result.editBoundColumnIndexMap.get(columnName.toLowerCase())
    if (!isPresentIndex(boundColumnIndex)) continue
    const value = draft.row[boundColumnIndex]
    editState.originalValues[columnName] = value
    editState.currentValues[columnName] = value
  }
  return {
    ...editState,
    isNewRow: true,
    modifiedColumns: draft.modifiedColumns,
    insertEligibleColumns: draft.insertEligibleColumns,
  }
}

function modifiedColumnsAfterEdit(
  editState: RowEditState,
  columnName: string,
  value: unknown
): Set<string> {
  const modifiedColumns = new Set(editState.modifiedColumns)
  const isOriginalValue =
    JSON.stringify(editState.originalValues[columnName]) === JSON.stringify(value)
  if (isOriginalValue) {
    modifiedColumns.delete(columnName)
    return modifiedColumns
  }
  modifiedColumns.add(columnName)
  return modifiedColumns
}

export function editStateWithCellValue(
  editState: RowEditState,
  columnName: string,
  value: unknown
): RowEditState {
  return {
    ...editState,
    currentValues: { ...editState.currentValues, [columnName]: value },
    modifiedColumns: modifiedColumnsAfterEdit(editState, columnName, value),
  }
}

export function draftRowPatchForCell(
  result: SingleResultState,
  resultColumnIndex: number,
  value: unknown
): Partial<SingleResultState> {
  const draftRow = result.draftRow
  if (!draftRow) return {}
  if (result.editingRowIndex !== result.viewRowCount) return {}
  return {
    draftRow: draftRow.map((cell, index) => (index === resultColumnIndex ? value : cell)),
  }
}

export function editMetadataWithTable(
  metadata: Record<string, QueryTableEditInfo>,
  tableName: string,
  tableInfo: QueryTableEditInfo
): Record<string, QueryTableEditInfo> {
  if (tableName in metadata) return metadata
  return { ...metadata, [tableName]: tableInfo }
}

interface AmbiguousEditColumnsCheck {
  tableInfo: QueryTableEditInfo
  keyColumns: string[]
  ambiguous: Set<string>
  boundColumnIndexMap: Map<string, number>
}

export function warnAboutAmbiguousEditColumns(check: AmbiguousEditColumnsCheck): void {
  const { tableInfo, keyColumns, ambiguous, boundColumnIndexMap } = check
  if (ambiguous.size === 0) return
  const keyColumnsLower = new Set(keyColumns.map((keyColumn) => keyColumn.toLowerCase()))
  const isUneditableAmbiguousColumn = (columnName: string): boolean => {
    const lower = columnName.toLowerCase()
    if (!ambiguous.has(lower)) return false
    if (keyColumnsLower.has(lower)) return false
    return !boundColumnIndexMap.has(lower)
  }
  const nonKeyAmbiguous = tableInfo.columns
    .map((column) => column.name)
    .filter(isUneditableAmbiguousColumn)
  if (nonKeyAmbiguous.length === 0) return
  showWarningToast(
    'Ambiguous columns',
    `Some columns are ambiguous and cannot be edited: ${nonKeyAmbiguous.join(', ')}`
  )
}

export function displayedCellUpdates(
  result: SingleResultState,
  editState: RowEditState
): Record<number, unknown> {
  const displayUpdates: Record<number, unknown> = {}
  for (const columnName of editState.modifiedColumns) {
    const columnIndex = result.editBoundColumnIndexMap.get(columnName.toLowerCase()) ?? -1
    if (columnIndex === -1) continue
    displayUpdates[columnIndex] = toDisplayedQueryCellValue(editState.currentValues[columnName])
  }
  return displayUpdates
}
