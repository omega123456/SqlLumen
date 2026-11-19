import type {
  AppInfo,
  BlobValueResponse,
  CharsetInfo,
  CollationInfo,
  ColumnInfo,
  CreateFavoriteInput,
  DatabaseDetails,
  FavoriteEntry,
  FetchResultWindowResult,
  ForeignKeyInfo,
  GenerateDdlRequest,
  GenerateDdlResponse,
  HistoryPage,
  MultiQueryResult,
  MultiQueryResultItem,
  QueryTableEditInfo,
  RemoveResultRowsResult,
  RoutineParameter,
  SaveObjectResponse,
  SchemaInfoResponse,
  SchemaMetadataFull,
  SchemaMetadataResponse,
  SetResultViewResult,
  TableDataCacheRestoreResult,
  TableDataCacheSyncResult,
  TableDataResponse,
  TableDesignerSchema,
  UpdateFavoriteInput,
} from '../../types/schema'
import type {
  ConnectionGroup,
  OpenConnectionSession,
  SavedConnection,
  TestConnectionResult,
} from '../../types/connection'
import type { RunExportProgress } from '../../types/run-export'
import type {
  AiChatRequest,
  AiModelInfo,
  AiQueryExpandRequest,
  AiQueryExpandResponse,
} from '../ai-commands'
import type {
  AiMemory,
  DeleteMemoryRequest,
  MoveMemoryRequest,
  SaveMemoryRequest,
  SearchMemoriesRequest,
} from '../ai-memory-commands'
import type { FrontendLogLevel } from '../app-log-commands'
import type {
  ConnectionGroupChanges,
  ConnectionStatus,
  OpenConnectionResult,
  SaveConnectionInput,
  TestConnectionInput,
  UpdateConnectionInput,
} from '../connection-commands'
import type { CopyableObjects, CopyProgress, CopyToHostParams } from '../copy-to-host-commands'
import type {
  ExportResult,
  ExportResultsRequest,
  ResultExportProgress,
  RunExportStart,
  StartResultExportRequest,
  StartRunExportRequest,
} from '../export-commands'
import type { ListHistoryRequest } from '../history-commands'
import type { LogLevelFilter, LogPage } from '../log-commands'
import type {
  RoutineParametersWithFoundResponse,
  SaveObjectRequest,
} from '../object-editor-commands'
import type { KillResult, ProcessRow } from '../processlist-commands'
import type {
  ExecuteCallQueryRequest,
  ExecuteMultiQueryRequest,
  ExecuteQueryRequest,
  ExecuteQueryResult,
  FetchResultWindowRequest,
  ReexecuteSingleResultRequest,
  RemoveResultRowsRequest,
  ResultCacheTouchResult,
  SetResultViewRequest,
  UpdateResultCellRequest,
} from '../query-commands'
import type { DatabaseEncodingRequest, RenameTableRequest } from '../schema-commands'
import type {
  IndexedTableInfo,
  RetrievalHints,
  SchemaIndexStatus,
  SearchResult,
} from '../schema-index-commands'
import type { CreateSnapshotArgs, SnapshotSummary } from '../session-snapshot-commands'
import type {
  DumpJobProgress,
  ExportableDatabase,
  ImportJobProgress,
  StartDumpInput,
  StartImportInput,
} from '../sql-dump-commands'
import type {
  DeleteTableRowRequest,
  ExportTableDataRequest,
  FetchBlobValueRequest,
  FetchTableDataRequest,
  InsertedColumnValue,
  InsertTableRowRequest,
  RestoreTableDataCacheRequest,
  SyncTableDataCacheRequest,
  TableDataTouchResult,
  UpdateTableRowRequest,
} from '../table-data-commands'
import type { WindowBackdrop } from '../window-commands'
import type {
  ConnectionTabRequest,
  DatabaseRequest,
  EditableObjectRequest,
  FileContentRequest,
  RoutineRequest,
  RoutineWithReturnTypeRequest,
  SchemaObjectRequest,
  TableRequest,
} from './requests'

interface Command<TRequest, TResponse> {
  request: TRequest
  response: TResponse
}

export type NoArguments = Record<string, never>

type ConnectionArgument = { connectionId: string }
type SessionArgument = { sessionId: string }
type JobArgument = { jobId: string }
type PathArgument = { path: string }

export interface PayloadCommandMap {
  save_memory: Command<SaveMemoryRequest, AiMemory>
  delete_memory: Command<DeleteMemoryRequest, void>
  move_memory: Command<MoveMemoryRequest, AiMemory>
  search_memories: Command<SearchMemoriesRequest, AiMemory[]>

  update_connection_group: Command<ConnectionGroupChanges, void>
  update_connection: Command<{ id: string; data: UpdateConnectionInput }, void>
  open_connection: Command<{ profileId: string; password: string | null }, OpenConnectionResult>

  list_copyable_objects: Command<DatabaseRequest, CopyableObjects>

  export_results: Command<ExportResultsRequest, ExportResult>
  start_result_export: Command<StartResultExportRequest, string>
  start_run_export: Command<StartRunExportRequest, RunExportStart>

  update_favorite: Command<{ id: number; input: UpdateFavoriteInput }, boolean>

  log_frontend: Command<{ level: FrontendLogLevel; message: string }, void>
  list_logs: Command<{ page: number; level: LogLevelFilter }, LogPage>
  export_logs: Command<{ startTimestamp: string; endTimestamp: string; filePath: string }, number>

  list_history: Command<ListHistoryRequest, HistoryPage>

  get_object_body: Command<EditableObjectRequest, string>
  drop_object: Command<EditableObjectRequest, void>
  get_routine_parameters: Command<RoutineRequest, RoutineParameter[]>
  get_routine_parameters_with_return_type: Command<
    RoutineWithReturnTypeRequest,
    RoutineParametersWithFoundResponse
  >

  kill_queries: Command<{ sessionId: string; ids: number[] }, KillResult[]>

  execute_query: Command<ExecuteQueryRequest, ExecuteQueryResult>
  execute_multi_query: Command<ExecuteMultiQueryRequest, MultiQueryResult>
  execute_call_query: Command<ExecuteCallQueryRequest, MultiQueryResult>
  reexecute_single_result: Command<ReexecuteSingleResultRequest, MultiQueryResultItem>
  set_result_view: Command<SetResultViewRequest, SetResultViewResult>
  fetch_result_window: Command<FetchResultWindowRequest, FetchResultWindowResult>
  remove_result_rows: Command<RemoveResultRowsRequest, RemoveResultRowsResult>
  update_result_cell: Command<UpdateResultCellRequest, void>
  evict_results: Command<ConnectionTabRequest, void>
  touch_results: Command<ConnectionTabRequest, ResultCacheTouchResult>
  cancel_query: Command<ConnectionTabRequest, boolean>
  analyze_query_for_edit: Command<{ connectionId: string; sql: string }, QueryTableEditInfo[]>
  write_file: Command<FileContentRequest, void>
  select_database: Command<{ connectionId: string; databaseName: string }, void>

  list_schema_objects: Command<DatabaseRequest & { objectType: string }, string[]>
  list_columns: Command<TableRequest, ColumnInfo[]>
  get_table_foreign_keys: Command<TableRequest, ForeignKeyInfo[]>
  get_schema_info: Command<SchemaObjectRequest, SchemaInfoResponse>
  get_database_details: Command<DatabaseRequest, DatabaseDetails>
  create_database: Command<DatabaseEncodingRequest, void>
  alter_database: Command<DatabaseEncodingRequest, void>
  drop_database: Command<{ connectionId: string; name: string }, void>
  rename_database: Command<{ connectionId: string; oldName: string; newName: string }, void>
  drop_table: Command<TableRequest, void>
  truncate_table: Command<TableRequest, void>
  rename_table: Command<RenameTableRequest, void>

  save_schema_cache_snapshot: Command<{ connectionId: string; snapshotJson: string }, void>

  semantic_search: Command<
    { sessionId: string; queries: string[]; hints: RetrievalHints | null },
    SearchResult[]
  >
  invalidate_schema_index: Command<{ sessionId: string; tables: string[] }, void>

  create_session_snapshot: Command<CreateSnapshotArgs, number>

  set_setting: Command<{ key: string; value: string }, void>

  cancel_dump: Command<{ jobId: string; connectionId: string }, void>

  fetch_table_data: Command<FetchTableDataRequest, TableDataResponse>
  touch_table_data: Command<ConnectionTabRequest, TableDataTouchResult>
  evict_table_data: Command<ConnectionTabRequest, void>
  restore_table_data_cache: Command<RestoreTableDataCacheRequest, TableDataCacheRestoreResult>
  sync_table_data_cache_after_insert: Command<SyncTableDataCacheRequest, TableDataCacheSyncResult>
  sync_table_data_cache_after_update: Command<SyncTableDataCacheRequest, TableDataCacheSyncResult>
  sync_table_data_cache_after_delete: Command<SyncTableDataCacheRequest, TableDataCacheSyncResult>
  update_table_row: Command<UpdateTableRowRequest, void>
  insert_table_row: Command<InsertTableRowRequest, InsertedColumnValue[]>
  delete_table_row: Command<DeleteTableRowRequest, void>
  fetch_blob_value: Command<FetchBlobValueRequest, BlobValueResponse>
  write_file_bytes: Command<{ path: string; base64: string }, void>
  export_table_data: Command<ExportTableDataRequest, void>

  load_table_for_designer: Command<
    { connectionId: string; database: string; tableName: string },
    TableDesignerSchema
  >
  apply_table_ddl: Command<{ connectionId: string; database: string; ddl: string }, void>
}

export interface ArgumentCommandMap {
  ai_chat: Command<{ request: AiChatRequest }, void>
  ai_cancel: Command<{ streamId: string }, void>
  list_ai_models: Command<{ endpoint: string }, { models: AiModelInfo[] }>
  ai_query_expand: Command<{ req: AiQueryExpandRequest }, AiQueryExpandResponse>

  list_global_memories: Command<NoArguments, AiMemory[]>
  list_group_memories: Command<{ groupId: string }, AiMemory[]>
  list_connection_memories: Command<ConnectionArgument, AiMemory[]>
  reembed_all_memories: Command<NoArguments, void>

  get_app_info: Command<NoArguments, AppInfo>

  create_connection_group: Command<{ name: string }, string>
  list_connection_groups: Command<NoArguments, ConnectionGroup[]>
  delete_connection_group: Command<{ id: string }, void>

  save_connection: Command<{ data: SaveConnectionInput }, string>
  get_connection: Command<{ id: string }, SavedConnection>
  list_connections: Command<NoArguments, SavedConnection[]>
  delete_connection: Command<{ id: string }, void>
  test_connection: Command<{ input: TestConnectionInput }, TestConnectionResult>
  close_connection: Command<ConnectionArgument, void>
  get_connection_status: Command<ConnectionArgument, ConnectionStatus | null>
  list_open_connection_sessions: Command<NoArguments, OpenConnectionSession[]>

  start_copy_to_host: Command<{ params: CopyToHostParams }, string>
  get_copy_progress: Command<JobArgument, CopyProgress>
  cancel_copy: Command<JobArgument, void>

  get_result_export_progress: Command<JobArgument, ResultExportProgress>
  cancel_result_export: Command<JobArgument, void>
  get_run_export_progress: Command<{ runId: string }, RunExportProgress | null>

  create_favorite: Command<{ input: CreateFavoriteInput }, number>
  list_favorites: Command<ConnectionArgument, FavoriteEntry[]>
  delete_favorite: Command<{ id: number }, boolean>

  delete_history_entry: Command<{ id: number }, boolean>
  clear_history: Command<ConnectionArgument, number>

  save_object: Command<{ request: SaveObjectRequest }, SaveObjectResponse>

  get_processlist: Command<SessionArgument, ProcessRow[]>

  fetch_schema_metadata: Command<ConnectionArgument, SchemaMetadataResponse>
  fetch_schema_metadata_full: Command<ConnectionArgument, SchemaMetadataFull>
  read_file: Command<PathArgument, string>

  list_databases: Command<ConnectionArgument, string[]>
  list_charsets: Command<ConnectionArgument, CharsetInfo[]>
  list_collations: Command<ConnectionArgument, CollationInfo[]>
  invalidate_metadata_cache: Command<ConnectionArgument, void>

  load_schema_cache_snapshot: Command<ConnectionArgument, string | null>

  build_schema_index: Command<SessionArgument, void>
  force_rebuild_schema_index: Command<SessionArgument, void>
  get_index_status: Command<SessionArgument, SchemaIndexStatus>
  list_indexed_tables: Command<SessionArgument, IndexedTableInfo[]>

  list_session_snapshots: Command<NoArguments, SnapshotSummary[]>
  get_session_snapshot: Command<{ id: number }, string | null>
  delete_session_snapshot: Command<{ id: number }, boolean>

  get_setting: Command<{ key: string }, string | null>
  get_all_settings: Command<NoArguments, Record<string, string>>

  list_exportable_objects: Command<ConnectionArgument, ExportableDatabase[]>
  start_sql_dump: Command<{ input: StartDumpInput }, string>
  get_dump_progress: Command<JobArgument, DumpJobProgress>
  start_sql_import: Command<{ input: StartImportInput }, string>
  get_import_progress: Command<JobArgument, ImportJobProgress>
  cancel_import: Command<JobArgument, void>

  read_file_bytes: Command<PathArgument, string>

  generate_table_ddl: Command<{ request: GenerateDdlRequest }, GenerateDdlResponse>

  set_window_theme: Command<{ theme: 'light' | 'dark' | null }, void>
  get_window_backdrop: Command<NoArguments, WindowBackdrop>
  'plugin:webview|set_webview_zoom': Command<{ label: string; value: number }, void>
}

export type PayloadCommandName = keyof PayloadCommandMap
export type ArgumentCommandName = keyof ArgumentCommandMap
