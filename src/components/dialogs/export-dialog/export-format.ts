import { formatCount } from '../../../lib/format-row-count'
import type { ResultExportJob, SingleResultState, TabQueryState } from '../../../stores/query-store'
import type { ExportFormat, ExportOptions } from '../../../types/schema'
import { BYTES_PER_MEGABYTE, TWO_DIGIT_WIDTH } from '../../../lib/units'
import { elapsedParts } from '../../../lib/elapsed-time'

const ONE_DECIMAL_BELOW_MEGABYTES = 10

export const EXPORT_FORMAT_CONFIG: Record<
  ExportFormat,
  {
    label: string
    extension: string
    supportsHeaders: boolean
    requiresTableName: boolean
    description: string
  }
> = {
  csv: {
    label: 'CSV (Comma Separated Values)',
    extension: 'csv',
    supportsHeaders: true,
    requiresTableName: false,
    description: 'Comma-separated values',
  },
  json: {
    label: 'JSON (JavaScript Object Notation)',
    extension: 'json',
    supportsHeaders: false,
    requiresTableName: false,
    description: 'JSON array of objects',
  },
  xlsx: {
    label: 'Excel (.xlsx)',
    extension: 'xlsx',
    supportsHeaders: true,
    requiresTableName: false,
    description: 'Excel Spreadsheet (.xlsx)',
  },
  'sql-insert': {
    label: 'SQL INSERT statements',
    extension: 'sql',
    supportsHeaders: false,
    requiresTableName: true,
    description: 'SQL INSERT statements',
  },
}

export const FORMAT_KEYS: readonly ExportFormat[] = ['csv', 'json', 'xlsx', 'sql-insert']

const XLSX_ALL_ROWS_DESCRIPTION = 'Excel (.xlsx) · up to 1,048,576 rows'

export function keepTableNameForSqlInsertOnly(options: Required<ExportOptions>): ExportOptions {
  const tableName = options.format === 'sql-insert' ? options.tableName : undefined
  return { ...options, tableName: tableName }
}

export function ignoredViewMessage(hasSort: boolean, filterCount: number): string {
  const filters = `${filterCount} ${filterCount === 1 ? 'filter' : 'filters'}`
  const hasFilters = filterCount > 0
  if (hasSort && hasFilters) return `Your sort and ${filters} will be ignored.`
  if (hasSort) return 'Your sort will be ignored.'
  return `Your ${filters} will be ignored.`
}

function formatElapsed(elapsedMs: number): string {
  const { totalMinutes, secondsOfMinute } = elapsedParts(elapsedMs)
  return `${totalMinutes}:${secondsOfMinute.toString().padStart(TWO_DIGIT_WIDTH, '0')}`
}

function formatMegabytes(bytes: number): string {
  const megabytes = bytes / BYTES_PER_MEGABYTE
  return megabytes < ONE_DECIMAL_BELOW_MEGABYTES
    ? megabytes.toFixed(1)
    : formatCount(Math.round(megabytes))
}

export function exportProgressText(job: ResultExportJob): string {
  const rows = job.progress?.rowsWritten ?? 0
  const isBuildingWorkbook = job.format === 'xlsx' && rows === 0
  if (isBuildingWorkbook) return 'Building workbook…'
  const elapsed = formatElapsed(job.progress?.elapsedMs ?? 0)
  if (job.format === 'xlsx') return `Rows written ${formatCount(rows)} · ${elapsed}`
  const bytes = job.progress?.bytesWritten ?? 0
  return `Rows written ${formatCount(rows)} · ${formatMegabytes(bytes)} MB · ${elapsed}`
}

export type ExportResult = SingleResultState

export const DEFAULT_EXPORT_TABLE_NAME = 'exported_results'
export const RESULTS_EXPIRED_ERROR_MARKER = 'results_expired'

export function resolveExportResultIndex(
  tab: TabQueryState,
  resultIndex: number | undefined
): number {
  return resultIndex ?? Math.min(tab.activeResultIndex, Math.max(0, tab.results.length - 1))
}

export function offersAllRowsExport(
  result: ExportResult | undefined,
  hasCustomExport: boolean
): boolean {
  if (hasCustomExport) return false
  if (!result?.truncated) return false
  return result.fullExportBlockedReason === null && result.view.slot.queryId !== null
}

export interface ViewModifiers {
  viewRowCount: number
  filterCount: number
  hasSort: boolean
}

export function viewModifiersOf(result: ExportResult | undefined): ViewModifiers {
  if (!result) return { viewRowCount: 0, filterCount: 0, hasSort: false }
  return {
    viewRowCount: result.view.slot.viewRowCount,
    filterCount: result.view.spec.filters.length,
    hasSort: result.view.spec.sort !== null,
  }
}

export function runningExportJob(exportJob: ResultExportJob | undefined): ResultExportJob | null {
  if (exportJob?.status !== 'running') return null
  return exportJob
}

export function isUnavailableFormat(format: ExportFormat, isView: boolean | undefined): boolean {
  return Boolean(isView) && format === 'sql-insert'
}

export function formatDescription(key: ExportFormat, offersAllRows: boolean): string {
  const isAllRowsWorkbook = offersAllRows && key === 'xlsx'
  if (isAllRowsWorkbook) return XLSX_ALL_ROWS_DESCRIPTION
  return EXPORT_FORMAT_CONFIG[key].description
}
