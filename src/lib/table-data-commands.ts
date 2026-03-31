import { invoke } from '@tauri-apps/api/core'
import type { TableDataResponse, PrimaryKeyInfo, FilterCondition } from '../types/schema'

/** Backend filter condition — matches the Rust `FilterCondition` struct. */
type BackendFilterCondition = {
  column: string
  operator: string
  value: string
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
  database: string
  table: string
  page: number
  pageSize: number
  sortColumn?: string
  sortDirection?: string
  filterModel?: FilterCondition[]
}): Promise<TableDataResponse> {
  return invoke<TableDataResponse>('fetch_table_data', {
    connectionId: params.connectionId,
    database: params.database,
    table: params.table,
    page: params.page,
    pageSize: params.pageSize,
    sortColumn: params.sortColumn ?? null,
    sortDirection: params.sortDirection ?? null,
    filterModel: params.filterModel ? mapFilterConditions(params.filterModel) : null,
  })
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
  })
}
