import { executeQuery as executeQueryCmd } from '../../lib/query-commands'
import { logFrontend } from '../../lib/app-log-commands'
import { toErrorMessage } from '../../lib/error-message'
import { launchBackgroundAnalysis } from './edit-analysis'
import { reexecuteAndPatchResult } from './query-rerun'
import { patchResultByIndex, resultAt, getQueryState } from './query-store-access'
import { freshResultFields, seedResultFromResponse } from './result-seeding'
import { rerunViewSpec } from './result-view-spec'
import type { RowSaveContext } from './row-save'

export async function reexecuteSingleResultAfterMutation(save: RowSaveContext, sql: string) {
  await reexecuteAndPatchResult({
    connectionId: save.connectionId,
    tabId: save.tabId,
    resultIndex: save.resultIndex,
    sql: sql,
    rowLimit: save.result.rowLimit,
    capturedQueryId: save.result.queryId,
    extraPatch: {
      isStale: false,
      saveError: null,
    },
  })
}

export async function reexecuteOnlyResultAfterMutation(save: RowSaveContext, sql: string) {
  const { connectionId, tabId, resultIndex, result } = save
  const capturedQueryId = result.queryId
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
  const isResultReplacedMeanwhile = postResult?.queryId !== capturedQueryId
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
  patchResultByIndex(tabId, resultIndex, {
    ...freshResultFields(execResult, spec),
    resultStatus: 'success',
    errorMessage: null,
    isStale: false,
    saveError: null,
  })

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
