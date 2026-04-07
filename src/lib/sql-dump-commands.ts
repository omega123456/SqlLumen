import { invoke } from '@tauri-apps/api/core'

/** A database with its exportable tables/views. */
export interface ExportableDatabase {
  name: string
  tables: ExportableTable[]
}

/** A table or view available for SQL dump export. */
export interface ExportableTable {
  name: string
  objectType: string
  estimatedRows: number
}

/** Options controlling what gets included in the SQL dump. */
export interface DumpOptions {
  includeStructure: boolean
  includeData: boolean
  includeDrop: boolean
  useTransaction: boolean
}

/** Input for starting a SQL dump export job. */
export interface StartDumpInput {
  connectionId: string
  filePath: string
  databases: string[]
  tables: Record<string, string[]>
  options: DumpOptions
}

/** Status of a SQL dump export job. */
export type DumpJobStatus = 'running' | 'completed' | 'failed'

/** Progress info for an active or completed SQL dump export job. */
export interface DumpJobProgress {
  jobId: string
  status: DumpJobStatus
  tablesTotal: number
  tablesDone: number
  currentTable: string | null
  bytesWritten: number
  errorMessage: string | null
}

/** List databases and their tables/views that can be exported via SQL dump. */
export async function listExportableObjects(connectionId: string): Promise<ExportableDatabase[]> {
  return invoke<ExportableDatabase[]>('list_exportable_objects', { connectionId })
}

/** Start a SQL dump export job. Returns the job ID for progress tracking. */
export async function startSqlDump(input: StartDumpInput): Promise<string> {
  return invoke<string>('start_sql_dump', { input })
}

/** Get progress of a SQL dump export job. */
export async function getDumpProgress(jobId: string): Promise<DumpJobProgress> {
  return invoke<DumpJobProgress>('get_dump_progress', { jobId })
}

// ---------------------------------------------------------------------------
// SQL Import types & IPC wrappers
// ---------------------------------------------------------------------------

/** Status of a SQL import job. */
export type ImportJobStatus = 'running' | 'completed' | 'failed' | 'cancelled'

/** An error encountered during SQL import execution. */
export interface ImportError {
  statementIndex: number
  sqlPreview: string
  errorMessage: string
}

/** Progress info for an active or completed SQL import job. */
export interface ImportJobProgress {
  jobId: string
  status: ImportJobStatus
  statementsTotal: number
  statementsDone: number
  errors: ImportError[]
  stopOnError: boolean
  cancelRequested: boolean
}

/** Start a SQL import job. Returns the job ID for progress tracking. */
export async function startSqlImport(
  connectionId: string,
  filePath: string,
  stopOnError: boolean
): Promise<string> {
  return invoke<string>('start_sql_import', {
    input: { connectionId, filePath, stopOnError },
  })
}

/** Get progress of a SQL import job. */
export async function getImportProgress(jobId: string): Promise<ImportJobProgress> {
  return invoke<ImportJobProgress>('get_import_progress', { jobId })
}

/** Cancel a running SQL import job. */
export async function cancelImport(jobId: string): Promise<void> {
  return invoke<void>('cancel_import', { jobId })
}
