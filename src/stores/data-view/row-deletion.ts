import type { QueryTableEditInfo, RemoveResultRowsResult } from '../../types/schema'
import {
  removeResultRows as removeResultRowsCmd,
  type ResultSlotRef,
} from '../../lib/query-commands'
import { deleteTableRow as deleteTableRowCmd } from '../../lib/table-data-commands'
import {
  isResultsExpiredError,
  parseSupersededVersion,
  readViewRange,
  type CachedRow,
  type ViewRange,
} from '../../lib/result-window-cache'
import { formatCount } from '../../lib/format-row-count'
import { MAX_BULK_DELETE_ROWS } from '../../lib/data-view-limits'
import { countRanges } from '../../lib/view-ranges'
import { logFrontend } from '../../lib/app-log-commands'
import { toErrorMessage } from '../../lib/error-message'
import { buildDeletePrimaryKeyValues, type CellProjection } from '../../lib/row-write-payloads'
import { showErrorToast, showSuccessToast } from '../toast-store'
import type { DataViewPatch, DataViewState, DataViewSurfaceRef } from './data-view-types'
import { CLOSED_EDIT_PATCH } from './data-view-defaults'
import { mergeViewPatches } from './data-view-reducers'
import {
  boundColumnIndexOf,
  deleteTargetRangesOf,
  hasStaleCheckedRows,
  slotRefOf,
} from './data-view-selectors'
import { closeEditSession, notifyEditClosed } from './edit-actions'
import { beginRowAction } from './row-action-progress'
import { isSurfaceOpen, readView, routeOf, updateView } from './route-registry'

interface RowDeletionPlan {
  connectionId: string
  tableInfo: QueryTableEditInfo
  keyColumns: string[]
  keyColumnIndices: number[]
  projection: CellProjection
}

function resolveRowDeletionPlan(
  ref: DataViewSurfaceRef,
  view: DataViewState
): RowDeletionPlan | null {
  const tableName = view.editTarget.tableName
  if (!tableName) {
    showErrorToast('Delete failed', 'Enable edit mode to delete rows from the database.')
    return null
  }
  const tableInfo = view.editTarget.tables[tableName]
  if (!tableInfo?.primaryKey) {
    showErrorToast('Delete failed', `Cannot delete ${tableName}: no primary or unique key.`)
    return null
  }
  if (!view.slot.connectionId) {
    showErrorToast('Delete failed', 'No active connection available for deletion.')
    return null
  }
  const keyColumns = tableInfo.primaryKey.keyColumns
  const keyColumnIndices = keyColumns.map((column) => boundColumnIndexOf(view, column) ?? -1)
  if (keyColumnIndices.some((index) => index < 0)) {
    showErrorToast(
      'Delete failed',
      `Result set does not contain the key columns (${keyColumns.join(', ')}).`
    )
    return null
  }
  return {
    connectionId: view.slot.connectionId,
    tableInfo: tableInfo,
    keyColumns: keyColumns,
    keyColumnIndices: keyColumnIndices,
    projection: routeOf(ref).writes.cellProjection,
  }
}

function primaryKeyValuesOf(plan: RowDeletionPlan, row: unknown[]): Record<string, unknown> {
  const cellValues: Record<string, unknown> = {}
  plan.keyColumns.forEach((column, columnIndex) => {
    cellValues[column] = row[plan.keyColumnIndices[columnIndex]]
  })
  const converted = buildDeletePrimaryKeyValues({
    keyColumns: plan.keyColumns,
    tableColumns: plan.tableInfo.columns,
    values: cellValues,
    projection: plan.projection,
  })
  if (!converted.ok) throw new Error(converted.error)
  return converted.values
}

interface RowDeletion {
  ref: DataViewSurfaceRef
  view: DataViewState
  targetRanges: ViewRange[]
}

interface RowDeletionOutcome {
  deletedBaseIndices: number[]
  failureMessage: string | null
  isSurfaceClosed: boolean
}

async function readTargetRows(deletion: RowDeletion): Promise<CachedRow[]> {
  const { ref, targetRanges } = deletion
  const targets: CachedRow[] = []
  for (const range of targetRanges) {
    const rows = await readViewRange({
      tabId: ref.tabId,
      resultIndex: ref.resultIndex,
      range: range,
    })
    targets.push(...rows)
  }
  return targets
}

async function loadRowsToDelete(deletion: RowDeletion): Promise<CachedRow[]> {
  try {
    return await readTargetRows(deletion)
  } catch (error) {
    if (isResultsExpiredError(error)) {
      routeOf(deletion.ref).lifecycle.onExpired(deletion.ref)
      return []
    }
    const message = toErrorMessage(error)
    logFrontend('warn', `[data-view] could not load the rows to delete: ${message}`)
    showErrorToast('Delete failed', message)
    return []
  }
}

interface DatabaseRowDeletion {
  ref: DataViewSurfaceRef
  plan: RowDeletionPlan
  targets: CachedRow[]
}

async function deleteRowsInDatabase({
  ref,
  plan,
  targets,
}: DatabaseRowDeletion): Promise<RowDeletionOutcome> {
  const action = beginRowAction(ref, { verb: 'Deleting', total: targets.length })
  const outcome: RowDeletionOutcome = {
    deletedBaseIndices: [],
    failureMessage: null,
    isSurfaceClosed: false,
  }
  for (const target of targets) {
    if (!isSurfaceOpen(ref)) {
      outcome.isSurfaceClosed = true
      break
    }
    try {
      await deleteTableRowCmd({
        connectionId: plan.connectionId,
        database: plan.tableInfo.database,
        table: plan.tableInfo.table,
        primaryKeyColumns: plan.keyColumns,
        primaryKeyValues: primaryKeyValuesOf(plan, target.row),
      })
      outcome.deletedBaseIndices.push(target.baseIndex)
      action.update(outcome.deletedBaseIndices.length)
    } catch (error) {
      outcome.failureMessage = toErrorMessage(error)
      showErrorToast('Delete failed', outcome.failureMessage)
      break
    }
  }
  action.finish()
  return outcome
}

interface RowRemoval {
  slot: ResultSlotRef | null
  baseViewVersion: number
  deletedBaseIndices: number[]
}

async function removeDeletedRowsFromView(removal: RowRemoval): Promise<RemoveResultRowsResult> {
  const { slot, baseViewVersion, deletedBaseIndices } = removal
  if (!slot) throw new Error('Result is no longer available')
  try {
    return await removeResultRowsCmd({
      ...slot,
      baseViewVersion: baseViewVersion,
      baseIndices: deletedBaseIndices,
    })
  } catch (error) {
    const supersededVersion = parseSupersededVersion(error)
    if (supersededVersion === null) throw error
    return removeResultRowsCmd({
      ...slot,
      baseViewVersion: supersededVersion,
      baseIndices: deletedBaseIndices,
    })
  }
}

interface TombstonedRows {
  viewAfterDelete: DataViewState
  removed: RemoveResultRowsResult
}

function deletedEditPatch(outcome: RowDeletionOutcome): DataViewPatch {
  return mergeViewPatches(CLOSED_EDIT_PATCH, { edit: { saveError: outcome.failureMessage } })
}

function applyTombstonedView(
  deletion: RowDeletion,
  outcome: RowDeletionOutcome,
  { viewAfterDelete, removed }: TombstonedRows
) {
  const { ref } = deletion
  const route = routeOf(ref)
  const deletePatch = deletedEditPatch(outcome)
  const committedVersion = Math.max(
    route.viewRequests.latestKnownVersion(ref),
    viewAfterDelete.slot.viewVersion
  )
  const isNewerViewCommitted = removed.viewVersion < committedVersion
  if (isNewerViewCommitted) {
    closeEditSession(ref, mergeViewPatches(deletePatch, { checked: { ranges: [] } }))
    return
  }
  route.viewRequests.paint(ref, {
    spec: { sort: viewAfterDelete.spec.sort, filters: viewAfterDelete.spec.filters },
    view: {
      viewVersion: removed.viewVersion,
      viewRowCount: removed.viewRowCount,
      totalRows: removed.totalRows,
    },
    extra: deletePatch,
  })
  notifyEditClosed(ref)
}

function rowsWord(count: number): string {
  return count === 1 ? 'row' : 'rows'
}

function reportTombstoneFailure(
  deletion: RowDeletion,
  outcome: RowDeletionOutcome,
  refreshError: unknown
) {
  const deletedCount = outcome.deletedBaseIndices.length
  logFrontend(
    'warn',
    `[data-view] remove_result_rows failed after deleting ${deletedCount} rows: ${toErrorMessage(refreshError)}`
  )
  if (isSurfaceOpen(deletion.ref)) {
    updateView(deletion.ref, {
      checked: { ranges: [] },
      edit: { isStale: true, saveError: outcome.failureMessage },
    })
  }
  const advice = routeOf(deletion.ref).writes.staleResultAdvice
  showErrorToast(
    'Refresh failed',
    `${formatCount(deletedCount)} ${rowsWord(deletedCount)} deleted, but the result couldn't be updated. ${advice}`
  )
}

async function tombstoneDeletedRows(
  deletion: RowDeletion,
  outcome: RowDeletionOutcome
): Promise<boolean> {
  const { ref, view } = deletion
  try {
    const removed = await removeDeletedRowsFromView({
      slot: slotRefOf(ref, view),
      baseViewVersion: routeOf(ref).viewRequests.latestKnownVersion(ref),
      deletedBaseIndices: outcome.deletedBaseIndices,
    })
    const viewAfterDelete = readView(ref)
    if (!viewAfterDelete) return false
    const isSameSlot = viewAfterDelete.slot.queryId === view.slot.queryId
    if (!isSameSlot) return false
    applyTombstonedView(deletion, outcome, {
      viewAfterDelete: viewAfterDelete,
      removed: removed,
    })
    return true
  } catch (refreshError) {
    reportTombstoneFailure(deletion, outcome, refreshError)
    return false
  }
}

async function finishRowDeletion(deletion: RowDeletion, outcome: RowDeletionOutcome) {
  const deletedCount = outcome.deletedBaseIndices.length
  if (deletedCount === 0) {
    if (outcome.failureMessage) {
      updateView(deletion.ref, { edit: { saveError: outcome.failureMessage } })
    }
    return
  }
  const isViewRefreshed = await tombstoneDeletedRows(deletion, outcome)
  if (!isViewRefreshed) return
  if (outcome.failureMessage) return
  showSuccessToast(
    'Rows deleted',
    `${deletedCount} ${rowsWord(deletedCount)} deleted successfully.`
  )
}

export async function deleteRows(ref: DataViewSurfaceRef): Promise<number> {
  const view = readView(ref)
  if (!view) return 0
  const targetRanges = deleteTargetRangesOf(view)
  if (targetRanges.length === 0) return 0

  const plan = resolveRowDeletionPlan(ref, view)
  if (!plan) return 0

  if (hasStaleCheckedRows(view)) {
    updateView(ref, { checked: { ranges: [] } })
    return 0
  }
  const exceedsBulkDeleteLimit = countRanges(targetRanges) > MAX_BULK_DELETE_ROWS
  if (exceedsBulkDeleteLimit) return 0

  const deletion: RowDeletion = { ref: ref, view: view, targetRanges: targetRanges }
  const targets = await loadRowsToDelete(deletion)
  if (targets.length === 0) return 0

  const outcome = await deleteRowsInDatabase({ ref: ref, plan: plan, targets: targets })
  if (!outcome.isSurfaceClosed) {
    await finishRowDeletion(deletion, outcome)
  }
  return outcome.deletedBaseIndices.length
}
