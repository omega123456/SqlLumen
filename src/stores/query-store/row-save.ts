import type { PrimaryKeyInfo, QueryTableEditInfo, RowEditState } from '../../types/schema'
import { updateResultCell as updateResultCellCmd } from '../../lib/query-commands'
import {
  insertTableRow as insertTableRowCmd,
  updateTableRow as updateTableRowCmd,
} from '../../lib/table-data-commands'
import { applySavedRowValues } from '../../lib/result-window-cache'
import { showErrorToast, showSuccessToast, showWarningToast } from '../toast-store'
import { buildInsertPayload, buildUpdatePayload } from '../../lib/query-edit-utils'
import { logFrontend, logFrontendWarning } from '../../lib/app-log-commands'
import { hasModifiedColumns } from '../../lib/row-edit-state'
import { toErrorMessage } from '../../lib/error-message'
import type { SingleResultState, ResultPatch } from './query-state-types'
import { markTabResultsExpired, patchResultByIndex, getQueryState } from './query-store-access'
import type { DataViewSurfaceRef } from '../data-view/data-view-types'
import { displayedCellUpdates } from './row-edit-builders'
import { mergeResultPatches } from './query-tab-reducers'
import {
  reexecuteOnlyResultAfterMutation,
  reexecuteSingleResultAfterMutation,
} from './row-save-rerun'

export interface RowSaveContext {
  connectionId: string
  tabId: string
  resultIndex: number
  result: SingleResultState
  editState: RowEditState
  editMode: string
  isMultiResultTab: boolean
}

interface RowSaveTarget {
  tableInfo: QueryTableEditInfo
  primaryKey: PrimaryKeyInfo
}

interface SavedRowCacheUpdate {
  baseIndex: number
  queryId: string
  displayUpdates: Record<number, unknown>
}

function resolveRowSave({ tabId, resultIndex }: DataViewSurfaceRef): RowSaveContext | null {
  const tab = getQueryState().tabs[tabId]
  const result = tab?.results[resultIndex]
  if (!result?.view.edit.state) return null
  if (!result.view.editTarget.tableName) return null
  if (!result.view.slot.connectionId) return null
  const editingRowIndex = result.view.edit.rowIndex
  if (editingRowIndex === null) return null
  return {
    connectionId: result.view.slot.connectionId,
    tabId: tabId,
    resultIndex: resultIndex,
    result: result,
    editState: result.view.edit.state,
    editMode: result.view.editTarget.tableName,
    isMultiResultTab: (tab?.results.length ?? 0) > 1,
  }
}

function clearUnmodifiedRowEdit(save: RowSaveContext) {
  const editReset: ResultPatch = {
    view: { edit: { state: null, rowIndex: null, baseIndex: null, saveError: null } },
  }
  const draftReset: ResultPatch = {
    view: { edit: { draftRow: null }, selection: { rowIndex: null } },
  }
  const reset = save.editState.isNewRow ? mergeResultPatches(editReset, draftReset) : editReset
  patchResultByIndex(save.tabId, save.resultIndex, reset)
}

function reportRowSaveFailure(save: RowSaveContext, error: unknown): boolean {
  if (!getQueryState().tabs[save.tabId]) return false
  const errorMessage = toErrorMessage(error)
  patchResultByIndex(save.tabId, save.resultIndex, { view: { edit: { saveError: errorMessage } } })
  showErrorToast('Save failed', errorMessage)
  return false
}

async function rerunResultAfterMutation(save: RowSaveContext, sql: string) {
  const rerun = save.isMultiResultTab
    ? reexecuteSingleResultAfterMutation
    : reexecuteOnlyResultAfterMutation
  await rerun(save, sql)
}

async function refreshResultAfterInsert(save: RowSaveContext) {
  const { tabId, resultIndex, result } = save
  const sql = result.lastExecutedSql
  if (!sql) {
    showSuccessToast('Row saved', 'Changes saved successfully.')
    return
  }
  try {
    await rerunResultAfterMutation(save, sql)
  } catch (refreshError) {
    if (!getQueryState().tabs[tabId]) return
    patchResultByIndex(tabId, resultIndex, { view: { edit: { isStale: true } } })
    showErrorToast(
      'Refresh failed',
      `Row inserted successfully, but the query result could not be refreshed: ${toErrorMessage(refreshError)}`
    )
    return
  }
  showSuccessToast('Row saved', 'Changes saved successfully.')
}

async function insertEditedRow(save: RowSaveContext, target: RowSaveTarget): Promise<boolean> {
  const { tabId, resultIndex } = save
  try {
    await insertTableRowCmd({
      connectionId: save.connectionId,
      database: target.tableInfo.database,
      table: target.tableInfo.table,
      values: buildInsertPayload(save.editState, target.tableInfo.columns),
      primaryKeyInfo: target.primaryKey,
    })
  } catch (error) {
    return reportRowSaveFailure(save, error)
  }
  if (!getQueryState().tabs[tabId]) return true
  patchResultByIndex(tabId, resultIndex, {
    view: {
      selection: { rowIndex: null },
      edit: {
        draftRow: null,
        state: null,
        rowIndex: null,
        baseIndex: null,
        saveError: null,
        isStale: false,
      },
    },
  })
  await refreshResultAfterInsert(save)
  return true
}

function handleResultCacheSyncFailure(tabId: string, cacheError: unknown): boolean {
  const cacheErrorMessage = toErrorMessage(cacheError)
  if (cacheErrorMessage.includes('Results were refreshed')) {
    logFrontend(
      'info',
      `[query-store] saved row not synced into a replaced result: ${cacheErrorMessage}`
    )
    return true
  }
  logFrontendWarning('[query-store] Result cache sync failed:', cacheError)
  if (cacheErrorMessage.includes('results_expired')) {
    markTabResultsExpired(tabId)
  }
  showWarningToast(
    'Cache sync warning',
    'Row saved successfully, but the result cache may be stale. Re-run the query to refresh pagination/sort/export.'
  )
  return false
}

async function pushSavedRowToResultCache(
  save: RowSaveContext,
  update: SavedRowCacheUpdate
): Promise<boolean> {
  try {
    await updateResultCellCmd({
      connectionId: save.connectionId,
      tabId: save.tabId,
      rowIndex: update.baseIndex,
      updates: update.displayUpdates,
      queryId: update.queryId,
      resultIndex: save.resultIndex,
    })
    return false
  } catch (cacheError) {
    return handleResultCacheSyncFailure(save.tabId, cacheError)
  }
}

async function syncSavedRowIntoResult(save: RowSaveContext) {
  const baseIndex = save.result.view.edit.baseIndex
  const queryId = save.result.view.slot.queryId
  if (baseIndex === null) return
  if (!queryId) return
  const displayUpdates = displayedCellUpdates(save.result, save.editState)
  const isResultReplaced = await pushSavedRowToResultCache(save, {
    baseIndex: baseIndex,
    queryId: queryId,
    displayUpdates: displayUpdates,
  })
  if (isResultReplaced) return
  applySavedRowValues({
    tabId: save.tabId,
    resultIndex: save.resultIndex,
    queryId: queryId,
    baseIndex: baseIndex,
    updates: displayUpdates,
  })
}

async function updateEditedRow(save: RowSaveContext, target: RowSaveTarget): Promise<boolean> {
  const { tabId, resultIndex } = save
  const {
    pkColumns,
    originalPkValues: originalPrimaryKeyValues,
    updatedValues,
  } = buildUpdatePayload(save.editState, target.primaryKey.keyColumns, target.tableInfo.columns)

  try {
    await updateTableRowCmd({
      connectionId: save.connectionId,
      database: target.tableInfo.database,
      table: target.tableInfo.table,
      primaryKeyColumns: pkColumns,
      originalPrimaryKeyValues: originalPrimaryKeyValues,
      updatedValues: updatedValues,
    })
    if (!getQueryState().tabs[tabId]) return true
    await syncSavedRowIntoResult(save)
    if (!getQueryState().tabs[tabId]) return true
    patchResultByIndex(tabId, resultIndex, {
      view: {
        edit: { state: null, rowIndex: null, baseIndex: null, saveError: null, isStale: false },
      },
    })
    showSuccessToast('Row saved', 'Changes saved successfully.')
    return true
  } catch (error) {
    return reportRowSaveFailure(save, error)
  }
}

export async function saveCurrentRow(ref: DataViewSurfaceRef): Promise<boolean> {
  const save = resolveRowSave(ref)
  if (!save) return true

  if (!hasModifiedColumns(save.editState)) {
    clearUnmodifiedRowEdit(save)
    return true
  }

  const tableInfo = save.result.view.editTarget.tables[save.editMode]
  const primaryKey = tableInfo?.primaryKey
  if (!primaryKey) {
    const message = 'No primary key info available'
    patchResultByIndex(save.tabId, save.resultIndex, { view: { edit: { saveError: message } } })
    showErrorToast('Save failed', message)
    return false
  }

  const target: RowSaveTarget = { tableInfo: tableInfo, primaryKey: primaryKey }
  if (save.editState.isNewRow) {
    return insertEditedRow(save, target)
  }
  return updateEditedRow(save, target)
}

export function rowSaveActions() {
  return { saveCurrentRow }
}
