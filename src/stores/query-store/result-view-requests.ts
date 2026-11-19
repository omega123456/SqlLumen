import type { ResultViewSpec, SetResultViewResult } from '../../types/schema'
import { setResultView as setResultViewCmd } from '../../lib/query-commands'
import {
  applyResultView,
  isResultsExpiredError,
  parseSupersededVersion,
} from '../../lib/result-window-cache'
import { logFrontend } from '../../lib/app-log-commands'
import { toErrorMessage } from '../../lib/error-message'
import type { ResultPatch, SingleResultState } from './query-state-types'
import { mergeResultPatches } from './query-tab-reducers'
import {
  markTabResultsExpired,
  patchResultByIndex,
  resultAt,
  slotFor,
  getQueryState,
} from './query-store-access'
import { repaintLatestKnownView, settleFailedView } from './result-view-failure'
import { getResultViewSpec } from './result-view-spec'
import type { ViewChangeRequest, ViewPaint, ViewRequestIssue } from './result-view-spec'

export interface ViewTracker {
  queryId: string
  spec: ResultViewSpec
  retrySpec: ResultViewSpec | null
  lastSuccess: { seq: number; spec: ResultViewSpec; response: SetResultViewResult } | null
}

const viewTrackers = new Map<string, ViewTracker>()

function isTrackerReusable(
  tracker: ViewTracker | undefined,
  result: SingleResultState
): tracker is ViewTracker {
  if (!tracker) return false
  const hasIssuedViewRequest = result.viewRequestSeq > 0
  return tracker.queryId === result.view.slot.queryId && hasIssuedViewRequest
}

export function trackerFor(tabId: string, resultIndex: number, result: SingleResultState) {
  const key = `${tabId}:${resultIndex}`
  const existing = viewTrackers.get(key)
  if (isTrackerReusable(existing, result)) {
    return existing
  }
  const tracker: ViewTracker = {
    queryId: result.view.slot.queryId ?? '',
    spec: getResultViewSpec(result),
    retrySpec: null,
    lastSuccess: null,
  }
  viewTrackers.set(key, tracker)
  return tracker
}

export function dropViewTrackers(tabId: string) {
  for (const key of viewTrackers.keys()) {
    if (key.startsWith(`${tabId}:`)) viewTrackers.delete(key)
  }
}

export function paintView({ tabId, resultIndex, spec, view, extra = {} }: ViewPaint) {
  applyResultView(tabId, resultIndex, view)
  const result = resultAt(tabId, resultIndex)
  const paintPatch: ResultPatch = {
    latestKnownViewVersion: Math.max(result?.latestKnownViewVersion ?? 0, view.viewVersion),
    view: {
      slot: {
        viewVersion: view.viewVersion,
        viewRowCount: view.viewRowCount,
        totalRows: view.totalRows,
      },
      selection: { rowIndex: null, cell: null },
      checked: { ranges: [], viewVersion: view.viewVersion },
      spec: { sort: spec.sort, filters: spec.filters, applying: null, error: null },
      window: { pendingRange: null, failedRange: null },
    },
  }
  patchResultByIndex(tabId, resultIndex, mergeResultPatches(paintPatch, extra))
}

interface IssuedViewRequest {
  tabId: string
  resultIndex: number
  seq: number
  spec: ResultViewSpec
  attempt: number
  queryId: string | null
}

function currentResultOfRequest(request: IssuedViewRequest): SingleResultState | null {
  const latest = getQueryState().tabs[request.tabId]?.results[request.resultIndex]
  const latestQueryId = latest?.view.slot.queryId
  return latestQueryId === request.queryId ? latest : null
}

async function applyViewResponse(
  request: IssuedViewRequest,
  latest: SingleResultState,
  response: SetResultViewResult
): Promise<void> {
  const { tabId, resultIndex, seq, spec } = request
  const tracker = trackerFor(tabId, resultIndex, latest)
  tracker.lastSuccess = { seq, spec, response }
  patchResultByIndex(tabId, resultIndex, {
    latestKnownViewVersion: Math.max(latest.latestKnownViewVersion, response.viewVersion),
  })
  if (seq !== latest.viewRequestSeq) return
  if (response.viewVersion < latest.latestKnownViewVersion) {
    await repaintLatestKnownView(tabId, resultIndex, spec)
    return
  }
  paintView({
    tabId: tabId,
    resultIndex: resultIndex,
    spec: spec,
    view: {
      viewVersion: response.viewVersion,
      viewRowCount: response.viewRowCount,
      totalRows: response.totalRows,
      window: response.firstWindow,
    },
  })
}

function recordSupersededViewVersion(
  request: IssuedViewRequest,
  latest: SingleResultState,
  supersededVersion: number | null
) {
  const isNewerVersion =
    supersededVersion !== null && supersededVersion > latest.latestKnownViewVersion
  if (!isNewerVersion) return
  patchResultByIndex(request.tabId, request.resultIndex, {
    latestKnownViewVersion: supersededVersion,
  })
}

async function handleViewRequestFailure(
  request: IssuedViewRequest,
  latest: SingleResultState,
  error: unknown
): Promise<void> {
  const { tabId, resultIndex, seq, spec } = request
  const supersededVersion = parseSupersededVersion(error)
  recordSupersededViewVersion(request, latest, supersededVersion)
  if (seq !== latest.viewRequestSeq) {
    logFrontend(
      'info',
      `[query-store] set_result_view failed for a superseded request (${tabId}/${resultIndex}): ${toErrorMessage(
        error
      )}`
    )
    return
  }
  const canReissue = supersededVersion !== null && request.attempt === 0
  if (canReissue) {
    await issueViewRequest({
      tabId: tabId,
      resultIndex: resultIndex,
      seq: seq,
      baseViewVersion: supersededVersion,
      spec: spec,
      attempt: 1,
    })
    return
  }
  await settleViewFailure(tabId, resultIndex, error)
}

async function issueViewRequest({
  tabId,
  resultIndex,
  seq,
  baseViewVersion,
  spec,
  attempt,
}: ViewRequestIssue): Promise<void> {
  const slot = slotFor(tabId, resultIndex)
  if (!slot) return
  const request: IssuedViewRequest = {
    tabId: tabId,
    resultIndex: resultIndex,
    seq: seq,
    spec: spec,
    attempt: attempt,
    queryId: slot.queryId,
  }
  try {
    const response = await setResultViewCmd({
      ...slot,
      baseViewVersion: baseViewVersion,
      viewSpec: spec,
    })
    const latest = currentResultOfRequest(request)
    if (!latest) return
    await applyViewResponse(request, latest, response)
  } catch (error) {
    const latest = currentResultOfRequest(request)
    if (!latest) return
    await handleViewRequestFailure(request, latest, error)
  }
}

export async function settleViewFailure(tabId: string, resultIndex: number, error: unknown) {
  if (isResultsExpiredError(error)) {
    patchResultByIndex(tabId, resultIndex, { view: { spec: { applying: null } } })
    markTabResultsExpired(tabId)
    return
  }
  await settleFailedView(tabId, resultIndex, error)
}

export function requestView({ tabId, resultIndex, spec, kind }: ViewChangeRequest): Promise<void> {
  const result = resultAt(tabId, resultIndex)
  if (!result) return Promise.resolve()
  const tracker = trackerFor(tabId, resultIndex, result)
  tracker.spec = spec
  tracker.retrySpec = null
  const seq = result.viewRequestSeq + 1
  patchResultByIndex(tabId, resultIndex, {
    viewRequestSeq: seq,
    view: { spec: { applying: kind, error: null } },
  })
  return issueViewRequest({
    tabId: tabId,
    resultIndex: resultIndex,
    seq: seq,
    baseViewVersion: result.latestKnownViewVersion,
    spec: spec,
    attempt: 0,
  })
}

export function latestRequestedSpec(tabId: string, resultIndex: number): ResultViewSpec | null {
  const result = resultAt(tabId, resultIndex)
  if (!result) return null
  return trackerFor(tabId, resultIndex, result).spec
}
