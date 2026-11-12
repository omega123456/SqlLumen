import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useJobProgressPolling } from '../../hooks/useJobProgressPolling'
import { JOB_PROGRESS_POLL_INTERVAL_MS, type JobStatus } from '../../lib/job-progress'
import { ipc } from '../ipc-mock'

interface TestProgress {
  status: JobStatus
}

function renderPolling(
  jobId: string | null,
  fetchProgress: (jobId: string) => Promise<TestProgress>
) {
  const onProgress = vi.fn()
  const onFinished = vi.fn()
  const hook = renderHook(() =>
    useJobProgressPolling({
      jobId: jobId,
      fetchProgress: fetchProgress,
      onProgress: onProgress,
      onFinished: onFinished,
      pollFailureMessage: '[test] Failed to poll progress:',
    })
  )
  return { ...hook, onProgress: onProgress, onFinished: onFinished }
}

async function advancePollInterval(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(JOB_PROGRESS_POLL_INTERVAL_MS)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useJobProgressPolling', () => {
  it('does not poll without a job id', async () => {
    const fetchProgress = vi.fn()
    renderPolling(null, fetchProgress)

    await advancePollInterval()

    expect(fetchProgress).not.toHaveBeenCalled()
  })

  it('polls immediately and on every interval while the job runs', async () => {
    const fetchProgress = vi.fn(async () => ({ status: 'running' as const }))
    const { onProgress, onFinished } = renderPolling('job-1', fetchProgress)

    await act(async () => {})
    expect(fetchProgress).toHaveBeenCalledWith('job-1')
    expect(onProgress).toHaveBeenCalledWith({ status: 'running' })

    await advancePollInterval()
    expect(fetchProgress).toHaveBeenCalledTimes(2)
    expect(onFinished).not.toHaveBeenCalled()
  })

  it('stops polling and reports the finished job once it is terminal', async () => {
    const fetchProgress = vi.fn(async () => ({ status: 'completed' as const }))
    const { onFinished } = renderPolling('job-2', fetchProgress)

    await act(async () => {})
    expect(onFinished).toHaveBeenCalledWith({ status: 'completed' })

    await advancePollInterval()
    expect(fetchProgress).toHaveBeenCalledTimes(1)
  })

  it('logs a failed poll and keeps polling', async () => {
    const fetchProgress = vi.fn(async (): Promise<TestProgress> => {
      throw new Error('IPC down')
    })
    renderPolling('job-3', fetchProgress)

    await act(async () => {})
    expect(ipc.calls('log_frontend')).toContainEqual({
      level: 'error',
      message: '[test] Failed to poll progress: Error: IPC down',
    })

    await advancePollInterval()
    expect(fetchProgress).toHaveBeenCalledTimes(2)
  })

  it('stops polling on unmount', async () => {
    const fetchProgress = vi.fn(async () => ({ status: 'running' as const }))
    const { unmount } = renderPolling('job-4', fetchProgress)

    await act(async () => {})
    unmount()
    await advancePollInterval()

    expect(fetchProgress).toHaveBeenCalledTimes(1)
  })
})
