import type { PrimaryKeyInfo, QueryTableEditInfo, RowEditState } from '../../types/schema'
import { updateResultCell as updateResultCellCmd } from '../../lib/query-commands'
import {
  insertTableRow as insertTableRowCmd,
  updateTableRow as updateTableRowCmd,
} from '../../lib/table-data-commands'
import { applySavedRowValues, isResultsExpiredError } from '../../lib/result-window-cache'
import {
  buildInsertPayload,
  buildUpdatePayload,
  projectSavedCellValue,
} from '../../lib/row-write-payloads'
import { logFrontend, logFrontendWarning } from '../../lib/app-log-commands'
import { hasModifiedColumns } from '../../lib/row-edit-state'
import { toErrorMessage } from '../../lib/error-message'
import { showErrorToast, showSuccessToast, showWarningToast } from '../toast-store'
import type { DataViewState, DataViewSurfaceRef } from './data-view-types'
import {
  CLOSED_EDIT_PATCH,
  DISCARDED_DRAFT_PATCH,
  SAVED_DRAFT_PATCH,
  SAVED_EDIT_PATCH,
} from './data-view-defaults'
import { editTableOf } from './data-view-selectors'
import { isSurfaceOpen, readView, routeOf, updateView, type DataViewRoute } from './route-registry'

const REPLACED_RESULT_MESSAGE_PREFIX = 'Results were refreshed'

interface RowSave {
  ref: DataViewSurfaceRef
  route: DataViewRoute
  view: DataViewState
  editState: RowEditState
  connectionId: string
}

interface RowSaveTarget {
  tableInfo: QueryTableEditInfo
  primaryKey: PrimaryKeyInfo
}

function resolveRowSave(ref: DataViewSurfaceRef): RowSave | null {
  const view = readView(ref)
  const editState = view?.edit.state
  if (!view) return null
  if (!editState) return null
  if (!view.editTarget.tableName) return null
  if (!view.slot.connectionId) return null
  const hasEditedRow = view.edit.rowIndex !== null
  if (!hasEditedRow) return null
  return {
    ref: ref,
    route: routeOf(ref),
    view: view,
    editState: editState,
    connectionId: view.slot.connectionId,
  }
}

function reportRowSaveFailure(save: RowSave, error: unknown): boolean {
  if (!isSurfaceOpen(save.ref)) return false
  const errorMessage = toErrorMessage(error)
  updateView(save.ref, { edit: { saveError: errorMessage } })
  showErrorToast('Save failed', errorMessage)
  return false
}

function showRowSavedToast() {
  showSuccessToast('Row saved', 'Changes saved successfully.')
}

async function insertEditedRow(save: RowSave, target: RowSaveTarget): Promise<boolean> {
  let insertedValues
  try {
    insertedValues = await insertTableRowCmd({
      connectionId: save.connectionId,
      database: target.tableInfo.database,
      table: target.tableInfo.table,
      values: buildInsertPayload(save.editState, target.tableInfo.columns),
      primaryKeyInfo: target.primaryKey,
    })
  } catch (error) {
    return reportRowSaveFailure(save, error)
  }
  if (!isSurfaceOpen(save.ref)) return true
  updateView(save.ref, SAVED_DRAFT_PATCH)
  const isRefreshed = await save.route.writes.afterInsert(save.ref, insertedValues)
  if (isRefreshed) showRowSavedToast()
  return true
}

function handleSlotSyncFailure(save: RowSave, cacheError: unknown): boolean {
  const cacheErrorMessage = toErrorMessage(cacheError)
  if (cacheErrorMessage.includes(REPLACED_RESULT_MESSAGE_PREFIX)) {
    logFrontend(
      'info',
      `[data-view] saved row not synced into a replaced result: ${cacheErrorMessage}`
    )
    return true
  }
  logFrontendWarning('[data-view] Result cache sync failed:', cacheError)
  if (isResultsExpiredError(cacheError)) {
    save.route.lifecycle.onExpired(save.ref)
  }
  showWarningToast(
    'Cache sync warning',
    'Row saved successfully, but the result cache may be stale. Re-run the query to refresh pagination/sort/export.'
  )
  return false
}

function displayedCellUpdates(save: RowSave): Record<number, unknown> {
  const { view, editState, route } = save
  const displayUpdates: Record<number, unknown> = {}
  for (const columnName of editState.modifiedColumns) {
    const columnIndex = view.editTarget.boundIndexByName.get(columnName.toLowerCase())
    if (columnIndex === undefined) continue
    const value = editState.currentValues[columnName]
    displayUpdates[columnIndex] = projectSavedCellValue(value, route.writes.cellProjection)
  }
  return displayUpdates
}

interface SavedRowSlotUpdate {
  baseIndex: number
  queryId: string
  displayUpdates: Record<number, unknown>
}

async function pushSavedRowToSlot(save: RowSave, update: SavedRowSlotUpdate): Promise<boolean> {
  try {
    await updateResultCellCmd({
      connectionId: save.connectionId,
      tabId: save.ref.tabId,
      rowIndex: update.baseIndex,
      updates: update.displayUpdates,
      queryId: update.queryId,
      resultIndex: save.ref.resultIndex,
    })
    return false
  } catch (cacheError) {
    return handleSlotSyncFailure(save, cacheError)
  }
}

async function syncSavedRowIntoSlot(save: RowSave) {
  const baseIndex = save.view.edit.baseIndex
  const queryId = save.view.slot.queryId
  if (baseIndex === null) return
  if (!queryId) return
  const update: SavedRowSlotUpdate = {
    baseIndex: baseIndex,
    queryId: queryId,
    displayUpdates: displayedCellUpdates(save),
  }
  const isSlotReplaced = await pushSavedRowToSlot(save, update)
  if (isSlotReplaced) return
  applySavedRowValues({
    tabId: save.ref.tabId,
    resultIndex: save.ref.resultIndex,
    queryId: queryId,
    baseIndex: baseIndex,
    updates: update.displayUpdates,
  })
}

async function updateEditedRow(save: RowSave, target: RowSaveTarget): Promise<boolean> {
  const built = buildUpdatePayload({
    editState: save.editState,
    keyColumns: target.primaryKey.keyColumns,
    tableColumns: target.tableInfo.columns,
    projection: save.route.writes.cellProjection,
  })
  if (!built.ok) return reportRowSaveFailure(save, built.error)

  try {
    await updateTableRowCmd({
      connectionId: save.connectionId,
      database: target.tableInfo.database,
      table: target.tableInfo.table,
      primaryKeyColumns: built.payload.primaryKeyColumns,
      originalPrimaryKeyValues: built.payload.originalPrimaryKeyValues,
      updatedValues: built.payload.updatedValues,
    })
    if (!isSurfaceOpen(save.ref)) return true
    await syncSavedRowIntoSlot(save)
    if (!isSurfaceOpen(save.ref)) return true
    updateView(save.ref, SAVED_EDIT_PATCH)
    showRowSavedToast()
    return true
  } catch (error) {
    return reportRowSaveFailure(save, error)
  }
}

function resolveSaveTarget(save: RowSave): RowSaveTarget | null {
  const tableInfo = editTableOf(save.view)
  const primaryKey = tableInfo?.primaryKey
  if (!tableInfo) return null
  if (!primaryKey) return null
  return { tableInfo: tableInfo, primaryKey: primaryKey }
}

export async function saveCurrentRow(ref: DataViewSurfaceRef): Promise<boolean> {
  const save = resolveRowSave(ref)
  if (!save) return true

  if (!hasModifiedColumns(save.editState)) {
    updateView(ref, save.editState.isNewRow ? DISCARDED_DRAFT_PATCH : CLOSED_EDIT_PATCH)
    return true
  }

  const target = resolveSaveTarget(save)
  if (!target) {
    const message = 'No primary key info available'
    updateView(ref, { edit: { saveError: message } })
    showErrorToast('Save failed', message)
    return false
  }

  if (save.editState.isNewRow) return insertEditedRow(save, target)
  return updateEditedRow(save, target)
}
