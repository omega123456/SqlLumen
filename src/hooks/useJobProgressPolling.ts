import { useEffect, useEffectEvent } from 'react'
import { logFrontendError } from '../lib/app-log-commands'
import {
  isTerminalJobStatus,
  JOB_PROGRESS_POLL_INTERVAL_MS,
  type JobProgressSnapshot,
} from '../lib/job-progress'

export interface JobProgressPollingOptions<TProgress extends JobProgressSnapshot> {
  jobId: string | null
  fetchProgress: (jobId: string) => Promise<TProgress>
  onProgress: (progress: TProgress) => void
  onFinished: (progress: TProgress) => void
  pollFailureMessage: string
}

export function useJobProgressPolling<TProgress extends JobProgressSnapshot>({
  jobId,
  fetchProgress,
  onProgress,
  onFinished,
  pollFailureMessage,
}: JobProgressPollingOptions<TProgress>): void {
  const requestProgress = useEffectEvent((activeJobId: string) => fetchProgress(activeJobId))
  const reportProgress = useEffectEvent((progress: TProgress) => onProgress(progress))
  const reportFinished = useEffectEvent((progress: TProgress) => onFinished(progress))

  useEffect(() => {
    if (!jobId) return

    let stopped = false
    let nextPollTimeoutId: ReturnType<typeof setTimeout> | undefined

    const stopPolling = () => {
      stopped = true
      clearTimeout(nextPollTimeoutId)
    }

    const scheduleNextPoll = () => {
      if (stopped) return
      nextPollTimeoutId = setTimeout(poll, JOB_PROGRESS_POLL_INTERVAL_MS)
    }

    const handleProgress = (progress: TProgress) => {
      if (stopped) return
      reportProgress(progress)
      if (!isTerminalJobStatus(progress.status)) {
        scheduleNextPoll()
        return
      }
      stopPolling()
      reportFinished(progress)
    }

    const handleFailure = (error: unknown) => {
      logFrontendError(pollFailureMessage, error)
      scheduleNextPoll()
    }

    const poll = () => {
      requestProgress(jobId).then(handleProgress).catch(handleFailure)
    }

    poll()

    return stopPolling
  }, [jobId, pollFailureMessage])
}
