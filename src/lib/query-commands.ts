import { invoke } from '@tauri-apps/api/core'
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

/** `execute_query` response: metadata plus the first window of the view. */
export interface ExecuteQueryResult extends QueryResultMeta, ResultWindowMeta {}

/**
 * Execute one statement. When `viewSpec` is given, the cached result is stored
 * with that sort and filter, and the first window comes back already applied.
 */
export async function executeQuery(
  connectionId: string,
  tabId: string,
  sql: string,
  rowLimit = 1000,
  viewSpec?: ResultViewSpec | null
): Promise<ExecuteQueryResult> {
  return invoke<ExecuteQueryResult>('execute_query', {
    connectionId,
    tabId,
    sql,
    rowLimit,
    ...(viewSpec ? { viewSpec } : {}),
  })
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
  rowLimit: number,
  viewSpec?: ResultViewSpec | null
): Promise<MultiQueryResultItem> {
  return invoke<MultiQueryResultItem>('reexecute_single_result', {
    connectionId,
    tabId,
    resultIndex,
    sql,
    rowLimit,
    ...(viewSpec ? { viewSpec } : {}),
  })
}

/** Identifies one cached result slot (and the query that produced it). */
export interface ResultSlotRef {
  connectionId: string
  tabId: string
  resultIndex: number
  queryId: string
}

/**
 * Replace a cached result's whole view spec (compare-and-swap against
 * `baseViewVersion`). Fails with `view_superseded: current=<n>` when the slot's
 * view changed since the caller last saw it.
 */
export async function setResultView(
  slot: ResultSlotRef,
  baseViewVersion: number,
  viewSpec: ResultViewSpec
): Promise<SetResultViewResult> {
  return invoke<SetResultViewResult>('set_result_view', {
    ...slot,
    baseViewVersion,
    viewSpec,
  })
}

/** Fetch a window of the current view (`limit` is clamped to 2,000 in Rust). */
export async function fetchResultWindow(
  slot: ResultSlotRef,
  viewVersion: number,
  offset: number,
  limit: number
): Promise<FetchResultWindowResult> {
  return invoke<FetchResultWindowResult>('fetch_result_window', {
    ...slot,
    viewVersion,
    offset,
    limit,
  })
}

/** Tombstone deleted rows in the cached result (compare-and-swap like `setResultView`). */
export async function removeResultRows(
  slot: ResultSlotRef,
  baseViewVersion: number,
  baseIndices: number[]
): Promise<RemoveResultRowsResult> {
  return invoke<RemoveResultRowsResult>('remove_result_rows', {
    ...slot,
    baseViewVersion,
    baseIndices,
  })
}

export async function evictResults(connectionId: string, tabId: string): Promise<void> {
  return invoke<void>('evict_results', { connectionId, tabId })
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

/** Update cells of one cached row. `rowIndex` is a **base** row index. */
/**
 * Sync a saved row into the cached result at base index `rowIndex`. Rust
 * refuses the write ("Results were refreshed during edit") when the slot no
 * longer holds `queryId`, i.e. a re-run replaced it while the save was running.
 */
export async function updateResultCell(
  connectionId: string,
  tabId: string,
  rowIndex: number,
  updates: Record<number, unknown>,
  queryId: string,
  resultIndex?: number
): Promise<void> {
  return invoke<void>('update_result_cell', {
    connectionId,
    tabId,
    rowIndex,
    updates,
    queryId,
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
