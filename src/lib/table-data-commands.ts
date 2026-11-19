import { invokeArgumentCommand, invokeCommand } from './ipc/dispatch'
import type {
  TableDataResponse,
  PrimaryKeyInfo,
  FilterCondition,
  BlobValueResponse,
  TablePageResult,
} from '../types/schema'

type BackendFilterCondition = {
  column: string
  operator: string
  value: string
}

export interface FetchTableDataParams {
  connectionId: string
  tabId: string
  database: string
  table: string
  page: number
  pageSize: number
  sortColumn?: string
  sortDirection?: string
  filterModel?: FilterCondition[]
}

export interface FetchTableDataRequest {
  connectionId: string
  tabId: string
  database: string
  table: string
  page: number
  pageSize: number
  sortColumn: string | null
  sortDirection: string | null
  filterModel: BackendFilterCondition[] | null
}

export interface UpdateTableRowRequest {
  connectionId: string
  database: string
  table: string
  primaryKeyColumns: string[]
  originalPrimaryKeyValues: Record<string, unknown>
  updatedValues: Record<string, unknown>
}

export interface InsertTableRowRequest {
  connectionId: string
  database: string
  table: string
  values: Record<string, unknown>
  primaryKeyInfo: PrimaryKeyInfo
}

export type InsertedColumnValue = [columnName: string, value: unknown]

export interface DeleteTableRowRequest {
  connectionId: string
  database: string
  table: string
  primaryKeyColumns: string[]
  primaryKeyValues: Record<string, unknown>
}

export type PrimaryKeyPair = [columnName: string, value: unknown]

export interface FetchBlobValueRequest {
  connectionId: string
  database: string
  table: string
  column: string
  primaryKeyPairs: PrimaryKeyPair[]
}

export interface ExportTableDataParams {
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
}

export interface ExportTableDataRequest {
  connectionId: string
  database: string
  table: string
  format: string
  filePath: string
  includeHeaders: boolean
  tableNameForSql: string
  filterModel: BackendFilterCondition[] | null
  sortColumn: string | null
  sortDirection: string | null
  page: number | null
  pageSize: number | null
}

const SQL_INSERT_EXPORT_FORMAT = 'sql-insert'
const BACKEND_SQL_EXPORT_FORMAT = 'sql'

const BOOLEAN_CHARACTER_CODES: ReadonlySet<number> = new Set([0, 1])

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

  if (typeof value !== 'string') return value
  if (value.length !== 1) return value
  const code = value.charCodeAt(0)
  return BOOLEAN_CHARACTER_CODES.has(code) ? code : value
}

function isBooleanLikeColumn(column: { dataType: string; isBooleanAlias?: boolean }): boolean {
  return column.isBooleanAlias === true || isTinyIntBooleanAlias(column.dataType)
}

export function normalizeTinyIntRows(
  columns: Array<{ dataType: string; isBooleanAlias?: boolean }>,
  rows: unknown[][]
): unknown[][] {
  const tinyIntIndexes = columns
    .map((column, index) => (isBooleanLikeColumn(column) ? index : -1))
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

function mapFilterConditions(conditions: FilterCondition[]): BackendFilterCondition[] {
  return conditions.map((condition) => ({
    column: condition.column,
    operator: condition.operator,
    value: condition.value,
  }))
}

function toBackendFilterModel(
  filterModel: FilterCondition[] | undefined
): BackendFilterCondition[] | null {
  if (!filterModel) return null
  return mapFilterConditions(filterModel)
}

function toFetchTableDataRequest(params: FetchTableDataParams): FetchTableDataRequest {
  return {
    connectionId: params.connectionId,
    tabId: params.tabId,
    database: params.database,
    table: params.table,
    page: params.page,
    pageSize: params.pageSize,
    sortColumn: params.sortColumn ?? null,
    sortDirection: params.sortDirection ?? null,
    filterModel: toBackendFilterModel(params.filterModel),
  }
}

export async function fetchTableData(params: FetchTableDataParams): Promise<TableDataResponse> {
  const response = await invokeCommand({
    command: 'fetch_table_data',
    payload: toFetchTableDataRequest(params),
  })
  return { ...response, rows: normalizeTinyIntRows(response.columns, response.rows) }
}

export async function fetchTablePage(params: FetchTableDataParams): Promise<TablePageResult> {
  return invokeCommand({ command: 'fetch_table_page', payload: toFetchTableDataRequest(params) })
}

export async function updateTableRow(request: UpdateTableRowRequest): Promise<void> {
  return invokeCommand({ command: 'update_table_row', payload: request })
}

export async function insertTableRow(
  request: InsertTableRowRequest
): Promise<InsertedColumnValue[]> {
  return invokeCommand({ command: 'insert_table_row', payload: request })
}

export async function deleteTableRow(request: DeleteTableRowRequest): Promise<void> {
  return invokeCommand({ command: 'delete_table_row', payload: request })
}

export async function fetchBlobValue(request: FetchBlobValueRequest): Promise<BlobValueResponse> {
  return invokeCommand({ command: 'fetch_blob_value', payload: request })
}

export async function readFileBytes(path: string): Promise<string> {
  return invokeArgumentCommand({ command: 'read_file_bytes', argument: { path } })
}

export async function writeFileBytes(path: string, base64: string): Promise<void> {
  return invokeCommand({ command: 'write_file_bytes', payload: { path, base64 } })
}

function toBackendExportFormat(format: string): string {
  if (format === SQL_INSERT_EXPORT_FORMAT) return BACKEND_SQL_EXPORT_FORMAT
  return format
}

function toExportTableDataRequest(params: ExportTableDataParams): ExportTableDataRequest {
  return {
    connectionId: params.connectionId,
    database: params.database,
    table: params.table,
    format: toBackendExportFormat(params.format),
    filePath: params.filePath,
    includeHeaders: params.includeHeaders,
    tableNameForSql: params.tableNameForSql,
    filterModel: toBackendFilterModel(params.filterModel),
    sortColumn: params.sortColumn ?? null,
    sortDirection: params.sortDirection ?? null,
    page: params.page ?? null,
    pageSize: params.pageSize ?? null,
  }
}

export async function exportTableData(params: ExportTableDataParams): Promise<void> {
  return invokeCommand({ command: 'export_table_data', payload: toExportTableDataRequest(params) })
}
