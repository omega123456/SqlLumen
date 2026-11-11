import type { ImportJobProgress } from '../../lib/sql-dump-commands'

export const SQL_IMPORT_JOB_ID = 'mock-import-job-1'

export const SQL_IMPORT_PROGRESS_RUNNING: ImportJobProgress = {
  jobId: SQL_IMPORT_JOB_ID,
  status: 'running',
  statementsTotal: 42,
  statementsDone: 18,
  errors: [],
  stopOnError: true,
  cancelRequested: false,
}
