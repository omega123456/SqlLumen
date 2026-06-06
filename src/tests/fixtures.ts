/**
 * Default IPC response fixtures for Vitest tests.
 *
 * Maps every known Tauri IPC command name to a stable default response.
 * Individual tests can override any command via `ipc.override(cmd, handler)`.
 *
 * This map is derived from the full set of commands wired in lib/*-commands.ts
 * and the plugin commands used by the app.
 */

// ---------------------------------------------------------------------------
// Handler type
// ---------------------------------------------------------------------------

export type IpcHandler = (args?: Record<string, unknown>, commandName?: string) => unknown

// ---------------------------------------------------------------------------
// Default fixture map
// ---------------------------------------------------------------------------

export const IPC_FIXTURES: Record<string, IpcHandler> = {
  // --- Tauri event system (shouldMockEvents:true in mockIPC handles listen/unlisten
  //     at the API level; these entries are included for completeness but the real
  //     event plumbing is handled by shouldMockEvents) ---
  'plugin:event|listen': (args) => args?.handler ?? null,
  'plugin:event|unlisten': () => null,

  // --- Tauri plugin: updater ---
  'plugin:updater|check': () => null,
  'plugin:updater|download_and_install': () => null,
  'plugin:updater|download': () => 201,
  'plugin:updater|install': () => null,

  // --- Tauri plugin: os ---
  'plugin:os|platform': () => 'linux',

  // --- Tauri plugin: process ---
  'plugin:process|relaunch': () => null,
  'plugin:process|restart': () => null,

  // --- Tauri plugin: clipboard-manager ---
  'plugin:clipboard-manager|write-text': () => null,
  'plugin:clipboard-manager|read-text': () => '',

  // --- Tauri plugin: dialog ---
  'plugin:dialog|open': () => null,
  'plugin:dialog|save': () => null,

  // --- Tauri plugin: resources ---
  'plugin:resources|close': () => null,

  // --- Logging ---
  log_frontend: () => undefined,
  list_logs: () => ({
    entries: [
      {
        id: 101,
        timestamp: '2026-06-06T12:00:00.000Z',
        level: 'ERROR',
        target: 'sqllumen::tests',
        message: 'Primary log fixture entry',
      },
      {
        id: 102,
        timestamp: '2026-06-06T11:58:30.000Z',
        level: 'INFO',
        target: 'sqllumen::tests',
        message: 'Background refresh fixture entry',
      },
    ],
    total: 2,
    page: 1,
    pageSize: 20,
  }),
  export_logs: () => 2,

  // --- Settings ---
  get_setting: () => null,
  set_setting: () => undefined,
  get_all_settings: () => ({}),

  // --- App info ---
  get_app_info: () => ({
    rustLogOverride: false,
    appVersion: '0.1.0',
  }),

  // --- Connection CRUD ---
  save_connection: () => 'conn-mock-new',
  get_connection: () => ({
    id: 'conn-mock-1',
    name: 'Mock Connection',
    host: '127.0.0.1',
    port: 3306,
    username: 'root',
    hasPassword: false,
    defaultDatabase: null,
    sslEnabled: false,
    sslCaPath: null,
    sslCertPath: null,
    sslKeyPath: null,
    color: '#2563eb',
    groupId: null,
    readOnly: false,
    sortOrder: 0,
    connectTimeoutSecs: 10,
    keepaliveIntervalSecs: 60,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  }),
  list_connections: () => [],
  update_connection: () => undefined,
  delete_connection: () => undefined,

  // --- Connection group CRUD ---
  create_connection_group: () => 'grp-mock-new',
  list_connection_groups: () => [],
  update_connection_group: () => undefined,
  delete_connection_group: () => undefined,

  // --- MySQL connectivity ---
  test_connection: () => ({
    success: true,
    serverVersion: '8.0.33-mock',
    authMethod: 'caching_sha2_password',
    sslStatus: 'Disabled',
    connectionTimeMs: 12,
    errorMessage: null,
  }),
  open_connection: () => ({ sessionId: 'session-mock-1', serverVersion: '8.0.33-mock' }),
  close_connection: () => undefined,
  get_connection_status: () => 'connected',

  // --- Schema cache ---
  load_schema_cache_snapshot: () => null,
  save_schema_cache_snapshot: () => undefined,

  // --- Schema read commands ---
  list_databases: () => [],
  list_schema_objects: () => [],
  list_columns: () => [],
  get_schema_info: () => ({
    columns: [],
    indexes: [],
    foreignKeys: [],
    ddl: '',
    metadata: null,
  }),
  get_database_details: () => ({
    name: 'mock_db',
    defaultCharacterSet: 'utf8mb4',
    defaultCollation: 'utf8mb4_general_ci',
  }),
  list_charsets: () => [],
  list_collations: () => [],
  get_table_foreign_keys: () => [],

  // --- Schema mutating commands ---
  create_database: () => undefined,
  drop_database: () => undefined,
  alter_database: () => undefined,
  rename_database: () => undefined,
  drop_table: () => undefined,
  truncate_table: () => undefined,
  rename_table: () => undefined,

  // --- Query execution ---
  execute_query: () => ({
    queryId: 'mock-query-id-1',
    columns: [],
    totalRows: 0,
    executionTimeMs: 5,
    totalTimeMs: 5,
    affectedRows: 0,
    rows: [],
    autoLimitApplied: false,
  }),
  execute_multi_query: () => ({ results: [] }),
  execute_call_query: () => ({ results: [] }),
  reexecute_single_result: () => ({
    queryId: 'mock-reexec-1',
    sourceSql: '',
    columns: [],
    totalRows: 0,
    executionTimeMs: 5,
    totalTimeMs: 5,
    affectedRows: 0,
    rows: [],
    autoLimitApplied: false,
    error: null,
    reExecutable: true,
  }),
  fetch_cached_rows: () => ({ rows: [], columns: [] }),
  evict_results: () => undefined,
  cancel_query: () => false,
  sort_results: () => ({ rows: [] }),
  select_database: () => undefined,
  fetch_schema_metadata: () => ({
    databases: [],
    tables: {},
    columns: {},
    routines: {},
  }),
  fetch_schema_metadata_full: () => ({
    databases: [],
    tables: {},
    columns: {},
    routines: {},
    foreignKeys: {},
    indexes: {},
  }),
  read_file: () => '',
  write_file: () => undefined,
  analyze_query_for_edit: () => [],
  update_result_cell: () => undefined,
  touch_results: () => ({ status: 'available' }),

  // --- Export ---
  export_results: () => ({ bytesWritten: 0, rowsExported: 0 }),

  // --- Table data browser/editor ---
  fetch_table_data: () => ({
    columns: [],
    rows: [],
    currentPage: 1,
    pageSize: 1000,
    primaryKey: null,
    executionTimeMs: 5,
  }),
  touch_table_data: () => ({ status: 'available' }),
  evict_table_data: () => undefined,
  restore_table_data_cache: () => ({
    status: 'available',
    data: {
      columns: [],
      rows: [],
      currentPage: 1,
      pageSize: 1000,
      primaryKey: null,
      executionTimeMs: 5,
    },
  }),
  sync_table_data_cache_after_insert: () => ({ status: 'synced' }),
  sync_table_data_cache_after_update: () => ({ status: 'synced' }),
  sync_table_data_cache_after_delete: () => ({ status: 'synced' }),
  update_table_row: () => undefined,
  insert_table_row: () => [],
  delete_table_row: () => undefined,
  export_table_data: () => undefined,
  fetch_blob_value: () => ({ base64: null, byteLength: 0, tooLarge: false }),
  read_file_bytes: () => '',
  write_file_bytes: () => undefined,

  // --- Table designer ---
  load_table_for_designer: () => ({
    tableName: '__new_table__',
    columns: [],
    indexes: [],
    foreignKeys: [],
    properties: {
      engine: 'InnoDB',
      charset: 'utf8mb4',
      collation: 'utf8mb4_unicode_ci',
      autoIncrement: 1,
      rowFormat: 'DYNAMIC',
      comment: '',
    },
  }),
  generate_table_ddl: () => ({
    ddl: 'CREATE TABLE `mock_table` (`id` INT NOT NULL);',
    warnings: [],
  }),
  apply_table_ddl: () => undefined,

  // --- Object editor ---
  get_object_body: () => 'CREATE ...',
  save_object: () => ({
    success: true,
    errorMessage: null,
    dropSucceeded: true,
    savedObjectName: 'mock_object',
  }),
  drop_object: () => undefined,
  get_routine_parameters: () => [],
  get_routine_parameters_with_return_type: () => ({ parameters: [], found: false }),

  // --- SQL Dump / Import ---
  list_exportable_objects: () => [],
  start_sql_dump: () => 'mock-dump-job-1',
  get_dump_progress: () => ({
    jobId: 'mock-dump-job-1',
    status: 'completed',
    tablesTotal: 0,
    tablesDone: 0,
    currentTable: null,
    bytesWritten: 0,
    rowsExported: 0,
    errorMessage: null,
    cancelRequested: false,
  }),
  cancel_dump: () => null,
  start_sql_import: () => 'mock-import-job-1',
  get_import_progress: () => ({
    jobId: 'mock-import-job-1',
    status: 'completed',
    statementsTotal: 0,
    statementsDone: 0,
    errors: [],
    stopOnError: true,
    cancelRequested: false,
  }),
  cancel_import: () => undefined,

  // --- Copy to host ---
  list_copyable_objects: () => ({
    tables: [
      { name: 'users', estimatedRows: 100 },
      { name: 'orders', estimatedRows: 500 },
    ],
    procedures: ['sp_recalc'],
    functions: ['fn_total'],
    triggers: ['trg_audit'],
    events: [],
  }),
  start_copy_to_host: () => 'copy-job-1',
  get_copy_progress: () => ({
    jobId: 'copy-job-1',
    status: 'completed',
    objectsTotal: 5,
    objectsDone: 5,
    currentObject: null,
    currentObjectType: null,
    rowsTotal: null,
    rowsDone: null,
    errorMessage: null,
    cancelRequested: false,
  }),
  cancel_copy: () => null,

  // --- Process list ---
  get_processlist: () => [],
  kill_queries: () => [],

  // --- Query history ---
  list_history: () => ({ entries: [], total: 0, page: 1, pageSize: 50 }),
  delete_history_entry: () => true,
  clear_history: () => 0,

  // --- Favorites ---
  create_favorite: () => 1,
  list_favorites: () => [],
  update_favorite: () => true,
  delete_favorite: () => true,

  // --- AI commands ---
  ai_chat: () => null,
  ai_cancel: () => null,
  list_ai_models: () => ({ models: [] }),
  ai_query_expand: () => ({ text: '' }),

  // --- Schema index commands ---
  build_schema_index: () => null,
  force_rebuild_schema_index: () => null,
  semantic_search: () => [],
  get_index_status: () => ({ status: 'not_configured' }),
  invalidate_schema_index: () => null,
  list_indexed_tables: () => [],

  // --- AI memory commands ---
  save_memory: () => ({
    id: 1,
    scope: 'connection',
    connectionId: 'conn-mock-1',
    groupId: null,
    content: '',
    createdAt: Math.floor(Date.now() / 1000),
    source: 'manual',
  }),
  list_global_memories: () => [],
  list_group_memories: () => [],
  list_connection_memories: () => [],
  move_memory: () => ({
    id: 1,
    scope: 'global',
    connectionId: null,
    groupId: null,
    content: '',
    createdAt: Math.floor(Date.now() / 1000),
    source: 'manual',
  }),
  delete_memory: () => null,
  search_memories: () => [],
  reembed_all_memories: () => null,

  // --- Session snapshots ---
  create_session_snapshot: () => 1,
  list_session_snapshots: () => [
    {
      id: 2,
      createdAt: '2026-06-05T14:32:00.000Z',
      triggerType: 'manual',
      connectionCount: 2,
      tabCount: 5,
      connections: [
        { name: 'ProdDB', tabCount: 3 },
        { name: 'Staging', tabCount: 2 },
      ],
    },
    {
      id: 1,
      createdAt: '2026-06-04T18:11:00.000Z',
      triggerType: 'onClose',
      connectionCount: 1,
      tabCount: 2,
      connections: [{ name: 'ProdDB', tabCount: 2 }],
    },
  ],
  get_session_snapshot: () =>
    JSON.stringify({
      version: 1,
      activeConnectionIndex: 0,
      connections: [{ profileId: 'conn-mock-1', activeTabIndex: 0, tabs: [] }],
    }),
  delete_session_snapshot: () => undefined,
}
