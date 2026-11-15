import { useMemo } from 'react'
import {
  useTableDataStore,
  isSameRowKey,
  findRowIndexByKey as findStoreRowIndexByKey,
} from '../../stores/table-data-store'
import { showErrorToast, showSuccessToast } from '../../stores/toast-store'
import { buildEnvelopedPrimaryKeyPairs } from '../../lib/blob-utils'
import { fetchBlobValue } from '../../lib/table-data-commands'
import type { TableDataColumnMeta } from '../../types/schema'
import type { GridColumnDescriptor } from '../../types/shared-data-view'
import type {
  BlobContent,
  CellTarget,
  GridRowData,
  RowEditSession,
  RowSaveOutcome,
} from '../shared/data-view/row-edit-session'
import { reportInvalidTemporalValue } from '../shared/row-save-feedback'
import {
  currentValuesFromRow,
  getRowKey,
  resolveRestoreRowIndex,
  type RowKey,
} from './table-data-grid/table-data-grid-model'

export interface TableEditSessionInputs {
  tabId: string
  columns: TableDataColumnMeta[]
  primaryKeyColumns: string[]
  descriptorColumns: GridColumnDescriptor[]
  canEditRows: boolean
}

const NOT_FOUND = -1
const NO_MODIFIED_COLUMNS: ReadonlySet<string> = new Set()
const SAVED: RowSaveOutcome = { saved: true, invalidColumnKey: null }
const SAVE_FAILED: RowSaveOutcome = { saved: false, invalidColumnKey: null }

function liveTab(tabId: string) {
  return useTableDataStore.getState().tabs[tabId]
}

function liveEditState(tabId: string) {
  return liveTab(tabId)?.editState ?? null
}

function storeRowIndexOf(tabId: string, rowKey: RowKey): number {
  const tab = liveTab(tabId)
  if (!tab) return NOT_FOUND
  const isDraftRowKey = '__tempId' in rowKey
  if (!isDraftRowKey) return findStoreRowIndexByKey(tab.rows, tab.columns, rowKey)
  const isEditingDraft = isSameRowKey(tab.editState?.rowKey ?? null, rowKey)
  return isEditingDraft ? tab.rows.length - 1 : NOT_FOUND
}

function selectEditingRow(tabId: string): void {
  const editState = liveEditState(tabId)
  if (editState) useTableDataStore.getState().setSelectedRow(tabId, editState.rowKey)
}

export async function saveTableEditingRow(
  tabId: string,
  columns: TableDataColumnMeta[]
): Promise<RowSaveOutcome> {
  const invalidValue = reportInvalidTemporalValue(liveEditState(tabId), columns)
  if (invalidValue) {
    selectEditingRow(tabId)
    return { saved: false, invalidColumnKey: invalidValue.columnName }
  }
  await useTableDataStore.getState().saveCurrentRow(tabId)
  const savedTab = liveTab(tabId)
  if (savedTab?.saveError) {
    showErrorToast('Save failed', savedTab.saveError)
    selectEditingRow(tabId)
    return SAVE_FAILED
  }
  const isEditFinished = savedTab !== undefined && !savedTab.editState
  if (isEditFinished) showSuccessToast('Row saved', 'Changes saved successfully.')
  return SAVED
}

function commitTableCellValue(tabId: string, target: CellTarget<RowKey>, value: unknown): void {
  const store = useTableDataStore.getState()
  store.updateCellValue(tabId, target.columnKey, value)
  store.syncCellValue(tabId, {
    rowData: target.rowData,
    column: target.columnKey,
    value: value,
    rowKeyOverride: target.identity,
  })
}

function selectTableCell(tabId: string, target: CellTarget<RowKey>): void {
  const store = useTableDataStore.getState()
  store.setSelectedRow(tabId, target.identity)
  store.setSelectedCell(tabId, {
    columnKey: target.columnKey,
    value: target.rowData[target.columnKey],
  })
}

function tableBlobContent(
  inputs: TableEditSessionInputs,
  target: CellTarget<RowKey>
): BlobContent | null {
  const { tabId, columns, primaryKeyColumns } = inputs
  const tab = liveTab(tabId)
  if (!tab) return null
  if (primaryKeyColumns.length === 0) return null
  const primaryKey = buildEnvelopedPrimaryKeyPairs(primaryKeyColumns, columns, target.rowData)
  if (!primaryKey.ok) {
    showErrorToast('Could not open BLOB viewer', primaryKey.error)
    return null
  }
  return {
    loader: () =>
      fetchBlobValue({
        connectionId: tab.connectionId,
        database: tab.database,
        table: tab.table,
        column: target.columnKey,
        primaryKeyPairs: primaryKey.pairs,
      }),
  }
}

function createTableEditSession(inputs: TableEditSessionInputs): RowEditSession<RowKey> {
  const { tabId, columns, primaryKeyColumns, descriptorColumns } = inputs
  const columnIndexOf = (columnKey: string) =>
    descriptorColumns.findIndex((column) => column.key === columnKey)
  return {
    tabId: tabId,
    canEditRows: inputs.canEditRows,
    identityOf: (rowData: GridRowData) => getRowKey(rowData, primaryKeyColumns),
    isSameRow: isSameRowKey,
    editingRow: () => liveEditState(tabId)?.rowKey ?? null,
    editingRowIndex: (fallbackRowIndex) => resolveRestoreRowIndex(liveTab(tabId), fallbackRowIndex),
    rowIndexOf: (rowKey) => storeRowIndexOf(tabId, rowKey),
    columnIndexOf: columnIndexOf,
    isColumnEditable: (columnKey) => descriptorColumns[columnIndexOf(columnKey)]?.editable === true,
    modifiedColumnKeys: () => liveEditState(tabId)?.modifiedColumns ?? NO_MODIFIED_COLUMNS,
    isEditingNewRow: () => liveEditState(tabId)?.isNewRow === true,
    startEditing: (rowKey, rowData) =>
      useTableDataStore
        .getState()
        .startEditing(tabId, rowKey, currentValuesFromRow(columns, rowData)),
    updateCell: (columnKey, value) =>
      useTableDataStore.getState().updateCellValue(tabId, columnKey, value),
    commitCellValue: (target, value) => commitTableCellValue(tabId, target, value),
    selectCell: (target) => selectTableCell(tabId, target),
    saveEditingRow: () => saveTableEditingRow(tabId, columns),
    discardEditingRow: () => useTableDataStore.getState().discardCurrentRow(tabId),
    blobContentFor: (target) => tableBlobContent(inputs, target),
  }
}

export function useTableEditSession(inputs: TableEditSessionInputs): RowEditSession<RowKey> {
  const { tabId, columns, primaryKeyColumns, descriptorColumns, canEditRows } = inputs
  return useMemo(
    () =>
      createTableEditSession({
        tabId: tabId,
        columns: columns,
        primaryKeyColumns: primaryKeyColumns,
        descriptorColumns: descriptorColumns,
        canEditRows: canEditRows,
      }),
    [tabId, columns, primaryKeyColumns, descriptorColumns, canEditRows]
  )
}
