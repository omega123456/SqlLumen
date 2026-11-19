import type { DataViewSurfaceRef } from '../data-view/data-view-types'
import { isResultsExpiredError } from '../../lib/result-window-cache'
import { formatCount } from '../../lib/format-row-count'
import {
  cancelResultExport as cancelResultExportCmd,
  getResultExportProgress as getResultExportProgressCmd,
  startResultExport as startResultExportCmd,
  type ResultExportProgress,
} from '../../lib/export-commands'
import { showErrorToast, showSuccessToast, showWarningToast } from '../toast-store'
import { logFrontend, logFrontendError } from '../../lib/app-log-commands'
import { toErrorMessage } from '../../lib/error-message'
import { hasOpenExportDialog } from './result-lists'
import {
  closeQueryExportDialogs,
  patchExportJob as patchExportJobOf,
  putExportJob,
  removeExportJob,
} from './query-tab-reducers'
import { RESULT_EXPORT_POLL_MS } from './query-state-defaults'
import type { ExportRowScope, FullExportRequest, ResultExportJob } from './query-state-types'
import { patchSurface, resultAt, getQueryState, setQueryState } from './query-store-access'

const exportPollTimers = new Map<string, ReturnType<typeof setTimeout>>()

let nextExportStartToken = 0

function stopExportPolling(tabId: string): void {
  const timer = exportPollTimers.get(tabId)
  if (timer !== undefined) {
    clearTimeout(timer)
    exportPollTimers.delete(tabId)
  }
}

function isCurrentExportJob(tabId: string, jobId: string | null): boolean {
  return getQueryState().exportJobs[tabId]?.jobId === jobId
}

function isExportRunning(tabId: string): boolean {
  return getQueryState().exportJobs[tabId]?.status === 'running'
}

export function runningExportJobId(tabId: string): string | null {
  const job = getQueryState().exportJobs[tabId]
  if (job?.status !== 'running') return null
  return job.jobId
}

function patchExportJob(tabId: string, partial: Partial<ResultExportJob>) {
  setQueryState((state) => patchExportJobOf(state, { tabId: tabId, partial: partial }))
}

export function dropExportJob(tabId: string) {
  stopExportPolling(tabId)
  setQueryState((state) => removeExportJob(state, tabId))
}

function isExportDialogOpenForTab(tabId: string): boolean {
  return hasOpenExportDialog(getQueryState().tabs[tabId])
}

function closeExportDialogsForTab(tabId: string) {
  setQueryState((state) => closeQueryExportDialogs(state, tabId))
}

export function cancelExportJobInBackground(jobId: string, context: string) {
  cancelResultExportCmd(jobId).catch((error: unknown) => {
    logFrontendError(`[query-store] cancelResultExport failed (${context}):`, error)
  })
}

function finishExportJob(tabId: string, progress: ResultExportProgress) {
  const job = getQueryState().exportJobs[tabId]
  if (!job) return
  stopExportPolling(tabId)
  if (progress.status === 'completed') {
    dropExportJob(tabId)
    closeExportDialogsForTab(tabId)
    const limitNote = progress.stoppedAtSheetLimit ? " Stopped at Excel's 1,048,576-row limit." : ''
    showSuccessToast(
      'Export completed',
      `${formatCount(progress.rowsWritten)} rows saved to ${job.filePath}${limitNote}`
    )
    if (progress.error) {
      logFrontend('warn', `[query-store] full export: ${progress.error}`)
      showWarningToast('Database not restored', progress.error)
    }
    return
  }
  const error =
    progress.status === 'failed' ? (progress.error ?? 'The export stopped unexpectedly.') : null
  if (progress.status === 'failed') {
    showErrorToast('Export failed', error ?? undefined)
  }
  if (!isExportDialogOpenForTab(tabId)) {
    dropExportJob(tabId)
    return
  }
  patchExportJob(tabId, {
    status: progress.status,
    progress: progress,
    error: error,
    cancelRequested: false,
  })
}

async function pollExportJob(tabId: string, jobId: string) {
  exportPollTimers.delete(tabId)
  let progress: ResultExportProgress
  try {
    progress = await getResultExportProgressCmd(jobId)
  } catch (error) {
    if (!isCurrentExportJob(tabId, jobId)) return
    const message = toErrorMessage(error)
    logFrontend('error', `[query-store] getResultExportProgress failed: ${message}`)
    finishExportJob(tabId, {
      status: 'failed',
      rowsWritten: getQueryState().exportJobs[tabId]?.progress?.rowsWritten ?? 0,
      bytesWritten: 0,
      elapsedMs: 0,
      stoppedAtSheetLimit: false,
      error: message,
    })
    return
  }
  if (!isCurrentExportJob(tabId, jobId)) return
  if (progress.status === 'running') {
    patchExportJob(tabId, { progress })
    scheduleExportPoll(tabId, jobId, RESULT_EXPORT_POLL_MS)
    return
  }
  finishExportJob(tabId, progress)
}

function scheduleExportPoll(tabId: string, jobId: string, delayMs: number) {
  stopExportPolling(tabId)
  exportPollTimers.set(
    tabId,
    setTimeout(() => {
      void pollExportJob(tabId, jobId)
    }, delayMs)
  )
}

function handleExportStartFailure(tabId: string, message: string, isStillThisJob: boolean) {
  if (!isStillThisJob) {
    logFrontend(
      'info',
      `[query-store] start_result_export failed after its job was dropped: ${message}`
    )
    return
  }
  if (isResultsExpiredError(message)) {
    getQueryState().markResultsExpired(tabId)
    dropExportJob(tabId)
    closeExportDialogsForTab(tabId)
    return
  }
  showErrorToast('Export failed', message)
  patchExportJob(tabId, { status: 'failed', error: message })
}

export function openExportDialog(ref: DataViewSurfaceRef, scope: ExportRowScope = 'currentView') {
  patchSurface(ref, { view: { prompts: { isExportOpen: true, exportScope: scope } } })
}

export function closeExportDialog(ref: DataViewSurfaceRef) {
  const { tabId } = ref
  patchSurface(ref, { view: { prompts: { isExportOpen: false } } })
  const job = getQueryState().exportJobs[tabId]
  const hasFinishedExportJob = job !== undefined && job.status !== 'running'
  if (hasFinishedExportJob) dropExportJob(tabId)
}

export async function startFullExport(tabId: string, request: FullExportRequest) {
  if (isExportRunning(tabId)) return
  const queryId = resultAt(tabId, request.resultIndex)?.view.slot.queryId ?? ''
  const startToken = ++nextExportStartToken
  stopExportPolling(tabId)
  const startingJob: ResultExportJob = {
    ...request,
    jobId: null,
    queryId: queryId,
    status: 'running',
    progress: null,
    cancelRequested: false,
    error: null,
    startToken: startToken,
  }
  setQueryState((state) => putExportJob(state, { tabId: tabId, job: startingJob }))
  const isStillThisJob = () => getQueryState().exportJobs[tabId]?.startToken === startToken

  let jobId: string
  try {
    jobId = await startResultExportCmd({
      connectionId: request.connectionId,
      tabId: tabId,
      resultIndex: request.resultIndex,
      queryId: queryId,
      format: request.format,
      filePath: request.filePath,
      includeHeaders: request.includeHeaders,
      tableName: request.tableName,
    })
  } catch (error) {
    handleExportStartFailure(tabId, toErrorMessage(error), isStillThisJob())
    return
  }

  if (!isStillThisJob()) {
    cancelExportJobInBackground(jobId, 'start raced cleanup')
    return
  }
  patchExportJob(tabId, { jobId })
  if (getQueryState().exportJobs[tabId]?.cancelRequested) {
    cancelExportJobInBackground(jobId, 'queued cancel')
  }
  scheduleExportPoll(tabId, jobId, 0)
}

export async function cancelFullExport(tabId: string) {
  const job = getQueryState().exportJobs[tabId]
  if (!job) return
  if (job.status !== 'running') return
  if (job.cancelRequested) return
  patchExportJob(tabId, { cancelRequested: true })
  if (job.jobId === null) return
  try {
    await cancelResultExportCmd(job.jobId)
  } catch (error) {
    const message = toErrorMessage(error)
    if (isCurrentExportJob(tabId, job.jobId)) {
      patchExportJob(tabId, { cancelRequested: false })
    }
    showErrorToast('Cancel failed', message)
  }
}

export function fullExportActions() {
  return { openExportDialog, closeExportDialog, startFullExport, cancelFullExport }
}
