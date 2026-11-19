import type { ExecuteQueryRequest } from '../query-commands'
import {
  appendResultRowFixture,
  fetchTablePageFixture,
  getAiModelsFixture,
  getAnalyzeQueryForEditFixture,
  getBlobValueFixture,
  getCancelResultExportFixture,
  getResultExportProgressFixture,
  getResultExportStartFixture,
  getRunExportFixture,
  getConnectionMemoriesFixture,
  getForeignKeysFixture,
  getGlobalMemoriesFixture,
  getGroupMemoriesFixture,
  getMovedMemoryFixture,
  getSavedMemoryFixture,
  getObjectBodyFixture,
  executeCallQueryFixture,
  executeMultiQueryFixture,
  executeQueryFixture,
  fetchResultWindowFixture,
  reexecuteSingleResultFixture,
  removeResultRowsFixture,
  setResultViewFixture,
  getRoutineParamsFixture,
  getSnapshotCreatedIdFixture,
  getSnapshotListFixture,
  getSnapshotStateFixture,
  getTableDataFixture,
  getSqlDumpProgressFixture,
  getSqlImportProgressFixture,
  getStaticFixture,
} from '../../tests/playwright-fixtures'
import { startMockAiChat } from './mock-events'
import {
  returnAvailableStatus,
  returnEmptyList,
  returnNull,
  returnTrue,
  returnUndefined,
} from './mock-handler-types'
import type { ArgumentCommandHandlers, PayloadCommandHandlers } from './mock-handler-types'
import {
  activeMockDatabase,
  readMockWindowFlag,
  readPendingQueryReject,
  writePendingQueryReject,
} from './mock-session-state'

function delayedQueryResult(result: unknown, delayMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    writePendingQueryReject(reject)
    setTimeout(() => {
      writePendingQueryReject(null)
      resolve(result)
    }, delayMs)
  })
}

function executeMockQuery(payload: ExecuteQueryRequest): unknown {
  if (readMockWindowFlag('__mockQueryError__')) {
    throw new Error(getStaticFixture('querySimulation').errorMessage)
  }
  const result = executeQueryFixture({
    tabId: payload.tabId,
    sql: payload.sql,
    activeMockDb: activeMockDatabase,
    viewSpec: payload.viewSpec ?? null,
  })
  const delay = readMockWindowFlag('__mockQueryDelay__')
  const hasQueryDelay = typeof delay === 'number' && delay > 0
  if (hasQueryDelay) {
    return delayedQueryResult(result, delay)
  }
  return result
}

function cancelMockQuery(): boolean {
  const pendingReject = readPendingQueryReject()
  if (pendingReject) {
    writePendingQueryReject(null)
    pendingReject(new Error(getStaticFixture('querySimulation').cancelledMessage))
  }
  return true
}

export const QUERY_PAYLOAD_HANDLERS = {
  execute_query: executeMockQuery,
  execute_multi_query: (payload) => executeMultiQueryFixture({ tabId: payload.tabId }),
  execute_call_query: (payload) =>
    executeCallQueryFixture({ tabId: payload.tabId, sql: payload.sql }),
  reexecute_single_result: (payload) =>
    reexecuteSingleResultFixture({
      tabId: payload.tabId,
      resultIndex: payload.resultIndex,
      sql: payload.sql,
      viewSpec: payload.viewSpec ?? null,
    }),
  set_result_view: (payload) => setResultViewFixture(payload),
  fetch_result_window: (payload) => fetchResultWindowFixture(payload),
  remove_result_rows: (payload) => removeResultRowsFixture(payload),
  append_result_row: (payload) => appendResultRowFixture(payload),
  evict_results: returnNull,
  cancel_query: cancelMockQuery,
  analyze_query_for_edit: (payload) => getAnalyzeQueryForEditFixture(payload.sql),
  update_result_cell: returnNull,
  touch_results: returnAvailableStatus,
  export_results: () => getStaticFixture('exportResults'),
  start_result_export: () => getResultExportStartFixture(),
  start_run_export: () => getRunExportFixture(),
} satisfies Partial<PayloadCommandHandlers>

export const QUERY_ARGUMENT_HANDLERS = {
  get_result_export_progress: (argument) => getResultExportProgressFixture(argument.jobId),
  cancel_result_export: (argument) => getCancelResultExportFixture(argument.jobId),
  get_run_export_progress: returnNull,
} satisfies Partial<ArgumentCommandHandlers>

function syncMockTableDataCache({ table }: { table: string }): { status: string } {
  void getTableDataFixture(table)
  return { status: 'synced' }
}

export const TABLE_DATA_PAYLOAD_HANDLERS = {
  fetch_table_data: (payload) => getTableDataFixture(payload.table),
  fetch_table_page: (payload) => fetchTablePageFixture(payload),
  touch_table_data: returnAvailableStatus,
  evict_table_data: returnNull,
  restore_table_data_cache: (payload) => ({
    status: 'available',
    data: getTableDataFixture(payload.table),
  }),
  get_table_foreign_keys: (payload) => getForeignKeysFixture(payload.table),
  sync_table_data_cache_after_insert: syncMockTableDataCache,
  sync_table_data_cache_after_update: syncMockTableDataCache,
  sync_table_data_cache_after_delete: syncMockTableDataCache,
  update_table_row: returnNull,
  insert_table_row: () => getStaticFixture('insertedRow'),
  delete_table_row: returnNull,
  export_table_data: returnNull,
  fetch_blob_value: (payload) => getBlobValueFixture(payload.column),
  write_file_bytes: returnNull,
} satisfies Partial<PayloadCommandHandlers>

export const TABLE_DATA_ARGUMENT_HANDLERS = {
  read_file_bytes: () => getBlobValueFixture('default').base64 ?? '',
} satisfies Partial<ArgumentCommandHandlers>

export const OBJECT_EDITOR_PAYLOAD_HANDLERS = {
  get_object_body: (payload) => getObjectBodyFixture(payload.objectType),
  drop_object: returnUndefined,
  get_routine_parameters: () => getStaticFixture('routineParameters'),
  get_routine_parameters_with_return_type: (payload) =>
    getRoutineParamsFixture(payload.routineType),
  write_file: returnNull,
} satisfies Partial<PayloadCommandHandlers>

export const OBJECT_EDITOR_ARGUMENT_HANDLERS = {
  save_object: () => getStaticFixture('savedObject'),
  read_file: () => getStaticFixture('openedFileContent'),
} satisfies Partial<ArgumentCommandHandlers>

export const DUMP_AND_IMPORT_PAYLOAD_HANDLERS = {
  cancel_dump: returnNull,
} satisfies Partial<PayloadCommandHandlers>

export const DUMP_AND_IMPORT_ARGUMENT_HANDLERS = {
  list_exportable_objects: () => getStaticFixture('exportableDatabases'),
  start_sql_dump: () => getStaticFixture('sqlDumpJobId'),
  get_dump_progress: (argument) => getSqlDumpProgressFixture(argument.jobId),
  start_sql_import: () => getStaticFixture('sqlImportJobId'),
  get_import_progress: (argument) => getSqlImportProgressFixture(argument.jobId),
  cancel_import: returnNull,
} satisfies Partial<ArgumentCommandHandlers>

function killMockQueries({ ids }: { ids: number[] }): unknown {
  return ids.map((id: number) => ({ id: id, success: true, error: null }))
}

export const PROCESS_LIST_AND_HISTORY_PAYLOAD_HANDLERS = {
  kill_queries: killMockQueries,
  list_history: () => getStaticFixture('historyPage'),
  update_favorite: returnTrue,
} satisfies Partial<PayloadCommandHandlers>

export const PROCESS_LIST_AND_HISTORY_ARGUMENT_HANDLERS = {
  get_processlist: () => getStaticFixture('processList'),
  delete_history_entry: returnTrue,
  clear_history: () => getStaticFixture('historyPage').total,
  create_favorite: () => getStaticFixture('createdFavoriteId'),
  list_favorites: () => getStaticFixture('favorites'),
  delete_favorite: returnTrue,
} satisfies Partial<ArgumentCommandHandlers>

export const AI_PAYLOAD_HANDLERS = {
  semantic_search: () => getStaticFixture('semanticSearchResults'),
  invalidate_schema_index: returnNull,
  save_memory: (payload) => getSavedMemoryFixture(payload),
  move_memory: (payload) => getMovedMemoryFixture(payload),
  delete_memory: returnNull,
  search_memories: returnEmptyList,
} satisfies Partial<PayloadCommandHandlers>

export const AI_ARGUMENT_HANDLERS = {
  ai_chat: startMockAiChat,
  ai_cancel: returnNull,
  list_ai_models: (argument) => ({ models: getAiModelsFixture(argument.endpoint) }),
  ai_query_expand: () => getStaticFixture('aiQueryExpansion'),
  build_schema_index: returnNull,
  force_rebuild_schema_index: returnNull,
  get_index_status: () => getStaticFixture('schemaIndexStatus'),
  list_indexed_tables: returnEmptyList,
  list_global_memories: () => getGlobalMemoriesFixture(),
  list_group_memories: (argument) => getGroupMemoriesFixture(argument.groupId),
  list_connection_memories: (argument) => getConnectionMemoriesFixture(argument.connectionId),
  reembed_all_memories: returnNull,
} satisfies Partial<ArgumentCommandHandlers>

export const SESSION_SNAPSHOT_PAYLOAD_HANDLERS = {
  create_session_snapshot: () => getSnapshotCreatedIdFixture(),
} satisfies Partial<PayloadCommandHandlers>

export const SESSION_SNAPSHOT_ARGUMENT_HANDLERS = {
  list_session_snapshots: () => getSnapshotListFixture(),
  get_session_snapshot: (argument) => getSnapshotStateFixture(argument.id),
  delete_session_snapshot: returnNull,
} satisfies Partial<ArgumentCommandHandlers>
