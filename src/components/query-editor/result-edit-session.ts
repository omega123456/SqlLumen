import type { DataViewSurfaceRef } from '../../stores/data-view/data-view-types'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { columnIndexFromKey, columnKey } from '../../lib/col-key-utils'
import { toCachedRow } from '../../lib/result-row-materializer'
import type { CachedRow } from '../../lib/result-window-cache'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { DEFAULT_RESULT_STATE, querySurfaceRef, useQueryStore } from '../../stores/query-store'
import type { ColumnMeta, RowEditState, TableDataColumnMeta } from '../../types/schema'
import type {
  BlobContent,
  CellTarget,
  GridRowData,
  RowEditSession,
  RowSaveOutcome,
} from '../shared/data-view/row-edit-session'
import { reportInvalidTemporalValue } from '../shared/row-save-feedback'
import type { TemporalValidationResult } from '../../lib/table-data-save-utils'
import { readEditTable } from './result-panel/result-panel-model'

export interface ResultRowIdentity {
  rowIndex: number
  baseIndex: number
}

export interface ResultEditSessionInputs {
  tabId: string
  resultIndex: number
  queryId: string | null
  viewVersion: number
  columns: ColumnMeta[]
  editMode: string | null
  editableColumnMap: Map<number, boolean>
  editState: RowEditState | null
  editingRowIndex: number | null
  editingBaseIndex: number | null
  editTableColumns: TableDataColumnMeta[]
  editColumnBindings: Map<number, string>
  onStartEditing: (rowIndex: number, row?: CachedRow) => void
  onUpdateCellValue: (columnIndex: number, value: unknown) => void
  onSyncCellValue: (columnIndex: number, value: unknown) => void
  onSaveRow: () => Promise<boolean>
  onDiscardRow: () => void
  onRowSelected: (rowIndex: number) => void
}

interface SelectedResultCell {
  rowIndex: number
  columnKey: string
  value: unknown
}

const MISSING_INDEX = -1
const NO_MODIFIED_COLUMNS: ReadonlySet<string> = new Set()
const NOT_SAVED: RowSaveOutcome = { saved: false, invalidColumnKey: null }

function indexOrMissing(value: unknown): number {
  return typeof value === 'number' ? value : MISSING_INDEX
}

export function resultRowIdentityOf(rowData: GridRowData): ResultRowIdentity {
  return {
    rowIndex: indexOrMissing(rowData.__rowIdx),
    baseIndex: indexOrMissing(rowData.__baseIdx),
  }
}

export function isSameResultRow(left: ResultRowIdentity, right: ResultRowIdentity): boolean {
  const hasBaseIndexes = left.baseIndex >= 0 && right.baseIndex >= 0
  if (hasBaseIndexes) return left.baseIndex === right.baseIndex
  return left.rowIndex === right.rowIndex
}

function editingResultRow(inputs: ResultEditSessionInputs): ResultRowIdentity | null {
  if (inputs.editingRowIndex === null) return null
  return { rowIndex: inputs.editingRowIndex, baseIndex: inputs.editingBaseIndex ?? MISSING_INDEX }
}

function resultColumnIndexOf(inputs: ResultEditSessionInputs, columnKeyText: string): number {
  const columnIndex = columnIndexFromKey(columnKeyText)
  return inputs.columns[columnIndex] ? columnIndex : MISSING_INDEX
}

function isEditableResultColumn(inputs: ResultEditSessionInputs, columnKeyText: string): boolean {
  if (inputs.editMode === null) return false
  return inputs.editableColumnMap.get(columnIndexFromKey(columnKeyText)) ?? false
}

function modifiedResultColumnKeys(inputs: ResultEditSessionInputs): ReadonlySet<string> {
  const modifiedColumns = inputs.editState?.modifiedColumns
  if (!modifiedColumns) return NO_MODIFIED_COLUMNS
  const keys = new Set<string>()
  for (const [columnIndex, boundName] of inputs.editColumnBindings) {
    if (modifiedColumns.has(boundName)) keys.add(columnKey(columnIndex))
  }
  return keys
}

function resultColumnKeyOfBoundName(
  inputs: ResultEditSessionInputs,
  boundName: string
): string | null {
  for (const [columnIndex, candidate] of inputs.editColumnBindings) {
    if (candidate === boundName) return columnKey(columnIndex)
  }
  return null
}

interface ResultRowValidation {
  editState: RowEditState | null
  editTableColumns: TableDataColumnMeta[]
  editingRowIndex: number | null
  onRowSelected: (rowIndex: number) => void
}

function reportInvalidResultRowValue(
  validation: ResultRowValidation
): TemporalValidationResult | null {
  const invalidValue = reportInvalidTemporalValue(validation.editState, validation.editTableColumns)
  if (!invalidValue) return null
  if (validation.editingRowIndex !== null) validation.onRowSelected(validation.editingRowIndex)
  return invalidValue
}

export async function saveResultRow(ref: DataViewSurfaceRef): Promise<boolean> {
  const store = useQueryStore.getState()
  const result = store.tabs[ref.tabId]?.results[ref.resultIndex] ?? DEFAULT_RESULT_STATE
  const invalidValue = reportInvalidResultRowValue({
    editState: result.view.edit.state,
    editTableColumns: readEditTable(result).editTableColumns,
    editingRowIndex: result.view.edit.rowIndex,
    onRowSelected: (rowIndex) => store.setSelectedRow(ref, rowIndex),
  })
  if (invalidValue) return false
  return store.saveCurrentRow(ref)
}

async function saveResultEditingRow(inputs: ResultEditSessionInputs): Promise<RowSaveOutcome> {
  const invalidValue = reportInvalidResultRowValue(inputs)
  if (invalidValue) {
    return {
      ...NOT_SAVED,
      invalidColumnKey: resultColumnKeyOfBoundName(inputs, invalidValue.columnName),
    }
  }
  const saved = await inputs.onSaveRow()
  return { saved: saved, invalidColumnKey: null }
}

function isSameSelection(previous: SelectedResultCell | null, next: SelectedResultCell): boolean {
  if (!previous) return false
  if (previous.rowIndex !== next.rowIndex) return false
  if (previous.columnKey !== next.columnKey) return false
  return Object.is(previous.value, next.value)
}

function selectResultCell(
  inputs: ResultEditSessionInputs,
  lastSelectionRef: RefObject<SelectedResultCell | null>,
  target: CellTarget<ResultRowIdentity>
) {
  const selection = {
    rowIndex: target.rowIndex,
    columnKey: target.columnKey,
    value: target.rowData[target.columnKey],
  }
  if (isSameSelection(lastSelectionRef.current, selection)) return
  lastSelectionRef.current = selection
  inputs.onRowSelected(target.rowIndex)
  const column = inputs.columns[columnIndexFromKey(target.columnKey)]
  if (!column) return
  useQueryStore.getState().setSelectedCell(querySurfaceRef(inputs.tabId, inputs.resultIndex), {
    columnKey: column.name,
    value: selection.value,
  })
}

function inlineBlobContent(target: CellTarget<ResultRowIdentity>): BlobContent {
  const cellValue = target.rowData[target.columnKey]
  return { initialBase64: typeof cellValue === 'string' ? cellValue : null }
}

function updateResultCell(inputs: ResultEditSessionInputs, columnKeyText: string, value: unknown) {
  const columnIndex = resultColumnIndexOf(inputs, columnKeyText)
  if (columnIndex !== MISSING_INDEX) inputs.onUpdateCellValue(columnIndex, value)
}

function syncResultCell(inputs: ResultEditSessionInputs, columnKeyText: string, value: unknown) {
  const columnIndex = resultColumnIndexOf(inputs, columnKeyText)
  if (columnIndex !== MISSING_INDEX) inputs.onSyncCellValue(columnIndex, value)
}

function startEditingResultRow(
  inputs: ResultEditSessionInputs,
  identity: ResultRowIdentity,
  rowData: GridRowData
) {
  inputs.onStartEditing(identity.rowIndex, toCachedRow(rowData, inputs.columns.length))
}

export function useResultEditSession(
  inputs: ResultEditSessionInputs
): RowEditSession<ResultRowIdentity> {
  const { tabId, queryId, viewVersion, columns } = inputs
  const inputsRef = useLatestRef(inputs)
  const lastSelectionRef = useRef<SelectedResultCell | null>(null)
  const canEditRows = inputs.editMode !== null

  useEffect(() => {
    lastSelectionRef.current = null
  }, [tabId, queryId, viewVersion, columns])

  return useMemo(
    () => ({
      tabId: tabId,
      canEditRows: canEditRows,
      identityOf: resultRowIdentityOf,
      isSameRow: isSameResultRow,
      editingRow: () => editingResultRow(inputsRef.current),
      editingRowIndex: (fallbackRowIndex) => inputsRef.current.editingRowIndex ?? fallbackRowIndex,
      rowIndexOf: (identity) => identity.rowIndex,
      columnIndexOf: (columnKeyText) => resultColumnIndexOf(inputsRef.current, columnKeyText),
      isColumnEditable: (columnKeyText) => isEditableResultColumn(inputsRef.current, columnKeyText),
      modifiedColumnKeys: () => modifiedResultColumnKeys(inputsRef.current),
      isEditingNewRow: () => inputsRef.current.editState?.isNewRow === true,
      startEditing: (identity, rowData) =>
        startEditingResultRow(inputsRef.current, identity, rowData),
      updateCell: (columnKeyText, value) =>
        updateResultCell(inputsRef.current, columnKeyText, value),
      commitCellValue: (target, value) =>
        syncResultCell(inputsRef.current, target.columnKey, value),
      selectCell: (target) => selectResultCell(inputsRef.current, lastSelectionRef, target),
      saveEditingRow: () => saveResultEditingRow(inputsRef.current),
      discardEditingRow: () => inputsRef.current.onDiscardRow(),
      blobContentFor: inlineBlobContent,
    }),
    [inputsRef, tabId, canEditRows]
  )
}
