import { executeQuery as executeQueryCmd } from '../../lib/query-commands'
import { logFrontend } from '../../lib/app-log-commands'
import { toErrorMessage } from '../../lib/error-message'
import { launchBackgroundAnalysis } from './edit-analysis'
import { reexecuteAndPatchResult } from './query-rerun'
import { patchResultByIndex, resultAt, getQueryState } from './query-store-access'
import { freshResultFields, seedResultFromResponse } from './result-seeding'
import { rerunViewSpec } from './result-view-spec'
import { mergeResultPatches } from './query-tab-reducers'
import { showErrorToast } from '../toast-store'
import type { DataViewSurfaceRef } from '../data-view/data-view-types'
import type { SingleResultState } from './query-state-types'

interface RerunAfterInsert {
  connectionId: string
  tabId: string
  resultIndex: number
  result: SingleResultState
}

async function reexecuteSingleResultAfterMutation(save: RerunAfterInsert, sql: string) {
  await reexecuteAndPatchResult({
    connectionId: save.connectionId,
    tabId: save.tabId,
    resultIndex: save.resultIndex,
    sql: sql,
    rowLimit: save.result.rowLimit,
    capturedQueryId: save.result.view.slot.queryId,
    extraPatch: { view: { edit: { isStale: false, saveError: null } } },
  })
}

async function reexecuteOnlyResultAfterMutation(save: RerunAfterInsert, sql: string) {
  const { connectionId, tabId, resultIndex, result } = save
  const capturedQueryId = result.view.slot.queryId
  const spec = rerunViewSpec(resultAt(tabId, resultIndex) ?? result)
  const execResult = await executeQueryCmd({
    connectionId: connectionId,
    tabId: tabId,
    sql: sql,
    rowLimit: result.rowLimit,
    viewSpec: spec ?? undefined,
  })

  if (!getQueryState().tabs[tabId]) return

  const postTab = getQueryState().tabs[tabId]
  const postResult = postTab?.results[resultIndex]
  const isResultReplacedMeanwhile = postResult?.view.slot.queryId !== capturedQueryId
  if (capturedQueryId && isResultReplacedMeanwhile) {
    logFrontend(
      'warn',
      '[query-store] reexecuteOnlyResultAfterMutation: discarding stale refresh result (queryId mismatch)'
    )
    return
  }

  seedResultFromResponse(
    { connectionId: connectionId, tabId: tabId, resultIndex: resultIndex },
    execResult
  )
  patchResultByIndex(
    tabId,
    resultIndex,
    mergeResultPatches(freshResultFields({ response: execResult, spec: spec }), {
      resultStatus: 'success',
      errorMessage: null,
      view: { edit: { isStale: false, saveError: null } },
    })
  )

  launchBackgroundAnalysis({
    tabId: tabId,
    connectionId: connectionId,
    sql: sql,
    queryId: execResult.queryId,
    resultIndex: resultIndex,
    hasColumns: execResult.columns.length > 0,
    onFailure: (error) =>
      logFrontend(
        'warn',
        `[query-edit] analyze_query_for_edit failed (insert re-exec): ${toErrorMessage(error)}`
      ),
  })
}

function isMultiResultTab(tabId: string): boolean {
  const resultCount = getQueryState().tabs[tabId]?.results.length ?? 0
  return resultCount > 1
}

function reportRefreshFailure(ref: DataViewSurfaceRef, refreshError: unknown) {
  if (!getQueryState().tabs[ref.tabId]) return
  patchResultByIndex(ref.tabId, ref.resultIndex, { view: { edit: { isStale: true } } })
  showErrorToast(
    'Refresh failed',
    `Row inserted successfully, but the query result could not be refreshed: ${toErrorMessage(refreshError)}`
  )
}

export async function rerunResultAfterInsert(ref: DataViewSurfaceRef): Promise<boolean> {
  const result = resultAt(ref.tabId, ref.resultIndex)
  if (!result) return true
  const sql = result.lastExecutedSql
  if (!sql) return true
  const rerun = isMultiResultTab(ref.tabId)
    ? reexecuteSingleResultAfterMutation
    : reexecuteOnlyResultAfterMutation
  const rerunTarget: RerunAfterInsert = {
    connectionId: result.view.slot.connectionId,
    tabId: ref.tabId,
    resultIndex: ref.resultIndex,
    result: result,
  }
  try {
    await rerun(rerunTarget, sql)
  } catch (refreshError) {
    reportRefreshFailure(ref, refreshError)
    return false
  }
  return true
}
