import { invoke } from '@tauri-apps/api/core'
import type { TableDataResponse, PrimaryKeyInfo, AgGridFilterModel } from '../types/schema'

/**
 * Transform frontend filter model to match Rust backend's FilterModelEntry format.
 * The frontend uses `type` (AG Grid convention) while Rust uses `filterCondition`.
 */
function mapFilterModel(
  filterModel: AgGridFilterModel
): Record<
  string,
  { filterType: string; filterCondition: string; filter: string | null; filterTo: string | null }
> {
  return Object.fromEntries(
    Object.entries(filterModel).map(([col, entry]) => [
      col,
      {
        filterType: entry.filterType,
        filterCondition: entry.type,
        // Convert to string so the Rust backend (which expects Option<String>) always
        // receives a string. AG Grid's agNumberColumnFilter sends `filter` as a number.
        filter: entry.filter != null ? String(entry.filter) : null,
        filterTo: entry.filterTo != null ? String(entry.filterTo) : null,
      },
    ])
  )
}

export async function fetchTableData(params: {
  connectionId: string
  database: string
  table: string
  page: number
  pageSize: number
  sortColumn?: string
  sortDirection?: string
  filterModel?: AgGridFilterModel
}): Promise<TableDataResponse> {
  return invoke<TableDataResponse>('fetch_table_data', {
    connectionId: params.connectionId,
    database: params.database,
    table: params.table,
    page: params.page,
    pageSize: params.pageSize,
    sortColumn: params.sortColumn ?? null,
    sortDirection: params.sortDirection ?? null,
    filterModel: params.filterModel ? mapFilterModel(params.filterModel) : null,
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
  filterModel?: AgGridFilterModel
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
    filterModel: params.filterModel ? mapFilterModel(params.filterModel) : null,
    sortColumn: params.sortColumn ?? null,
    sortDirection: params.sortDirection ?? null,
  })
}
