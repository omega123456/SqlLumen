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

function getPlaywrightUpdateOverride(): PlaywrightUpdateOverride | undefined {
  const playwrightGlobals = globalThis as typeof globalThis & {
    __PLAYWRIGHT_UPDATE_OVERRIDE__?: PlaywrightUpdateOverride
  }

  return playwrightGlobals.__PLAYWRIGHT_UPDATE_OVERRIDE__
}

function getMockUpdateMetadata(): Record<string, unknown> | null {
  const override = getPlaywrightUpdateOverride()
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

function getSchemaMetadataOverride(): SchemaMetadataResponse | undefined {
  const playwrightGlobals = globalThis as typeof globalThis & {
    __PLAYWRIGHT_SCHEMA_METADATA_OVERRIDE__?: SchemaMetadataResponse
  }

  return playwrightGlobals.__PLAYWRIGHT_SCHEMA_METADATA_OVERRIDE__
}

function getCommandPaletteRecentsValue(): string {
  const playwrightGlobals = globalThis as typeof globalThis & {
    __PLAYWRIGHT_COMMAND_PALETTE_RECENTS_OVERRIDE__?: string
  }

  return (
    playwrightGlobals.__PLAYWRIGHT_COMMAND_PALETTE_RECENTS_OVERRIDE__ ??
    getCommandPaletteRecentsFixture()
  )
}

function getSchemaMetadataDelayMs(): number {
  const playwrightGlobals = globalThis as typeof globalThis & {
    __PLAYWRIGHT_SCHEMA_METADATA_FULL_DELAY_MS__?: number
  }

  const candidate = playwrightGlobals.__PLAYWRIGHT_SCHEMA_METADATA_FULL_DELAY_MS__
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

/**
 * IPC handler for `mockIPC` when the app runs under Playwright (VITE_PLAYWRIGHT).
 * Returns stable, deterministic data so UI flows and visual snapshots do not flap.
 */
export function playwrightIpcMockHandler(command: string, args?: Record<string, unknown>): unknown {
  switch (command) {
    // --- Tauri event system (captures listener callback IDs for AI streaming) ---
    case 'plugin:event|listen': {
      const eventName = args?.event as string | undefined
      const handlerId = args?.handler as number | undefined
      if (eventName && typeof handlerId === 'number') {
        const ids = eventListenerCallbackIds.get(eventName) ?? []
        ids.push(handlerId)
        eventListenerCallbackIds.set(eventName, ids)
      }
      // Return the handler ID as the event ID (used by unlisten)
      return handlerId ?? null
    }
    case 'plugin:event|unlisten': {
      const eventName = args?.event as string | undefined
      const eventId = args?.eventId as number | undefined
      if (eventName && typeof eventId === 'number') {
        const ids = eventListenerCallbackIds.get(eventName)
        if (ids) {
          const index = ids.indexOf(eventId)
          if (index !== -1) ids.splice(index, 1)
        }
      }
      return null
    }

    // --- Tauri plugins: updater/process ---
    case 'plugin:updater|check':
      return getMockUpdateMetadata()
    case 'plugin:updater|download_and_install':
      emitUpdaterDownload(args, getStaticFixture('update').installChunkLengths)
      return null
    case 'plugin:updater|download':
      emitUpdaterDownload(args, getStaticFixture('update').downloadChunkLengths)
      return getStaticFixture('update').downloadRid
    case 'plugin:updater|install':
      return null
    case 'plugin:os|platform':
      return getStaticFixture('platform')
    case 'plugin:process|restart':
    case 'plugin:process|relaunch':
      return null

    // --- Settings ---
    case 'get_setting': {
      const key = args?.key as string
      if (key === COMMAND_PALETTE_RECENTS_SETTING_KEY) {
        return getCommandPaletteRecentsValue()
      }
      return getAiDefaultSettingFixture(key)
    }
    case 'set_setting':
      return null
    case 'get_all_settings':
      return {
        ...getStaticFixture('appSettings'),
        [COMMAND_PALETTE_RECENTS_SETTING_KEY]: getCommandPaletteRecentsValue(),
      }

    case 'log_frontend':
      return null
    case 'list_logs': {
      const page = Number((args as Record<string, unknown>)?.page ?? 1)
      const level = (args as Record<string, unknown>)?.level
      const normalizedLevel =
        typeof level === 'string' && PLAYWRIGHT_LOG_LEVEL_FILTERS.includes(level as LogLevelFilter)
          ? (level as LogLevelFilter)
          : 'all'
      return getLogsPageFixture(page, normalizedLevel)
    }
    case 'export_logs': {
      const startTimestamp = (args as Record<string, unknown>)?.startTimestamp
      const endTimestamp = (args as Record<string, unknown>)?.endTimestamp
      return getExportLogsFixture(
        typeof startTimestamp === 'string' ? startTimestamp : '',
        typeof endTimestamp === 'string' ? endTimestamp : ''
      )
    }

    // --- App info ---
    case 'get_app_info':
      return getStaticFixture('appInfo')

    // --- Window chrome ---
    case 'set_window_theme':
    case 'plugin:webview|set_webview_zoom':
      return null
    case 'get_window_backdrop':
      return getWindowBackdropFixture()

    // --- Connection management ---
    case 'list_connections':
      return [getStaticFixture('savedConnection')]
    case 'list_connection_groups':
      return []
    case 'list_open_connection_sessions':
      return getOpenConnectionSessionsFixture()
    case 'open_connection':
      activeMockDatabase = defaultMockDatabase()
      return {
        sessionId: allocatePlaywrightSessionId(),
        serverVersion: getStaticFixture('serverVersion'),
      }
    case 'select_database':
      activeMockDatabase =
        ((args as Record<string, unknown>)?.databaseName as string | null) ?? null
      return null
    case 'test_connection':
      return getStaticFixture('testConnection')
    case 'save_connection':
      return getStaticFixture('newConnectionId')
    case 'update_connection':
      return null
    case 'delete_connection':
      return null
    case 'get_connection':
      return getStaticFixture('savedConnection')
    case 'create_connection_group':
      return getStaticFixture('newConnectionGroupId')
    case 'update_connection_group':
      return null
    case 'delete_connection_group':
      return null
    case 'close_connection':
      return null
    case 'get_connection_status':
      return 'connected'
    case 'load_schema_cache_snapshot':
      return null
    case 'save_schema_cache_snapshot':
      return null

    // --- Schema read commands ---
    case 'list_databases':
      return getTargetDatabasesFixture()
    case 'list_copyable_objects': {
      const database = (args as Record<string, unknown>)?.database
      return getCopyableObjectsFixture(typeof database === 'string' ? database : undefined)
    }
    case 'list_schema_objects': {
      const objectType = (args as Record<string, unknown>)?.objectType
      return getSchemaObjectsFixture(typeof objectType === 'string' ? objectType : undefined)
    }
    case 'list_columns': {
      const table = (args as Record<string, unknown>)?.table
      return getColumnsFixture(typeof table === 'string' ? table : undefined)
    }
    case 'get_schema_info': {
      const objectType = (args as Record<string, unknown>)?.objectType ?? 'table'
      return getSchemaInfoFixture(String(objectType))
    }
    case 'get_database_details':
      return getStaticFixture('databaseDetails')
    case 'list_charsets':
      return getStaticFixture('charsets')
    case 'list_collations':
      return getStaticFixture('collations')

    // --- Copy to another host ---
    case 'start_copy_to_host':
      return getCopyToHostStartFixture()
    case 'get_copy_progress': {
      const jobId = (args as Record<string, unknown>)?.jobId
      return getCopyProgressFixture(typeof jobId === 'string' ? jobId : undefined)
    }
    case 'cancel_copy': {
      const jobId = (args as Record<string, unknown>)?.jobId
      return getCancelCopyFixture(typeof jobId === 'string' ? jobId : undefined)
    }

    // --- Table designer ---
    case 'load_table_for_designer':
      return getStaticFixture('tableDesignerSchema')
    case 'generate_table_ddl': {
      const request = (args as Record<string, unknown>)?.request as { mode?: string } | undefined
      return getTableDdlPreviewFixture(request?.mode)
    }
    case 'apply_table_ddl':
      return undefined

    // --- Schema mutating commands ---
    case 'create_database':
    case 'drop_database':
    case 'alter_database':
    case 'rename_database':
    case 'drop_table':
    case 'truncate_table':
    case 'rename_table':
    case 'invalidate_metadata_cache':
      return null

    // --- Query execution ---
    case 'execute_query': {
      // Support error simulation for Playwright tests
      if (
        typeof window !== 'undefined' &&
        (window as unknown as Record<string, unknown>).__mockQueryError__
      ) {
        throw new Error(getStaticFixture('querySimulation').errorMessage)
      }

      // Build the windowed result for this request (used for both immediate and delayed paths)
      const result = executeQueryFixture({
        tabId: String(args?.tabId ?? ''),
        sql: String(args?.sql ?? ''),
        activeMockDb: activeMockDatabase,
        viewSpec: (args?.viewSpec as Parameters<typeof executeQueryFixture>[0]['viewSpec']) ?? null,
      })

      // Support configurable delay for Playwright E2E tests (running indicator + cancel flow)
      if (typeof window !== 'undefined') {
        const delay = (window as unknown as Record<string, unknown>).__mockQueryDelay__
        if (delay && typeof delay === 'number' && delay > 0) {
          return new Promise((resolve, reject) => {
            ;(window as unknown as Record<string, unknown>).__pendingQueryReject__ = reject
            setTimeout(() => {
              ;(window as unknown as Record<string, unknown>).__pendingQueryReject__ = null
              resolve(result)
            }, delay)
          })
        }
      }

      return result
    }

    // Windowed results: fixture data and view/window logic live in the registry.
    case 'execute_multi_query':
      return executeMultiQueryFixture({ tabId: String(args?.tabId ?? '') })

    case 'execute_call_query':
      return executeCallQueryFixture({
        tabId: String(args?.tabId ?? ''),
        sql: String(args?.sql ?? ''),
      })

    case 'reexecute_single_result':
      return reexecuteSingleResultFixture({
        tabId: String(args?.tabId ?? ''),
        resultIndex: Number(args?.resultIndex ?? 0),
        sql: String(args?.sql ?? 'SELECT 1'),
        viewSpec:
          (args?.viewSpec as Parameters<typeof reexecuteSingleResultFixture>[0]['viewSpec']) ??
          null,
      })

    case 'set_result_view':
      return setResultViewFixture(args as unknown as Parameters<typeof setResultViewFixture>[0])

    case 'fetch_result_window':
      return fetchResultWindowFixture(
        args as unknown as Parameters<typeof fetchResultWindowFixture>[0]
      )

    case 'remove_result_rows':
      return removeResultRowsFixture(
        args as unknown as Parameters<typeof removeResultRowsFixture>[0]
      )

    case 'evict_results':
      return null

    case 'cancel_query': {
      if (typeof window !== 'undefined') {
        const pendingReject = (window as unknown as Record<string, unknown>)
          .__pendingQueryReject__ as ((reason: Error) => void) | null
        if (pendingReject) {
          // Clear the reference BEFORE calling reject to prevent recursive issues
          ;(window as unknown as Record<string, unknown>).__pendingQueryReject__ = null
          pendingReject(new Error(getStaticFixture('querySimulation').cancelledMessage))
        }
      }
      return true
    }

    case 'analyze_query_for_edit':
      return getAnalyzeQueryForEditFixture(args?.sql as string | null | undefined)

    case 'update_result_cell':
      return null

    case 'touch_results':
      return { status: 'available' }

    case 'export_results':
      return getStaticFixture('exportResults')

    case 'start_result_export':
      return getResultExportStartFixture()

    case 'get_result_export_progress':
      return getResultExportProgressFixture(args?.jobId as string | null | undefined)

    case 'cancel_result_export':
      return getCancelResultExportFixture(args?.jobId as string | null | undefined)

    case 'fetch_schema_metadata':
      return getSchemaMetadataOverride() ?? getStaticFixture('schemaMetadata')

    case 'fetch_schema_metadata_full': {
      const fixtureMetadata = getSchemaMetadataFullFixture()
      const baseMetadata = getSchemaMetadataOverride()
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

    // --- Table data browser/editor ---
    case 'fetch_table_data': {
      const payload = args?.payload as Record<string, unknown> | undefined
      return getTableDataFixture(String(payload?.table))
    }

    case 'touch_table_data':
      return { status: 'available' }

    case 'evict_table_data':
      return null

    case 'restore_table_data_cache': {
      const table = (args as Record<string, unknown>)?.table
      return {
        status: 'available',
        data: getTableDataFixture(String(table)),
      }
    }

    case 'get_table_foreign_keys': {
      const table = (args as Record<string, unknown>)?.table
      return getForeignKeysFixture(String(table))
    }

    case 'sync_table_data_cache_after_insert':
    case 'sync_table_data_cache_after_update':
    case 'sync_table_data_cache_after_delete': {
      const payload = args?.payload as Record<string, unknown> | undefined
      void getTableDataFixture(String(payload?.table))
      return { status: 'synced' }
    }

    case 'update_table_row':
      return null

    case 'insert_table_row':
      return getStaticFixture('insertedRow')

    case 'delete_table_row':
      return null

    case 'export_table_data':
      return null

    case 'fetch_blob_value': {
      const column = (args as Record<string, unknown>)?.column
      return getBlobValueFixture(String(column))
    }

    case 'read_file_bytes':
      // Default: same 1x1 PNG bytes the blob fixture serves, base64-encoded.
      return getBlobValueFixture('default').base64 ?? ''

    case 'write_file_bytes':
      return null

    // --- Object editor commands (Phase 8) ---
    case 'get_object_body': {
      const objectType = (args as Record<string, unknown>)?.objectType as string | undefined
      return getObjectBodyFixture(objectType)
    }

    case 'save_object':
      return getStaticFixture('savedObject')

    case 'drop_object':
      return undefined

    case 'get_routine_parameters':
      return getStaticFixture('routineParameters')

    case 'get_routine_parameters_with_return_type': {
      const rtType = (args as Record<string, unknown>)?.routineType
      return getRoutineParamsFixture(String(rtType))
    }

    case 'read_file':
      return getStaticFixture('openedFileContent')

    case 'write_file':
      return null

    // --- SQL Dump Export (Phase 9.5a) ---
    case 'list_exportable_objects':
      return getStaticFixture('exportableDatabases')

    case 'start_sql_dump':
      return getStaticFixture('sqlDumpJobId')

    case 'get_dump_progress': {
      const jobId = (args as Record<string, unknown>)?.jobId
      return getSqlDumpProgressFixture(typeof jobId === 'string' ? jobId : undefined)
    }

    case 'cancel_dump':
      return null

    // --- SQL Import (Phase 9.5b) ---
    case 'start_sql_import':
      return getStaticFixture('sqlImportJobId')

    case 'get_import_progress': {
      const jobId = (args as Record<string, unknown>)?.jobId
      return getSqlImportProgressFixture(typeof jobId === 'string' ? jobId : undefined)
    }

    case 'cancel_import':
      return null

    // --- Process List ---
    case 'get_processlist':
      return getStaticFixture('processList')

    case 'kill_queries': {
      const ids = (args as Record<string, unknown>)?.ids as number[] | undefined
      return (ids ?? []).map((id: number) => ({ id: id, success: true, error: null }))
    }

    // --- Query History & Favorites (Phase 9.3) ---
    case 'list_history':
      return getStaticFixture('historyPage')

    case 'delete_history_entry':
      return true

    case 'clear_history':
      return getStaticFixture('historyPage').total

    case 'create_favorite':
      return getStaticFixture('createdFavoriteId')

    case 'list_favorites':
      return getStaticFixture('favorites')

    case 'update_favorite':
      return true

    case 'delete_favorite':
      return true

    // --- AI commands ---
    case 'ai_chat': {
      const request = args?.request as { streamId?: string } | undefined
      const streamId = request?.streamId ?? getStaticFixture('aiChat').fallbackStreamId

      if (
        typeof window !== 'undefined' &&
        (window as unknown as Record<string, unknown>).__mockAiError__
      ) {
        scheduleAiStreamError(streamId)
        return null
      }

      if (
        typeof window !== 'undefined' &&
        (window as unknown as Record<string, unknown>).__mockAiThinking__
      ) {
        scheduleAiThinkingStream(streamId)
        return null
      }

      scheduleAiContentStream(streamId, AI_STREAM_START_DELAY_MS)
      return null
    }

    case 'ai_cancel':
      return null

    case 'list_ai_models':
      return {
        models: getAiModelsFixture(args?.endpoint as string | null | undefined),
      }

    case 'ai_query_expand':
      return getStaticFixture('aiQueryExpansion')

    // --- Schema index commands ---
    case 'build_schema_index':
      return null
    case 'force_rebuild_schema_index':
      return null
    case 'semantic_search':
      return getStaticFixture('semanticSearchResults')
    case 'get_index_status':
      return getStaticFixture('schemaIndexStatus')
    case 'invalidate_schema_index':
      return null
    case 'list_indexed_tables':
      return []

    // --- AI Memory commands ---
    case 'save_memory':
      return getSavedMemoryFixture(args)
    case 'list_global_memories':
      return getGlobalMemoriesFixture()
    case 'list_group_memories':
      return getGroupMemoriesFixture((args as Record<string, unknown>)?.groupId as string | null)
    case 'list_connection_memories':
      return getConnectionMemoriesFixture(
        (args as Record<string, unknown>)?.connectionId as string | null
      )
    case 'move_memory':
      return getMovedMemoryFixture(args)
    case 'delete_memory':
      return null
    case 'search_memories':
      return []
    case 'reembed_all_memories':
      return null

    // --- Session snapshots ---
    case 'create_session_snapshot':
      return getSnapshotCreatedIdFixture()
    case 'list_session_snapshots':
      return getSnapshotListFixture()
    case 'get_session_snapshot':
      return getSnapshotStateFixture((args as Record<string, unknown>)?.id as number | null)
    case 'delete_session_snapshot':
      return null

    default:
      return null
  }
}
