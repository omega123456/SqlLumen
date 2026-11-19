import type { TableDataTabState, RowEditState } from '../../types/schema'
import {
  updateTableRow as updateTableRowCmd,
  insertTableRow as insertTableRowCmd,
} from '../../lib/table-data-commands'
import { hasModifiedColumns } from '../../lib/row-edit-state'
import { showErrorToast } from '../toast-store'
import { logFrontend } from '../../lib/app-log-commands'
import { toErrorMessage } from '../../lib/error-message'
import {
  applyInsertedRow,
  applyUpdatedRow,
  withOriginalValuesRestored,
} from './row-edit-transitions'
import {
  buildPersistedRowKeyFromInsertedData,
  findRowIndexByKey,
  isSameRowKey,
  isSelectedDraftRow,
  restoredSelectedRowKey,
} from './row-keys'
import { buildInsertPayload, buildUpdatePayload } from '../../lib/row-write-payloads'
import { markTableDataResident, patchTab, recordSaveError } from './table-data-access'
import { SYNC_TABLE_DATA_CACHE_COMMANDS, evictTableDataWithWarning } from './table-data-tab-state'
import { useTableDataStore } from '../table-data-store'

export async function syncPatchedTableDataCache(
  mode: 'insert' | 'update' | 'delete',
  tabId: string,
  rows: unknown[][]
) {
  const latestTab = useTableDataStore.getState().tabs[tabId]
  if (!latestTab) return

  const syncParams = {
    connectionId: latestTab.connectionId,
    tabId: tabId,
    database: latestTab.database,
    table: latestTab.table,
    columns: latestTab.columns,
    rows: rows,
    currentPage: latestTab.currentPage,
    pageSize: latestTab.pageSize,
    primaryKey: latestTab.primaryKey,
    executionTimeMs: latestTab.executionTimeMs,
  }

  try {
    const syncResult = await SYNC_TABLE_DATA_CACHE_COMMANDS[mode](syncParams)

    if (syncResult.status !== 'synced') {
      logFrontend(
        'warn',
        `[table-data-store] sync_table_data_cache_after_${mode} returned ${syncResult.status} for ${tabId}`
      )
      evictTableDataWithWarning(
        latestTab.connectionId,
        tabId,
        `after sync_table_data_cache_after_${mode} returned ${syncResult.status}`
      )
    }
  } catch (error) {
    const errorMessage = toErrorMessage(error)
    logFrontend(
      'warn',
      `[table-data-store] sync_table_data_cache_after_${mode} failed for ${tabId}: ${errorMessage}`
    )
    evictTableDataWithWarning(
      latestTab.connectionId,
      tabId,
      `after sync_table_data_cache_after_${mode} failed`
    )
  }
}

async function insertDraftRowUnsafe(
  tabId: string,
  tab: TableDataTabState,
  editState: RowEditState
): Promise<boolean> {
  const { columns, primaryKey } = tab
  if (!primaryKey) throw new Error('No primary key info available')

  const returnedData = await insertTableRowCmd({
    connectionId: tab.connectionId,
    database: tab.database,
    table: tab.table,
    values: buildInsertPayload(editState, columns),
    primaryKeyInfo: primaryKey,
  })
  if (!useTableDataStore.getState().tabs[tabId]) return true

  const newRows = applyInsertedRow(tab.rows, columns, returnedData)
  const persistedRowKey = buildPersistedRowKeyFromInsertedData(returnedData, primaryKey.keyColumns)
  await syncPatchedTableDataCache('insert', tabId, newRows)
  markTableDataResident(
    tabId,
    {
      rows: newRows,
      editState: null,
      saveError: null,
      selectedRowKey: persistedRowKey,
    },
    { preserveActiveState: true }
  )
  return true
}

async function insertDraftRow(
  tabId: string,
  tab: TableDataTabState,
  editState: RowEditState
): Promise<boolean> {
  try {
    return await insertDraftRowUnsafe(tabId, tab, editState)
  } catch (error) {
    return recordSaveError(tabId, error)
  }
}

async function updateEditedRowUnsafe(
  tabId: string,
  tab: TableDataTabState,
  editState: RowEditState
): Promise<boolean> {
  const { columns, primaryKey } = tab
  if (!primaryKey) throw new Error('No primary key info available')

  const built = buildUpdatePayload({
    editState: editState,
    keyColumns: primaryKey.keyColumns,
    tableColumns: columns,
    projection: 'blobPlaceholders',
  })
  if (!built.ok) {
    showErrorToast('Could not save row', built.error)
    patchTab(tabId, { saveError: built.error })
    return false
  }

  await updateTableRowCmd({
    connectionId: tab.connectionId,
    database: tab.database,
    table: tab.table,
    primaryKeyColumns: built.payload.primaryKeyColumns,
    originalPrimaryKeyValues: built.payload.originalPrimaryKeyValues,
    updatedValues: built.payload.updatedValues,
  })
  if (!useTableDataStore.getState().tabs[tabId]) return true

  const newRows = applyUpdatedRow(tab.rows, columns, editState)
  await syncPatchedTableDataCache('update', tabId, newRows)
  markTableDataResident(
    tabId,
    {
      rows: newRows,
      editState: null,
      saveError: null,
    },
    { preserveActiveState: true }
  )
  return true
}

async function updateEditedRow(
  tabId: string,
  tab: TableDataTabState,
  editState: RowEditState
): Promise<boolean> {
  try {
    return await updateEditedRowUnsafe(tabId, tab, editState)
  } catch (error) {
    return recordSaveError(tabId, error)
  }
}

function discardDraftRow(tabId: string, tab: TableDataTabState, editState: RowEditState): void {
  const newRows = [...tab.rows]
  newRows.pop()
  patchTab(tabId, {
    rows: newRows,
    editState: null,
    saveError: null,
    selectedRowKey: isSelectedDraftRow(tab, editState) ? null : tab.selectedRowKey,
  })
}

function restoreEditedRow(tabId: string, tab: TableDataTabState, editState: RowEditState): void {
  const rowIndex = findRowIndexByKey(tab.rows, tab.columns, editState.rowKey)
  if (rowIndex === -1) {
    patchTab(tabId, { editState: null, saveError: null })
    return
  }
  const newRows = [...tab.rows]
  newRows[rowIndex] = withOriginalValuesRestored(
    newRows[rowIndex],
    tab.columns,
    editState.originalValues
  )
  patchTab(tabId, {
    rows: newRows,
    editState: null,
    saveError: null,
    selectedRowKey: restoredSelectedRowKey(tab, editState),
  })
}

export function removeDraftRow(tabId: string, tab: TableDataTabState, tempId: unknown): void {
  const isEditingRemovedDraft = tab.editState?.tempId === tempId
  const newRows = [...tab.rows]
  newRows.pop()
  patchTab(tabId, {
    rows: newRows,
    editState: isEditingRemovedDraft ? null : tab.editState,
    saveError: null,
  })
}

export function clearEditStateIfUnmodified(tabId: string, rowKey: Record<string, unknown>): void {
  const tab = useTableDataStore.getState().tabs[tabId]
  if (!tab?.editState) return
  if (!isSameRowKey(tab.editState.rowKey, rowKey)) return
  if (tab.editState.isNewRow) return
  if (hasModifiedColumns(tab.editState)) return

  patchTab(tabId, { editState: null, saveError: null })
}

export async function saveCurrentRow(tabId: string): Promise<boolean> {
  const tab = useTableDataStore.getState().tabs[tabId]
  if (!tab?.editState) return true

  if (!hasModifiedColumns(tab.editState)) {
    patchTab(tabId, { editState: null, saveError: null })
    return true
  }

  if (tab.editState.isNewRow) {
    return insertDraftRow(tabId, tab, tab.editState)
  }
  return updateEditedRow(tabId, tab, tab.editState)
}

export function discardCurrentRow(tabId: string): void {
  const tab = useTableDataStore.getState().tabs[tabId]
  if (!tab?.editState) return

  if (tab.editState.isNewRow) {
    discardDraftRow(tabId, tab, tab.editState)
    return
  }
  restoreEditedRow(tabId, tab, tab.editState)
}

export async function commitEditingRowIfNeeded(
  tabId: string,
  newRowKey: Record<string, unknown> | null
): Promise<void> {
  const tab = useTableDataStore.getState().tabs[tabId]
  if (!tab?.editState) return
  if (!hasModifiedColumns(tab.editState)) return

  const isStillOnEditedRow =
    Boolean(newRowKey) && isSameRowKey(tab.editState.rowKey, newRowKey ?? null)
  if (isStillOnEditedRow) return

  await useTableDataStore.getState().saveCurrentRow(tabId)
}

export function rowSaveActions() {
  return { clearEditStateIfUnmodified, saveCurrentRow, discardCurrentRow, commitEditingRowIfNeeded }
}
