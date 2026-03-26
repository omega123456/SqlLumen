import { invoke } from '@tauri-apps/api/core'
import type { TableDataResponse, PrimaryKeyInfo, AgGridFilterModel } from '../types/schema'

/** Rust `FilterModelEntry` (camelCase over IPC). */
type BackendFilterEntry = {
  filterType: string
  filterCondition: string
  filter: string | null
  filterTo: string | null
}

function coerceFilterString(value: unknown): string | null {
  if (value == null) {
    return null
  }
  return String(value)
}

/**
 * Normalize AG Grid's per-column filter JSON (simple or combined `conditions[]`) into
 * the shape expected by the Rust command. Combined models only send the **first**
 * condition to the backend today (multi-condition per column is not translated to SQL yet).
 */
function normalizeFilterEntryForBackend(raw: unknown): BackendFilterEntry | null {
  if (raw == null || typeof raw !== 'object') {
    return null
  }

  const root = raw as Record<string, unknown>
  let leaf = root

  const conditions = root.conditions
  if (Array.isArray(conditions) && conditions.length > 0) {
    const first = conditions[0]
    if (first != null && typeof first === 'object') {
      leaf = first as Record<string, unknown>
    }
  }

  const filterTypeRaw = leaf.filterType ?? root.filterType
  const filterType =
    typeof filterTypeRaw === 'string' && filterTypeRaw.length > 0 ? filterTypeRaw : 'text'

  const typeRaw = leaf.type ?? leaf.filterOption
  let filterCondition: string
  if (typeof typeRaw === 'string' && typeRaw.length > 0) {
    filterCondition = typeRaw
  } else if (filterType === 'number') {
    filterCondition = 'equals'
  } else {
    filterCondition = 'contains'
  }

  return {
    filterType,
    filterCondition,
    filter: coerceFilterString(leaf.filter ?? root.filter),
    filterTo: coerceFilterString(leaf.filterTo ?? root.filterTo),
  }
}

/**
 * Transform frontend filter model to match Rust backend's FilterModelEntry format.
 * The frontend uses `type` (AG Grid simple model) while Rust uses `filterCondition`.
 */
function mapFilterModel(filterModel: AgGridFilterModel): Record<string, BackendFilterEntry> {
  const out: Record<string, BackendFilterEntry> = {}
  for (const [col, entry] of Object.entries(filterModel)) {
    const normalized = normalizeFilterEntryForBackend(entry)
    if (normalized) {
      out[col] = normalized
    }
  }
  return out
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
