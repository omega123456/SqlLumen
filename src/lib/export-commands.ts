import { invokeArgumentCommand, invokeCommand } from './ipc/dispatch'
import type { ExportFormat, ExportOptions } from '../types/schema'
import type { ResultSlotRequest } from './ipc/requests'

export interface ExportResult {
  bytesWritten: number
  rowsExported: number
}

export interface ExportResultsRequest {
  connectionId: string
  tabId: string
  options: ExportOptions
  resultIndex?: number
}

export async function exportResults(request: ExportResultsRequest): Promise<ExportResult> {
  return invokeCommand({ command: 'export_results', payload: request })
}

export type ResultExportStatus = 'running' | 'completed' | 'cancelled' | 'failed'

export interface ResultExportProgress {
  status: ResultExportStatus
  rowsWritten: number
  bytesWritten: number
  elapsedMs: number
  stoppedAtSheetLimit: boolean
  error: string | null
}

export interface StartResultExportRequest extends ResultSlotRequest {
  format: ExportFormat
  filePath: string
  includeHeaders: boolean
  tableName: string | null
}

export interface StartResultExportArgs {
  connectionId: string
  tabId: string
  resultIndex: number
  queryId: string
  format: ExportFormat
  filePath: string
  includeHeaders: boolean
  tableName?: string
}

function toStartResultExportRequest(args: StartResultExportArgs): StartResultExportRequest {
  return {
    connectionId: args.connectionId,
    tabId: args.tabId,
    resultIndex: args.resultIndex,
    queryId: args.queryId,
    format: args.format,
    filePath: args.filePath,
    includeHeaders: args.includeHeaders,
    tableName: args.tableName ?? null,
  }
}

export async function startResultExport(args: StartResultExportArgs): Promise<string> {
  return invokeCommand({
    command: 'start_result_export',
    payload: toStartResultExportRequest(args),
  })
}

export async function getResultExportProgress(jobId: string): Promise<ResultExportProgress> {
  return invokeArgumentCommand({ command: 'get_result_export_progress', argument: { jobId } })
}

export async function cancelResultExport(jobId: string): Promise<void> {
  await invokeArgumentCommand({ command: 'cancel_result_export', argument: { jobId } })
}
