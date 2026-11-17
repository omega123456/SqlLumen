import type {
  FetchResultWindowResult,
  MultiQueryResult,
  MultiQueryResultItem,
  QueryResultMeta,
  QueryTableEditInfo,
  RemoveResultRowsResult,
  ResultViewSpec,
  ResultWindowMeta,
  SchemaMetadataResponse,
  SchemaMetadataFull,
  SetResultViewResult,
} from '../types/schema'
import { invokeArgumentCommand, invokeCommand } from './ipc/dispatch'
import type { ResultSlotRequest } from './ipc/requests'
import type { RunExportOptions } from '../types/run-export'

export interface ExecuteQueryResult extends QueryResultMeta, ResultWindowMeta {}

export interface ExecuteQueryRequest {
  connectionId: string
  tabId: string
  sql: string
  rowLimit: number
  viewSpec?: ResultViewSpec
}

export interface ExecuteMultiQueryRequest {
  connectionId: string
  tabId: string
  statements: string[]
  rowLimit: number
  runExport?: RunExportOptions
}

export interface ExecuteCallQueryRequest {
  connectionId: string
  tabId: string
  sql: string
  rowLimit: number
}

export interface ReexecuteSingleResultRequest {
  connectionId: string
  tabId: string
  resultIndex: number
  sql: string
  rowLimit: number
  viewSpec?: ResultViewSpec
}

export type ResultSlotRef = ResultSlotRequest

export interface SetResultViewRequest extends ResultSlotRequest {
  baseViewVersion: number
  viewSpec: ResultViewSpec
}

export interface FetchResultWindowRequest extends ResultSlotRequest {
  viewVersion: number
  offset: number
  limit: number
}

export interface RemoveResultRowsRequest extends ResultSlotRequest {
  baseViewVersion: number
  baseIndices: number[]
}

export interface UpdateResultCellRequest {
  connectionId: string
  tabId: string
  rowIndex: number
  updates: Record<number, unknown>
  queryId: string
  resultIndex?: number
}

export interface ResultCacheTouchResult {
  status: 'available' | 'expired' | 'missing'
}

export async function executeQuery(request: ExecuteQueryRequest): Promise<ExecuteQueryResult> {
  return invokeCommand({ command: 'execute_query', payload: request })
}

export async function executeMultiQuery(
  request: ExecuteMultiQueryRequest
): Promise<MultiQueryResult> {
  return invokeCommand({ command: 'execute_multi_query', payload: request })
}

export async function executeCallQuery(
  request: ExecuteCallQueryRequest
): Promise<MultiQueryResult> {
  return invokeCommand({ command: 'execute_call_query', payload: request })
}

export async function reexecuteSingleResult(
  request: ReexecuteSingleResultRequest
): Promise<MultiQueryResultItem> {
  return invokeCommand({ command: 'reexecute_single_result', payload: request })
}

export async function setResultView(request: SetResultViewRequest): Promise<SetResultViewResult> {
  return invokeCommand({ command: 'set_result_view', payload: request })
}

export async function fetchResultWindow(
  request: FetchResultWindowRequest
): Promise<FetchResultWindowResult> {
  return invokeCommand({ command: 'fetch_result_window', payload: request })
}

export async function removeResultRows(
  request: RemoveResultRowsRequest
): Promise<RemoveResultRowsResult> {
  return invokeCommand({ command: 'remove_result_rows', payload: request })
}

export async function evictResults(connectionId: string, tabId: string): Promise<void> {
  return invokeCommand({ command: 'evict_results', payload: { connectionId, tabId } })
}

export async function selectDatabase(connectionId: string, databaseName: string): Promise<void> {
  return invokeCommand({ command: 'select_database', payload: { connectionId, databaseName } })
}

export async function fetchSchemaMetadata(connectionId: string): Promise<SchemaMetadataResponse> {
  return invokeArgumentCommand({ command: 'fetch_schema_metadata', argument: { connectionId } })
}

export async function fetchSchemaMetadataFull(connectionId: string): Promise<SchemaMetadataFull> {
  return invokeArgumentCommand({
    command: 'fetch_schema_metadata_full',
    argument: { connectionId },
  })
}

export async function readFile(path: string): Promise<string> {
  return invokeArgumentCommand({ command: 'read_file', argument: { path } })
}

export async function writeFile(path: string, content: string): Promise<void> {
  return invokeCommand({ command: 'write_file', payload: { path, content } })
}

export async function analyzeQueryForEdit(
  connectionId: string,
  sql: string
): Promise<QueryTableEditInfo[]> {
  return invokeCommand({ command: 'analyze_query_for_edit', payload: { connectionId, sql } })
}

export async function updateResultCell(request: UpdateResultCellRequest): Promise<void> {
  return invokeCommand({ command: 'update_result_cell', payload: request })
}

export async function cancelQuery(connectionId: string, tabId: string): Promise<boolean> {
  return invokeCommand({ command: 'cancel_query', payload: { connectionId, tabId } })
}

export async function touchResults(
  connectionId: string,
  tabId: string
): Promise<ResultCacheTouchResult> {
  return invokeCommand({ command: 'touch_results', payload: { connectionId, tabId } })
}
