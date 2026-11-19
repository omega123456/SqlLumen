import type { ResultViewSpec } from '../../types/schema'
import { fetchResultWindow as fetchResultWindowCmd } from '../../lib/query-commands'
import { showErrorToast } from '../toast-store'
import { logFrontend } from '../../lib/app-log-commands'
import { toErrorMessage } from '../../lib/error-message'
import { VIEW_REFRESH_WINDOW_ROWS } from './query-state-defaults'
import type { SingleResultState, ResultPatch } from './query-state-types'
import { patchResultByIndex, resultAt, slotFor } from './query-store-access'
import { paintView, settleViewFailure, trackerFor } from './result-view-requests'
import type { ViewTracker } from './result-view-requests'
import { getResultViewSpec } from './result-view-spec'

function isReplacedSlot(tabId: string, resultIndex: number, queryId: string): boolean {
  const currentQueryId = resultAt(tabId, resultIndex)?.view.slot.queryId
  return currentQueryId !== queryId
}

export async function repaintLatestKnownView(
  tabId: string,
  resultIndex: number,
  spec: ResultViewSpec
): Promise<void> {
  const result = resultAt(tabId, resultIndex)
  const slot = slotFor(tabId, resultIndex)
  if (!result) return
  if (!slot) return
  try {
    const window = await fetchResultWindowCmd({
      ...slot,
      viewVersion: result.latestKnownViewVersion,
      offset: 0,
      limit: VIEW_REFRESH_WINDOW_ROWS,
    })
    if (isReplacedSlot(tabId, resultIndex, slot.queryId)) return
    paintView({
      tabId: tabId,
      resultIndex: resultIndex,
      spec: spec,
      view: {
        viewVersion: window.viewVersion,
        viewRowCount: window.viewRowCount,
        totalRows: resultAt(tabId, resultIndex)?.view.slot.totalRows ?? result.view.slot.totalRows,
        window: window,
      },
    })
  } catch (error) {
    if (isReplacedSlot(tabId, resultIndex, slot.queryId)) return
    await settleViewFailure(tabId, resultIndex, error)
  }
}

interface FailedViewSettlement {
  tabId: string
  resultIndex: number
  result: SingleResultState
  tracker: ViewTracker
  errorPatch: ResultPatch
}

function repaintLastSuccessfulView(
  failure: FailedViewSettlement,
  success: NonNullable<ViewTracker['lastSuccess']>
) {
  failure.tracker.spec = success.spec
  paintView({
    tabId: failure.tabId,
    resultIndex: failure.resultIndex,
    spec: success.spec,
    view: {
      viewVersion: success.response.viewVersion,
      viewRowCount: success.response.viewRowCount,
      totalRows: success.response.totalRows,
      window: success.response.firstWindow,
    },
    extra: failure.errorPatch,
  })
}

async function refetchServerViewAfterFailure(failure: FailedViewSettlement): Promise<boolean> {
  const { tabId, resultIndex, result, tracker, errorPatch } = failure
  const fallbackSpec = tracker.lastSuccess?.spec ?? getResultViewSpec(result)
  tracker.spec = fallbackSpec
  const slot = slotFor(tabId, resultIndex)
  try {
    if (!slot) throw new Error('Result is no longer available')
    const window = await fetchResultWindowCmd({
      ...slot,
      viewVersion: result.latestKnownViewVersion,
      offset: 0,
      limit: VIEW_REFRESH_WINDOW_ROWS,
    })
    if (isReplacedSlot(tabId, resultIndex, slot.queryId)) return false
    paintView({
      tabId: tabId,
      resultIndex: resultIndex,
      spec: fallbackSpec,
      view: {
        viewVersion: window.viewVersion,
        viewRowCount: window.viewRowCount,
        totalRows: result.view.slot.totalRows,
        window: window,
      },
      extra: errorPatch,
    })
  } catch (refetchError) {
    logFrontend(
      'warn',
      `[query-store] could not refetch the current view after a failed view change: ${String(refetchError)}`
    )
    patchResultByIndex(tabId, resultIndex, errorPatch)
  }
  return true
}

async function revertFailedView(failure: FailedViewSettlement): Promise<boolean> {
  const success = failure.tracker.lastSuccess
  const isLastSuccessServerView =
    success !== null && success.response.viewVersion >= failure.result.latestKnownViewVersion
  if (isLastSuccessServerView) {
    repaintLastSuccessfulView(failure, success)
    return true
  }
  const hasServerViewMovedOn =
    failure.result.latestKnownViewVersion > failure.result.view.slot.viewVersion
  if (hasServerViewMovedOn) {
    return refetchServerViewAfterFailure(failure)
  }
  failure.tracker.spec = getResultViewSpec(failure.result)
  patchResultByIndex(failure.tabId, failure.resultIndex, failure.errorPatch)
  return true
}

export async function settleFailedView(tabId: string, resultIndex: number, error: unknown) {
  const message = toErrorMessage(error)
  logFrontend(
    'warn',
    `[query-store] set_result_view failed for ${tabId}/${resultIndex}: ${message}`
  )
  const result = resultAt(tabId, resultIndex)
  if (!result) return
  const tracker = trackerFor(tabId, resultIndex, result)
  tracker.retrySpec = tracker.spec
  const isStillCurrent = await revertFailedView({
    tabId: tabId,
    resultIndex: resultIndex,
    result: result,
    tracker: tracker,
    errorPatch: { view: { spec: { applying: null, error: message } } },
  })
  if (!isStillCurrent) return
  showErrorToast("Couldn't apply sort or filter", message)
}
