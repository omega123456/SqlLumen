import { invokeArgumentCommand, invokeCommand } from './ipc/dispatch'
import type { JobStatus } from './job-progress'

export interface ExportableDatabase {
  name: string
  tables: ExportableTable[]
}

export type SqlDumpObjectType = 'table' | 'view'

export interface ExportableTable {
  name: string
  objectType: SqlDumpObjectType
  estimatedRows: number
}

export interface DumpTableEntry {
  name: string
  objectType: SqlDumpObjectType
}

export interface DumpOptions {
  includeStructure: boolean
  includeData: boolean
  includeDrop: boolean
  useTransaction: boolean
}

export interface StartDumpInput {
  connectionId: string
  filePath: string
  databases: string[]
  tables: Record<string, DumpTableEntry[]>
  options: DumpOptions
}

export type DumpJobStatus = JobStatus

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

export type ImportJobStatus = JobStatus

export interface ImportError {
  statementIndex: number
  sqlPreview: string
  errorMessage: string
}

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
