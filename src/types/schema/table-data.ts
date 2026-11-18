import type { ForeignKeyColumnInfo } from '../schema'
import type {
  FilterCondition,
  FrontendRowResidencyState,
  RowEditState,
  SelectedCellInfo,
} from './query-results'

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

export type TableDataCacheRestoreStatus = 'available' | 'expired' | 'missing'

export interface TableDataCacheRestoreResult {
  status: TableDataCacheRestoreStatus
  data: TableDataResponse | null
}

export type TableDataCacheSyncStatus = 'synced' | 'expired' | 'missing'

export interface TableDataCacheSyncResult {
  status: TableDataCacheSyncStatus
}

export interface TableDataSortInfo {
  column: string
  direction: 'asc' | 'desc'
}

export interface TableDataTabState {
  columns: TableDataColumnMeta[]
  rows: unknown[][]
  currentPage: number
  pageSize: number
  primaryKey: PrimaryKeyInfo | null
  executionTimeMs: number
  rowResidency?: FrontendRowResidencyState
  rowsEvictedAt: number | null

  connectionId: string
  database: string
  table: string

  editState: RowEditState | null

  viewMode: 'grid' | 'form'
  selectedRowKey: Record<string, unknown> | null
  columnWidths?: Record<string, number>

  selectedCell: SelectedCellInfo | null
  checkedRowKeys?: Record<string, unknown>[]

  filterModel: FilterCondition[]
  sort: TableDataSortInfo | null

  foreignKeys?: ForeignKeyColumnInfo[]

  isLoading: boolean
  isCancelling?: boolean
  error: string | null
  saveError: string | null
  isExportDialogOpen: boolean

  scrollRow: number
  scrollCol: number

  pendingNavigationAction: (() => void) | null
}
