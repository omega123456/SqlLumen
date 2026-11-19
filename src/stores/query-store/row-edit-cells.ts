import type { QueryTableEditInfo, RowEditState, TableDataColumnMeta } from '../../types/schema'
import { getInitialValueForNewRow, isSeededFromColumnDefault } from '../../lib/new-row-values'
import { showErrorToast } from '../toast-store'
import { envelopeForBase64 } from '../../lib/blob-utils'
import type { SingleResultState } from './query-state-types'
import { patchSurface, resultOf, rowAt } from './query-store-access'
import type { DataViewSurfaceRef } from '../data-view/data-view-types'
import {
  buildClonedEditState,
  copiedBoundColumnNames,
  draftRowPatchForCell,
  editStateWithCellValue,
  resolveCloneSelection,
} from './row-edit-builders'
import type { ClonedDraftRow } from './row-edit-builders'
import { ensureResultEditState } from './row-edit-mode'
import { hasUnsavedModifications } from './query-tab-selectors'

interface CloneSource {
  tableInfo: QueryTableEditInfo
  keyColumns: string[]
  sourceRow: unknown[]
}

function resolveCloneSource(
  ref: DataViewSurfaceRef,
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
    { tabId: ref.tabId, resultIndex: ref.resultIndex, result: result },
    selection.sourceRowIndex
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
  result: SingleResultState
  editState: RowEditState
  columnName: string
}

function resolveCellEditTarget(
  ref: DataViewSurfaceRef,
  resultColumnIndex: number
): CellEditTarget | null {
  const result = resultOf(ref)
  if (!result) return null

  const editingRowIndex = result.editingRowIndex ?? result.selectedRowIndex
  if (editingRowIndex === null) return null

  const activeResult = ensureResultEditState(
    { tabId: ref.tabId, resultIndex: ref.resultIndex, result: result },
    editingRowIndex
  )
  if (!activeResult?.editState) return null

  const columnName =
    activeResult.editColumnBindings.get(resultColumnIndex) ??
    activeResult.columns[resultColumnIndex]?.name
  if (!columnName) return null
  return {
    result: activeResult,
    editState: activeResult.editState,
    columnName: columnName,
  }
}

function clonedBoundCellValue(tableColumn: TableDataColumnMeta, sourceValue: unknown): unknown {
  const isBinaryBase64 = tableColumn.isBinary && typeof sourceValue === 'string'
  if (!isBinaryBase64) return sourceValue
  return envelopeForBase64(sourceValue)
}

function buildClonedDraftRow(
  result: SingleResultState,
  tableInfo: QueryTableEditInfo,
  sourceRow: unknown[]
): ClonedDraftRow {
  const copiedColumnNames = copiedBoundColumnNames(result, tableInfo)
  const row = result.columns.map((_column, index) => {
    const sourceValue = sourceRow[index] ?? null
    const tableColumn = boundTableColumnAt(result, tableInfo, index)
    if (!tableColumn) return sourceValue
    if (!copiedColumnNames.has(tableColumn.name)) return null
    return clonedBoundCellValue(tableColumn, sourceValue)
  })

  return {
    row: row,
    modifiedColumns: copiedColumnNames,
    insertEligibleColumns: new Set(copiedColumnNames),
  }
}

interface DraftRowRequest {
  result: SingleResultState
  draft: ClonedDraftRow
  keyColumns: string[]
}

function openDraftRow(ref: DataViewSurfaceRef, request: DraftRowRequest) {
  const { result, draft, keyColumns } = request
  const draftRowIndex = result.viewRowCount
  patchSurface(ref, {
    draftRow: draft.row,
    selectedRowIndex: draftRowIndex,
    editingRowIndex: draftRowIndex,
    editingBaseIndex: null,
    editState: buildClonedEditState(result, draft, keyColumns),
    saveError: null,
    isStale: false,
  })
}

export function cloneSelectedRow(ref: DataViewSurfaceRef) {
  const result = resultOf(ref)
  if (!result) return

  const source = resolveCloneSource(ref, result)
  if (!source) return

  const draft = buildClonedDraftRow(result, source.tableInfo, source.sourceRow)
  const hasCopiedColumns = draft.insertEligibleColumns.size > 0
  if (!hasCopiedColumns) return

  openDraftRow(ref, { result: result, draft: draft, keyColumns: source.keyColumns })
}

interface InsertTable {
  tableInfo: QueryTableEditInfo
  keyColumns: string[]
}

function resolveInsertTable(result: SingleResultState): InsertTable | null {
  if (!result.editMode) return null
  if (result.draftRow) return null
  if (hasUnsavedModifications(result)) {
    showErrorToast('Unsaved changes', 'Save or discard the current row before adding a row.')
    return null
  }
  const tableInfo = result.editTableMetadata[result.editMode]
  const primaryKey = tableInfo?.primaryKey
  if (!primaryKey) return null
  if (primaryKey.isUniqueKeyFallback) return null
  return { tableInfo: tableInfo, keyColumns: primaryKey.keyColumns }
}

function boundTableColumnAt(
  result: SingleResultState,
  tableInfo: QueryTableEditInfo,
  resultColumnIndex: number
): TableDataColumnMeta | undefined {
  const boundName = result.editColumnBindings.get(resultColumnIndex)
  if (!boundName) return undefined
  const lowerBoundName = boundName.toLowerCase()
  return tableInfo.columns.find((column) => column.name.toLowerCase() === lowerBoundName)
}

function initialResultCellValue(tableColumn: TableDataColumnMeta | undefined): unknown {
  if (!tableColumn) return null
  return getInitialValueForNewRow(tableColumn)
}

function buildNewDraftRow(
  result: SingleResultState,
  tableInfo: QueryTableEditInfo
): ClonedDraftRow {
  const row = result.columns.map((_column, index) =>
    initialResultCellValue(boundTableColumnAt(result, tableInfo, index))
  )
  const modifiedColumns = new Set<string>()
  for (const tableColumn of tableInfo.columns) {
    const isBound = result.editBoundColumnIndexMap.has(tableColumn.name.toLowerCase())
    const isSeededBoundColumn = isBound && isSeededFromColumnDefault(tableColumn)
    if (isSeededBoundColumn) modifiedColumns.add(tableColumn.name)
  }
  return { row: row, modifiedColumns: modifiedColumns, insertEligibleColumns: new Set<string>() }
}

export function insertDraftRow(ref: DataViewSurfaceRef) {
  const result = resultOf(ref)
  if (!result) return

  const insertTable = resolveInsertTable(result)
  if (!insertTable) return

  const draft = buildNewDraftRow(result, insertTable.tableInfo)
  openDraftRow(ref, {
    result: result,
    draft: draft,
    keyColumns: insertTable.keyColumns,
  })
}

export function updateCellValue(
  ref: DataViewSurfaceRef,
  resultColumnIndex: number,
  value: unknown
) {
  const target = resolveCellEditTarget(ref, resultColumnIndex)
  if (!target) return

  patchSurface(ref, {
    editState: editStateWithCellValue(target.editState, target.columnName, value),
    saveError: null,
  })
}

export function syncCellValue(ref: DataViewSurfaceRef, resultColumnIndex: number, value: unknown) {
  const target = resolveCellEditTarget(ref, resultColumnIndex)
  if (!target) return
  const isEditingRow = target.result.editingRowIndex !== null
  if (!isEditingRow) return

  patchSurface(ref, {
    ...draftRowPatchForCell(target.result, resultColumnIndex, value),
    editState: editStateWithCellValue(target.editState, target.columnName, value),
    saveError: null,
  })
}

export function rowEditCellActions() {
  return { cloneSelectedRow, insertDraftRow, updateCellValue, syncCellValue }
}
