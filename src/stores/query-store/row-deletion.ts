import type { QueryTableEditInfo, RemoveResultRowsResult } from '../../types/schema'
import { mergeResultPatches } from './query-tab-reducers'
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
import { showErrorToast, showSuccessToast } from '../toast-store'
import { logFrontend } from '../../lib/app-log-commands'
import { toErrorMessage } from '../../lib/error-message'
import { MAX_BULK_DELETE_ROWS } from './query-state-defaults'
import type { SingleResultState, ResultPatch } from './query-state-types'
import type { DataViewSurfaceRef } from '../data-view/data-view-types'
import {
  markTabResultsExpired,
  patchResultByIndex,
  resultAt,
  slotFor,
  getQueryState,
} from './query-store-access'
import { countRanges, isSelectedRowInView } from './query-tab-selectors'
import { paintView } from './result-view-requests'
import { getResultViewSpec } from './result-view-spec'

interface RowDeletionPlan {
  connectionId: string
  tableInfo: QueryTableEditInfo
  keyColumns: string[]
  keyColumnIndices: number[]
}

function resolveRowDeletionPlan(result: SingleResultState): RowDeletionPlan | null {
  if (!result.view.editTarget.tableName) {
    showErrorToast('Delete failed', 'Enable edit mode to delete rows from the database.')
    return null
  }
  const tableInfo = result.view.editTarget.tables[result.view.editTarget.tableName]
  if (!tableInfo?.primaryKey) {
    showErrorToast(
      'Delete failed',
      `Cannot delete ${result.view.editTarget.tableName}: no primary or unique key.`
    )
    return null
  }
  if (!result.view.slot.connectionId) {
    showErrorToast('Delete failed', 'No active connection available for deletion.')
    return null
  }
  const keyColumns = tableInfo.primaryKey.keyColumns
  const keyColumnIndices = keyColumns.map(
    (column) => result.view.editTarget.boundIndexByName.get(column.toLowerCase()) ?? -1
  )
  if (keyColumnIndices.some((index) => index < 0)) {
    showErrorToast(
      'Delete failed',
      `Result set does not contain the key columns (${keyColumns.join(', ')}).`
    )
    return null
  }
  return {
    connectionId: result.view.slot.connectionId,
    tableInfo: tableInfo,
    keyColumns: keyColumns,
    keyColumnIndices: keyColumnIndices,
  }
}

function primaryKeyValuesOf(plan: RowDeletionPlan, row: unknown[]): Record<string, unknown> {
  const primaryKeyValues: Record<string, unknown> = {}
  plan.keyColumns.forEach((column, columnIndex) => {
    primaryKeyValues[column] = row[plan.keyColumnIndices[columnIndex]]
  })
  return primaryKeyValues
}

interface RowDeletionContext {
  tabId: string
  resultIndex: number
  result: SingleResultState
  targetRanges: ViewRange[]
}

interface RowDeletionOutcome {
  deletedBaseIndices: number[]
  failureMessage: string | null
  isTabClosed: boolean
}

async function loadRowsToDelete(deletion: RowDeletionContext): Promise<CachedRow[]> {
  const { tabId, resultIndex, targetRanges } = deletion
  try {
    const targets: CachedRow[] = []
    for (const range of targetRanges) {
      targets.push(
        ...(await readViewRange({ tabId: tabId, resultIndex: resultIndex, range: range }))
      )
    }
    return targets
  } catch (error) {
    if (isResultsExpiredError(error)) {
      markTabResultsExpired(tabId)
      return []
    }
    const message = toErrorMessage(error)
    logFrontend('warn', `[query-store] could not load the rows to delete: ${message}`)
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
  const tabId = ref.tabId
  const action = getQueryState().beginRowAction(ref, { verb: 'Deleting', total: targets.length })
  const outcome: RowDeletionOutcome = {
    deletedBaseIndices: [],
    failureMessage: null,
    isTabClosed: false,
  }
  for (const target of targets) {
    if (!getQueryState().tabs[tabId]) {
      outcome.isTabClosed = true
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

async function removeDeletedRowsFromView(
  slot: ResultSlotRef | null,
  baseVersion: number,
  deletedBaseIndices: number[]
): Promise<RemoveResultRowsResult> {
  if (!slot) throw new Error('Result is no longer available')
  try {
    return await removeResultRowsCmd({
      ...slot,
      baseViewVersion: baseVersion,
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
  afterResult: SingleResultState
  removed: RemoveResultRowsResult
}

function applyTombstonedView(
  deletion: RowDeletionContext,
  outcome: RowDeletionOutcome,
  tombstoned: TombstonedRows
) {
  const { tabId, resultIndex } = deletion
  const { afterResult, removed } = tombstoned
  const deletePatch: ResultPatch = {
    view: {
      edit: { state: null, rowIndex: null, baseIndex: null, saveError: outcome.failureMessage },
    },
  }
  const isNewerViewCommitted =
    removed.viewVersion <
    Math.max(afterResult.latestKnownViewVersion, afterResult.view.slot.viewVersion)
  if (isNewerViewCommitted) {
    patchResultByIndex(
      tabId,
      resultIndex,
      mergeResultPatches(deletePatch, { view: { checked: { ranges: [] } } })
    )
    return
  }
  paintView({
    tabId: tabId,
    resultIndex: resultIndex,
    spec: getResultViewSpec(afterResult),
    view: {
      viewVersion: removed.viewVersion,
      viewRowCount: removed.viewRowCount,
      totalRows: removed.totalRows,
    },
    extra: deletePatch,
  })
}

function reportTombstoneFailure(
  deletion: RowDeletionContext,
  outcome: RowDeletionOutcome,
  refreshError: unknown
) {
  const { tabId, resultIndex } = deletion
  const deletedCount = outcome.deletedBaseIndices.length
  logFrontend(
    'warn',
    `[query-store] remove_result_rows failed after deleting ${deletedCount} rows: ${toErrorMessage(refreshError)}`
  )
  if (getQueryState().tabs[tabId]) {
    patchResultByIndex(tabId, resultIndex, {
      view: { checked: { ranges: [] }, edit: { isStale: true, saveError: outcome.failureMessage } },
    })
  }
  showErrorToast(
    'Refresh failed',
    `${formatCount(deletedCount)} ${deletedCount === 1 ? 'row' : 'rows'} deleted, but the result couldn't be updated. Re-run the query to refresh.`
  )
}

async function tombstoneDeletedRows(
  deletion: RowDeletionContext,
  outcome: RowDeletionOutcome
): Promise<boolean> {
  const { tabId, resultIndex, result } = deletion
  const slot = slotFor(tabId, resultIndex)
  try {
    const latest = resultAt(tabId, resultIndex) ?? result
    const removed = await removeDeletedRowsFromView(
      slot,
      latest.latestKnownViewVersion,
      outcome.deletedBaseIndices
    )
    if (!getQueryState().tabs[tabId]) return false
    const afterResult = resultAt(tabId, resultIndex)
    if (!afterResult) return false
    const isSameResult = afterResult.view.slot.queryId === result.view.slot.queryId
    if (!isSameResult) return false
    applyTombstonedView(deletion, outcome, { afterResult: afterResult, removed: removed })
    return true
  } catch (refreshError) {
    reportTombstoneFailure(deletion, outcome, refreshError)
    return false
  }
}

async function finishRowDeletion(deletion: RowDeletionContext, outcome: RowDeletionOutcome) {
  const deletedCount = outcome.deletedBaseIndices.length
  if (deletedCount === 0) {
    if (outcome.failureMessage) {
      patchResultByIndex(deletion.tabId, deletion.resultIndex, {
        view: { edit: { saveError: outcome.failureMessage } },
      })
    }
    return
  }
  const isResultRefreshed = await tombstoneDeletedRows(deletion, outcome)
  if (!isResultRefreshed) return
  if (outcome.failureMessage) return
  showSuccessToast(
    'Rows deleted',
    `${deletedCount} row${deletedCount === 1 ? '' : 's'} deleted successfully.`
  )
}

function selectedRowRanges(result: SingleResultState): ViewRange[] {
  const selectedRowIndex = result.view.selection.rowIndex
  if (selectedRowIndex === null) return []
  if (!isSelectedRowInView(result)) return []
  return [[selectedRowIndex, selectedRowIndex + 1]]
}

export function deleteTargetRangesOf(result: SingleResultState): ViewRange[] {
  const hasCheckedRows = result.view.checked.ranges.length > 0
  if (hasCheckedRows) return result.view.checked.ranges
  return selectedRowRanges(result)
}

function hasStaleCheckedRows(result: SingleResultState): boolean {
  const hasCheckedRows = result.view.checked.ranges.length > 0
  return hasCheckedRows && result.view.checked.viewVersion !== result.view.slot.viewVersion
}

export async function deleteResultRows(ref: DataViewSurfaceRef): Promise<number> {
  const { tabId, resultIndex } = ref
  const result = resultAt(tabId, resultIndex)
  if (!result) return 0
  const targetRanges = deleteTargetRangesOf(result)
  if (targetRanges.length === 0) return 0

  const plan = resolveRowDeletionPlan(result)
  if (!plan) return 0

  if (hasStaleCheckedRows(result)) {
    patchResultByIndex(tabId, resultIndex, { view: { checked: { ranges: [] } } })
    return 0
  }
  const exceedsBulkDeleteLimit = countRanges(targetRanges) > MAX_BULK_DELETE_ROWS
  if (exceedsBulkDeleteLimit) return 0

  const deletion: RowDeletionContext = {
    tabId: tabId,
    resultIndex: resultIndex,
    result: result,
    targetRanges: targetRanges,
  }
  const targets = await loadRowsToDelete(deletion)
  if (targets.length === 0) return 0

  const outcome = await deleteRowsInDatabase({ ref: ref, plan: plan, targets: targets })
  if (!outcome.isTabClosed) {
    await finishRowDeletion(deletion, outcome)
  }
  return outcome.deletedBaseIndices.length
}

export function rowDeletionActions() {
  return { deleteResultRows }
}
