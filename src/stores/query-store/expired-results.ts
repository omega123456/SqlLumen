import { touchResults as touchResultsCmd } from '../../lib/query-commands'
import { logFrontendWarning } from '../../lib/app-log-commands'
import {
  buildExecuteQueryPlan,
  executeQueryPlan,
  type ExecuteQueryPlan,
} from '../../lib/query-execution-plan'
import { reexecuteAndPatchResult } from './query-rerun'
import { runSingleQuery } from './query-run'
import type { SingleResultState } from './query-state-types'
import {
  beginExecution,
  clearExpiredFlags,
  finalizeExecution,
  getActiveIndex,
  markTabResultsExpired,
  patchResultByIndex,
  patchTab,
  getQueryState,
} from './query-store-access'
import { getActiveResult } from './query-tab-selectors'
import { rerunViewSpec } from './result-view-spec'

interface ExpiredResultRetry {
  connectionId: string
  tabId: string
  result: SingleResultState
  plan: ExecuteQueryPlan
}

async function retryExpiredResultOfMultiResultTab(retry: ExpiredResultRetry) {
  const { connectionId, tabId, result, plan } = retry
  if (plan.kind !== 'single') return
  const activeResultIndex = getActiveIndex(tabId)
  beginExecution(tabId)
  try {
    await reexecuteAndPatchResult({
      connectionId: connectionId,
      tabId: tabId,
      resultIndex: activeResultIndex,
      sql: plan.payload,
      rowLimit: result.rowLimit,
      capturedQueryId: result.view.slot.queryId,
      extraPatch: { errorMessage: null, view: { residency: { isExpired: false } } },
    })
    if (!getQueryState().tabs[tabId]) return
    patchTab(tabId, { tabStatus: 'success' })
    finalizeExecution(tabId)
  } catch (error) {
    logFrontendWarning('[query-store] retryExpiredResult re-execution failed:', error)
    if (getQueryState().tabs[tabId]) {
      patchTab(tabId, { tabStatus: 'error' })
      finalizeExecution(tabId)
    }
    markTabResultsExpired(tabId)
  }
}

async function runExpiredResultPlan(retry: ExpiredResultRetry) {
  const { connectionId, tabId, plan } = retry
  if (plan.kind === 'single') {
    await runSingleQuery({
      connectionId: connectionId,
      tabId: tabId,
      sql: plan.payload,
      viewSpec: rerunViewSpec(retry.result),
    })
    return
  }
  await executeQueryPlan(getQueryState(), { connectionId: connectionId, tabId: tabId }, plan)
}

async function retryExpiredResultOfSingleResultTab(retry: ExpiredResultRetry) {
  const { tabId } = retry
  try {
    await runExpiredResultPlan(retry)
  } catch (error) {
    logFrontendWarning('[query-store] retryExpiredResult re-execution failed:', error)
  }

  const postRetryTab = getQueryState().tabs[tabId]
  if (!postRetryTab) return

  const postRetryResult = postRetryTab.results[getActiveIndex(tabId)]
  const isRetrySuccessful =
    postRetryTab.tabStatus === 'success' && postRetryResult?.resultStatus === 'success'
  if (!isRetrySuccessful) {
    markTabResultsExpired(tabId)
  }
}

export function markResultsExpired(tabId: string) {
  markTabResultsExpired(tabId)
}

export function markResultExpired(tabId: string, resultIndex: number) {
  patchResultByIndex(tabId, resultIndex, { view: { residency: { isExpired: true } } })
}

export function validateActiveTabResults(tabId: string) {
  const tab = getQueryState().tabs[tabId]
  if (!tab) return
  const resultIndex = getActiveIndex(tabId)
  const result = tab.results[resultIndex]
  if (!result?.view.slot.queryId) return

  const connectionId = tab.connectionId
  if (!connectionId) return

  const previousStatus = tab.tabStatus
  const shouldShowRestoringState = previousStatus !== 'success'
  if (shouldShowRestoringState) {
    patchTab(tabId, { tabStatus: 'restoring' })
  }

  touchResultsCmd(connectionId, tabId)
    .then((response) => {
      if (!getQueryState().tabs[tabId]) return
      if (response.status === 'expired') {
        markTabResultsExpired(tabId)
      }
      if (shouldShowRestoringState) {
        patchTab(tabId, { tabStatus: previousStatus })
      }
    })
    .catch((error) => {
      if (shouldShowRestoringState) {
        patchTab(tabId, { tabStatus: previousStatus })
      }
      logFrontendWarning('[query-store] validateActiveTabResults failed:', error)
    })
}

export async function retryExpiredResult(tabId: string) {
  const tab = getQueryState().tabs[tabId]
  if (!tab) return

  const connectionId = tab.connectionId
  if (!connectionId) return

  const result = getActiveResult(tab)
  if (!result.view.residency.isExpired) return
  if (!result.reExecutable) return

  const plan = buildExecuteQueryPlan(tab.content, tab.selectedText ?? '', tab.cursorPosition)
  if (!plan) return

  const isMultiResultTab = tab.results.length > 1
  const isMultiStatementPlan = plan.kind === 'multi'
  if (isMultiResultTab && isMultiStatementPlan) return

  clearExpiredFlags(tabId)

  const retry: ExpiredResultRetry = {
    connectionId: connectionId,
    tabId: tabId,
    result: result,
    plan: plan,
  }
  if (isMultiResultTab) {
    await retryExpiredResultOfMultiResultTab(retry)
    return
  }
  await retryExpiredResultOfSingleResultTab(retry)
}

export function expiredResultActions() {
  return { markResultsExpired, markResultExpired, validateActiveTabResults, retryExpiredResult }
}
