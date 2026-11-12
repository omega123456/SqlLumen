import { PERCENT_SCALE } from './units'

export type JobStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface JobProgressSnapshot {
  status: JobStatus
}

export const JOB_PROGRESS_POLL_INTERVAL_MS = 500

const TERMINAL_JOB_STATUSES: ReadonlySet<JobStatus> = new Set(['completed', 'failed', 'cancelled'])

export function isTerminalJobStatus(status: JobStatus | undefined): boolean {
  if (status === undefined) return false
  return TERMINAL_JOB_STATUSES.has(status)
}

export function progressPercent(
  done: number | null | undefined,
  total: number | null | undefined
): number {
  if (!total) return 0
  return Math.round(((done ?? 0) / total) * PERCENT_SCALE)
}
