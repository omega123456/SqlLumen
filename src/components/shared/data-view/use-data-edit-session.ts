import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { columnIndexFromKey, columnKey } from '../../../lib/col-key-utils'
import { isBlobPlaceholderText } from '../../../lib/blob-utils'
import { toCachedRow } from '../../../lib/result-row-materializer'
import type { DataViewState, DataViewSurfaceRef } from '../../../stores/data-view/data-view-types'
import { editTableOf } from '../../../stores/data-view/data-view-selectors'
import {
  discardCurrentRow,
  startEditingRow,
  syncCellValue,
  updateCellValue,
} from '../../../stores/data-view/edit-actions'
import { saveCurrentRow } from '../../../stores/data-view/row-save'
import { setSelectedCell, setSelectedRow } from '../../../stores/data-view/view-actions'
import { currentView, useDataView } from '../../../stores/data-view/use-data-view'
import { storedBlobLoadOf } from '../../../stores/data-view/stored-blobs'
import { showErrorToast } from '../../../stores/toast-store'
import { reportInvalidTemporalValue } from '../row-save-feedback'
import type {
  BlobContent,
  CellTarget,
  GridRowData,
  RowEditSession,
  RowSaveOutcome,
} from './row-edit-session'

export interface DataRowIdentity {
  rowIndex: number
  baseIndex: number
}

interface SelectedDataCell {
  rowIndex: number
  columnKey: string
  value: unknown
}

const MISSING_INDEX = -1
const NO_MODIFIED_COLUMNS: ReadonlySet<string> = new Set()

function indexOrMissing(value: unknown): number {
  return typeof value === 'number' ? value : MISSING_INDEX
}

export function dataRowIdentityOf(rowData: GridRowData): DataRowIdentity {
  return {
    rowIndex: indexOrMissing(rowData.__rowIdx),
    baseIndex: indexOrMissing(rowData.__baseIdx),
  }
}

export function isSameDataRow(left: DataRowIdentity, right: DataRowIdentity): boolean {
  const hasBaseIndexes = left.baseIndex >= 0 && right.baseIndex >= 0
  if (hasBaseIndexes) return left.baseIndex === right.baseIndex
  return left.rowIndex === right.rowIndex
}

function editingDataRow(view: DataViewState): DataRowIdentity | null {
  const rowIndex = view.edit.rowIndex
  if (rowIndex === null) return null
  return { rowIndex: rowIndex, baseIndex: view.edit.baseIndex ?? MISSING_INDEX }
}

function dataColumnIndexOf(view: DataViewState, columnKeyText: string): number {
  const columnIndex = columnIndexFromKey(columnKeyText)
  return view.slot.columns[columnIndex] ? columnIndex : MISSING_INDEX
}

function isEditableDataColumn(view: DataViewState, columnKeyText: string): boolean {
  const hasEditTarget = view.editTarget.tableName !== null
  if (!hasEditTarget) return false
  return view.editTarget.editableColumns.get(columnIndexFromKey(columnKeyText)) ?? false
}

function modifiedDataColumnKeys(view: DataViewState): ReadonlySet<string> {
  const modifiedColumns = view.edit.state?.modifiedColumns
  if (!modifiedColumns) return NO_MODIFIED_COLUMNS
  const keys = new Set<string>()
  for (const [columnIndex, boundName] of view.editTarget.bindings) {
    if (modifiedColumns.has(boundName)) keys.add(columnKey(columnIndex))
  }
  return keys
}

function columnKeyOfBoundName(view: DataViewState, boundName: string): string | null {
  for (const [columnIndex, candidate] of view.editTarget.bindings) {
    if (candidate === boundName) return columnKey(columnIndex)
  }
  return null
}

export async function saveDataRow(ref: DataViewSurfaceRef): Promise<RowSaveOutcome> {
  const view = currentView(ref)
  const editTableColumns = editTableOf(view)?.columns ?? []
  const invalidValue = reportInvalidTemporalValue(view.edit.state, editTableColumns)
  if (invalidValue) {
    const editingRowIndex = view.edit.rowIndex
    if (editingRowIndex !== null) setSelectedRow(ref, editingRowIndex)
    return {
      saved: false,
      invalidColumnKey: columnKeyOfBoundName(view, invalidValue.columnName),
    }
  }
  const saved = await saveCurrentRow(ref)
  return { saved: saved, invalidColumnKey: null }
}

function isSameSelection(previous: SelectedDataCell | null, next: SelectedDataCell): boolean {
  if (!previous) return false
  if (previous.rowIndex !== next.rowIndex) return false
  if (previous.columnKey !== next.columnKey) return false
  return Object.is(previous.value, next.value)
}

interface CellSelection {
  ref: DataViewSurfaceRef
  lastSelectionRef: RefObject<SelectedDataCell | null>
  target: CellTarget<DataRowIdentity>
}

function selectDataCell({ ref, lastSelectionRef, target }: CellSelection) {
  const selection = {
    rowIndex: target.rowIndex,
    columnKey: target.columnKey,
    value: target.rowData[target.columnKey],
  }
  if (isSameSelection(lastSelectionRef.current, selection)) return
  lastSelectionRef.current = selection
  setSelectedRow(ref, target.rowIndex)
  const column = currentView(ref).slot.columns[columnIndexFromKey(target.columnKey)]
  if (!column) return
  setSelectedCell(ref, { columnKey: column.name, value: selection.value })
}

function storedBlobContent(
  ref: DataViewSurfaceRef,
  target: CellTarget<DataRowIdentity>
): BlobContent | null {
  const stored = storedBlobLoadOf(ref, {
    columnIndex: columnIndexFromKey(target.columnKey),
    valueAt: (columnIndex) => target.rowData[columnKey(columnIndex)],
  })
  if (!stored) return null
  if (!stored.ok) {
    showErrorToast('Could not open BLOB viewer', stored.error)
    return null
  }
  return { loader: stored.load }
}

function dataBlobContent(
  ref: DataViewSurfaceRef,
  target: CellTarget<DataRowIdentity>
): BlobContent | null {
  const cellValue = target.rowData[target.columnKey]
  if (isBlobPlaceholderText(cellValue)) return storedBlobContent(ref, target)
  return { initialBase64: typeof cellValue === 'string' ? cellValue : null }
}

function writeDataCell(ref: DataViewSurfaceRef, columnKeyText: string, value: unknown) {
  const columnIndex = dataColumnIndexOf(currentView(ref), columnKeyText)
  if (columnIndex !== MISSING_INDEX) updateCellValue(ref, columnIndex, value)
}

function commitDataCell(ref: DataViewSurfaceRef, columnKeyText: string, value: unknown) {
  const columnIndex = dataColumnIndexOf(currentView(ref), columnKeyText)
  if (columnIndex !== MISSING_INDEX) syncCellValue(ref, columnIndex, value)
}

function startEditingDataRow(
  ref: DataViewSurfaceRef,
  identity: DataRowIdentity,
  rowData: GridRowData
) {
  const columnCount = currentView(ref).slot.columns.length
  startEditingRow(ref, identity.rowIndex, toCachedRow(rowData, columnCount))
}

export function useDataEditSession(ref: DataViewSurfaceRef): RowEditSession<DataRowIdentity> {
  const canEditRows = useDataView(ref, (view) => view.editTarget.tableName !== null)
  const slot = useDataView(ref, (view) => view.slot)
  const lastSelectionRef = useRef<SelectedDataCell | null>(null)

  useEffect(() => {
    lastSelectionRef.current = null
  }, [slot])

  return useMemo(
    () => ({
      tabId: ref.tabId,
      canEditRows: canEditRows,
      identityOf: dataRowIdentityOf,
      isSameRow: isSameDataRow,
      editingRow: () => editingDataRow(currentView(ref)),
      editingRowIndex: (fallbackRowIndex) => currentView(ref).edit.rowIndex ?? fallbackRowIndex,
      rowIndexOf: (identity) => identity.rowIndex,
      columnIndexOf: (columnKeyText) => dataColumnIndexOf(currentView(ref), columnKeyText),
      isColumnEditable: (columnKeyText) => isEditableDataColumn(currentView(ref), columnKeyText),
      modifiedColumnKeys: () => modifiedDataColumnKeys(currentView(ref)),
      isEditingNewRow: () => currentView(ref).edit.state?.isNewRow === true,
      startEditing: (identity, rowData) => startEditingDataRow(ref, identity, rowData),
      updateCell: (columnKeyText, value) => writeDataCell(ref, columnKeyText, value),
      commitCellValue: (target, value) => commitDataCell(ref, target.columnKey, value),
      selectCell: (target) =>
        selectDataCell({ ref: ref, lastSelectionRef: lastSelectionRef, target: target }),
      saveEditingRow: () => saveDataRow(ref),
      discardEditingRow: () => discardCurrentRow(ref),
      blobContentFor: (target) => dataBlobContent(ref, target),
    }),
    [ref, canEditRows]
  )
}
