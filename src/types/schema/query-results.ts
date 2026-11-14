import type { ForeignKeyInfo } from '../schema'
import type { PrimaryKeyInfo, TableDataColumnMeta } from './table-data'

export interface ColumnMeta {
  name: string
  dataType: string
}

export interface BlobValueResponse {
  base64: string | null
  byteLength: number
  tooLarge: boolean
}

export interface BlobEnvelope {
  __sqllumen_blob__: true
  kind: 'bytes' | 'null' | 'empty'
  base64?: string
}

export interface QueryResultMeta {
  queryId: string
  columns: ColumnMeta[]
  totalRows: number
  executionTimeMs: number
  totalTimeMs: number
  affectedRows: number
  autoLimitApplied: boolean
}

export interface ResultWindow {
  offset: number
  rows: unknown[][]
  baseIndices: number[]
}

export interface ResultViewSort {
  column: string
  direction: 'asc' | 'desc'
}

export interface ResultViewSpec {
  sort: ResultViewSort | null
  filters: FilterCondition[]
}

export type FullExportBlockedReason = 'call' | 'locking' | 'unknownDatabase'

export interface ResultWindowMeta {
  viewRowCount: number
  viewVersion: number
  truncated: boolean
  rowCeiling: number
  appliedRowLimit: number | null
  fullExportBlockedReason: FullExportBlockedReason | null
  firstWindow: ResultWindow
}

export interface SetResultViewResult {
  viewVersion: number
  viewRowCount: number
  totalRows: number
  firstWindow: ResultWindow
}

export interface FetchResultWindowResult extends ResultWindow {
  viewRowCount: number
  viewVersion: number
}

export interface RemoveResultRowsResult {
  viewVersion: number
  viewRowCount: number
  totalRows: number
}

export type FrontendRowResidencyStatus = 'resident' | 'evicted' | 'restoring'

export interface FrontendRowResidencyState {
  status: FrontendRowResidencyStatus
  isActive: boolean
  inactiveSince: number | null
}

export type ViewMode = 'grid' | 'form' | 'text'

export type SortDirection = 'asc' | 'desc'

export type ExportFormat = 'csv' | 'json' | 'xlsx' | 'sql-insert'

export interface ExportOptions {
  format: ExportFormat
  filePath: string
  includeHeaders: boolean
  tableName?: string
}

export interface SelectedCellInfo {
  columnKey: string
  value: unknown
}

export type FilterOperator =
  '>' | '>=' | '<' | '<=' | '==' | '!=' | 'LIKE' | 'NOT LIKE' | 'IS NULL' | 'IS NOT NULL'

export interface FilterCondition {
  column: string
  operator: FilterOperator
  value: string
}

export interface RowEditState {
  rowKey: Record<string, unknown>
  originalValues: Record<string, unknown>
  currentValues: Record<string, unknown>
  modifiedColumns: Set<string>
  insertEligibleColumns?: Set<string>
  isNewRow: boolean
  tempId?: string
}

export interface MultiQueryResultItem extends ResultWindowMeta {
  queryId: string
  sourceSql: string
  columns: ColumnMeta[]
  totalRows: number
  executionTimeMs: number
  totalTimeMs: number
  affectedRows: number
  autoLimitApplied: boolean
  error: string | null
  reExecutable: boolean
}

export interface MultiQueryResult {
  results: MultiQueryResultItem[]
}

export interface QueryTableEditInfo {
  database: string
  table: string
  columns: TableDataColumnMeta[]
  primaryKey: PrimaryKeyInfo | null
  foreignKeys?: ForeignKeyInfo[]
}

export type QueryEditableColumnMap = Map<number, boolean>
