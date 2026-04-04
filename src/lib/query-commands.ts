import { invoke } from '@tauri-apps/api/core'
import type {
  QueryResultMeta,
  QueryTableEditInfo,
  ResultPage,
  SchemaMetadataResponse,
} from '../types/schema'

export interface ExecuteQueryResult extends QueryResultMeta {
  firstPage: unknown[][]
}

export async function executeQuery(
  connectionId: string,
  tabId: string,
  sql: string,
  pageSize = 1000
): Promise<ExecuteQueryResult> {
  return invoke<ExecuteQueryResult>('execute_query', { connectionId, tabId, sql, pageSize })
}

export async function fetchResultPage(
  connectionId: string,
  tabId: string,
  queryId: string,
  page: number
): Promise<ResultPage> {
  return invoke<ResultPage>('fetch_result_page', { connectionId, tabId, queryId, page })
}

export async function evictResults(connectionId: string, tabId: string): Promise<void> {
  return invoke<void>('evict_results', { connectionId, tabId })
}

export async function sortResults(
  connectionId: string,
  tabId: string,
  columnName: string,
  direction: string
): Promise<ResultPage> {
  return invoke<ResultPage>('sort_results', { connectionId, tabId, columnName, direction })
}

export async function selectDatabase(connectionId: string, databaseName: string): Promise<void> {
  return invoke<void>('select_database', { connectionId, databaseName })
}

export async function fetchSchemaMetadata(connectionId: string): Promise<SchemaMetadataResponse> {
  return invoke<SchemaMetadataResponse>('fetch_schema_metadata', { connectionId })
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
  updates: Record<number, unknown>
): Promise<void> {
  return invoke<void>('update_result_cell', { connectionId, tabId, rowIndex, updates })
}

export async function cancelQuery(connectionId: string, tabId: string): Promise<boolean> {
  return invoke<boolean>('cancel_query', { connectionId, tabId })
}
