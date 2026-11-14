import type { TableDataTabState } from '../../types/schema'
import { deleteTableRow as deleteTableRowCmd } from '../../lib/table-data-commands'
import type { DeleteTableRowRequest } from '../../lib/table-data-commands'
import { showErrorToast } from '../toast-store'
import { convertBinaryPrimaryKeyValuesToEnvelopes } from '../../lib/blob-utils'
import { findRowIndexByKey, isDraftRowKey } from './row-keys'
import type { RowKey } from './row-keys'
import { removeDraftRow, syncPatchedTableDataCache } from './row-save'
import { markTableDataResident, patchTab, recordTabError } from './table-data-access'
import { useTableDataStore } from '../table-data-store'

function primaryKeyValuesForDelete(
  tabId: string,
  tab: TableDataTabState,
  rowKey: RowKey
): DeleteTableRowRequest | null {
  if (!tab.primaryKey) return null
  const converted = convertBinaryPrimaryKeyValuesToEnvelopes(
    tab.primaryKey.keyColumns,
    tab.columns,
    rowKey
  )
  if (!converted.ok) {
    showErrorToast('Could not delete row', converted.error)
    patchTab(tabId, { error: converted.error })
    return null
  }
  return {
    connectionId: tab.connectionId,
    database: tab.database,
    table: tab.table,
    primaryKeyColumns: tab.primaryKey.keyColumns,
    primaryKeyValues: converted.values,
  }
}

async function removePersistedRowLocally(
  tabId: string,
  sourceTab: TableDataTabState,
  rowKey: RowKey
): Promise<void> {
  const rowIndex = findRowIndexByKey(sourceTab.rows, sourceTab.columns, rowKey)
  if (rowIndex === -1) return
  const newRows = [...sourceTab.rows]
  newRows.splice(rowIndex, 1)
  await syncPatchedTableDataCache('delete', tabId, newRows)
  markTableDataResident(
    tabId,
    { rows: newRows, editState: null, saveError: null },
    { preserveActiveState: true }
  )
}

async function deletePersistedRowInBulk(tabId: string, rowKey: RowKey): Promise<boolean> {
  const tab = useTableDataStore.getState().tabs[tabId]
  if (!tab) return false
  const primaryKeyValues = primaryKeyValuesForDelete(tabId, tab, rowKey)
  if (!primaryKeyValues) return false
  try {
    await deleteTableRowCmd(primaryKeyValues)
    const latest = useTableDataStore.getState().tabs[tabId]
    if (!latest) return false
    await removePersistedRowLocally(tabId, latest, rowKey)
    return true
  } catch (error) {
    recordTabError(tabId, error)
    return false
  }
}

export async function deleteRow(tabId: string, rowKey: Record<string, unknown>): Promise<void> {
  const tab = useTableDataStore.getState().tabs[tabId]
  if (!tab) return

  if (isDraftRowKey(rowKey)) {
    removeDraftRow(tabId, tab, rowKey.__tempId)
    return
  }

  const primaryKeyValues = primaryKeyValuesForDelete(tabId, tab, rowKey)
  if (!primaryKeyValues) return

  try {
    await deleteTableRowCmd(primaryKeyValues)
    if (!useTableDataStore.getState().tabs[tabId]) return
    await removePersistedRowLocally(tabId, tab, rowKey)
  } catch (error) {
    recordTabError(tabId, error)
  }
}

export async function deleteRows(
  tabId: string,
  rowKeys: Record<string, unknown>[]
): Promise<number> {
  if (rowKeys.length === 0) return 0

  let deletedCount = 0
  const draftKeys = rowKeys.filter(isDraftRowKey)
  const persistedKeys = rowKeys.filter((key) => !isDraftRowKey(key))

  for (const key of draftKeys) {
    const tab = useTableDataStore.getState().tabs[tabId]
    if (!tab) return deletedCount
    removeDraftRow(tabId, tab, key.__tempId)
    deletedCount += 1
  }

  if (!useTableDataStore.getState().tabs[tabId]?.primaryKey) return deletedCount

  for (const rowKey of persistedKeys) {
    const deleted = await deletePersistedRowInBulk(tabId, rowKey)
    if (!deleted) break
    deletedCount += 1
  }

  return deletedCount
}

export function rowDeletionActions() {
  return { deleteRow, deleteRows }
}
