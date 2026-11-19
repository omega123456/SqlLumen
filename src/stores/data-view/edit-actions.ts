import type { QueryTableEditInfo, RowEditState, TableDataColumnMeta } from '../../types/schema'
import type { CachedRow } from '../../lib/result-window-cache'
import { buildRowEditState } from '../../lib/query-edit-utils'
import { getInitialValueForNewRow, isSeededFromColumnDefault } from '../../lib/new-row-values'
import { isPresentIndex } from '../../lib/value-checks'
import { showErrorToast } from '../toast-store'
import type { DataViewPatch, DataViewState, DataViewSurfaceRef } from './data-view-types'
import { CLOSED_EDIT_PATCH, DISCARDED_DRAFT_PATCH } from './data-view-defaults'
import { mergeViewPatches } from './data-view-reducers'
import {
  editTableOf,
  hasUnsavedModifications,
  rowAt,
  storedBaseIndexOf,
} from './data-view-selectors'
import { readView, updateView } from './route-registry'

export interface DraftRow {
  row: unknown[]
  modifiedColumns: Set<string>
  insertEligibleColumns: Set<string>
}

interface BlobEditSeed {
  row: unknown[]
  tableInfo: QueryTableEditInfo
  columnBindings: Map<number, string>
}

function binaryColumnNamesByLowerName(tableInfo: QueryTableEditInfo): Map<string, string> {
  const binaryColumns = tableInfo.columns.filter((column) => column.isBinary)
  return new Map(binaryColumns.map((column) => [column.name.toLowerCase(), column.name]))
}

function seedBlobViewerEditValues(
  editState: RowEditState,
  { row, tableInfo, columnBindings }: BlobEditSeed
): RowEditState {
  const binaryColumns = binaryColumnNamesByLowerName(tableInfo)
  if (binaryColumns.size === 0) return editState

  const originalValues = { ...editState.originalValues }
  const currentValues = { ...editState.currentValues }
  let changed = false

  for (const [columnIndex, columnName] of columnBindings) {
    const binaryColumnName = binaryColumns.get(columnName.toLowerCase())
    if (!binaryColumnName) continue

    if (!(binaryColumnName in originalValues)) {
      originalValues[binaryColumnName] = row[columnIndex] ?? null
      changed = true
    }
    if (!(binaryColumnName in currentValues)) {
      currentValues[binaryColumnName] = row[columnIndex] ?? null
      changed = true
    }
  }

  return changed ? { ...editState, originalValues, currentValues } : editState
}

export function buildSeededRowEditState(
  view: DataViewState,
  tableInfo: QueryTableEditInfo,
  row: unknown[]
): RowEditState {
  const baseEditState = buildRowEditState({
    row: row,
    resultColumns: view.slot.columns,
    editableMap: view.editTarget.editableColumns,
    primaryKeyColumnNames: tableInfo.primaryKey?.keyColumns ?? [],
    columnBindings: view.editTarget.bindings,
    boundColumnIndexMap: view.editTarget.boundIndexByName,
  })
  return seedBlobViewerEditValues(baseEditState, {
    row: row,
    tableInfo: tableInfo,
    columnBindings: view.editTarget.bindings,
  })
}

function editedRowPatch(
  view: DataViewState,
  rowIndex: number,
  cached: CachedRow
): DataViewPatch | null {
  const tableInfo = editTableOf(view)
  if (!tableInfo) return null
  return {
    edit: {
      state: buildSeededRowEditState(view, tableInfo, cached.row),
      rowIndex: rowIndex,
      baseIndex: storedBaseIndexOf(cached),
      saveError: null,
    },
  }
}

function isEditingRowAt(view: DataViewState, rowIndex: number): boolean {
  return view.edit.state !== null && view.edit.rowIndex === rowIndex
}

export function ensureEditState(ref: DataViewSurfaceRef, rowIndex: number): DataViewState | null {
  const view = readView(ref)
  if (!view) return null
  if (isEditingRowAt(view, rowIndex)) return view

  const cached = rowAt(ref, view, rowIndex)
  if (!cached) return null
  const patch = editedRowPatch(view, rowIndex, cached)
  if (!patch) return null
  updateView(ref, patch)
  return readView(ref) ?? null
}

export function startEditingRow(ref: DataViewSurfaceRef, rowIndex: number, cachedRow?: CachedRow) {
  const view = readView(ref)
  if (!view) return
  const cached = cachedRow ?? rowAt(ref, view, rowIndex)
  if (!cached) return
  const patch = editedRowPatch(view, rowIndex, cached)
  if (!patch) return
  updateView(ref, patch)
}

export function discardCurrentRow(ref: DataViewSurfaceRef) {
  const view = readView(ref)
  if (!view?.edit.state) return
  const isDiscardingDraft = view.edit.state.isNewRow
  updateView(ref, isDiscardingDraft ? DISCARDED_DRAFT_PATCH : CLOSED_EDIT_PATCH)
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

function editStateWithCellValue(
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

function isEditingDraftRow(view: DataViewState): boolean {
  return view.edit.rowIndex === view.slot.viewRowCount
}

function draftRowPatchForCell(
  view: DataViewState,
  columnIndex: number,
  value: unknown
): DataViewPatch {
  const draftRow = view.edit.draftRow
  if (!draftRow) return {}
  if (!isEditingDraftRow(view)) return {}
  return {
    edit: { draftRow: draftRow.map((cell, index) => (index === columnIndex ? value : cell)) },
  }
}

interface CellEditTarget {
  view: DataViewState
  editState: RowEditState
  columnName: string
}

function resolveCellEditTarget(
  ref: DataViewSurfaceRef,
  columnIndex: number
): CellEditTarget | null {
  const view = readView(ref)
  if (!view) return null

  const editingRowIndex = view.edit.rowIndex ?? view.selection.rowIndex
  if (editingRowIndex === null) return null

  const editingView = ensureEditState(ref, editingRowIndex)
  if (!editingView?.edit.state) return null

  const columnName =
    editingView.editTarget.bindings.get(columnIndex) ?? editingView.slot.columns[columnIndex]?.name
  if (!columnName) return null
  return { view: editingView, editState: editingView.edit.state, columnName: columnName }
}

function cellValuePatch(target: CellEditTarget, value: unknown): DataViewPatch {
  return {
    edit: {
      state: editStateWithCellValue(target.editState, target.columnName, value),
      saveError: null,
    },
  }
}

export function updateCellValue(ref: DataViewSurfaceRef, columnIndex: number, value: unknown) {
  const target = resolveCellEditTarget(ref, columnIndex)
  if (!target) return
  updateView(ref, cellValuePatch(target, value))
}

export function syncCellValue(ref: DataViewSurfaceRef, columnIndex: number, value: unknown) {
  const target = resolveCellEditTarget(ref, columnIndex)
  if (!target) return
  const isEditingRow = target.view.edit.rowIndex !== null
  if (!isEditingRow) return

  const draftPatch = draftRowPatchForCell(target.view, columnIndex, value)
  updateView(ref, mergeViewPatches(draftPatch, cellValuePatch(target, value)))
}

export function boundTableColumnAt(
  view: DataViewState,
  tableInfo: QueryTableEditInfo,
  columnIndex: number
): TableDataColumnMeta | undefined {
  const boundName = view.editTarget.bindings.get(columnIndex)
  if (!boundName) return undefined
  const lowerBoundName = boundName.toLowerCase()
  return tableInfo.columns.find((column) => column.name.toLowerCase() === lowerBoundName)
}

export function isBoundColumn(view: DataViewState, tableColumn: TableDataColumnMeta): boolean {
  return view.editTarget.boundIndexByName.has(tableColumn.name.toLowerCase())
}

function buildDraftEditState(
  view: DataViewState,
  draft: DraftRow,
  keyColumns: string[]
): RowEditState {
  const editState = buildRowEditState({
    row: draft.row,
    resultColumns: view.slot.columns,
    editableMap: view.editTarget.editableColumns,
    primaryKeyColumnNames: keyColumns,
    columnBindings: view.editTarget.bindings,
    boundColumnIndexMap: view.editTarget.boundIndexByName,
  })
  for (const columnName of draft.insertEligibleColumns) {
    const boundColumnIndex = view.editTarget.boundIndexByName.get(columnName.toLowerCase())
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

export interface DraftRowRequest {
  view: DataViewState
  draft: DraftRow
  keyColumns: string[]
}

export function openDraftRow(
  ref: DataViewSurfaceRef,
  { view, draft, keyColumns }: DraftRowRequest
) {
  const draftRowIndex = view.slot.viewRowCount
  updateView(ref, {
    selection: { rowIndex: draftRowIndex },
    edit: {
      draftRow: draft.row,
      rowIndex: draftRowIndex,
      baseIndex: null,
      state: buildDraftEditState(view, draft, keyColumns),
      saveError: null,
      isStale: false,
    },
  })
}

interface InsertTable {
  tableInfo: QueryTableEditInfo
  keyColumns: string[]
}

function resolveInsertTable(view: DataViewState): InsertTable | null {
  if (view.edit.draftRow) return null
  const tableInfo = editTableOf(view)
  if (!tableInfo) return null
  if (hasUnsavedModifications(view)) {
    showErrorToast('Unsaved changes', 'Save or discard the current row before adding a row.')
    return null
  }
  const primaryKey = tableInfo.primaryKey
  if (!primaryKey) return null
  if (primaryKey.isUniqueKeyFallback) return null
  return { tableInfo: tableInfo, keyColumns: primaryKey.keyColumns }
}

function initialCellValue(tableColumn: TableDataColumnMeta | undefined): unknown {
  if (!tableColumn) return null
  return getInitialValueForNewRow(tableColumn)
}

function buildNewDraftRow(view: DataViewState, tableInfo: QueryTableEditInfo): DraftRow {
  const row = view.slot.columns.map((_column, index) =>
    initialCellValue(boundTableColumnAt(view, tableInfo, index))
  )
  const modifiedColumns = new Set<string>()
  for (const tableColumn of tableInfo.columns) {
    const isSeededBoundColumn =
      isBoundColumn(view, tableColumn) && isSeededFromColumnDefault(tableColumn)
    if (isSeededBoundColumn) modifiedColumns.add(tableColumn.name)
  }
  return { row: row, modifiedColumns: modifiedColumns, insertEligibleColumns: new Set<string>() }
}

export function insertDraftRow(ref: DataViewSurfaceRef) {
  const view = readView(ref)
  if (!view) return

  const insertTable = resolveInsertTable(view)
  if (!insertTable) return

  openDraftRow(ref, {
    view: view,
    draft: buildNewDraftRow(view, insertTable.tableInfo),
    keyColumns: insertTable.keyColumns,
  })
}
