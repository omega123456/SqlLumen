import { invoke } from '@tauri-apps/api/core'
import type { ExportOptions } from '../types/schema'

/** Result returned by the `export_results` Tauri command. */
export interface ExportResult {
  bytesWritten: number
  rowsExported: number
}

/**
 * Export the stored query results for the given connection/tab to a file.
 * The Rust backend clones the result data under a brief lock and writes
 * in a background thread so the UI stays responsive.
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
