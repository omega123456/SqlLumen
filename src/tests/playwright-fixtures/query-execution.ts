import type { ExportResult } from '../../lib/export-commands'

export interface PlaywrightQuerySimulationFixture {
  errorMessage: string
  cancelledMessage: string
}

export const QUERY_SIMULATION: PlaywrightQuerySimulationFixture = {
  errorMessage: "Table 'app_db.nonexistent' doesn't exist",
  cancelledMessage: 'Query execution was interrupted (cancelled by mock)',
}

export const EXPORT_RESULTS_SUMMARY: ExportResult = { bytesWritten: 1024, rowsExported: 5 }
