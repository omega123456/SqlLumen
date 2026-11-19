import type { ResultViewSpec } from '../../types/schema'
import {
  executeQuery as executeQueryCmd,
  reexecuteSingleResult as reexecuteSingleResultCmd,
  type ExecuteQueryResult,
} from '../../lib/query-commands'
import { showWarningToast } from '../toast-store'
import { logFrontend, logFrontendError } from '../../lib/app-log-commands'
import { describeQueryFailure, toErrorMessage } from '../../lib/error-message'
import { launchBackgroundAnalysis } from './edit-analysis'
import { DEFAULT_RESULT_STATE, EDIT_STATE_DEFAULTS } from './query-state-defaults'
import type { SingleResultState, ResultPatch } from './query-state-types'
import {
  beginExecution,
  clearExpiredFlags,
  finalizeExecution,
  getActiveIndex,
  markTabResultsExpired,
  patchResultByIndex,
  patchTab,
  resultAt,
  getQueryState,
} from './query-store-access'
import { residentRows, residentRowsAfterReload } from '../data-view/residency'
import { DEFAULT_DATA_VIEW_STATE } from '../data-view/data-view-defaults'
import { freshResultFields, seedResultFromResponse } from './result-seeding'
import { mergeResultPatches, patchedResult } from './query-tab-reducers'
import { rerunViewSpec } from './result-view-spec'
import type { ResultTarget } from './result-view-spec'

interface ResultRerun extends ResultTarget {
  sql: string
  rowLimit: number
  capturedQueryId: string | null
  extraPatch: ResultPatch
}

export async function reexecuteAndPatchResult({
  connectionId,
  tabId,
  resultIndex,
  sql,
  rowLimit,
  capturedQueryId,
  extraPatch,
}: ResultRerun) {
  const spec = rerunViewSpec(resultAt(tabId, resultIndex))
  const reResult = await reexecuteSingleResultCmd({
    connectionId: connectionId,
    tabId: tabId,
    resultIndex: resultIndex,
    sql: sql,
    rowLimit: rowLimit,
    viewSpec: spec ?? undefined,
  })

  if (!getQueryState().tabs[tabId]) return

  const postResult = resultAt(tabId, resultIndex)
  const isReplacedResult =
    Boolean(capturedQueryId) && postResult?.view.slot.queryId !== capturedQueryId
  if (isReplacedResult) {
    logFrontend(
      'warn',
      '[query-store] reexecuteAndPatchResult: discarding stale re-execution result (queryId mismatch)'
    )
    return
  }

  seedResultFromResponse(
    { connectionId: connectionId, tabId: tabId, resultIndex: resultIndex },
    reResult
  )
  const rerunPatch = mergeResultPatches(freshResultFields({ response: reResult, spec: spec }), {
    resultStatus: 'success',
    errorMessage: reResult.error ?? null,
  })
  const previousRows = postResult?.view.residency.rows ?? DEFAULT_DATA_VIEW_STATE.residency.rows
  const residencyPatch: ResultPatch = {
    view: {
      residency: { isExpired: false, evictedAt: null, rows: residentRowsAfterReload(previousRows) },
    },
  }
  patchResultByIndex(
    tabId,
    resultIndex,
    mergeResultPatches(mergeResultPatches(rerunPatch, extraPatch), residencyPatch)
  )

  launchBackgroundAnalysis({
    tabId: tabId,
    connectionId: connectionId,
    sql: sql,
    queryId: reResult.queryId,
    resultIndex: resultIndex,
    hasColumns: reResult.columns.length > 0,
    onFailure: (error) =>
      logFrontendError('[query-edit] analyze_query_for_edit failed (re-exec):', error),
  })
}

interface RowLimitRerun {
  connectionId: string
  tabId: string
  resultIndex: number
  result: SingleResultState
  sql: string
  rowLimit: number
}

function isRerunResultReplaced(rerun: RowLimitRerun): boolean {
  const capturedQueryId = rerun.result.view.slot.queryId
  const postResult = resultAt(rerun.tabId, rerun.resultIndex)
  return Boolean(capturedQueryId) && postResult?.view.slot.queryId !== capturedQueryId
}

function handleMultiResultRerunFailure(rerun: RowLimitRerun, error: unknown) {
  const { tabId, resultIndex } = rerun
  if (!getQueryState().tabs[tabId]) return
  if (isRerunResultReplaced(rerun)) {
    logFrontend('warn', '[query-store] changeRowLimit: discarding stale error (queryId mismatch)')
    return
  }
  const errorMessage = toErrorMessage(error)
  if (errorMessage.includes('results_expired')) {
    markTabResultsExpired(tabId)
    return
  }
  patchResultByIndex(tabId, resultIndex, {
    resultStatus: 'error',
    errorMessage: errorMessage,
  })
}

async function rerunMultiResultWithRowLimit(rerun: RowLimitRerun) {
  try {
    await reexecuteAndPatchResult({
      connectionId: rerun.connectionId,
      tabId: rerun.tabId,
      resultIndex: rerun.resultIndex,
      sql: rerun.sql,
      rowLimit: rerun.rowLimit,
      capturedQueryId: rerun.result.view.slot.queryId,
      extraPatch: { rowLimit: rerun.rowLimit },
    })
  } catch (error) {
    handleMultiResultRerunFailure(rerun, error)
  }
}

function applySingleResultRerun(
  rerun: RowLimitRerun,
  spec: ResultViewSpec | null,
  response: ExecuteQueryResult
) {
  const { connectionId, tabId, sql } = rerun
  seedResultFromResponse({ connectionId: connectionId, tabId: tabId, resultIndex: 0 }, response)
  const fresh = freshResultFields({
    response: response,
    spec: spec,
    view: {
      slot: { connectionId: connectionId },
      residency: { rows: residentRows(true), evictedAt: null },
    },
  })
  const updatedResult = patchedResult(DEFAULT_RESULT_STATE, {
    ...fresh,
    resultStatus: 'success',
    rowLimit: rerun.rowLimit,
    lastExecutedSql: sql,
    reExecutable: true,
  })
  patchTab(tabId, {
    tabStatus: 'success',
    results: [updatedResult],
    activeResultIndex: 0,
    wasCancelled: false,
  })
  finalizeExecution(tabId)
  launchBackgroundAnalysis({
    tabId: tabId,
    connectionId: connectionId,
    sql: sql,
    queryId: response.queryId,
    resultIndex: 0,
    hasColumns: response.columns.length > 0,
    onFailure: (error) =>
      logFrontendError('[query-edit] analyze_query_for_edit failed (page re-exec):', error),
  })
}

function handleSingleResultRerunFailure(tabId: string, error: unknown) {
  const wasCancelled = getQueryState().tabs[tabId]?.wasCancelled ?? false
  const errorMessage = describeQueryFailure(wasCancelled, error)
  if (errorMessage.includes('results_expired')) {
    markTabResultsExpired(tabId)
  }
  patchResultByIndex(tabId, 0, {
    resultStatus: 'error',
    errorMessage: errorMessage,
  })
  patchTab(tabId, {
    tabStatus: 'error',
    wasCancelled: false,
  })
  finalizeExecution(tabId)
}

async function rerunSingleResultWithRowLimit(rerun: RowLimitRerun) {
  const { connectionId, tabId } = rerun
  beginExecution(tabId)
  try {
    const spec = rerunViewSpec(rerun.result)
    const response = await executeQueryCmd({
      connectionId: connectionId,
      tabId: tabId,
      sql: rerun.sql,
      rowLimit: rerun.rowLimit,
      viewSpec: spec ?? undefined,
    })
    if (!getQueryState().tabs[tabId]) return
    applySingleResultRerun(rerun, spec, response)
  } catch (error) {
    if (!getQueryState().tabs[tabId]) return
    handleSingleResultRerunFailure(tabId, error)
  }
}

export async function changeRowLimit(connectionId: string, tabId: string, size: number) {
  const tab = getQueryState().tabs[tabId]
  const resultIndex = getActiveIndex(tabId)
  const result = tab?.results[resultIndex]

  if (!result?.lastExecutedSql) return

  if (!result.reExecutable) {
    showWarningToast(
      'Cannot change row limit',
      'This result is from a stored procedure and cannot be re-executed.'
    )
    return
  }

  patchResultByIndex(tabId, resultIndex, { ...EDIT_STATE_DEFAULTS, rowLimit: size })
  clearExpiredFlags(tabId)

  const rerun: RowLimitRerun = {
    connectionId: connectionId,
    tabId: tabId,
    resultIndex: resultIndex,
    result: result,
    sql: result.lastExecutedSql,
    rowLimit: size,
  }
  const isMultiResultTab = (tab?.results.length ?? 0) > 1
  if (isMultiResultTab) {
    await rerunMultiResultWithRowLimit(rerun)
    return
  }
  await rerunSingleResultWithRowLimit(rerun)
}

export function queryRerunActions() {
  return { changeRowLimit }
}
