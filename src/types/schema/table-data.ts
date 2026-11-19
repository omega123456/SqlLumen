import type { ResultWindow } from './query-results'

export interface TableDataColumnMeta {
  name: string
  dataType: string
  isBooleanAlias: boolean
  enumValues?: string[]
  setValues?: string[]
  isNullable: boolean
  isPrimaryKey: boolean
  isUniqueKey: boolean
  hasDefault: boolean
  columnDefault: string | null
  isBinary: boolean
  isAutoIncrement: boolean
  isGenerated?: boolean
}

export interface PrimaryKeyInfo {
  keyColumns: string[]
  hasAutoIncrement: boolean
  isUniqueKeyFallback: boolean
}

export interface TableDataResponse {
  columns: TableDataColumnMeta[]
  rows: unknown[][]
  currentPage: number
  pageSize: number
  primaryKey: PrimaryKeyInfo | null
  executionTimeMs: number
}

export interface TablePageResult {
  queryId: string
  columns: TableDataColumnMeta[]
  primaryKey: PrimaryKeyInfo | null
  currentPage: number
  pageSize: number
  executionTimeMs: number
  viewRowCount: number
  viewVersion: number
  totalRows: number
  rowCeiling: number
  firstWindow: ResultWindow
}

export type TableDataCacheRestoreStatus = 'available' | 'expired' | 'missing'

export interface TableDataCacheRestoreResult {
  status: TableDataCacheRestoreStatus
  data: TableDataResponse | null
}

export type TableDataCacheSyncStatus = 'synced' | 'expired' | 'missing'

export interface TableDataCacheSyncResult {
  status: TableDataCacheSyncStatus
}
