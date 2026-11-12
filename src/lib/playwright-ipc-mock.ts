import type { SchemaMetadataResponse, SchemaMetadataFull } from '../types/schema'
import type { LogLevelFilter } from './log-commands'
import {
  getAiDefaultSettingFixture,
  getAiModelsFixture,
  getAnalyzeQueryForEditFixture,
  getBlobValueFixture,
  getCancelCopyFixture,
  getCommandPaletteRecentsFixture,
  getCopyableObjectsFixture,
  getCopyProgressFixture,
  getCopyToHostStartFixture,
  getCancelResultExportFixture,
  getResultExportProgressFixture,
  getResultExportStartFixture,
  getColumnsFixture,
  getConnectionMemoriesFixture,
  getOpenConnectionSessionsFixture,
  getExportLogsFixture,
  getForeignKeysFixture,
  getGlobalMemoriesFixture,
  getGroupMemoriesFixture,
  getLogsPageFixture,
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
  getSchemaMetadataFullFixture,
  getSchemaInfoFixture,
  getSnapshotCreatedIdFixture,
  getSnapshotListFixture,
  getSnapshotStateFixture,
  getTableDataFixture,
  getTargetDatabasesFixture,
  getSchemaObjectsFixture,
  getSqlDumpProgressFixture,
  getSqlImportProgressFixture,
  getStaticFixture,
  getTableDdlPreviewFixture,
  getWindowBackdropFixture,
} from '../tests/playwright-fixtures'

const PLAYWRIGHT_LOG_LEVEL_FILTERS: LogLevelFilter[] = [
  'all',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
]

const COMMAND_PALETTE_RECENTS_SETTING_KEY = 'commandPalette.recents'
const AI_STREAM_START_DELAY_MS = 10
const AI_STREAM_CHUNK_INTERVAL_MS = 10
const AI_THINKING_LEAD_MS = 20
const AI_STREAM_ERROR_DELAY_MS = 20
const AI_STREAM_CHUNK_PATTERN = /[\s\S]{1,20}/g

function defaultMockDatabase(): string | null {
  return getStaticFixture('savedConnection').defaultDatabase
}

let activeMockDatabase: string | null = defaultMockDatabase()

// ---------------------------------------------------------------------------
// Deterministic multi-session allocation
// ---------------------------------------------------------------------------

/**
 * Per-page runtime session counter for `open_connection`. The first call in a
 * browser page returns `session-playwright-1`, the second `session-playwright-2`,
 * and so on. The counter lives on `window` so it resets automatically on every
 * page navigation/reload (a fresh `window` is created each load), preserving the
 * existing first-session E2E assumption that the initial open is
 * `session-playwright-1`.
 */
const SESSION_COUNTER_KEY = '__playwrightSessionCounter__'

/** Module-level fallback counter store for environments without `window`. */
const moduleSessionCounterStore: { [SESSION_COUNTER_KEY]?: number } = {}

function getCounterStore(): Record<string, number> {
  return typeof window !== 'undefined'
    ? (window as unknown as Record<string, number>)
    : (moduleSessionCounterStore as Record<string, number>)
}

function allocatePlaywrightSessionId(): string {
  const store = getCounterStore()
  const next = (store[SESSION_COUNTER_KEY] ?? 0) + 1
  store[SESSION_COUNTER_KEY] = next
  return `session-playwright-${next}`
}

/**
 * Reset the deterministic session allocator. Browser page loads reset it
 * implicitly via a fresh `window`; tests call this to isolate cases.
 */
export function resetPlaywrightSessionAllocator(): void {
  delete getCounterStore()[SESSION_COUNTER_KEY]
}

// ---------------------------------------------------------------------------
// AI stream mock infrastructure
// ---------------------------------------------------------------------------

/**
 * Registry of event listener callback IDs registered via `plugin:event|listen`.
 * Maps event name → array of callback IDs (registered via transformCallback).
 * Used by the `ai_chat` mock to simulate streaming events.
 */
const eventListenerCallbackIds = new Map<string, number[]>()

/**
 * Emit a mock event to all registered listeners for the given event name.
 * Uses Tauri's internal `runCallback` to invoke the callbacks registered
 * by `listen()` via `transformCallback`.
 */
function emitMockEvent(eventName: string, payload: unknown): void {
  const ids = eventListenerCallbackIds.get(eventName) ?? []
  // Tolerate `window` being gone (e.g. jsdom tears down before a pending
  // setTimeout fires in unit tests). The AI streaming path schedules chunks
  // with setTimeout, and a test may complete before they run.
  if (typeof window === 'undefined') {
    return
  }
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__?: { runCallback?: (id: number, data: unknown) => void }
    }
  ).__TAURI_INTERNALS__
  if (!internals?.runCallback) return

  for (const id of ids) {
    internals.runCallback(id, { event: eventName, payload: payload })
  }
}

function splitAiResponseIntoChunks(responseText: string): string[] {
  return responseText.match(AI_STREAM_CHUNK_PATTERN) ?? [responseText]
}

function scheduleAiContentStream(streamId: string, startDelayMs: number): void {
  let delay = startDelayMs
  for (const chunk of splitAiResponseIntoChunks(getStaticFixture('aiChat').responseText)) {
    setTimeout(() => {
      emitMockEvent('ai-stream-chunk', { streamId: streamId, content: chunk, kind: 'content' })
    }, delay)
    delay += AI_STREAM_CHUNK_INTERVAL_MS
  }
  setTimeout(() => {
    emitMockEvent('ai-stream-done', { streamId })
  }, delay)
}

function scheduleAiThinkingStream(streamId: string): void {
  const thinkingText = getStaticFixture('aiChat').thinkingText
  setTimeout(() => {
    emitMockEvent('ai-stream-chunk', {
      streamId: streamId,
      content: thinkingText,
      kind: 'thinking',
    })
  }, AI_STREAM_START_DELAY_MS)
  scheduleAiContentStream(streamId, AI_STREAM_START_DELAY_MS + AI_THINKING_LEAD_MS)
}

function scheduleAiStreamError(streamId: string): void {
  const errorMessage = getStaticFixture('aiChat').errorMessage
  setTimeout(() => {
    emitMockEvent('ai-stream-error', { streamId: streamId, error: errorMessage })
  }, AI_STREAM_ERROR_DELAY_MS)
}

// ---------------------------------------------------------------------------

interface PlaywrightUpdateOverride {
  available?: boolean
  version?: string
  currentVersion?: string
  body?: string | null
  date?: string | null
  rawJson?: unknown
}

interface PlaywrightGlobalOverrides {
  __PLAYWRIGHT_UPDATE_OVERRIDE__?: PlaywrightUpdateOverride
  __PLAYWRIGHT_SCHEMA_METADATA_OVERRIDE__?: SchemaMetadataResponse
  __PLAYWRIGHT_COMMAND_PALETTE_RECENTS_OVERRIDE__?: string
  __PLAYWRIGHT_SCHEMA_METADATA_FULL_DELAY_MS__?: number
}

function readGlobalOverride<TKey extends keyof PlaywrightGlobalOverrides>(
  key: TKey
): PlaywrightGlobalOverrides[TKey] {
  const playwrightGlobals = globalThis as typeof globalThis & PlaywrightGlobalOverrides
  return playwrightGlobals[key]
}

interface PlaywrightMockWindowFlags {
  __mockQueryError__?: unknown
  __mockQueryDelay__?: unknown
  __pendingQueryReject__?: ((reason: Error) => void) | null
  __mockAiError__?: unknown
  __mockAiThinking__?: unknown
}

function mockWindowFlags(): PlaywrightMockWindowFlags | null {
  if (typeof window === 'undefined') return null
  return window as unknown as PlaywrightMockWindowFlags
}

function readMockWindowFlag<TKey extends keyof PlaywrightMockWindowFlags>(
  key: TKey
): PlaywrightMockWindowFlags[TKey] | undefined {
  return mockWindowFlags()?.[key]
}

function writeMockWindowFlag<TKey extends keyof PlaywrightMockWindowFlags>(
  key: TKey,
  value: PlaywrightMockWindowFlags[TKey]
): void {
  const flags = mockWindowFlags()
  if (flags) flags[key] = value
}

function getMockUpdateMetadata(): Record<string, unknown> | null {
  const override = readGlobalOverride('__PLAYWRIGHT_UPDATE_OVERRIDE__')
  if (!override?.available) {
    return null
  }

  const update = getStaticFixture('update')
  return {
    rid: update.rid,
    currentVersion: override.currentVersion ?? update.currentVersion,
    version: override.version ?? update.version,
    date: override.date ?? update.date,
    body: override.body ?? update.body,
    rawJson: override.rawJson ?? null,
  }
}

function emitUpdaterEvent(args: Record<string, unknown> | undefined, payload: unknown): void {
  const onEvent = args?.onEvent as { onmessage?: (payload: unknown) => void } | undefined
  onEvent?.onmessage?.(payload)
}

function emitUpdaterDownload(
  args: Record<string, unknown> | undefined,
  chunkLengths: number[]
): void {
  emitUpdaterEvent(args, {
    event: 'Started',
    data: { contentLength: getStaticFixture('update').contentLength },
  })
  for (const chunkLength of chunkLengths) {
    emitUpdaterEvent(args, { event: 'Progress', data: { chunkLength: chunkLength } })
  }
  emitUpdaterEvent(args, { event: 'Finished' })
}

function getCommandPaletteRecentsValue(): string {
  return (
    readGlobalOverride('__PLAYWRIGHT_COMMAND_PALETTE_RECENTS_OVERRIDE__') ??
    getCommandPaletteRecentsFixture()
  )
}

function getSchemaMetadataDelayMs(): number {
  const candidate = readGlobalOverride('__PLAYWRIGHT_SCHEMA_METADATA_FULL_DELAY_MS__')
  return typeof candidate === 'number' && candidate > 0 ? candidate : 0
}

async function maybeDelaySchemaMetadata(): Promise<void> {
  const delayMs = getSchemaMetadataDelayMs()
  if (delayMs <= 0) {
    return
  }

  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs)
  })
}

type PlaywrightIpcArgs = Record<string, unknown> | undefined
type PlaywrightIpcHandler = (args: PlaywrightIpcArgs) => unknown
type PlaywrightIpcHandlerTable = Record<string, PlaywrightIpcHandler>

function returnNull(): null {
  return null
}

function returnTrue(): boolean {
  return true
}

function returnUndefined(): undefined {
  return undefined
}

function returnEmptyList(): never[] {
  return []
}

function returnAvailableStatus(): { status: string } {
  return { status: 'available' }
}

function optionalStringArg(args: PlaywrightIpcArgs, key: string): string | undefined {
  const value = args?.[key]
  return typeof value === 'string' ? value : undefined
}

function stringArgOrEmpty(args: PlaywrightIpcArgs, key: string): string {
  return optionalStringArg(args, key) ?? ''
}

function isPlaywrightLogLevelFilter(level: unknown): level is LogLevelFilter {
  return typeof level === 'string' && PLAYWRIGHT_LOG_LEVEL_FILTERS.includes(level as LogLevelFilter)
}

function hasEventListenerIds(eventName: string | undefined, callbackId: number | undefined) {
  return Boolean(eventName) && typeof callbackId === 'number'
}

function listenToMockEvent(args: PlaywrightIpcArgs): unknown {
  const eventName = args?.event as string | undefined
  const handlerId = args?.handler as number | undefined
  if (!hasEventListenerIds(eventName, handlerId)) {
    return handlerId ?? null
  }
  const ids = eventListenerCallbackIds.get(eventName as string) ?? []
  ids.push(handlerId as number)
  eventListenerCallbackIds.set(eventName as string, ids)
  return handlerId
}

function unlistenFromMockEvent(args: PlaywrightIpcArgs): null {
  const eventName = args?.event as string | undefined
  const eventId = args?.eventId as number | undefined
  if (!hasEventListenerIds(eventName, eventId)) {
    return null
  }
  const ids = eventListenerCallbackIds.get(eventName as string) ?? []
  const index = ids.indexOf(eventId as number)
  if (index !== -1) ids.splice(index, 1)
  return null
}

const TAURI_PLUGIN_HANDLERS: PlaywrightIpcHandlerTable = {
  'plugin:event|listen': listenToMockEvent,
  'plugin:event|unlisten': unlistenFromMockEvent,
  'plugin:updater|check': () => getMockUpdateMetadata(),
  'plugin:updater|download_and_install': (args) => {
    emitUpdaterDownload(args, getStaticFixture('update').installChunkLengths)
    return null
  },
  'plugin:updater|download': (args) => {
    emitUpdaterDownload(args, getStaticFixture('update').downloadChunkLengths)
    return getStaticFixture('update').downloadRid
  },
  'plugin:updater|install': returnNull,
  'plugin:os|platform': () => getStaticFixture('platform'),
  'plugin:process|restart': returnNull,
  'plugin:process|relaunch': returnNull,
  'plugin:webview|set_webview_zoom': returnNull,
}

function getMockSetting(args: PlaywrightIpcArgs): unknown {
  const key = args?.key as string
  if (key === COMMAND_PALETTE_RECENTS_SETTING_KEY) {
    return getCommandPaletteRecentsValue()
  }
  return getAiDefaultSettingFixture(key)
}

function listMockLogs(args: PlaywrightIpcArgs): unknown {
  const page = Number(args?.page ?? 1)
  const level = args?.level
  const normalizedLevel = isPlaywrightLogLevelFilter(level) ? level : 'all'
  return getLogsPageFixture(page, normalizedLevel)
}

const APP_HANDLERS: PlaywrightIpcHandlerTable = {
  get_setting: getMockSetting,
  set_setting: returnNull,
  get_all_settings: () => ({
    ...getStaticFixture('appSettings'),
    [COMMAND_PALETTE_RECENTS_SETTING_KEY]: getCommandPaletteRecentsValue(),
  }),
  log_frontend: returnNull,
  list_logs: listMockLogs,
  export_logs: (args) =>
    getExportLogsFixture(
      stringArgOrEmpty(args, 'startTimestamp'),
      stringArgOrEmpty(args, 'endTimestamp')
    ),
  get_app_info: () => getStaticFixture('appInfo'),
  set_window_theme: returnNull,
  get_window_backdrop: () => getWindowBackdropFixture(),
}

const CONNECTION_HANDLERS: PlaywrightIpcHandlerTable = {
  list_connections: () => [getStaticFixture('savedConnection')],
  list_connection_groups: returnEmptyList,
  list_open_connection_sessions: () => getOpenConnectionSessionsFixture(),
  open_connection: () => {
    activeMockDatabase = defaultMockDatabase()
    return {
      sessionId: allocatePlaywrightSessionId(),
      serverVersion: getStaticFixture('serverVersion'),
    }
  },
  select_database: (args) => {
    activeMockDatabase = (args?.databaseName as string | null) ?? null
    return null
  },
  test_connection: () => getStaticFixture('testConnection'),
  save_connection: () => getStaticFixture('newConnectionId'),
  update_connection: returnNull,
  delete_connection: returnNull,
  get_connection: () => getStaticFixture('savedConnection'),
  create_connection_group: () => getStaticFixture('newConnectionGroupId'),
  update_connection_group: returnNull,
  delete_connection_group: returnNull,
  close_connection: returnNull,
  get_connection_status: () => 'connected',
  load_schema_cache_snapshot: returnNull,
  save_schema_cache_snapshot: returnNull,
}

function fetchMockSchemaMetadataFull(): Promise<SchemaMetadataFull> {
  const fixtureMetadata = getSchemaMetadataFullFixture()
  const baseMetadata = readGlobalOverride('__PLAYWRIGHT_SCHEMA_METADATA_OVERRIDE__')
  return maybeDelaySchemaMetadata().then((): SchemaMetadataFull => ({
    databases: baseMetadata?.databases ?? fixtureMetadata.databases,
    tables: baseMetadata?.tables ?? fixtureMetadata.tables,
    views: fixtureMetadata.views,
    columns: baseMetadata?.columns ?? fixtureMetadata.columns,
    routines: baseMetadata?.routines ?? fixtureMetadata.routines,
    triggers: fixtureMetadata.triggers,
    foreignKeys: fixtureMetadata.foreignKeys,
    indexes: fixtureMetadata.indexes,
  }))
}

const SCHEMA_HANDLERS: PlaywrightIpcHandlerTable = {
  list_databases: () => getTargetDatabasesFixture(),
  list_copyable_objects: (args) => getCopyableObjectsFixture(optionalStringArg(args, 'database')),
  list_schema_objects: (args) => getSchemaObjectsFixture(optionalStringArg(args, 'objectType')),
  list_columns: (args) => getColumnsFixture(optionalStringArg(args, 'table')),
  get_schema_info: (args) => getSchemaInfoFixture(String(args?.objectType ?? 'table')),
  get_database_details: () => getStaticFixture('databaseDetails'),
  list_charsets: () => getStaticFixture('charsets'),
  list_collations: () => getStaticFixture('collations'),
  load_table_for_designer: () => getStaticFixture('tableDesignerSchema'),
  generate_table_ddl: (args) => {
    const request = args?.request as { mode?: string } | undefined
    return getTableDdlPreviewFixture(request?.mode)
  },
  apply_table_ddl: returnUndefined,
  create_database: returnNull,
  drop_database: returnNull,
  alter_database: returnNull,
  rename_database: returnNull,
  drop_table: returnNull,
  truncate_table: returnNull,
  rename_table: returnNull,
  invalidate_metadata_cache: returnNull,
  fetch_schema_metadata: () =>
    readGlobalOverride('__PLAYWRIGHT_SCHEMA_METADATA_OVERRIDE__') ??
    getStaticFixture('schemaMetadata'),
  fetch_schema_metadata_full: fetchMockSchemaMetadataFull,
}

const COPY_TO_HOST_HANDLERS: PlaywrightIpcHandlerTable = {
  start_copy_to_host: () => getCopyToHostStartFixture(),
  get_copy_progress: (args) => getCopyProgressFixture(optionalStringArg(args, 'jobId')),
  cancel_copy: (args) => getCancelCopyFixture(optionalStringArg(args, 'jobId')),
}

function delayedQueryResult(result: unknown, delayMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    writeMockWindowFlag('__pendingQueryReject__', reject)
    setTimeout(() => {
      writeMockWindowFlag('__pendingQueryReject__', null)
      resolve(result)
    }, delayMs)
  })
}

function executeMockQuery(args: PlaywrightIpcArgs): unknown {
  if (readMockWindowFlag('__mockQueryError__')) {
    throw new Error(getStaticFixture('querySimulation').errorMessage)
  }
  const result = executeQueryFixture({
    tabId: String(args?.tabId ?? ''),
    sql: String(args?.sql ?? ''),
    activeMockDb: activeMockDatabase,
    viewSpec: (args?.viewSpec as Parameters<typeof executeQueryFixture>[0]['viewSpec']) ?? null,
  })
  const delay = readMockWindowFlag('__mockQueryDelay__')
  const hasQueryDelay = typeof delay === 'number' && delay > 0
  if (hasQueryDelay) {
    return delayedQueryResult(result, delay)
  }
  return result
}

function cancelMockQuery(): boolean {
  const pendingReject = readMockWindowFlag('__pendingQueryReject__')
  if (pendingReject) {
    writeMockWindowFlag('__pendingQueryReject__', null)
    pendingReject(new Error(getStaticFixture('querySimulation').cancelledMessage))
  }
  return true
}

const QUERY_HANDLERS: PlaywrightIpcHandlerTable = {
  execute_query: executeMockQuery,
  execute_multi_query: (args) => executeMultiQueryFixture({ tabId: String(args?.tabId ?? '') }),
  execute_call_query: (args) =>
    executeCallQueryFixture({
      tabId: String(args?.tabId ?? ''),
      sql: String(args?.sql ?? ''),
    }),
  reexecute_single_result: (args) =>
    reexecuteSingleResultFixture({
      tabId: String(args?.tabId ?? ''),
      resultIndex: Number(args?.resultIndex ?? 0),
      sql: String(args?.sql ?? 'SELECT 1'),
      viewSpec:
        (args?.viewSpec as Parameters<typeof reexecuteSingleResultFixture>[0]['viewSpec']) ?? null,
    }),
  set_result_view: (args) =>
    setResultViewFixture(args as unknown as Parameters<typeof setResultViewFixture>[0]),
  fetch_result_window: (args) =>
    fetchResultWindowFixture(args as unknown as Parameters<typeof fetchResultWindowFixture>[0]),
  remove_result_rows: (args) =>
    removeResultRowsFixture(args as unknown as Parameters<typeof removeResultRowsFixture>[0]),
  evict_results: returnNull,
  cancel_query: cancelMockQuery,
  analyze_query_for_edit: (args) =>
    getAnalyzeQueryForEditFixture(args?.sql as string | null | undefined),
  update_result_cell: returnNull,
  touch_results: returnAvailableStatus,
  export_results: () => getStaticFixture('exportResults'),
  start_result_export: () => getResultExportStartFixture(),
  get_result_export_progress: (args) =>
    getResultExportProgressFixture(args?.jobId as string | null | undefined),
  cancel_result_export: (args) =>
    getCancelResultExportFixture(args?.jobId as string | null | undefined),
}

function payloadTableName(args: PlaywrightIpcArgs): string {
  const payload = args?.payload as Record<string, unknown> | undefined
  return String(payload?.table)
}

function syncMockTableDataCache(args: PlaywrightIpcArgs): { status: string } {
  void getTableDataFixture(payloadTableName(args))
  return { status: 'synced' }
}

const TABLE_DATA_HANDLERS: PlaywrightIpcHandlerTable = {
  fetch_table_data: (args) => getTableDataFixture(payloadTableName(args)),
  touch_table_data: returnAvailableStatus,
  evict_table_data: returnNull,
  restore_table_data_cache: (args) => ({
    status: 'available',
    data: getTableDataFixture(String(args?.table)),
  }),
  get_table_foreign_keys: (args) => getForeignKeysFixture(String(args?.table)),
  sync_table_data_cache_after_insert: syncMockTableDataCache,
  sync_table_data_cache_after_update: syncMockTableDataCache,
  sync_table_data_cache_after_delete: syncMockTableDataCache,
  update_table_row: returnNull,
  insert_table_row: () => getStaticFixture('insertedRow'),
  delete_table_row: returnNull,
  export_table_data: returnNull,
  fetch_blob_value: (args) => getBlobValueFixture(String(args?.column)),
  read_file_bytes: () => getBlobValueFixture('default').base64 ?? '',
  write_file_bytes: returnNull,
}

const OBJECT_EDITOR_HANDLERS: PlaywrightIpcHandlerTable = {
  get_object_body: (args) => getObjectBodyFixture(args?.objectType as string | undefined),
  save_object: () => getStaticFixture('savedObject'),
  drop_object: returnUndefined,
  get_routine_parameters: () => getStaticFixture('routineParameters'),
  get_routine_parameters_with_return_type: (args) =>
    getRoutineParamsFixture(String(args?.routineType)),
  read_file: () => getStaticFixture('openedFileContent'),
  write_file: returnNull,
}

const DUMP_AND_IMPORT_HANDLERS: PlaywrightIpcHandlerTable = {
  list_exportable_objects: () => getStaticFixture('exportableDatabases'),
  start_sql_dump: () => getStaticFixture('sqlDumpJobId'),
  get_dump_progress: (args) => getSqlDumpProgressFixture(optionalStringArg(args, 'jobId')),
  cancel_dump: returnNull,
  start_sql_import: () => getStaticFixture('sqlImportJobId'),
  get_import_progress: (args) => getSqlImportProgressFixture(optionalStringArg(args, 'jobId')),
  cancel_import: returnNull,
}

function killMockQueries(args: PlaywrightIpcArgs): unknown {
  const ids = args?.ids as number[] | undefined
  return (ids ?? []).map((id: number) => ({ id: id, success: true, error: null }))
}

const PROCESS_LIST_AND_HISTORY_HANDLERS: PlaywrightIpcHandlerTable = {
  get_processlist: () => getStaticFixture('processList'),
  kill_queries: killMockQueries,
  list_history: () => getStaticFixture('historyPage'),
  delete_history_entry: returnTrue,
  clear_history: () => getStaticFixture('historyPage').total,
  create_favorite: () => getStaticFixture('createdFavoriteId'),
  list_favorites: () => getStaticFixture('favorites'),
  update_favorite: returnTrue,
  delete_favorite: returnTrue,
}

function startMockAiChat(args: PlaywrightIpcArgs): null {
  const request = args?.request as { streamId?: string } | undefined
  const streamId = request?.streamId ?? getStaticFixture('aiChat').fallbackStreamId
  if (readMockWindowFlag('__mockAiError__')) {
    scheduleAiStreamError(streamId)
    return null
  }
  if (readMockWindowFlag('__mockAiThinking__')) {
    scheduleAiThinkingStream(streamId)
    return null
  }
  scheduleAiContentStream(streamId, AI_STREAM_START_DELAY_MS)
  return null
}

const AI_HANDLERS: PlaywrightIpcHandlerTable = {
  ai_chat: startMockAiChat,
  ai_cancel: returnNull,
  list_ai_models: (args) => ({
    models: getAiModelsFixture(args?.endpoint as string | null | undefined),
  }),
  ai_query_expand: () => getStaticFixture('aiQueryExpansion'),
  build_schema_index: returnNull,
  force_rebuild_schema_index: returnNull,
  semantic_search: () => getStaticFixture('semanticSearchResults'),
  get_index_status: () => getStaticFixture('schemaIndexStatus'),
  invalidate_schema_index: returnNull,
  list_indexed_tables: returnEmptyList,
  save_memory: (args) => getSavedMemoryFixture(args),
  list_global_memories: () => getGlobalMemoriesFixture(),
  list_group_memories: (args) => getGroupMemoriesFixture(args?.groupId as string | null),
  list_connection_memories: (args) =>
    getConnectionMemoriesFixture(args?.connectionId as string | null),
  move_memory: (args) => getMovedMemoryFixture(args),
  delete_memory: returnNull,
  search_memories: returnEmptyList,
  reembed_all_memories: returnNull,
}

const SESSION_SNAPSHOT_HANDLERS: PlaywrightIpcHandlerTable = {
  create_session_snapshot: () => getSnapshotCreatedIdFixture(),
  list_session_snapshots: () => getSnapshotListFixture(),
  get_session_snapshot: (args) => getSnapshotStateFixture(args?.id as number | null),
  delete_session_snapshot: returnNull,
}

const PLAYWRIGHT_IPC_HANDLERS = new Map<string, PlaywrightIpcHandler>(
  Object.entries({
    ...TAURI_PLUGIN_HANDLERS,
    ...APP_HANDLERS,
    ...CONNECTION_HANDLERS,
    ...SCHEMA_HANDLERS,
    ...COPY_TO_HOST_HANDLERS,
    ...QUERY_HANDLERS,
    ...TABLE_DATA_HANDLERS,
    ...OBJECT_EDITOR_HANDLERS,
    ...DUMP_AND_IMPORT_HANDLERS,
    ...PROCESS_LIST_AND_HISTORY_HANDLERS,
    ...AI_HANDLERS,
    ...SESSION_SNAPSHOT_HANDLERS,
  })
)

export function playwrightIpcMockHandler(command: string, args?: Record<string, unknown>): unknown {
  const handler = PLAYWRIGHT_IPC_HANDLERS.get(command) ?? returnNull
  return handler(args)
}
