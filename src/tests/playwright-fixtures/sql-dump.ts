import type { DumpJobProgress } from '../../lib/sql-dump-commands'

export const SQL_DUMP_JOB_ID = 'mock-dump-job-1'

export const SQL_DUMP_PROGRESS_COMPLETED: DumpJobProgress = {
  jobId: SQL_DUMP_JOB_ID,
  status: 'completed',
  tablesTotal: 4,
  tablesDone: 4,
  currentTable: null,
  bytesWritten: 102400,
  rowsExported: 0,
  errorMessage: null,
  cancelRequested: false,
}
