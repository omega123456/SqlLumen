import { invoke } from '@tauri-apps/api/core'
import type {
  ColumnMeta,
  MultiQueryResult,
  MultiQueryResultItem,
  QueryResultMeta,
  QueryTableEditInfo,
  SchemaMetadataResponse,
  SchemaMetadataFull,
} from '../types/schema'

export interface ExecuteQueryResult extends QueryResultMeta {
  rows: unknown[][]
}

export async function executeQuery(
  connectionId: string,
  tabId: string,
  sql: string,
  rowLimit = 1000
): Promise<ExecuteQueryResult> {
  return invoke<ExecuteQueryResult>('execute_query', { connectionId, tabId, sql, rowLimit })
}

export async function executeMultiQuery(
  connectionId: string,
  tabId: string,
  statements: string[],
  rowLimit: number
): Promise<MultiQueryResult> {
  return invoke<MultiQueryResult>('execute_multi_query', {
    connectionId,
    tabId,
    statements,
    rowLimit,
  })
}

export async function executeCallQuery(
  connectionId: string,
  tabId: string,
  sql: string,
  rowLimit: number
): Promise<MultiQueryResult> {
  return invoke<MultiQueryResult>('execute_call_query', {
    connectionId,
    tabId,
    sql,
    rowLimit,
  })
}

export async function reexecuteSingleResult(
  connectionId: string,
  tabId: string,
  resultIndex: number,
  sql: string,
  rowLimit: number
): Promise<MultiQueryResultItem> {
  return invoke<MultiQueryResultItem>('reexecute_single_result', {
    connectionId,
    tabId,
    resultIndex,
    sql,
    rowLimit,
  })
}

export interface FetchCachedRowsResult {
  rows: unknown[][]
  columns: ColumnMeta[]
}

export async function fetchCachedRows(
  connectionId: string,
  tabId: string,
  queryId: string,
  resultIndex?: number
): Promise<FetchCachedRowsResult> {
  return invoke<FetchCachedRowsResult>('fetch_cached_rows', {
    connectionId,
    tabId,
    queryId,
    ...(resultIndex !== undefined ? { resultIndex } : {}),
  })
}

export async function evictResults(connectionId: string, tabId: string): Promise<void> {
  return invoke<void>('evict_results', { connectionId, tabId })
}

export interface SortedRowsResult {
  rows: unknown[][]
}

export async function sortResults(
  connectionId: string,
  tabId: string,
  columnName: string,
  direction: string,
  resultIndex?: number
): Promise<SortedRowsResult> {
  return invoke<SortedRowsResult>('sort_results', {
    connectionId,
    tabId,
    columnName,
    direction,
    ...(resultIndex !== undefined ? { resultIndex } : {}),
  })
}

export async function selectDatabase(connectionId: string, databaseName: string): Promise<void> {
  return invoke<void>('select_database', { connectionId, databaseName })
}

export async function fetchSchemaMetadata(connectionId: string): Promise<SchemaMetadataResponse> {
  return invoke<SchemaMetadataResponse>('fetch_schema_metadata', { connectionId })
}

export async function fetchSchemaMetadataFull(connectionId: string): Promise<SchemaMetadataFull> {
  return invoke<SchemaMetadataFull>('fetch_schema_metadata_full', { connectionId })
}

export async function readFile(path: string): Promise<string> {
  return invoke<string>('read_file', { path })
}

export async function writeFile(path: string, content: string): Promise<void> {
  return invoke<void>('write_file', { path, content })
}

export async function analyzeQueryForEdit(
  connectionId: string,
  sql: string
): Promise<QueryTableEditInfo[]> {
  return invoke<QueryTableEditInfo[]>('analyze_query_for_edit', { connectionId, sql })
}

export async function updateResultCell(
  connectionId: string,
  tabId: string,
  rowIndex: number,
  updates: Record<number, unknown>,
  resultIndex?: number
): Promise<void> {
  return invoke<void>('update_result_cell', {
    connectionId,
    tabId,
    rowIndex,
    updates,
    ...(resultIndex !== undefined ? { resultIndex } : {}),
  })
}

export async function cancelQuery(connectionId: string, tabId: string): Promise<boolean> {
  return invoke<boolean>('cancel_query', { connectionId, tabId })
}

export async function touchResults(
  connectionId: string,
  tabId: string
): Promise<{ status: 'available' | 'expired' | 'missing' }> {
  return invoke<{ status: 'available' | 'expired' | 'missing' }>('touch_results', {
    connectionId,
    tabId,
  })
}
