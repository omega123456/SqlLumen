import { invoke } from '@tauri-apps/api/core'
import type {
  TableDataResponse,
  PrimaryKeyInfo,
  FilterCondition,
  TableDataColumnMeta,
  TableDataCacheRestoreResult,
  TableDataCacheSyncResult,
  BlobValueResponse,
} from '../types/schema'

export type TableDataTouchStatus = 'available' | 'expired' | 'missing'

export interface TableDataTouchResult {
  status: TableDataTouchStatus
}

/** Backend filter condition — matches the Rust `FilterCondition` struct. */
type BackendFilterCondition = {
  column: string
  operator: string
  value: string
}

function isTinyIntBooleanAlias(dataType: string): boolean {
  const normalized = dataType.trim().toUpperCase()
  return (
    normalized === 'BOOL' ||
    normalized === 'BOOLEAN' ||
    normalized === 'TINYINT' ||
    normalized === 'TINYINT(1)'
  )
}

function normalizeTinyIntDisplayValue(value: unknown): unknown {
  if (typeof value === 'boolean') return value ? 1 : 0

  if (typeof value === 'string' && value.length === 1) {
    const code = value.charCodeAt(0)
    if (code === 0 || code === 1) return code
  }

  return value
}

export function normalizeTinyIntRows(
  columns: Array<{ dataType: string; isBooleanAlias?: boolean }>,
  rows: unknown[][]
): unknown[][] {
  const tinyIntIndexes = columns
    .map((column, index) =>
      column.isBooleanAlias || isTinyIntBooleanAlias(column.dataType) ? index : -1
    )
    .filter((index) => index !== -1)

  if (tinyIntIndexes.length === 0) return rows

  const mappedRows = rows.map((row) => {
    let copy: unknown[] | null = null

    for (const index of tinyIntIndexes) {
      const normalizedValue = normalizeTinyIntDisplayValue(row[index])
      if (normalizedValue !== row[index]) {
        copy ??= [...row]
        copy[index] = normalizedValue
      }
    }

    return copy ?? row
  })

  return mappedRows.some((row, index) => row !== rows[index]) ? mappedRows : rows
}

/**
 * Convert frontend `FilterCondition[]` to the shape expected by the Rust backend.
 * The types are structurally identical, but this function provides an explicit
 * mapping boundary and ensures the backend only receives the expected fields.
 */
function mapFilterConditions(conditions: FilterCondition[]): BackendFilterCondition[] {
  return conditions.map((c) => ({
    column: c.column,
    operator: c.operator,
    value: c.value,
  }))
}

export async function fetchTableData(params: {
  connectionId: string
  tabId: string
  database: string
  table: string
  page: number
  pageSize: number
  sortColumn?: string
  sortDirection?: string
  filterModel?: FilterCondition[]
}): Promise<TableDataResponse> {
  const response = await invoke<TableDataResponse>('fetch_table_data', {
    connectionId: params.connectionId,
    tabId: params.tabId,
    database: params.database,
    table: params.table,
    page: params.page,
    pageSize: params.pageSize,
    sortColumn: params.sortColumn ?? null,
    sortDirection: params.sortDirection ?? null,
    filterModel: params.filterModel ? mapFilterConditions(params.filterModel) : null,
  })
  return { ...response, rows: normalizeTinyIntRows(response.columns, response.rows) }
}

export async function touchTableData(params: {
  connectionId: string
  tabId: string
}): Promise<TableDataTouchResult> {
  return invoke<TableDataTouchResult>('touch_table_data', {
    connectionId: params.connectionId,
    tabId: params.tabId,
  })
}

export async function evictTableData(params: {
  connectionId: string
  tabId: string
}): Promise<void> {
  return invoke<void>('evict_table_data', {
    connectionId: params.connectionId,
    tabId: params.tabId,
  })
}

type SyncTableDataCacheParams = {
  connectionId: string
  tabId: string
  database: string
  table: string
  columns: TableDataColumnMeta[]
  rows: unknown[][]
  currentPage: number
  pageSize: number
  primaryKey: PrimaryKeyInfo | null
  executionTimeMs: number
}

export async function restoreTableDataCache(params: {
  connectionId: string
  tabId: string
  database: string
  table: string
}): Promise<TableDataCacheRestoreResult> {
  return invoke<TableDataCacheRestoreResult>('restore_table_data_cache', {
    connectionId: params.connectionId,
    tabId: params.tabId,
    database: params.database,
    table: params.table,
  })
}

async function syncTableDataCache(
  command: string,
  params: SyncTableDataCacheParams
): Promise<TableDataCacheSyncResult> {
  return invoke<TableDataCacheSyncResult>(command, {
    connectionId: params.connectionId,
    tabId: params.tabId,
    database: params.database,
    table: params.table,
    columns: params.columns,
    rows: params.rows,
    currentPage: params.currentPage,
    pageSize: params.pageSize,
    primaryKey: params.primaryKey,
    executionTimeMs: params.executionTimeMs,
  })
}

export async function syncTableDataCacheAfterInsert(
  params: SyncTableDataCacheParams
): Promise<TableDataCacheSyncResult> {
  return syncTableDataCache('sync_table_data_cache_after_insert', params)
}

export async function syncTableDataCacheAfterUpdate(
  params: SyncTableDataCacheParams
): Promise<TableDataCacheSyncResult> {
  return syncTableDataCache('sync_table_data_cache_after_update', params)
}

export async function syncTableDataCacheAfterDelete(
  params: SyncTableDataCacheParams
): Promise<TableDataCacheSyncResult> {
  return syncTableDataCache('sync_table_data_cache_after_delete', params)
}

export async function updateTableRow(params: {
  connectionId: string
  database: string
  table: string
  primaryKeyColumns: string[]
  originalPkValues: Record<string, unknown>
  updatedValues: Record<string, unknown>
}): Promise<void> {
  return invoke<void>('update_table_row', {
    connectionId: params.connectionId,
    database: params.database,
    table: params.table,
    primaryKeyColumns: params.primaryKeyColumns,
    originalPkValues: params.originalPkValues,
    updatedValues: params.updatedValues,
  })
}

export async function insertTableRow(params: {
  connectionId: string
  database: string
  table: string
  values: Record<string, unknown>
  pkInfo: PrimaryKeyInfo
}): Promise<[string, unknown][]> {
  return invoke<[string, unknown][]>('insert_table_row', {
    connectionId: params.connectionId,
    database: params.database,
    table: params.table,
    values: params.values,
    pkInfo: params.pkInfo,
  })
}

export async function deleteTableRow(params: {
  connectionId: string
  database: string
  table: string
  pkColumns: string[]
  pkValues: Record<string, unknown>
}): Promise<void> {
  return invoke<void>('delete_table_row', {
    connectionId: params.connectionId,
    database: params.database,
    table: params.table,
    pkColumns: params.pkColumns,
    pkValues: params.pkValues,
  })
}

/**
 * Fetch the raw bytes of a single binary cell, identified by table + target
 * column + the row's primary-key column/value pairs.
 *
 * `pkPairs` is an ORDERED array of `[name, value]` tuples (matching the Rust
 * `Vec<(String, serde_json::Value)>` signature), NOT a map — the backend
 * preserves pair order when building the WHERE clause.
 */
export async function fetchBlobValue(
  connectionId: string,
  database: string,
  table: string,
  column: string,
  pkPairs: [string, unknown][]
): Promise<BlobValueResponse> {
  return invoke<BlobValueResponse>('fetch_blob_value', {
    connectionId,
    database,
    table,
    column,
    pkPairs,
  })
}

/** Read an arbitrary file's bytes from disk, returned as a base64 string. */
export async function readFileBytes(path: string): Promise<string> {
  return invoke<string>('read_file_bytes', { path })
}

/** Write base64-decoded bytes to a file on disk. */
export async function writeFileBytes(path: string, base64: string): Promise<void> {
  return invoke<void>('write_file_bytes', { path, base64 })
}

export async function exportTableData(params: {
  connectionId: string
  database: string
  table: string
  format: string
  filePath: string
  includeHeaders: boolean
  tableNameForSql: string
  filterModel?: FilterCondition[]
  sortColumn?: string
  sortDirection?: string
  page?: number
  pageSize?: number
}): Promise<void> {
  // Map 'sql-insert' -> 'sql' for the Rust backend which uses 'sql' as the format key
  const backendFormat = params.format === 'sql-insert' ? 'sql' : params.format

  return invoke<void>('export_table_data', {
    connectionId: params.connectionId,
    database: params.database,
    table: params.table,
    format: backendFormat,
    filePath: params.filePath,
    includeHeaders: params.includeHeaders,
    tableNameForSql: params.tableNameForSql,
    filterModel: params.filterModel ? mapFilterConditions(params.filterModel) : null,
    sortColumn: params.sortColumn ?? null,
    sortDirection: params.sortDirection ?? null,
    page: params.page ?? null,
    pageSize: params.pageSize ?? null,
  })
}
