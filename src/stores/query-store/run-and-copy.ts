import { writeClipboardText } from '../../lib/context-menu-utils'
import { logFrontendWarning } from '../../lib/app-log-commands'
import { QUERY_CANCELLED_MESSAGE, toErrorMessage } from '../../lib/error-message'
import {
  getRunExportProgress,
  startRunExport,
  type RunExportStart,
  type StartRunExportRequest,
} from '../../lib/export-commands'
import { formatCount, formatRowsCount } from '../../lib/format-row-count'
import type { MultiQueryResult, MultiQueryResultItem } from '../../types/schema'
import type { RunOutcome } from '../../types/run-export'
import {
  showErrorToast,
  showSuccessToast,
  showWarningToast,
  UNTIL_DISMISSED,
  WARNING_ERROR_TOAST_DURATION_MS,
  type ToastDuration,
} from '../toast-store'
import { useConnectionStore } from '../connection-store'
import { useWorkspaceStore } from '../workspace-store'
import { RESULT_EXPORT_POLL_MS } from './query-state-defaults'
import { executeMultiQueryWithRun } from './query-run'
import { getQueryState, patchTab } from './query-store-access'
import { isExecutionLocked } from './query-tab-selectors'
import type { RunTarget, TabRunExport } from './query-state-types'

const COPY_FAILED_TOAST_DURATION_MS = WARNING_ERROR_TOAST_DURATION_MS
const PATH_COPIED_TITLE = 'Run file path copied'
const RUN_STARTED_TITLE = 'Run started, path copied'
const RUN_STARTED_MESSAGE =
  'Results are still being written. Wait for "Run complete" before asking an agent to read them.'

type ToastVariant = 'success' | 'warning' | 'error'

interface OutcomeToast {
  variant: ToastVariant
  title: string
  message: string
}

interface FinishedRun {
  runFilePath: string
  statementCount: number
  results: MultiQueryResultItem[]
}

interface OutcomeDetails {
  statementNumber: number
  run: FinishedRun
}

const SHOW_TOAST: Record<
  ToastVariant,
  (title: string, message: string, durationMs: ToastDuration) => string
> = {
  success: showSuccessToast,
  warning: showWarningToast,
  error: showErrorToast,
}

const runPollTimers = new Map<string, ReturnType<typeof setTimeout>>()

function resultSetsText(results: MultiQueryResultItem[]): string {
  const resultSets = results.filter((item) => item.columns.length > 0)
  const rowCount = resultSets.reduce(
    (total, item) => total + (item.exportedRowCount ?? item.totalRows),
    0
  )
  const resultSetWord = resultSets.length === 1 ? 'result set' : 'result sets'
  return `${formatCount(resultSets.length)} ${resultSetWord} · ${formatRowsCount(rowCount)}`
}

const OUTCOME_TOASTS: Record<RunOutcome['kind'], (details: OutcomeDetails) => OutcomeToast> = {
  complete: ({ run }) => ({
    variant: 'success',
    title: 'Run complete',
    message: `${resultSetsText(run.results)} · ${run.runFilePath}`,
  }),
  cancelled: ({ statementNumber, run }) => ({
    variant: 'warning',
    title: `Run cancelled at statement ${statementNumber} of ${run.statementCount}`,
    message: `Result ${statementNumber} is incomplete. Run file: ${run.runFilePath}`,
  }),
  stopped: ({ statementNumber, run }) => ({
    variant: 'warning',
    title: `Run stopped at statement ${statementNumber} of ${run.statementCount}`,
    message: `Run file: ${run.runFilePath}. It lists the error and the statements that did not run.`,
  }),
  writeFailed: ({ statementNumber }) => ({
    variant: 'error',
    title: `Run stopped: couldn't write result ${statementNumber}`,
    message: 'Statements that already ran are not undone. Free up disk space, then run again.',
  }),
  failed: ({ run }) => ({
    variant: 'warning',
    title: 'Run failed',
    message: `Run file: ${run.runFilePath}. It records the error.`,
  }),
}

function statementNumberOf(outcome: RunOutcome): number {
  return 'statementNumber' in outcome ? outcome.statementNumber : 0
}

function outcomeToast(outcome: RunOutcome, run: FinishedRun): OutcomeToast {
  const build = OUTCOME_TOASTS[outcome.kind]
  return build({ statementNumber: statementNumberOf(outcome), run: run })
}

function connectionName(connectionId: string): string {
  return useConnectionStore.getState().activeConnections[connectionId]?.profile?.name ?? ''
}

function tabTitle(connectionId: string, tabId: string): string {
  const tabs = useWorkspaceStore.getState().tabsByConnection[connectionId] ?? []
  return tabs.find((tab) => tab.id === tabId)?.label ?? ''
}

function startRequest(target: RunTarget): StartRunExportRequest {
  return {
    connectionId: target.connectionId,
    tabId: target.tabId,
    connectionName: connectionName(target.connectionId),
    tabTitle: tabTitle(target.connectionId, target.tabId),
    statements: target.statements,
  }
}

async function startRun(target: RunTarget): Promise<RunExportStart | null> {
  try {
    return await startRunExport(startRequest(target))
  } catch (error) {
    showErrorToast("Couldn't start the run", `Nothing ran. ${toErrorMessage(error)}`)
    return null
  }
}

async function copyPath(path: string, failureTitle: string): Promise<boolean> {
  try {
    await writeClipboardText(path)
    return true
  } catch (error) {
    logFrontendWarning('[run-and-copy] clipboard write failed:', error)
    showWarningToast(
      failureTitle,
      `Copy this path manually: ${path}`,
      COPY_FAILED_TOAST_DURATION_MS
    )
    return false
  }
}

async function copyStartedRunPath(path: string): Promise<void> {
  const isCopied = await copyPath(path, 'Run started, copy failed')
  if (!isCopied) return
  showSuccessToast(RUN_STARTED_TITLE, RUN_STARTED_MESSAGE)
}

function patchRunExport(tabId: string, partial: Partial<TabRunExport>): void {
  const current = getQueryState().tabs[tabId]?.runExport
  if (!current) return
  patchTab(tabId, { runExport: { ...current, ...partial } })
}

function isPollingRun(tabId: string, runId: string): boolean {
  const runExport = getQueryState().tabs[tabId]?.runExport
  return runExport?.isActive === true && runExport.runId === runId
}

async function readRunProgress(runId: string) {
  try {
    return await getRunExportProgress(runId)
  } catch (error) {
    logFrontendWarning('[run-and-copy] run progress read failed:', error)
    return null
  }
}

async function pollRunProgress(tabId: string, runId: string): Promise<void> {
  const progress = await readRunProgress(runId)
  if (!isPollingRun(tabId, runId)) return
  if (progress) patchRunExport(tabId, { progress: progress })
  scheduleRunProgressPoll(tabId, runId)
}

function scheduleRunProgressPoll(tabId: string, runId: string): void {
  const timer = setTimeout(() => void pollRunProgress(tabId, runId), RESULT_EXPORT_POLL_MS)
  runPollTimers.set(tabId, timer)
}

export function stopRunProgressPolling(tabId: string): void {
  clearTimeout(runPollTimers.get(tabId))
  runPollTimers.delete(tabId)
}

function failedRunOutcome(tabId: string): RunOutcome {
  const errorMessage = getQueryState().tabs[tabId]?.results[0]?.errorMessage ?? ''
  if (errorMessage === QUERY_CANCELLED_MESSAGE) return { kind: 'cancelled', statementNumber: 1 }
  return { kind: 'failed', message: errorMessage }
}

function runOutcomeOf(tabId: string, result: MultiQueryResult | null): RunOutcome {
  return result?.runExport?.outcome ?? failedRunOutcome(tabId)
}

function showOutcomeToast(toast: OutcomeToast): void {
  SHOW_TOAST[toast.variant](toast.title, toast.message, UNTIL_DISMISSED)
}

function finishRun(target: RunTarget, result: MultiQueryResult | null): void {
  const { tabId } = target
  stopRunProgressPolling(tabId)
  const runExport = getQueryState().tabs[tabId]?.runExport
  if (!runExport) return
  patchRunExport(tabId, { isActive: false, progress: null })
  const finished: FinishedRun = {
    runFilePath: runExport.runFilePath,
    statementCount: target.statements.length,
    results: result?.results ?? [],
  }
  showOutcomeToast(outcomeToast(runOutcomeOf(tabId, result), finished))
}

export async function executeAllAndCopyResultPath(target: RunTarget): Promise<void> {
  if (isExecutionLocked(getQueryState().tabs[target.tabId])) return
  const started = await startRun(target)
  if (!started) return
  patchTab(target.tabId, {
    runExport: {
      runId: started.runId,
      runFilePath: started.runFilePath,
      progress: null,
      isActive: true,
    },
  })
  void copyStartedRunPath(started.runFilePath)
  scheduleRunProgressPoll(target.tabId, started.runId)
  const result = await executeMultiQueryWithRun(target, started.runId)
  finishRun(target, result)
}

export async function copyLastRunFilePath(tabId: string): Promise<void> {
  const path = getQueryState().tabs[tabId]?.runExport?.runFilePath
  if (!path) return
  const isCopied = await copyPath(path, 'Run file ready, copy failed')
  if (!isCopied) return
  showSuccessToast(PATH_COPIED_TITLE, path)
}

export function runAndCopyActions() {
  return { executeAllAndCopyResultPath, copyLastRunFilePath }
}
