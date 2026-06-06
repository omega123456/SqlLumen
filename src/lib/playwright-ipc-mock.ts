import type { SavedConnection } from '../types/connection'
import type { SchemaMetadataResponse, SchemaMetadataFull } from '../types/schema'
import {
  getAiModelsFixture,
  getAnalyzeQueryForEditFixture,
  getBlobValueFixture,
  getCancelCopyFixture,
  getCopyableObjectsFixture,
  getCopyProgressFixture,
  getCopyToHostStartFixture,
  getCachedRowsFixture,
  getColumnsFixture,
  getConnectionMemoriesFixture,
  getForeignKeysFixture,
  getGlobalMemoriesFixture,
  getGroupMemoriesFixture,
  getMovedMemoryFixture,
  getSavedMemoryFixture,
  getObjectBodyFixture,
  getQueryResultFixture,
  getRoutineParamsFixture,
  getSchemaInfoFixture,
  getSnapshotCreatedIdFixture,
  getSnapshotListFixture,
  getSnapshotStateFixture,
  getTableDataFixture,
  getTargetDatabasesFixture,
} from '../tests/playwright-fixtures'

const MOCK_TS = '2025-01-01T00:00:00.000Z'

/** Deterministic saved profile for Playwright / VITE_PLAYWRIGHT browser runs. */
export const PLAYWRIGHT_MOCK_CONNECTION: SavedConnection = {
  id: 'conn-playwright-1',
  name: 'Sample MySQL',
  host: '127.0.0.1',
  port: 3306,
  username: 'appuser',
  hasPassword: true,
  defaultDatabase: 'ecommerce_db',
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
  createdAt: MOCK_TS,
  updatedAt: MOCK_TS,
}

let activeMockDatabase: string | null = PLAYWRIGHT_MOCK_CONNECTION.defaultDatabase

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
    internals.runCallback(id, { event: eventName, payload })
  }
}

/** The pre-defined AI mock response containing a SQL code block. */
const AI_MOCK_RESPONSE =
  "Here's a query to help you:\n\n```sql\nSELECT * FROM users WHERE active = 1;\n```\n\nThis query filters for active users."

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
  const w = globalThis as typeof globalThis & {
    __PLAYWRIGHT_UPDATE_OVERRIDE__?: PlaywrightUpdateOverride
  }

  return w.__PLAYWRIGHT_UPDATE_OVERRIDE__
}

function getMockUpdateMetadata(): Record<string, unknown> | null {
  const override = getPlaywrightUpdateOverride()
  if (!override?.available) {
    return null
  }

  return {
    rid: 101,
    currentVersion: override.currentVersion ?? '0.1.0',
    version: override.version ?? '0.2.0',
    date: override.date ?? MOCK_TS,
    body: override.body ?? 'Mock SqlLumen update for Playwright flows.',
    rawJson: override.rawJson ?? null,
  }
}

function emitUpdaterEvent(args: Record<string, unknown> | undefined, payload: unknown): void {
  const onEvent = args?.onEvent as { onmessage?: (payload: unknown) => void } | undefined
  onEvent?.onmessage?.(payload)
}

function getSchemaMetadataOverride(): SchemaMetadataResponse | undefined {
  const w = globalThis as typeof globalThis & {
    __PLAYWRIGHT_SCHEMA_METADATA_OVERRIDE__?: SchemaMetadataResponse
  }

  return w.__PLAYWRIGHT_SCHEMA_METADATA_OVERRIDE__
}

/**
 * IPC handler for `mockIPC` when the app runs under Playwright (VITE_PLAYWRIGHT).
 * Returns stable, deterministic data so UI flows and visual snapshots do not flap.
 */
export function playwrightIpcMockHandler(cmd: string, args?: Record<string, unknown>): unknown {
  switch (cmd) {
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
          const idx = ids.indexOf(eventId)
          if (idx !== -1) ids.splice(idx, 1)
        }
      }
      return null
    }

    // --- Tauri plugins: updater/process ---
    case 'plugin:updater|check':
      return getMockUpdateMetadata()
    case 'plugin:updater|download_and_install':
      emitUpdaterEvent(args, { event: 'Started', data: { contentLength: 100 } })
      emitUpdaterEvent(args, { event: 'Progress', data: { chunkLength: 50 } })
      emitUpdaterEvent(args, { event: 'Progress', data: { chunkLength: 50 } })
      emitUpdaterEvent(args, { event: 'Finished' })
      return null
    case 'plugin:updater|download':
      emitUpdaterEvent(args, { event: 'Started', data: { contentLength: 100 } })
      emitUpdaterEvent(args, { event: 'Progress', data: { chunkLength: 100 } })
      emitUpdaterEvent(args, { event: 'Finished' })
      return 201
    case 'plugin:updater|install':
      return null
    case 'plugin:os|platform':
      return 'linux'
    case 'plugin:process|restart':
    case 'plugin:process|relaunch':
      return null

    // --- Settings ---
    case 'get_setting': {
      const key = args?.key as string
      // Return AI defaults for AI-related keys
      const AI_DEFAULTS: Record<string, string> = {
        'ai.enabled': 'false',
        'ai.endpoint': '',
        'ai.model': '',
        'ai.embeddingModel': '',
        'ai.temperature': '0.3',
        'ai.maxTokens': '2048',
        'ai.enableReasoning': 'false',
        'ai.preferResponsesApi': 'false',
      }
      if (key in AI_DEFAULTS) return AI_DEFAULTS[key]
      return null
    }
    case 'set_setting':
      return null
    case 'get_all_settings':
      return {
        theme: 'system',
        'log.level': 'info',
        'session.restore': 'true',
        'editor.fontFamily': 'JetBrains Mono',
        'editor.fontSize': '14',
        'editor.lineHeight': '1.6',
        'editor.wordWrap': 'false',
        'editor.minimap': 'false',
        'editor.lineNumbers': 'true',
        'editor.autocompleteBackticks': 'false',
        'results.pageSize': '500',
        'results.nullDisplay': 'NULL',
        'results.tableTabsInBottomPanel': 'false',
        'connection.defaultTimeout': '10',
        'connection.defaultKeepalive': '60',
        shortcuts: '{}',
        'session.state': 'null',
        'ai.enabled': 'false',
        'ai.endpoint': '',
        'ai.model': '',
        'ai.embeddingModel': '',
        'ai.temperature': '0.3',
        'ai.maxTokens': '2048',
        'ai.enableReasoning': 'false',
        'ai.preferResponsesApi': 'false',
      }

    case 'log_frontend':
      return null

    // --- App info ---
    case 'get_app_info':
      return { rustLogOverride: false, logDirectory: '/mock/app/logs', appVersion: '0.1.0' }

    // --- Connection management ---
    case 'list_connections':
      return [PLAYWRIGHT_MOCK_CONNECTION]
    case 'list_connection_groups':
      return []
    case 'open_connection':
      activeMockDatabase = PLAYWRIGHT_MOCK_CONNECTION.defaultDatabase
      return { sessionId: allocatePlaywrightSessionId(), serverVersion: '8.0.33-mock' }
    case 'select_database':
      activeMockDatabase =
        ((args as Record<string, unknown>)?.databaseName as string | null) ?? null
      return null
    case 'test_connection':
      return {
        success: true,
        serverVersion: '8.0.33-mock',
        authMethod: 'caching_sha2_password',
        sslStatus: 'Disabled',
        connectionTimeMs: 12,
        errorMessage: null,
      }
    case 'save_connection':
      return 'conn-playwright-new'
    case 'update_connection':
      return null
    case 'delete_connection':
      return null
    case 'get_connection':
      return PLAYWRIGHT_MOCK_CONNECTION
    case 'create_connection_group':
      return 'grp-playwright-new'
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
      switch (objectType) {
        case 'table':
          return ['users', 'orders', 'products', 'bit_test']
        case 'view':
          return ['user_stats_view']
        case 'procedure':
          return ['sp_get_orders']
        case 'function':
          return ['fn_calculate_total']
        case 'trigger':
          return ['trg_before_insert']
        case 'event':
          return []
        default:
          return []
      }
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
      return {
        name: 'ecommerce_db',
        defaultCharacterSet: 'utf8mb4',
        defaultCollation: 'utf8mb4_general_ci',
      }
    case 'list_charsets':
      return [
        {
          charset: 'utf8mb4',
          description: 'UTF-8 Unicode',
          defaultCollation: 'utf8mb4_general_ci',
          maxLength: 4,
        },
      ]
    case 'list_collations':
      return [{ name: 'utf8mb4_general_ci', charset: 'utf8mb4', isDefault: true }]

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
      return {
        tableName: 'users',
        columns: [
          {
            name: 'id',
            type: 'BIGINT',
            typeModifier: 'UNSIGNED',
            length: '20',
            nullable: false,
            isPrimaryKey: true,
            isAutoIncrement: true,
            defaultValue: { tag: 'NO_DEFAULT' },
            comment: '',
            originalName: 'id',
          },
          {
            name: 'username',
            type: 'VARCHAR',
            length: '64',
            nullable: false,
            isPrimaryKey: false,
            isAutoIncrement: false,
            defaultValue: { tag: 'NO_DEFAULT' },
            comment: '',
            originalName: 'username',
          },
          {
            name: 'email',
            type: 'VARCHAR',
            length: '255',
            nullable: true,
            isPrimaryKey: false,
            isAutoIncrement: false,
            defaultValue: { tag: 'NULL_DEFAULT' },
            comment: '',
            originalName: 'email',
          },
          {
            name: 'status',
            type: 'VARCHAR',
            length: '50',
            nullable: false,
            isPrimaryKey: false,
            isAutoIncrement: false,
            defaultValue: { tag: 'LITERAL', value: 'active' },
            comment: 'Account status',
            originalName: 'status',
          },
          {
            name: 'created_at',
            type: 'DATETIME',
            length: '',
            nullable: true,
            isPrimaryKey: false,
            isAutoIncrement: false,
            defaultValue: { tag: 'EXPRESSION', value: 'CURRENT_TIMESTAMP' },
            comment: 'Row creation timestamp',
            originalName: 'created_at',
          },
        ],
        indexes: [
          {
            name: 'PRIMARY',
            indexType: 'PRIMARY',
            columns: ['id'],
          },
          {
            name: 'uk_username',
            indexType: 'UNIQUE',
            columns: ['username'],
          },
        ],
        foreignKeys: [
          {
            name: 'fk_orders_user',
            sourceColumn: 'id',
            referencedTable: 'roles',
            referencedColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'NO ACTION',
            isComposite: false,
          },
          {
            name: 'fk_composite_example',
            sourceColumn: 'id',
            referencedTable: 'composite_table',
            referencedColumn: 'id',
            onDelete: 'NO ACTION',
            onUpdate: 'NO ACTION',
            isComposite: true,
          },
        ],
        properties: {
          engine: 'InnoDB',
          charset: 'utf8mb4',
          collation: 'utf8mb4_unicode_ci',
          autoIncrement: 1,
          rowFormat: 'DYNAMIC',
          comment: 'User accounts table',
        },
      }
    case 'generate_table_ddl': {
      const request = (args as Record<string, unknown>)?.request as { mode?: string } | undefined

      if (request?.mode === 'create') {
        return {
          ddl: 'CREATE TABLE `mock_db`.`__new_table__` (\n  `id` BIGINT(20) NOT NULL AUTO_INCREMENT,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;',
          warnings: [],
        }
      }

      return {
        ddl: 'ALTER TABLE `mock_db`.`users`\n  MODIFY COLUMN `email` VARCHAR(320) NOT NULL;',
        warnings: [],
      }
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
        throw new Error("Table 'app_db.nonexistent' doesn't exist")
      }

      // Build the result for this request (used for both immediate and delayed paths)
      const result = getQueryResultFixture(String(args?.sql ?? ''), activeMockDatabase)

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

    case 'execute_multi_query':
      return {
        results: [
          {
            queryId: 'mock-multi-q1',
            sourceSql: 'SELECT id, name FROM users',
            columns: [
              { name: 'id', dataType: 'BIGINT' },
              { name: 'name', dataType: 'VARCHAR' },
            ],
            totalRows: 2,
            executionTimeMs: 15,
            totalTimeMs: 19,
            affectedRows: 0,
            rows: [
              [1, 'Alice'],
              [2, 'Bob'],
            ],

            autoLimitApplied: false,
            error: null,
            reExecutable: true,
          },
          {
            queryId: 'mock-multi-q2',
            sourceSql: 'SELECT product_id, price FROM products',
            columns: [
              { name: 'product_id', dataType: 'INT' },
              { name: 'price', dataType: 'DECIMAL' },
            ],
            totalRows: 2,
            executionTimeMs: 8,
            totalTimeMs: 11,
            affectedRows: 0,
            rows: [
              [101, '29.99'],
              [102, '49.99'],
            ],

            autoLimitApplied: false,
            error: null,
            reExecutable: true,
          },
          {
            queryId: 'mock-multi-q3',
            sourceSql: "UPDATE users SET status = 'active' WHERE id = 1",
            columns: [],
            totalRows: 0,
            executionTimeMs: 3,
            totalTimeMs: 3,
            affectedRows: 1,
            rows: [],

            autoLimitApplied: false,
            error: null,
            reExecutable: true,
          },
        ],
      }

    case 'execute_call_query':
      return {
        results: [
          {
            queryId: 'mock-call-q1',
            sourceSql: 'CALL sp_get_orders()',
            columns: [
              { name: 'order_id', dataType: 'INT' },
              { name: 'total', dataType: 'DECIMAL' },
            ],
            totalRows: 2,
            executionTimeMs: 20,
            totalTimeMs: 26,
            affectedRows: 0,
            rows: [
              [1, '150.00'],
              [2, '230.50'],
            ],

            autoLimitApplied: false,
            error: null,
            reExecutable: false,
          },
          {
            queryId: 'mock-call-q2',
            sourceSql: 'CALL sp_get_orders()',
            columns: [
              { name: 'summary_key', dataType: 'VARCHAR' },
              { name: 'summary_value', dataType: 'INT' },
            ],
            totalRows: 1,
            executionTimeMs: 5,
            totalTimeMs: 7,
            affectedRows: 0,
            rows: [['total_orders', 42]],

            autoLimitApplied: false,
            error: null,
            reExecutable: false,
          },
        ],
      }

    case 'reexecute_single_result':
      return {
        queryId: 'mock-reexec-q1',
        sourceSql: String(args?.sql ?? 'SELECT 1'),
        columns: [
          { name: 'id', dataType: 'BIGINT' },
          { name: 'name', dataType: 'VARCHAR' },
        ],
        totalRows: 2,
        executionTimeMs: 10,
        totalTimeMs: 13,
        affectedRows: 0,
        rows: [
          [1, 'Alice'],
          [2, 'Bob'],
        ],
        autoLimitApplied: false,
        error: null,
        reExecutable: true,
      }

    case 'fetch_cached_rows': {
      const cachedRows = getCachedRowsFixture(
        typeof args?.queryId === 'string' ? args.queryId : null,
        typeof args?.resultIndex === 'number' ? args.resultIndex : null
      )
      return {
        rows: cachedRows.rows,
        columns: cachedRows.columns,
      }
    }

    case 'evict_results':
      return null

    case 'cancel_query': {
      if (typeof window !== 'undefined') {
        const pendingReject = (window as unknown as Record<string, unknown>)
          .__pendingQueryReject__ as ((reason: Error) => void) | null
        if (pendingReject) {
          // Clear the reference BEFORE calling reject to prevent recursive issues
          ;(window as unknown as Record<string, unknown>).__pendingQueryReject__ = null
          pendingReject(new Error('Query execution was interrupted (cancelled by mock)'))
        }
      }
      return true
    }

    case 'sort_results':
      // Returns SortedRowsResult shape (rows only)
      return {
        rows: [
          [1005, 'Alex Chen', 'alex.c@datacraft.net', 'active', null],
          [1002, 'Elena Vance', 'vance.e@techcorp.com', 'active', '2024-02-20T14:22:00'],
          [1001, 'Julian Thorne', 'j.thorne@example.com', 'active', '2024-01-15T10:30:00'],
          [1003, 'Marcus Reed', null, 'inactive', '2024-03-05T09:15:00'],
          [1004, 'Sarah Kim', 's.kim@devtools.co', null, '2024-04-12T16:45:00'],
        ],
      }

    case 'analyze_query_for_edit':
      return getAnalyzeQueryForEditFixture(args?.sql as string | null | undefined)

    case 'update_result_cell':
      return null

    case 'touch_results':
      return { status: 'available' }

    case 'export_results':
      return { bytesWritten: 1024, rowsExported: 5 }

    case 'fetch_schema_metadata':
      return (
        getSchemaMetadataOverride() ?? {
          databases: ['ecommerce_db', 'analytics_db', 'staging_db'],
          tables: {
            ecommerce_db: [
              {
                name: 'users',
                engine: 'InnoDB',
                charset: 'utf8mb4',
                rowCount: 1000,
                dataSize: 1048576,
              },
              {
                name: 'orders',
                engine: 'InnoDB',
                charset: 'utf8mb4',
                rowCount: 5000,
                dataSize: 2097152,
              },
              {
                name: 'products',
                engine: 'InnoDB',
                charset: 'utf8mb4',
                rowCount: 200,
                dataSize: 524288,
              },
              {
                name: 'bit_test',
                engine: 'InnoDB',
                charset: 'utf8mb4',
                rowCount: 4,
                dataSize: 16384,
              },
            ],
            analytics_db: [
              {
                name: 'events',
                engine: 'InnoDB',
                charset: 'utf8mb4',
                rowCount: 50000,
                dataSize: 8388608,
              },
            ],
          },
          columns: {
            'ecommerce_db.users': [
              { name: 'id', dataType: 'BIGINT' },
              { name: 'name', dataType: 'VARCHAR' },
              { name: 'email', dataType: 'VARCHAR' },
              { name: 'status', dataType: 'VARCHAR' },
              { name: 'created_at', dataType: 'DATETIME' },
            ],
            'ecommerce_db.orders': [
              { name: 'id', dataType: 'BIGINT' },
              { name: 'user_id', dataType: 'BIGINT' },
              { name: 'status', dataType: 'VARCHAR' },
              { name: 'total', dataType: 'DECIMAL' },
            ],
            'ecommerce_db.bit_test': [
              { name: 'id', dataType: 'INT' },
              { name: 'is_active', dataType: 'BIT' },
              { name: 'flags', dataType: 'BIT' },
              { name: 'label', dataType: 'VARCHAR' },
            ],
            'analytics_db.events': [
              { name: 'id', dataType: 'BIGINT' },
              { name: 'event_name', dataType: 'VARCHAR' },
              { name: 'user_id', dataType: 'BIGINT' },
              { name: 'created_at', dataType: 'DATETIME' },
            ],
          },
          routines: {
            ecommerce_db: [
              { name: 'sp_get_orders', routineType: 'PROCEDURE' },
              { name: 'fn_calculate_total', routineType: 'FUNCTION' },
            ],
          },
        }
      )

    case 'fetch_schema_metadata_full': {
      const baseMetadata = getSchemaMetadataOverride()
      const fullMetadata: SchemaMetadataFull = {
        databases: baseMetadata?.databases ?? ['ecommerce_db', 'analytics_db', 'staging_db'],
        tables: baseMetadata?.tables ?? {
          ecommerce_db: [
            {
              name: 'users',
              engine: 'InnoDB',
              charset: 'utf8mb4',
              rowCount: 1000,
              dataSize: 1048576,
            },
            {
              name: 'orders',
              engine: 'InnoDB',
              charset: 'utf8mb4',
              rowCount: 5000,
              dataSize: 2097152,
            },
            {
              name: 'products',
              engine: 'InnoDB',
              charset: 'utf8mb4',
              rowCount: 200,
              dataSize: 524288,
            },
            {
              name: 'bit_test',
              engine: 'InnoDB',
              charset: 'utf8mb4',
              rowCount: 4,
              dataSize: 16384,
            },
          ],
          analytics_db: [
            {
              name: 'events',
              engine: 'InnoDB',
              charset: 'utf8mb4',
              rowCount: 50000,
              dataSize: 8388608,
            },
          ],
        },
        columns: baseMetadata?.columns ?? {
          'ecommerce_db.users': [
            { name: 'id', dataType: 'BIGINT' },
            { name: 'name', dataType: 'VARCHAR' },
            { name: 'email', dataType: 'VARCHAR' },
            { name: 'status', dataType: 'VARCHAR' },
            { name: 'created_at', dataType: 'DATETIME' },
          ],
          'ecommerce_db.orders': [
            { name: 'id', dataType: 'BIGINT' },
            { name: 'user_id', dataType: 'BIGINT' },
            { name: 'status', dataType: 'VARCHAR' },
            { name: 'total', dataType: 'DECIMAL' },
          ],
          'ecommerce_db.bit_test': [
            { name: 'id', dataType: 'INT' },
            { name: 'is_active', dataType: 'BIT' },
            { name: 'flags', dataType: 'BIT' },
            { name: 'label', dataType: 'VARCHAR' },
          ],
          'analytics_db.events': [
            { name: 'id', dataType: 'BIGINT' },
            { name: 'event_name', dataType: 'VARCHAR' },
            { name: 'user_id', dataType: 'BIGINT' },
            { name: 'created_at', dataType: 'DATETIME' },
          ],
        },
        routines: baseMetadata?.routines ?? {
          ecommerce_db: [
            { name: 'sp_get_orders', routineType: 'PROCEDURE' },
            { name: 'fn_calculate_total', routineType: 'FUNCTION' },
          ],
        },
        foreignKeys: {},
        indexes: {},
      }
      return fullMetadata
    }

    // --- Table data browser/editor ---
    case 'fetch_table_data': {
      const table = (args as Record<string, unknown>)?.table
      void (args as Record<string, unknown>)?.tabId
      return getTableDataFixture(String(table))
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
      const table = (args as Record<string, unknown>)?.table
      void getTableDataFixture(String(table))
      return { status: 'synced' }
    }

    case 'update_table_row':
      return null

    case 'insert_table_row':
      return [
        ['id', 1005],
        ['name', ''],
        ['email', null],
        ['status', 'active'],
        ['created_at', null],
        ['updated_at', null],
        ['birth_date', null],
        ['login_time', null],
      ]

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
      return {
        success: true,
        errorMessage: null,
        dropSucceeded: true,
        savedObjectName: 'mock_object',
      }

    case 'drop_object':
      return undefined

    case 'get_routine_parameters':
      return [
        { name: 'p_id', dataType: 'int', mode: 'IN', ordinalPosition: 1 },
        { name: 'p_result', dataType: 'varchar(255)', mode: 'OUT', ordinalPosition: 2 },
      ]

    case 'get_routine_parameters_with_return_type': {
      const rtType = (args as Record<string, unknown>)?.routineType
      return getRoutineParamsFixture(String(rtType))
    }

    case 'read_file':
      return "SELECT * FROM users\nWHERE status = 'active'\nLIMIT 100;"

    case 'write_file':
      return null

    // --- SQL Dump Export (Phase 9.5a) ---
    case 'list_exportable_objects':
      return [
        {
          name: 'ecommerce_db',
          tables: [
            { name: 'users', objectType: 'table', estimatedRows: 1000 },
            { name: 'orders', objectType: 'table', estimatedRows: 5000 },
            { name: 'products', objectType: 'table', estimatedRows: 200 },
            { name: 'bit_test', objectType: 'table', estimatedRows: 4 },
            { name: 'user_stats_view', objectType: 'view', estimatedRows: 0 },
          ],
        },
        {
          name: 'analytics_db',
          tables: [{ name: 'events', objectType: 'table', estimatedRows: 50000 }],
        },
      ]

    case 'start_sql_dump':
      return 'mock-dump-job-1'

    case 'get_dump_progress':
      return {
        jobId: String(args?.jobId ?? 'mock-dump-job-1'),
        status: 'completed',
        tablesTotal: 4,
        tablesDone: 4,
        currentTable: null,
        bytesWritten: 102400,
        rowsExported: 0,
        errorMessage: null,
        cancelRequested: false,
      }

    case 'cancel_dump':
      return null

    // --- SQL Import (Phase 9.5b) ---
    case 'start_sql_import':
      return 'mock-import-job-1'

    case 'get_import_progress':
      return {
        jobId: String(args?.jobId ?? 'mock-import-job-1'),
        status: 'running',
        statementsTotal: 42,
        statementsDone: 18,
        errors: [],
        stopOnError: true,
        cancelRequested: false,
      }

    case 'cancel_import':
      return null

    // --- Process List ---
    case 'get_processlist':
      return [
        {
          id: 1,
          user: 'root',
          host: 'localhost:3306',
          db: 'ecommerce_db',
          command: 'Query',
          time: 0,
          state: 'executing',
          info: "SELECT * FROM users WHERE status = 'active'",
        },
        {
          id: 2,
          user: 'appuser',
          host: '10.0.0.5:49152',
          db: 'ecommerce_db',
          command: 'Sleep',
          time: 120,
          state: 'Idle',
          info: 'SELECT SLEEP(120)',
        },
        {
          id: 3,
          user: 'repl_user',
          host: '10.0.0.10:52000',
          db: null,
          command: 'Binlog Dump',
          time: 86400,
          state: 'Master has sent all binlog to slave',
          info: null,
        },
        {
          id: 4,
          user: 'appuser',
          host: '10.0.0.5:49200',
          db: 'analytics_db',
          command: 'Query',
          time: 5,
          state: 'Sending data',
          info: 'SELECT COUNT(*) FROM events WHERE created_at > NOW() - INTERVAL 1 DAY',
        },
        {
          id: 5,
          user: 'admin',
          host: 'localhost:3307',
          db: 'ecommerce_db',
          command: 'Query',
          time: 42,
          state: 'Sorting result',
          info: 'SELECT o.*, u.name FROM orders o JOIN users u ON o.user_id = u.id ORDER BY o.created_at DESC LIMIT 1000',
        },
        {
          id: 6,
          user: 'root',
          host: 'localhost',
          db: null,
          command: 'Daemon',
          time: 0,
          state: 'Waiting for next activation',
          info: null,
        },
      ]

    case 'kill_queries': {
      const ids = (args as Record<string, unknown>)?.ids as number[] | undefined
      return (ids ?? []).map((id: number) => ({ id, success: true, error: null }))
    }

    // --- Query History & Favorites (Phase 9.3) ---
    case 'list_history':
      return {
        entries: [
          {
            id: 1,
            connectionId: 'conn-playwright-1',
            databaseName: 'ecommerce_db',
            sqlText: "SELECT * FROM users WHERE status = 'active'",
            timestamp: '2025-01-01T12:00:00.000Z',
            durationMs: 42,
            rowCount: 5,
            affectedRows: 0,
            success: true,
            errorMessage: null,
          },
          {
            id: 2,
            connectionId: 'conn-playwright-1',
            databaseName: 'ecommerce_db',
            sqlText: 'SELECT COUNT(*) FROM orders',
            timestamp: '2025-01-01T11:30:00.000Z',
            durationMs: 8,
            rowCount: 1,
            affectedRows: 0,
            success: true,
            errorMessage: null,
          },
          {
            id: 3,
            connectionId: 'conn-playwright-1',
            databaseName: 'ecommerce_db',
            sqlText: 'SELECT * FROM nonexistent_table',
            timestamp: '2025-01-01T11:00:00.000Z',
            durationMs: 0,
            rowCount: 0,
            affectedRows: 0,
            success: false,
            errorMessage: "Table 'ecommerce_db.nonexistent_table' doesn't exist",
          },
        ],
        total: 3,
        page: 1,
        pageSize: 50,
      }

    case 'delete_history_entry':
      return true

    case 'clear_history':
      return 3

    case 'create_favorite':
      return 1

    case 'list_favorites':
      return [
        {
          id: 1,
          name: 'Active Users',
          sqlText: "SELECT * FROM users WHERE status = 'active'",
          description: 'Frequently used query for monitoring',
          category: 'Monitoring',
          connectionId: 'conn-playwright-1',
          createdAt: '2025-01-01T10:00:00.000Z',
          updatedAt: '2025-01-01T10:00:00.000Z',
        },
        {
          id: 2,
          name: 'Order Summary',
          sqlText: 'SELECT status, COUNT(*) as cnt FROM orders GROUP BY status',
          description: null,
          category: null,
          connectionId: 'conn-playwright-1',
          createdAt: '2025-01-01T09:00:00.000Z',
          updatedAt: '2025-01-01T09:00:00.000Z',
        },
      ]

    case 'update_favorite':
      return true

    case 'delete_favorite':
      return true

    // --- AI commands ---
    case 'ai_chat': {
      // Simulate streaming by emitting mock events after a short delay
      const request = args?.request as { streamId?: string } | undefined
      const streamId = request?.streamId ?? 'mock-stream-id'

      // Support AI error simulation for Playwright tests
      if (
        typeof window !== 'undefined' &&
        (window as unknown as Record<string, unknown>).__mockAiError__
      ) {
        setTimeout(() => {
          emitMockEvent('ai-stream-error', {
            streamId,
            error: 'Connection refused: unable to reach AI endpoint',
          })
        }, 20)
        return null
      }

      // Support thinking/reasoning simulation for Playwright tests
      if (
        typeof window !== 'undefined' &&
        (window as unknown as Record<string, unknown>).__mockAiThinking__
      ) {
        const thinkingText = 'Let me analyze the database schema and find the best approach...'
        let delay = 10
        // Emit thinking chunk
        setTimeout(() => {
          emitMockEvent('ai-stream-chunk', { streamId, content: thinkingText, kind: 'thinking' })
        }, delay)
        delay += 20
        // Then emit normal content chunks
        const chunks = AI_MOCK_RESPONSE.match(/[\s\S]{1,20}/g) ?? [AI_MOCK_RESPONSE]
        for (const chunk of chunks) {
          setTimeout(() => {
            emitMockEvent('ai-stream-chunk', { streamId, content: chunk, kind: 'content' })
          }, delay)
          delay += 10
        }
        setTimeout(() => {
          emitMockEvent('ai-stream-done', { streamId })
        }, delay)
        return null
      }

      // Break the response into chunks and emit them asynchronously.
      // Use [\s\S] instead of . so newlines are preserved in chunks —
      // . does not match \n by default, which would strip the newlines
      // that markdown fenced code blocks require.
      const chunks = AI_MOCK_RESPONSE.match(/[\s\S]{1,20}/g) ?? [AI_MOCK_RESPONSE]
      let delay = 10
      for (const chunk of chunks) {
        setTimeout(() => {
          emitMockEvent('ai-stream-chunk', { streamId, content: chunk, kind: 'content' })
        }, delay)
        delay += 10
      }
      // Emit done after all chunks
      setTimeout(() => {
        emitMockEvent('ai-stream-done', { streamId })
      }, delay)

      return null
    }

    case 'ai_cancel':
      return null

    case 'list_ai_models':
      return {
        models: getAiModelsFixture(args?.endpoint as string | null | undefined),
      }

    case 'ai_query_expand':
      return {
        text: '{"queries":["SELECT users","JOIN orders","user_id foreign key"],"hypotheticalSql":"SELECT u.* FROM `ecommerce_db`.`users` u JOIN `ecommerce_db`.`orders` o ON u.id = o.user_id","entities":["users","orders"],"joins":["users → orders"],"metrics":["count"]}',
      }

    // --- Schema index commands ---
    case 'build_schema_index':
      return null
    case 'force_rebuild_schema_index':
      return null
    case 'semantic_search':
      return [
        {
          chunkId: 1,
          chunkKey: 'table:ecommerce_db.users',
          dbName: 'ecommerce_db',
          tableName: 'users',
          chunkType: 'table',
          ddlText:
            'CREATE TABLE `ecommerce_db`.`users` (`id` int NOT NULL, `name` varchar(255), `email` varchar(255), PRIMARY KEY (`id`)) -- approximate rows: 15000\n-- Table comment: Registered platform users',
          refDbName: null,
          refTableName: null,
          score: 0.95,
        },
      ]
    case 'get_index_status':
      return { status: 'ready' }
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
