import type { InvokeArgs } from '@tauri-apps/api/core'
import type { SchemaMetadataFull } from '../types/schema'
import type {
  ArgumentCommandMap,
  ArgumentCommandName,
  PayloadCommandMap,
  PayloadCommandName,
} from './ipc/command-map'
import type { ExecuteQueryRequest } from './query-commands'
import type { LogLevelFilter } from './log-commands'
import { hasWindow } from './tauri-env'
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

const PLAYWRIGHT_LOG_LEVEL_FILTERS: ReadonlySet<string> = new Set<LogLevelFilter>([
  'all',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
])

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

interface SessionCounterStore {
  __playwrightSessionCounter__?: number
}

const moduleSessionCounterStore: SessionCounterStore = {}

function getCounterStore(): SessionCounterStore {
  if (hasWindow()) return window
  return moduleSessionCounterStore
}

function allocatePlaywrightSessionId(): string {
  const store = getCounterStore()
  const next = (store.__playwrightSessionCounter__ ?? 0) + 1
  store.__playwrightSessionCounter__ = next
  return `session-playwright-${next}`
}

export function resetPlaywrightSessionAllocator(): void {
  delete getCounterStore().__playwrightSessionCounter__
}

const eventListenerCallbackIds = new Map<string, number[]>()

function emitMockEvent(eventName: string, payload: unknown): void {
  if (!hasWindow()) return
  const runCallback = window.__TAURI_INTERNALS__?.runCallback
  if (!runCallback) return

  const ids = eventListenerCallbackIds.get(eventName) ?? []
  for (const id of ids) {
    runCallback(id, { event: eventName, payload: payload })
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

type PlaywrightMockWindowFlag =
  '__mockQueryError__' | '__mockQueryDelay__' | '__mockAiError__' | '__mockAiThinking__'

function readMockWindowFlag(flag: PlaywrightMockWindowFlag): unknown {
  if (!hasWindow()) return undefined
  return window[flag]
}

type PendingQueryReject = (reason: Error) => void

function readPendingQueryReject(): PendingQueryReject | null {
  if (!hasWindow()) return null
  return window.__pendingQueryReject__ ?? null
}

function writePendingQueryReject(reject: PendingQueryReject | null): void {
  if (hasWindow()) window.__pendingQueryReject__ = reject
}

function getMockUpdateMetadata(): Record<string, unknown> | null {
  const override = globalThis.__PLAYWRIGHT_UPDATE_OVERRIDE__
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

type PlaywrightIpcArgs = Record<string, unknown> | undefined

interface UpdaterEventChannel {
  onmessage: (payload: unknown) => void
}

function isUpdaterEventChannel(candidate: unknown): candidate is UpdaterEventChannel {
  if (typeof candidate !== 'object') return false
  if (candidate === null) return false
  return 'onmessage' in candidate && typeof candidate.onmessage === 'function'
}

function emitUpdaterEvent(args: PlaywrightIpcArgs, payload: unknown): void {
  const onEvent = args?.onEvent
  if (isUpdaterEventChannel(onEvent)) onEvent.onmessage(payload)
}

function emitUpdaterDownload(args: PlaywrightIpcArgs, chunkLengths: number[]): void {
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
    globalThis.__PLAYWRIGHT_COMMAND_PALETTE_RECENTS_OVERRIDE__ ?? getCommandPaletteRecentsFixture()
  )
}

function getSchemaMetadataDelayMs(): number {
  const candidate = globalThis.__PLAYWRIGHT_SCHEMA_METADATA_FULL_DELAY_MS__
  const hasPositiveDelay = typeof candidate === 'number' && candidate > 0
  return hasPositiveDelay ? candidate : 0
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

type PluginIpcHandler = (args: PlaywrightIpcArgs) => unknown

type PayloadCommandHandlers = {
  [TCommand in PayloadCommandName]: (payload: PayloadCommandMap[TCommand]['request']) => unknown
}

type ArgumentCommandHandlers = {
  [TCommand in ArgumentCommandName]: (argument: ArgumentCommandMap[TCommand]['request']) => unknown
}

type ParsedCommandHandler = (request: never) => unknown

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

function isPlaywrightLogLevelFilter(level: string): level is LogLevelFilter {
  return PLAYWRIGHT_LOG_LEVEL_FILTERS.has(level)
}

interface MockEventSubscription {
  eventName: string
  callbackId: number
}

function readMockEventSubscription(
  eventName: unknown,
  callbackId: unknown
): MockEventSubscription | null {
  if (typeof eventName !== 'string') return null
  if (eventName === '') return null
  if (typeof callbackId !== 'number') return null
  return { eventName, callbackId }
}

function listenToMockEvent(args: PlaywrightIpcArgs): unknown {
  const subscription = readMockEventSubscription(args?.event, args?.handler)
  if (!subscription) {
    return args?.handler ?? null
  }
  const ids = eventListenerCallbackIds.get(subscription.eventName) ?? []
  ids.push(subscription.callbackId)
  eventListenerCallbackIds.set(subscription.eventName, ids)
  return subscription.callbackId
}

function unlistenFromMockEvent(args: PlaywrightIpcArgs): null {
  const subscription = readMockEventSubscription(args?.event, args?.eventId)
  if (!subscription) {
    return null
  }
  const ids = eventListenerCallbackIds.get(subscription.eventName) ?? []
  const index = ids.indexOf(subscription.callbackId)
  if (index !== -1) ids.splice(index, 1)
  return null
}

const TAURI_PLUGIN_HANDLERS: Record<string, PluginIpcHandler> = {
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
}

function getMockSetting({ key }: { key: string }): unknown {
  if (key === COMMAND_PALETTE_RECENTS_SETTING_KEY) {
    return getCommandPaletteRecentsValue()
  }
  return getAiDefaultSettingFixture(key)
}

function listMockLogs({ page, level }: { page: number; level: string }): unknown {
  const normalizedLevel = isPlaywrightLogLevelFilter(level) ? level : 'all'
  return getLogsPageFixture(page, normalizedLevel)
}

const APP_PAYLOAD_HANDLERS = {
  set_setting: returnNull,
  log_frontend: returnNull,
  list_logs: listMockLogs,
  export_logs: (payload) => getExportLogsFixture(payload.startTimestamp, payload.endTimestamp),
} satisfies Partial<PayloadCommandHandlers>

const APP_ARGUMENT_HANDLERS = {
  get_setting: getMockSetting,
  get_all_settings: () => ({
    ...getStaticFixture('appSettings'),
    [COMMAND_PALETTE_RECENTS_SETTING_KEY]: getCommandPaletteRecentsValue(),
  }),
  get_app_info: () => getStaticFixture('appInfo'),
  set_window_theme: returnNull,
  get_window_backdrop: () => getWindowBackdropFixture(),
  'plugin:webview|set_webview_zoom': returnNull,
} satisfies Partial<ArgumentCommandHandlers>

function openMockConnection(): { sessionId: string; serverVersion: string } {
  activeMockDatabase = defaultMockDatabase()
  return {
    sessionId: allocatePlaywrightSessionId(),
    serverVersion: getStaticFixture('serverVersion'),
  }
}

function selectMockDatabase({ databaseName }: { databaseName: string | null }): null {
  activeMockDatabase = databaseName ?? null
  return null
}

const CONNECTION_PAYLOAD_HANDLERS = {
  open_connection: openMockConnection,
  select_database: selectMockDatabase,
  update_connection: returnNull,
  update_connection_group: returnNull,
  save_schema_cache_snapshot: returnNull,
} satisfies Partial<PayloadCommandHandlers>

const CONNECTION_ARGUMENT_HANDLERS = {
  list_connections: () => [getStaticFixture('savedConnection')],
  list_connection_groups: returnEmptyList,
  list_open_connection_sessions: () => getOpenConnectionSessionsFixture(),
  test_connection: () => getStaticFixture('testConnection'),
  save_connection: () => getStaticFixture('newConnectionId'),
  delete_connection: returnNull,
  get_connection: () => getStaticFixture('savedConnection'),
  create_connection_group: () => getStaticFixture('newConnectionGroupId'),
  delete_connection_group: returnNull,
  close_connection: returnNull,
  get_connection_status: () => 'connected',
  load_schema_cache_snapshot: returnNull,
} satisfies Partial<ArgumentCommandHandlers>

function fetchMockSchemaMetadataFull(): Promise<SchemaMetadataFull> {
  const fixtureMetadata = getSchemaMetadataFullFixture()
  const baseMetadata = globalThis.__PLAYWRIGHT_SCHEMA_METADATA_OVERRIDE__
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

const SCHEMA_PAYLOAD_HANDLERS = {
  list_copyable_objects: (payload) => getCopyableObjectsFixture(payload.database),
  list_schema_objects: (payload) => getSchemaObjectsFixture(payload.objectType),
  list_columns: (payload) => getColumnsFixture(payload.table),
  get_schema_info: (payload) => getSchemaInfoFixture(payload.objectType ?? 'table'),
  get_database_details: () => getStaticFixture('databaseDetails'),
  load_table_for_designer: () => getStaticFixture('tableDesignerSchema'),
  apply_table_ddl: returnUndefined,
  create_database: returnNull,
  drop_database: returnNull,
  alter_database: returnNull,
  rename_database: returnNull,
  drop_table: returnNull,
  truncate_table: returnNull,
  rename_table: returnNull,
} satisfies Partial<PayloadCommandHandlers>

const SCHEMA_ARGUMENT_HANDLERS = {
  list_databases: () => getTargetDatabasesFixture(),
  list_charsets: () => getStaticFixture('charsets'),
  list_collations: () => getStaticFixture('collations'),
  generate_table_ddl: (argument) => getTableDdlPreviewFixture(argument.request?.mode),
  invalidate_metadata_cache: returnNull,
  fetch_schema_metadata: () =>
    globalThis.__PLAYWRIGHT_SCHEMA_METADATA_OVERRIDE__ ?? getStaticFixture('schemaMetadata'),
  fetch_schema_metadata_full: fetchMockSchemaMetadataFull,
} satisfies Partial<ArgumentCommandHandlers>

const COPY_TO_HOST_ARGUMENT_HANDLERS = {
  start_copy_to_host: () => getCopyToHostStartFixture(),
  get_copy_progress: (argument) => getCopyProgressFixture(argument.jobId),
  cancel_copy: (argument) => getCancelCopyFixture(argument.jobId),
} satisfies Partial<ArgumentCommandHandlers>

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

const QUERY_PAYLOAD_HANDLERS = {
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
  evict_results: returnNull,
  cancel_query: cancelMockQuery,
  analyze_query_for_edit: (payload) => getAnalyzeQueryForEditFixture(payload.sql),
  update_result_cell: returnNull,
  touch_results: returnAvailableStatus,
  export_results: () => getStaticFixture('exportResults'),
  start_result_export: () => getResultExportStartFixture(),
} satisfies Partial<PayloadCommandHandlers>

const QUERY_ARGUMENT_HANDLERS = {
  get_result_export_progress: (argument) => getResultExportProgressFixture(argument.jobId),
  cancel_result_export: (argument) => getCancelResultExportFixture(argument.jobId),
} satisfies Partial<ArgumentCommandHandlers>

function syncMockTableDataCache({ table }: { table: string }): { status: string } {
  void getTableDataFixture(table)
  return { status: 'synced' }
}

const TABLE_DATA_PAYLOAD_HANDLERS = {
  fetch_table_data: (payload) => getTableDataFixture(payload.table),
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

const TABLE_DATA_ARGUMENT_HANDLERS = {
  read_file_bytes: () => getBlobValueFixture('default').base64 ?? '',
} satisfies Partial<ArgumentCommandHandlers>

const OBJECT_EDITOR_PAYLOAD_HANDLERS = {
  get_object_body: (payload) => getObjectBodyFixture(payload.objectType),
  drop_object: returnUndefined,
  get_routine_parameters: () => getStaticFixture('routineParameters'),
  get_routine_parameters_with_return_type: (payload) =>
    getRoutineParamsFixture(payload.routineType),
  write_file: returnNull,
} satisfies Partial<PayloadCommandHandlers>

const OBJECT_EDITOR_ARGUMENT_HANDLERS = {
  save_object: () => getStaticFixture('savedObject'),
  read_file: () => getStaticFixture('openedFileContent'),
} satisfies Partial<ArgumentCommandHandlers>

const DUMP_AND_IMPORT_PAYLOAD_HANDLERS = {
  cancel_dump: returnNull,
} satisfies Partial<PayloadCommandHandlers>

const DUMP_AND_IMPORT_ARGUMENT_HANDLERS = {
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

const PROCESS_LIST_AND_HISTORY_PAYLOAD_HANDLERS = {
  kill_queries: killMockQueries,
  list_history: () => getStaticFixture('historyPage'),
  update_favorite: returnTrue,
} satisfies Partial<PayloadCommandHandlers>

const PROCESS_LIST_AND_HISTORY_ARGUMENT_HANDLERS = {
  get_processlist: () => getStaticFixture('processList'),
  delete_history_entry: returnTrue,
  clear_history: () => getStaticFixture('historyPage').total,
  create_favorite: () => getStaticFixture('createdFavoriteId'),
  list_favorites: () => getStaticFixture('favorites'),
  delete_favorite: returnTrue,
} satisfies Partial<ArgumentCommandHandlers>

function startMockAiChat({ request }: { request: { streamId: string } }): null {
  const streamId = request.streamId ?? getStaticFixture('aiChat').fallbackStreamId
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

const AI_PAYLOAD_HANDLERS = {
  semantic_search: () => getStaticFixture('semanticSearchResults'),
  invalidate_schema_index: returnNull,
  save_memory: (payload) => getSavedMemoryFixture(payload),
  move_memory: (payload) => getMovedMemoryFixture(payload),
  delete_memory: returnNull,
  search_memories: returnEmptyList,
} satisfies Partial<PayloadCommandHandlers>

const AI_ARGUMENT_HANDLERS = {
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

const SESSION_SNAPSHOT_PAYLOAD_HANDLERS = {
  create_session_snapshot: () => getSnapshotCreatedIdFixture(),
} satisfies Partial<PayloadCommandHandlers>

const SESSION_SNAPSHOT_ARGUMENT_HANDLERS = {
  list_session_snapshots: () => getSnapshotListFixture(),
  get_session_snapshot: (argument) => getSnapshotStateFixture(argument.id),
  delete_session_snapshot: returnNull,
} satisfies Partial<ArgumentCommandHandlers>

const PAYLOAD_COMMAND_HANDLERS: PayloadCommandHandlers = {
  ...APP_PAYLOAD_HANDLERS,
  ...CONNECTION_PAYLOAD_HANDLERS,
  ...SCHEMA_PAYLOAD_HANDLERS,
  ...QUERY_PAYLOAD_HANDLERS,
  ...TABLE_DATA_PAYLOAD_HANDLERS,
  ...OBJECT_EDITOR_PAYLOAD_HANDLERS,
  ...DUMP_AND_IMPORT_PAYLOAD_HANDLERS,
  ...PROCESS_LIST_AND_HISTORY_PAYLOAD_HANDLERS,
  ...AI_PAYLOAD_HANDLERS,
  ...SESSION_SNAPSHOT_PAYLOAD_HANDLERS,
}

const ARGUMENT_COMMAND_HANDLERS: ArgumentCommandHandlers = {
  ...APP_ARGUMENT_HANDLERS,
  ...CONNECTION_ARGUMENT_HANDLERS,
  ...SCHEMA_ARGUMENT_HANDLERS,
  ...COPY_TO_HOST_ARGUMENT_HANDLERS,
  ...QUERY_ARGUMENT_HANDLERS,
  ...TABLE_DATA_ARGUMENT_HANDLERS,
  ...OBJECT_EDITOR_ARGUMENT_HANDLERS,
  ...DUMP_AND_IMPORT_ARGUMENT_HANDLERS,
  ...PROCESS_LIST_AND_HISTORY_ARGUMENT_HANDLERS,
  ...AI_ARGUMENT_HANDLERS,
  ...SESSION_SNAPSHOT_ARGUMENT_HANDLERS,
}

const PAYLOAD_HANDLERS_BY_COMMAND = new Map<string, ParsedCommandHandler>(
  Object.entries(PAYLOAD_COMMAND_HANDLERS)
)

const ARGUMENT_HANDLERS_BY_COMMAND = new Map<string, ParsedCommandHandler>(
  Object.entries(ARGUMENT_COMMAND_HANDLERS)
)

function isArgumentRecord(args: InvokeArgs | undefined): args is Record<string, unknown> {
  if (args === undefined) return false
  if (Array.isArray(args)) return false
  if (args instanceof ArrayBuffer) return false
  return !(args instanceof Uint8Array)
}

export function playwrightIpcMockHandler(command: string, invokeArgs?: InvokeArgs): unknown {
  const args = isArgumentRecord(invokeArgs) ? invokeArgs : undefined

  const payloadHandler = PAYLOAD_HANDLERS_BY_COMMAND.get(command)
  if (payloadHandler) return payloadHandler(args?.payload as never)

  const argumentHandler = ARGUMENT_HANDLERS_BY_COMMAND.get(command)
  if (argumentHandler) return argumentHandler(args as never)

  const pluginHandler = TAURI_PLUGIN_HANDLERS[command] ?? returnNull
  return pluginHandler(args)
}
