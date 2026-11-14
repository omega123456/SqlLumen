import type { QueryTableEditInfo, RowEditState } from '../../types/schema'
import { showErrorToast } from '../toast-store'
import type { SingleResultState } from './query-state-types'
import { getActiveIndex, patchResultByIndex, resultAt, rowAt } from './query-store-access'
import {
  buildClonedEditState,
  draftRowPatchForCell,
  editStateWithCellValue,
  resolveCloneSelection,
} from './row-edit-builders'
import type { ClonedDraftRow } from './row-edit-builders'
import { ensureResultEditState } from './row-edit-mode'

interface CloneSource {
  tableInfo: QueryTableEditInfo
  keyColumns: string[]
  sourceRow: unknown[]
}

function resolveCloneSource(
  tabId: string,
  resultIndex: number,
  result: SingleResultState
): CloneSource | null {
  const selection = resolveCloneSelection(result)
  if (!selection) return null

  const tableInfo = result.editTableMetadata[selection.editMode]
  if (!tableInfo?.primaryKey) return null

  if (tableInfo.primaryKey.isUniqueKeyFallback) {
    showErrorToast(
      'Clone failed',
      'Cannot clone query-result rows when edit mode is using a unique-key fallback.'
    )
    return null
  }

  const sourceRow = rowAt(
    { tabId: tabId, resultIndex: resultIndex, result: result },
    selection.selectedRowIndex
  )?.row
  if (!sourceRow) return null
  if (result.draftRow) return null
  return {
    tableInfo: tableInfo,
    keyColumns: tableInfo.primaryKey.keyColumns,
    sourceRow: sourceRow,
  }
}

interface CellEditTarget {
  resultIndex: number
  result: SingleResultState
  editState: RowEditState
  columnName: string
}

function resolveCellEditTarget(tabId: string, resultColumnIndex: number): CellEditTarget | null {
  const resultIndex = getActiveIndex(tabId)
  const result = resultAt(tabId, resultIndex)
  if (!result) return null

  const editingRowIndex = result.editingRowIndex ?? result.selectedRowIndex
  if (editingRowIndex === null) return null

  const activeResult = ensureResultEditState(
    { tabId: tabId, resultIndex: resultIndex, result: result },
    editingRowIndex
  )
  if (!activeResult?.editState) return null

  const columnName =
    activeResult.editColumnBindings.get(resultColumnIndex) ??
    activeResult.columns[resultColumnIndex]?.name
  if (!columnName) return null
  return {
    resultIndex: resultIndex,
    result: activeResult,
    editState: activeResult.editState,
    columnName: columnName,
  }
}

function buildClonedDraftRow(
  result: SingleResultState,
  tableInfo: QueryTableEditInfo,
  sourceRow: unknown[]
): ClonedDraftRow {
  const primaryKeyColumns = new Set(
    tableInfo.primaryKey?.keyColumns.map((column) => column.toLowerCase()) ?? []
  )
  const row = result.columns.map((column, index) => {
    const boundColumnName = result.editColumnBindings.get(index) ?? column.name
    if (primaryKeyColumns.has(boundColumnName.toLowerCase())) {
      return null
    }
    return sourceRow[index] ?? null
  })

  const modifiedColumns = new Set<string>()
  const insertEligibleColumns = new Set<string>()
  for (const tableColumn of tableInfo.columns) {
    if (tableColumn.isPrimaryKey) {
      continue
    }
    if (result.editBoundColumnIndexMap.has(tableColumn.name.toLowerCase())) {
      modifiedColumns.add(tableColumn.name)
      insertEligibleColumns.add(tableColumn.name)
    }
  }

  return { row, modifiedColumns, insertEligibleColumns }
}

export function cloneSelectedRow(tabId: string) {
  const resultIndex = getActiveIndex(tabId)
  const result = resultAt(tabId, resultIndex)
  if (!result) return

  const source = resolveCloneSource(tabId, resultIndex, result)
  if (!source) return

  const draft = buildClonedDraftRow(result, source.tableInfo, source.sourceRow)
  const hasClonableColumns = draft.modifiedColumns.size > 0 || draft.insertEligibleColumns.size > 0
  if (!hasClonableColumns) return

  const draftRowIndex = result.viewRowCount
  patchResultByIndex(tabId, resultIndex, {
    draftRow: draft.row,
    selectedRowIndex: draftRowIndex,
    editingRowIndex: draftRowIndex,
    editingBaseIndex: null,
    editState: buildClonedEditState(result, draft, source.keyColumns),
    saveError: null,
    isStale: false,
  })
}

export function updateCellValue(tabId: string, resultColumnIndex: number, value: unknown) {
  const target = resolveCellEditTarget(tabId, resultColumnIndex)
  if (!target) return

  patchResultByIndex(tabId, target.resultIndex, {
    editState: editStateWithCellValue(target.editState, target.columnName, value),
    saveError: null,
  })
}

export function syncCellValue(tabId: string, resultColumnIndex: number, value: unknown) {
  const target = resolveCellEditTarget(tabId, resultColumnIndex)
  if (!target) return
  const isEditingRow = target.result.editingRowIndex !== null
  if (!isEditingRow) return

  patchResultByIndex(tabId, target.resultIndex, {
    ...draftRowPatchForCell(target.result, resultColumnIndex, value),
    editState: editStateWithCellValue(target.editState, target.columnName, value),
    saveError: null,
  })
}

export function rowEditCellActions() {
  return { cloneSelectedRow, updateCellValue, syncCellValue }
}
