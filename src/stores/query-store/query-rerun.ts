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
import type { SingleResultState } from './query-state-types'
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
import { residentRowResidency } from './query-tab-selectors'
import { freshResultFields, seedResultFromResponse } from './result-seeding'
import { rerunViewSpec } from './result-view-spec'
import type { ResultTarget } from './result-view-spec'

interface ResultRerun extends ResultTarget {
  sql: string
  rowLimit: number
  capturedQueryId: string | null
  extraPatch: Partial<SingleResultState>
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
  const isReplacedResult = Boolean(capturedQueryId) && postResult?.queryId !== capturedQueryId
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
  patchResultByIndex(tabId, resultIndex, {
    ...freshResultFields(reResult, spec),
    resultStatus: 'success',
    errorMessage: reResult.error ?? null,
    isExpired: false,
    rowsEvictedAt: null,
    rowResidency: residentRowResidency(postResult),
    ...extraPatch,
  })

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
  const capturedQueryId = rerun.result.queryId
  const postResult = resultAt(rerun.tabId, rerun.resultIndex)
  return Boolean(capturedQueryId) && postResult?.queryId !== capturedQueryId
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
      capturedQueryId: rerun.result.queryId,
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
  const updatedResult: SingleResultState = {
    ...DEFAULT_RESULT_STATE,
    ...freshResultFields(response, spec),
    resultStatus: 'success',
    rowLimit: rerun.rowLimit,
    lastExecutedSql: sql,
    reExecutable: true,
    rowResidency: {
      status: 'resident',
      isActive: true,
      inactiveSince: null,
    },
    rowsEvictedAt: null,
  }
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
