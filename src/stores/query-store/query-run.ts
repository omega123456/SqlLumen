import type { MultiQueryResult, MultiQueryResultItem, ResultViewSpec } from '../../types/schema'
import {
  executeQuery as executeQueryCmd,
  executeMultiQuery as executeMultiQueryCmd,
  executeCallQuery as executeCallQueryCmd,
  cancelQuery as cancelQueryCmd,
  type ExecuteQueryResult,
} from '../../lib/query-commands'
import { showErrorToast, showSuccessToast } from '../toast-store'
import { useHistoryStore } from '../history-store'
import { logFrontendError } from '../../lib/app-log-commands'
import { describeQueryFailure, toErrorMessage } from '../../lib/error-message'
import { launchBackgroundAnalysis } from './edit-analysis'
import {
  DEFAULT_RESULT_STATE,
  EDIT_ANALYSIS_ERROR_TOAST_DURATION_MS,
  getDefaultRowLimit,
} from './query-state-defaults'
import type { RunTarget, SingleResultState, TabQueryState } from './query-state-types'
import {
  beginExecution,
  cancelAllResultLifecycleTimers,
  clearExpiredFlags,
  finalizeExecution,
  patchTab,
  getQueryState,
} from './query-store-access'
import { isExecutionLocked, isQueryTabVisibleInWorkspace } from './query-tab-selectors'
import { buildSingleResultFromItem, seedResultFromResponse } from './result-seeding'
import { viewFieldsForColumns, windowMetaFromResponse } from './result-view-spec'

interface MultiResultExecution {
  connectionId: string
  tabId: string
  ipcCall: () => Promise<MultiQueryResult>
  runPostAnalysis: boolean
}

interface SingleQueryRun {
  connectionId: string
  tabId: string
  sql: string
  viewSpec: ResultViewSpec | null
}

function applyExecutionFailure(connectionId: string, tabId: string, error: unknown) {
  const wasCancelled = getQueryState().tabs[tabId]?.wasCancelled ?? false
  const errorResult: SingleResultState = {
    ...DEFAULT_RESULT_STATE,
    resultStatus: 'error',
    errorMessage: describeQueryFailure(wasCancelled, error),
  }
  patchTab(tabId, {
    tabStatus: 'error',
    results: [errorResult],
    activeResultIndex: 0,
    activeBottomPanelItem: { type: 'result' },
    wasCancelled: false,
  })
  finalizeExecution(tabId)
  useHistoryStore.getState().notifyNewQuery(connectionId)
}

interface SingleQueryCompletion {
  connectionId: string
  tabId: string
  sql: string
  viewSpec: ResultViewSpec | null
  response: ExecuteQueryResult
}

function buildExecutedSingleResult(
  completion: SingleQueryCompletion,
  isVisibleOnCompletion: boolean
): SingleResultState {
  const { response, sql, viewSpec } = completion
  return {
    ...DEFAULT_RESULT_STATE,
    ...windowMetaFromResponse(response).fields,
    ...viewFieldsForColumns(viewSpec, response.columns),
    resultStatus: 'success',
    columns: response.columns,
    totalRows: response.totalRows,
    executionTimeMs: response.executionTimeMs,
    totalTimeMs: response.totalTimeMs,
    affectedRows: response.affectedRows,
    queryId: response.queryId,
    rowLimit: getDefaultRowLimit(),
    autoLimitApplied: response.autoLimitApplied,
    lastExecutedSql: sql,
    reExecutable: true,
    isAnalyzed: false,
    rowResidency: {
      status: 'resident',
      isActive: isVisibleOnCompletion,
      inactiveSince: isVisibleOnCompletion ? null : Date.now(),
    },
    rowsEvictedAt: null,
  }
}

function applySingleQuerySuccess(completion: SingleQueryCompletion) {
  const { connectionId, tabId, sql, response } = completion
  seedResultFromResponse({ connectionId: connectionId, tabId: tabId, resultIndex: 0 }, response)
  const isVisibleOnCompletion = isQueryTabVisibleInWorkspace(tabId)
  patchTab(tabId, {
    tabStatus: 'success',
    results: [buildExecutedSingleResult(completion, isVisibleOnCompletion)],
    activeResultIndex: 0,
    activeBottomPanelItem: { type: 'result' },
    wasCancelled: false,
  })
  finalizeExecution(tabId)
  if (!isVisibleOnCompletion) {
    getQueryState().markResultSurfaceInactive(tabId, 0)
  }
  useHistoryStore.getState().notifyNewQuery(connectionId)
  launchBackgroundAnalysis({
    tabId: tabId,
    connectionId: connectionId,
    sql: sql,
    queryId: response.queryId,
    resultIndex: 0,
    hasColumns: response.columns.length > 0,
    onFailure: (error) => {
      logFrontendError('[query-edit] analyze_query_for_edit failed:', error)
      showErrorToast(
        'Edit mode analysis failed',
        toErrorMessage(error),
        EDIT_ANALYSIS_ERROR_TOAST_DURATION_MS
      )
    },
  })
}

interface MultiResultRun {
  connectionId: string
  tabId: string
  runPostAnalysis: boolean
  previousResultCount: number
}

function launchFirstResultAnalysis(run: MultiResultRun, results: SingleResultState[]) {
  const firstResult = results[0]
  const shouldAnalyze = run.runPostAnalysis && firstResult !== undefined
  if (!shouldAnalyze) return
  launchBackgroundAnalysis({
    tabId: run.tabId,
    connectionId: run.connectionId,
    sql: firstResult.lastExecutedSql,
    queryId: firstResult.queryId,
    resultIndex: 0,
    hasColumns: firstResult.columns.length > 0,
    onFailure: (error) =>
      logFrontendError('[query-edit] analyze_query_for_edit failed (multi):', error),
  })
}

function applyMultiResultSuccess(run: MultiResultRun, items: MultiQueryResultItem[]) {
  const { connectionId, tabId } = run
  cancelAllResultLifecycleTimers(tabId, run.previousResultCount)
  const isVisibleOnCompletion = isQueryTabVisibleInWorkspace(tabId)
  const results = items.map((item, index) =>
    buildSingleResultFromItem(item, getDefaultRowLimit(), index === 0 && isVisibleOnCompletion)
  )
  items.forEach((item, index) =>
    seedResultFromResponse({ connectionId: connectionId, tabId: tabId, resultIndex: index }, item)
  )

  patchTab(tabId, {
    tabStatus: results.length > 0 ? 'success' : 'idle',
    results: results,
    activeResultIndex: 0,
    activeBottomPanelItem: { type: 'result' },
    wasCancelled: false,
  })
  finalizeExecution(tabId)

  const isInactiveCompletion = !isVisibleOnCompletion && results.length > 0
  if (isInactiveCompletion) {
    getQueryState().markResultSurfaceInactive(tabId, 0)
  }
  useHistoryStore.getState().notifyNewQuery(connectionId)
  launchFirstResultAnalysis(run, results)
}

async function runMultiResultExecution({
  connectionId,
  tabId,
  ipcCall,
  runPostAnalysis,
}: MultiResultExecution): Promise<MultiQueryResult | null> {
  const currentState = getQueryState().tabs[tabId]
  if (isExecutionLocked(currentState)) return null

  getQueryState().clearEditState(tabId)
  patchTab(tabId, { wasCancelled: false, connectionId: connectionId })
  clearExpiredFlags(tabId)
  beginExecution(tabId)

  const run: MultiResultRun = {
    connectionId: connectionId,
    tabId: tabId,
    runPostAnalysis: runPostAnalysis,
    previousResultCount: currentState?.results.length ?? 0,
  }
  try {
    const multiResult = await ipcCall()
    if (!getQueryState().tabs[tabId]) return null
    applyMultiResultSuccess(run, multiResult.results)
    return multiResult
  } catch (error) {
    if (!getQueryState().tabs[tabId]) return null
    applyExecutionFailure(connectionId, tabId, error)
    return null
  }
}

export async function runSingleQuery({ connectionId, tabId, sql, viewSpec }: SingleQueryRun) {
  const currentState = getQueryState().tabs[tabId]
  if (isExecutionLocked(currentState)) return

  getQueryState().clearEditState(tabId)
  cancelAllResultLifecycleTimers(tabId, currentState?.results.length ?? 0)
  patchTab(tabId, { wasCancelled: false, connectionId: connectionId })
  clearExpiredFlags(tabId)
  beginExecution(tabId)

  try {
    const result = await executeQueryCmd({
      connectionId: connectionId,
      tabId: tabId,
      sql: sql,
      rowLimit: getDefaultRowLimit(),
      viewSpec: viewSpec ?? undefined,
    })
    if (!getQueryState().tabs[tabId]) return
    applySingleQuerySuccess({
      connectionId: connectionId,
      tabId: tabId,
      sql: sql,
      viewSpec: viewSpec,
      response: result,
    })
  } catch (error) {
    if (!getQueryState().tabs[tabId]) return
    applyExecutionFailure(connectionId, tabId, error)
  }
}

export async function executeQuery(connectionId: string, tabId: string, sql: string) {
  await runSingleQuery({
    connectionId: connectionId,
    tabId: tabId,
    sql: sql,
    viewSpec: null,
  })
}

export async function executeMultiQuery(connectionId: string, tabId: string, statements: string[]) {
  await runMultiResultExecution({
    connectionId: connectionId,
    tabId: tabId,
    ipcCall: () =>
      executeMultiQueryCmd({
        connectionId: connectionId,
        tabId: tabId,
        statements: statements,
        rowLimit: getDefaultRowLimit(),
      }),
    runPostAnalysis: true,
  })
}

export async function executeMultiQueryWithRun(
  target: RunTarget,
  runId: string
): Promise<MultiQueryResult | null> {
  const { connectionId, tabId, statements } = target
  return runMultiResultExecution({
    connectionId: connectionId,
    tabId: tabId,
    ipcCall: () =>
      executeMultiQueryCmd({
        connectionId: connectionId,
        tabId: tabId,
        statements: statements,
        rowLimit: getDefaultRowLimit(),
        runExport: { runId: runId },
      }),
    runPostAnalysis: true,
  })
}

export async function executeCallQuery(connectionId: string, tabId: string, sql: string) {
  await runMultiResultExecution({
    connectionId: connectionId,
    tabId: tabId,
    ipcCall: () =>
      executeCallQueryCmd({
        connectionId: connectionId,
        tabId: tabId,
        sql: sql,
        rowLimit: getDefaultRowLimit(),
      }),
    runPostAnalysis: false,
  })
}

export async function cancelQuery(connectionId: string, tabId: string) {
  if (!getQueryState().tabs[tabId]) return

  const state = getQueryState()
  if (state.tabs[tabId]?.isCancelling) return

  patchTab(tabId, { isCancelling: true, wasCancelled: true })

  try {
    const isCancelled = await cancelQueryCmd(connectionId, tabId)

    if (!getQueryState().tabs[tabId]) return

    if (!isCancelled) {
      patchTab(tabId, { isCancelling: false, wasCancelled: false })
      return
    }
    if (hasActiveRunExport(getQueryState().tabs[tabId])) return
    showSuccessToast('Query cancelled')
  } catch (error) {
    if (!getQueryState().tabs[tabId]) return

    patchTab(tabId, { isCancelling: false, wasCancelled: false })
    const errorMessage = toErrorMessage(error)
    showErrorToast('Cancel failed', errorMessage)
  }
}

function hasActiveRunExport(tab: TabQueryState | undefined): boolean {
  return tab?.runExport?.isActive === true
}

export function queryRunActions() {
  return { executeQuery, executeMultiQuery, executeCallQuery, cancelQuery }
}
