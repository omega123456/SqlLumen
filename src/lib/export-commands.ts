import { invoke } from '@tauri-apps/api/core'
import type { ExportFormat, ExportOptions } from '../types/schema'

/** Result returned by the `export_results` Tauri command. */
export interface ExportResult {
  bytesWritten: number
  rowsExported: number
}

/**
 * Export the stored query results for the given connection/tab to a file.
 * The Rust backend copies the row pointers under a brief lock and writes
 * in a background thread so the UI stays responsive.
 *
 * The export always writes the result's **current view**: the active sort and
 * filter are applied and deleted rows are excluded.
 *
 * @param resultIndex — optional index into the `Vec<StoredResult>` for multi-result tabs.
 *                      If omitted, the backend defaults to index 0.
 */
export async function exportResults(
  connectionId: string,
  tabId: string,
  options: ExportOptions,
  resultIndex?: number
): Promise<ExportResult> {
  return invoke<ExportResult>('export_results', {
    connectionId,
    tabId,
    options,
    ...(resultIndex !== undefined ? { resultIndex } : {}),
  })
}

/** Status of a streaming full export (`get_result_export_progress`). */
export type ResultExportStatus = 'running' | 'completed' | 'cancelled' | 'failed'

/** Progress of a streaming full export of a truncated result. */
export interface ResultExportProgress {
  status: ResultExportStatus
  rowsWritten: number
  bytesWritten: number
  elapsedMs: number
  /** True when an XLSX export stopped at Excel's 1,048,576-row sheet limit. */
  stoppedAtSheetLimit: boolean
  error: string | null
}

/** Arguments of `start_result_export`. */
export interface StartResultExportArgs {
  connectionId: string
  tabId: string
  resultIndex: number
  queryId: string
  format: ExportFormat
  filePath: string
  includeHeaders: boolean
  /** Table name for SQL INSERT output. */
  tableName?: string
}

/**
 * Start a streaming full export of a truncated, re-runnable result. The
 * backend re-runs the result's SQL on the editor session (no auto-LIMIT, no
 * row ceiling) in the database it originally ran in, and streams every row to
 * the file. Grid sort and filter are not applied. Resolves with the job id.
 */
export async function startResultExport(args: StartResultExportArgs): Promise<string> {
  return invoke<string>('start_result_export', {
    connectionId: args.connectionId,
    tabId: args.tabId,
    resultIndex: args.resultIndex,
    queryId: args.queryId,
    format: args.format,
    filePath: args.filePath,
    includeHeaders: args.includeHeaders,
    tableName: args.tableName ?? null,
  })
}

/** Poll the progress of a streaming full export. */
export async function getResultExportProgress(jobId: string): Promise<ResultExportProgress> {
  return invoke<ResultExportProgress>('get_result_export_progress', { jobId })
}

/** Cancel a streaming full export (`KILL QUERY` on its re-run; no file is written). */
export async function cancelResultExport(jobId: string): Promise<void> {
  await invoke('cancel_result_export', { jobId })
}
