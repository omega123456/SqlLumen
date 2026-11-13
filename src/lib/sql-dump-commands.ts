import { invokeArgumentCommand, invokeCommand } from './ipc/dispatch'
import type { JobStatus } from './job-progress'

/** A database with its exportable tables/views. */
export interface ExportableDatabase {
  name: string
  tables: ExportableTable[]
}

/** The closed set of supported SQL dump object categories. */
export type SqlDumpObjectType = 'table' | 'view'

/** A table or view available for SQL dump export. */
export interface ExportableTable {
  name: string
  objectType: SqlDumpObjectType
  estimatedRows: number
}

/** A selected table or view in the dump-start input. */
export interface DumpTableEntry {
  name: string
  objectType: SqlDumpObjectType
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
  tables: Record<string, DumpTableEntry[]>
  options: DumpOptions
}

/** Status of a SQL dump export job. */
export type DumpJobStatus = JobStatus

/** Progress info for an active or completed SQL dump export job. */
export interface DumpJobProgress {
  jobId: string
  status: DumpJobStatus
  tablesTotal: number
  tablesDone: number
  currentTable: string | null
  bytesWritten: number
  rowsExported: number
  errorMessage: string | null
  cancelRequested: boolean
}

export async function listExportableObjects(connectionId: string): Promise<ExportableDatabase[]> {
  return invokeArgumentCommand({ command: 'list_exportable_objects', argument: { connectionId } })
}

export async function startSqlDump(input: StartDumpInput): Promise<string> {
  return invokeArgumentCommand({ command: 'start_sql_dump', argument: { input } })
}

export async function getDumpProgress(jobId: string): Promise<DumpJobProgress> {
  return invokeArgumentCommand({ command: 'get_dump_progress', argument: { jobId } })
}

export async function cancelDump(jobId: string, connectionId: string): Promise<void> {
  return invokeCommand({ command: 'cancel_dump', payload: { jobId, connectionId } })
}

// ---------------------------------------------------------------------------
// SQL Import types & IPC wrappers
// ---------------------------------------------------------------------------

/** Status of a SQL import job. */
export type ImportJobStatus = JobStatus

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

export interface StartImportInput {
  connectionId: string
  filePath: string
  stopOnError: boolean
}

export async function startSqlImport(
  connectionId: string,
  filePath: string,
  stopOnError: boolean
): Promise<string> {
  return invokeArgumentCommand({
    command: 'start_sql_import',
    argument: { input: { connectionId, filePath, stopOnError } },
  })
}

export async function getImportProgress(jobId: string): Promise<ImportJobProgress> {
  return invokeArgumentCommand({ command: 'get_import_progress', argument: { jobId } })
}

export async function cancelImport(jobId: string): Promise<void> {
  return invokeArgumentCommand({ command: 'cancel_import', argument: { jobId } })
}
