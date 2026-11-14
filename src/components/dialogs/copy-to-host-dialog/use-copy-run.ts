import { useCallback, useState } from 'react'
import {
  assembleCopyObjects,
  cancelCopy,
  getCopyProgress,
  startCopyToHost,
  type CopyObjectCategory,
  type CopyProgress,
} from '../../../lib/copy-to-host-commands'
import { logFrontendError } from '../../../lib/app-log-commands'
import { toErrorMessage } from '../../../lib/error-message'
import { useJobProgressPolling } from '../../../hooks/useJobProgressPolling'
import { showErrorToast, showSuccessToast } from '../../../stores/toast-store'
import {
  IDLE_COPY_RUN,
  objectCountText,
  toCopyToHostOptions,
  type CopyDialogOptions,
  type CopyRunState,
} from './copy-to-host-model'

export interface CopyRequest {
  canCopy: boolean
  selected: Record<CopyObjectCategory, Set<string>>
  copyOptions: CopyDialogOptions
  sourceConnectionId: string
  sourceDatabase: string
  targetConnectionId: string
  targetDatabase: string
}

type PatchCopyRun = (patch: Partial<CopyRunState>) => void

function reportCopyFinished(finishedProgress: CopyProgress, patchCopyRun: PatchCopyRun): void {
  patchCopyRun({ isCopying: false })
  if (finishedProgress.status === 'completed') {
    showSuccessToast('Copy completed', `${objectCountText(finishedProgress.objectsDone)} copied`)
    return
  }
  if (finishedProgress.status === 'cancelled') {
    patchCopyRun({ cancelPending: false })
    return
  }
  showErrorToast('Copy failed', finishedProgress.errorMessage ?? 'Copy to host failed')
}

async function startCopyJob(request: CopyRequest, patchCopyRun: PatchCopyRun): Promise<void> {
  if (!request.canCopy) return
  patchCopyRun({ isCopying: true, progress: null })
  try {
    const id = await startCopyToHost({
      sourceConnectionId: request.sourceConnectionId,
      sourceDatabase: request.sourceDatabase,
      targetConnectionId: request.targetConnectionId,
      targetDatabase: request.targetDatabase,
      objects: assembleCopyObjects(request.selected),
      options: toCopyToHostOptions(request.copyOptions),
    })
    patchCopyRun({ jobId: id })
  } catch (error) {
    patchCopyRun({ isCopying: false })
    const message = toErrorMessage(error)
    showErrorToast('Copy failed', message)
    logFrontendError('[copy-to-host] Failed to start copy:', message)
  }
}

export function useCopyRun() {
  const [copyRun, setCopyRun] = useState<CopyRunState>(IDLE_COPY_RUN)
  const { jobId, cancelPending } = copyRun
  const patchCopyRun = useCallback((patch: Partial<CopyRunState>) => {
    setCopyRun((current) => ({ ...current, ...patch }))
  }, [])

  useJobProgressPolling({
    jobId: jobId,
    fetchProgress: getCopyProgress,
    onProgress: (nextProgress) => patchCopyRun({ progress: nextProgress }),
    onFinished: (finishedProgress) => reportCopyFinished(finishedProgress, patchCopyRun),
    pollFailureMessage: '[copy-to-host] Failed to poll progress:',
  })

  const handleCancel = useCallback(async () => {
    if (!jobId) return
    if (cancelPending) return
    patchCopyRun({ cancelPending: true })
    try {
      await cancelCopy(jobId)
    } catch (error) {
      patchCopyRun({ cancelPending: false })
      const message = toErrorMessage(error)
      logFrontendError('[copy-to-host] Failed to cancel copy:', message)
      showErrorToast('Failed to cancel copy', message)
    }
  }, [jobId, cancelPending, patchCopyRun])

  const startCopy = (request: CopyRequest) => startCopyJob(request, patchCopyRun)

  return { copyRun, startCopy, handleCancel }
}
