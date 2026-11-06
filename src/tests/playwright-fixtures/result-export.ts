import type { ResultExportProgress } from '../../lib/export-commands'

/** Job id returned by the mocked `start_result_export`. */
export const RESULT_EXPORT_JOB_ID = 'result-export-job-1'

/** A full export that is still streaming rows. */
export const RESULT_EXPORT_PROGRESS_RUNNING: ResultExportProgress = {
  status: 'running',
  rowsWritten: 1_240_000,
  bytesWritten: 318 * 1024 * 1024,
  elapsedMs: 42_000,
  stoppedAtSheetLimit: false,
  error: null,
}

/** A finished full export (the default, so mocked exports complete). */
export const RESULT_EXPORT_PROGRESS_COMPLETED: ResultExportProgress = {
  status: 'completed',
  rowsWritten: 250_000,
  bytesWritten: 12 * 1024 * 1024,
  elapsedMs: 3_000,
  stoppedAtSheetLimit: false,
  error: null,
}
