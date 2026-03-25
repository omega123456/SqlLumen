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
 */
export async function exportResults(
  connectionId: string,
  tabId: string,
  options: ExportOptions
): Promise<ExportResult> {
  return invoke<ExportResult>('export_results', { connectionId, tabId, options })
}
