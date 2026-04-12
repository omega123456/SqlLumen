import type { SavedConnection } from '../types/connection'
import type { SchemaMetadataResponse, SchemaMetadataFull } from '../types/schema'

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

    // --- Settings ---
    case 'get_setting': {
      const key = args?.key as string
      // Return AI defaults for AI-related keys
      const AI_DEFAULTS: Record<string, string> = {
        'ai.enabled': 'false',
        'ai.endpoint': '',
        'ai.model': '',
        'ai.temperature': '0.3',
        'ai.maxTokens': '2048',
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
        'connection.defaultTimeout': '10',
        'connection.defaultKeepalive': '60',
        shortcuts: '{}',
        'session.state': 'null',
        'ai.enabled': 'false',
        'ai.endpoint': '',
        'ai.model': '',
        'ai.temperature': '0.3',
        'ai.maxTokens': '2048',
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
      return { sessionId: 'session-playwright-1', serverVersion: '8.0.33-mock' }
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

    // --- Schema read commands ---
    case 'list_databases':
      return ['ecommerce_db', 'analytics_db', 'staging_db']
    case 'list_schema_objects': {
      const objectType = (args as Record<string, unknown>)?.objectType
      switch (objectType) {
        case 'table':
          return ['users', 'orders', 'products']
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
      if (table === 'users') {
        return [
          {
            name: 'id',
            dataType: 'bigint',
            nullable: false,
            columnKey: 'PRI',
            defaultValue: null,
            extra: 'auto_increment',
            ordinalPosition: 1,
          },
          {
            name: 'name',
            dataType: 'varchar',
            nullable: false,
            columnKey: '',
            defaultValue: null,
            extra: '',
            ordinalPosition: 2,
          },
          {
            name: 'email',
            dataType: 'varchar',
            nullable: true,
            columnKey: 'UNI',
            defaultValue: null,
            extra: '',
            ordinalPosition: 3,
          },
        ]
      }
      if (table === 'orders') {
        return [
          {
            name: 'id',
            dataType: 'bigint',
            nullable: false,
            columnKey: 'PRI',
            defaultValue: null,
            extra: 'auto_increment',
            ordinalPosition: 1,
          },
          {
            name: 'user_id',
            dataType: 'bigint',
            nullable: false,
            columnKey: 'MUL',
            defaultValue: null,
            extra: '',
            ordinalPosition: 2,
          },
          {
            name: 'status',
            dataType: 'varchar',
            nullable: false,
            columnKey: '',
            defaultValue: "'pending'",
            extra: '',
            ordinalPosition: 3,
          },
        ]
      }
      return [
        {
          name: 'id',
          dataType: 'bigint',
          nullable: false,
          columnKey: 'PRI',
          defaultValue: null,
          extra: 'auto_increment',
          ordinalPosition: 1,
        },
      ]
    }
    case 'get_schema_info': {
      const objectType = (args as Record<string, unknown>)?.objectType ?? 'table'

      if (objectType === 'table') {
        return {
          columns: [
            {
              name: 'id',
              dataType: 'bigint',
              nullable: false,
              columnKey: 'PRI',
              defaultValue: null,
              extra: 'auto_increment',
              ordinalPosition: 1,
            },
            {
              name: 'name',
              dataType: 'varchar',
              nullable: false,
              columnKey: '',
              defaultValue: null,
              extra: '',
              ordinalPosition: 2,
            },
            {
              name: 'email',
              dataType: 'varchar',
              nullable: false,
              columnKey: '',
              defaultValue: null,
              extra: '',
              ordinalPosition: 3,
            },
          ],
          indexes: [
            {
              name: 'PRIMARY',
              indexType: 'BTREE',
              cardinality: 1000,
              columns: ['id'],
              isVisible: true,
              isUnique: true,
            },
          ],
          foreignKeys: [],
          ddl: 'CREATE TABLE `users` (\n  `id` bigint NOT NULL AUTO_INCREMENT,\n  `name` varchar(255) NOT NULL,\n  `email` varchar(255) NOT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
          metadata: {
            engine: 'InnoDB',
            collation: 'utf8mb4_general_ci',
            autoIncrement: 1001,
            createTime: '2023-01-15T00:00:00',
            tableRows: 1000,
            dataLength: 1048576,
            indexLength: 524288,
          },
        }
      }

      if (objectType === 'view') {
        return {
          columns: [
            {
              name: 'user_id',
              dataType: 'bigint',
              nullable: false,
              columnKey: '',
              defaultValue: null,
              extra: '',
              ordinalPosition: 1,
            },
            {
              name: 'total',
              dataType: 'bigint',
              nullable: false,
              columnKey: '',
              defaultValue: null,
              extra: '',
              ordinalPosition: 2,
            },
          ],
          indexes: [],
          foreignKeys: [],
          ddl: 'CREATE VIEW `user_stats` AS SELECT user_id, COUNT(*) as total FROM orders GROUP BY user_id',
          metadata: null,
        }
      }

      // procedure, function, trigger, event — DDL only
      const ddlByType: Record<string, string> = {
        procedure: 'CREATE PROCEDURE `sp_get_orders`()\nBEGIN\n  SELECT * FROM orders;\nEND',
        function:
          'CREATE FUNCTION `fn_calculate_total`(order_id BIGINT) RETURNS DECIMAL(10,2)\nBEGIN\n  RETURN 0.00;\nEND',
        trigger:
          "CREATE TRIGGER `trg_before_insert` BEFORE INSERT ON `orders`\nFOR EACH ROW\nBEGIN\n  SET NEW.status = 'pending';\nEND",
        event:
          'CREATE EVENT `cleanup_job` ON SCHEDULE EVERY 1 DAY DO DELETE FROM logs WHERE created_at < NOW() - INTERVAL 30 DAY',
      }

      return {
        columns: [],
        indexes: [],
        foreignKeys: [],
        ddl: ddlByType[objectType as string] ?? 'CREATE ...',
        metadata: null,
      }
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
      let result: unknown

      if (/^\s*SELECT\s+DATABASE\s*\(\s*\)\s*;?\s*$/i.test(String(args?.sql ?? ''))) {
        result = {
          queryId: 'mock-query-current-db',
          columns: [{ name: 'DATABASE()', dataType: 'VARCHAR' }],
          totalRows: 1,
          executionTimeMs: 7,
          affectedRows: 0,
          firstPage: [[activeMockDatabase]],
          totalPages: 1,
          autoLimitApplied: false,
        }
      } else {
        result = {
          queryId: 'mock-query-id-1',
          columns: [
            { name: 'id', dataType: 'BIGINT' },
            { name: 'name', dataType: 'VARCHAR' },
            { name: 'email', dataType: 'VARCHAR' },
            { name: 'status', dataType: 'VARCHAR' },
            { name: 'created_at', dataType: 'DATETIME' },
          ],
          totalRows: 5,
          executionTimeMs: 42,
          affectedRows: 0,
          firstPage: [
            [1001, 'Julian Thorne', 'j.thorne@example.com', 'active', '2024-01-15T10:30:00'],
            [1002, 'Elena Vance', 'vance.e@techcorp.com', 'active', '2024-02-20T14:22:00'],
            [1003, 'Marcus Reed', null, 'inactive', '2024-03-05T09:15:00'],
            [1004, 'Sarah Kim', 's.kim@devtools.co', null, '2024-04-12T16:45:00'],
            [1005, 'Alex Chen', 'alex.c@datacraft.net', 'active', null],
          ],
          totalPages: 1,
          autoLimitApplied: true,
        }
      }

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
            affectedRows: 0,
            firstPage: [
              [1, 'Alice'],
              [2, 'Bob'],
            ],
            totalPages: 1,
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
            affectedRows: 0,
            firstPage: [
              [101, '29.99'],
              [102, '49.99'],
            ],
            totalPages: 1,
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
            affectedRows: 1,
            firstPage: [],
            totalPages: 0,
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
            affectedRows: 0,
            firstPage: [
              [1, '150.00'],
              [2, '230.50'],
            ],
            totalPages: 1,
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
            affectedRows: 0,
            firstPage: [['total_orders', 42]],
            totalPages: 1,
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
        affectedRows: 0,
        firstPage: [
          [1, 'Alice'],
          [2, 'Bob'],
        ],
        totalPages: 1,
        autoLimitApplied: false,
        error: null,
        reExecutable: true,
      }

    case 'fetch_result_page':
      return {
        rows: [[1001, 'Julian Thorne', 'j.thorne@example.com', 'active', '2024-01-15T10:30:00']],
        page: 1,
        totalPages: 1,
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
      // Returns FetchPageResult shape (same as fetch_result_page)
      return {
        rows: [
          [1005, 'Alex Chen', 'alex.c@datacraft.net', 'active', null],
          [1002, 'Elena Vance', 'vance.e@techcorp.com', 'active', '2024-02-20T14:22:00'],
          [1001, 'Julian Thorne', 'j.thorne@example.com', 'active', '2024-01-15T10:30:00'],
          [1003, 'Marcus Reed', null, 'inactive', '2024-03-05T09:15:00'],
          [1004, 'Sarah Kim', 's.kim@devtools.co', null, '2024-04-12T16:45:00'],
        ],
        page: 1,
        totalPages: 1,
      }

    case 'analyze_query_for_edit':
      return [
        {
          database: 'ecommerce_db',
          table: 'users',
          columns: [
            {
              name: 'id',
              dataType: 'INT',
              isBooleanAlias: false,
              enumValues: null,
              isNullable: false,
              isPrimaryKey: true,
              isUniqueKey: false,
              hasDefault: false,
              columnDefault: null,
              isBinary: false,
              isAutoIncrement: true,
            },
            {
              name: 'name',
              dataType: 'VARCHAR',
              isBooleanAlias: false,
              enumValues: null,
              isNullable: true,
              isPrimaryKey: false,
              isUniqueKey: false,
              hasDefault: false,
              columnDefault: null,
              isBinary: false,
              isAutoIncrement: false,
            },
            {
              name: 'email',
              dataType: 'VARCHAR',
              isBooleanAlias: false,
              enumValues: null,
              isNullable: true,
              isPrimaryKey: false,
              isUniqueKey: false,
              hasDefault: false,
              columnDefault: null,
              isBinary: false,
              isAutoIncrement: false,
            },
          ],
          primaryKey: {
            keyColumns: ['id'],
            hasAutoIncrement: true,
            isUniqueKeyFallback: false,
          },
          foreignKeys: [
            {
              name: 'fk_users_email',
              columnName: 'email',
              referencedDatabase: 'ecommerce_db',
              referencedTable: 'users',
              referencedColumn: 'id',
              onDelete: 'CASCADE',
              onUpdate: 'CASCADE',
            },
          ],
        },
      ]

    case 'update_result_cell':
      return null

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

      if (table === 'users') {
        return {
          columns: [
            {
              name: 'id',
              dataType: 'INT',
              isBooleanAlias: false,
              isNullable: false,
              isPrimaryKey: true,
              isUniqueKey: false,
              hasDefault: false,
              columnDefault: null,
              isBinary: false,
              isAutoIncrement: true,
            },
            {
              name: 'name',
              dataType: 'VARCHAR',
              isBooleanAlias: false,
              isNullable: true,
              isPrimaryKey: false,
              isUniqueKey: false,
              hasDefault: false,
              columnDefault: null,
              isBinary: false,
              isAutoIncrement: false,
            },
            {
              name: 'email',
              dataType: 'VARCHAR',
              isBooleanAlias: false,
              isNullable: true,
              isPrimaryKey: false,
              isUniqueKey: false,
              hasDefault: false,
              columnDefault: null,
              isBinary: false,
              isAutoIncrement: false,
            },
          ],
          rows: [
            [1, 'Alice', 'alice@example.com'],
            [2, 'Bob', 'bob@example.com'],
            [3, 'Charlie', 'charlie@example.com'],
          ],
          totalRows: 3,
          currentPage: 1,
          totalPages: 1,
          pageSize: 100,
          primaryKey: {
            keyColumns: ['id'],
            hasAutoIncrement: true,
            isUniqueKeyFallback: false,
          },
          executionTimeMs: 12,
        }
      }

      if (table === 'orders') {
        return {
          columns: [
            {
              name: 'id',
              dataType: 'INT',
              isBooleanAlias: false,
              isNullable: false,
              isPrimaryKey: true,
              isUniqueKey: false,
              hasDefault: false,
              columnDefault: null,
              isBinary: false,
              isAutoIncrement: true,
            },
            {
              name: 'user_id',
              dataType: 'BIGINT',
              isBooleanAlias: false,
              isNullable: false,
              isPrimaryKey: false,
              isUniqueKey: false,
              hasDefault: false,
              columnDefault: null,
              isBinary: false,
              isAutoIncrement: false,
            },
            {
              name: 'status',
              dataType: 'VARCHAR',
              isBooleanAlias: false,
              isNullable: false,
              isPrimaryKey: false,
              isUniqueKey: false,
              hasDefault: true,
              columnDefault: 'pending',
              isBinary: false,
              isAutoIncrement: false,
            },
          ],
          rows: [
            [1, 101, 'pending'],
            [2, 102, 'shipped'],
            [3, 101, 'delivered'],
          ],
          totalRows: 3,
          currentPage: 1,
          totalPages: 1,
          pageSize: 1000,
          primaryKey: {
            keyColumns: ['id'],
            hasAutoIncrement: true,
            isUniqueKeyFallback: false,
          },
          executionTimeMs: 8,
        }
      }

      if (table === 'user_stats_view') {
        return {
          columns: [
            {
              name: 'user_id',
              dataType: 'INT',
              isBooleanAlias: false,
              isNullable: false,
              isPrimaryKey: false,
              isUniqueKey: false,
              hasDefault: false,
              columnDefault: null,
              isBinary: false,
              isAutoIncrement: false,
            },
            {
              name: 'total_orders',
              dataType: 'INT',
              isBooleanAlias: false,
              isNullable: true,
              isPrimaryKey: false,
              isUniqueKey: false,
              hasDefault: false,
              columnDefault: null,
              isBinary: false,
              isAutoIncrement: false,
            },
          ],
          rows: [
            [1, 5],
            [2, 12],
            [3, 3],
          ],
          totalRows: 3,
          currentPage: 1,
          totalPages: 1,
          pageSize: 100,
          primaryKey: null,
          executionTimeMs: 6,
        }
      }

      // Default response (original)
      return {
        columns: [
          {
            name: 'id',
            dataType: 'INT',
            isBooleanAlias: false,
            isNullable: false,
            isPrimaryKey: true,
            isUniqueKey: false,
            hasDefault: false,
            columnDefault: null,
            isBinary: false,
            isAutoIncrement: true,
          },
          {
            name: 'name',
            dataType: 'VARCHAR',
            isBooleanAlias: false,
            isNullable: true,
            isPrimaryKey: false,
            isUniqueKey: false,
            hasDefault: false,
            columnDefault: null,
            isBinary: false,
            isAutoIncrement: false,
          },
          {
            name: 'email',
            dataType: 'VARCHAR',
            isBooleanAlias: false,
            isNullable: true,
            isPrimaryKey: false,
            isUniqueKey: false,
            hasDefault: false,
            columnDefault: null,
            isBinary: false,
            isAutoIncrement: false,
          },
          {
            name: 'status',
            dataType: 'ENUM',
            isBooleanAlias: false,
            enumValues: ['active', 'inactive'],
            isNullable: false,
            isPrimaryKey: false,
            isUniqueKey: false,
            hasDefault: true,
            columnDefault: 'active',
            isBinary: false,
            isAutoIncrement: false,
          },
          {
            name: 'created_at',
            dataType: 'DATETIME',
            isBooleanAlias: false,
            isNullable: true,
            isPrimaryKey: false,
            isUniqueKey: false,
            hasDefault: false,
            columnDefault: null,
            isBinary: false,
            isAutoIncrement: false,
          },
          {
            name: 'updated_at',
            dataType: 'TIMESTAMP',
            isBooleanAlias: false,
            isNullable: true,
            isPrimaryKey: false,
            isUniqueKey: false,
            hasDefault: false,
            columnDefault: null,
            isBinary: false,
            isAutoIncrement: false,
          },
          {
            name: 'birth_date',
            dataType: 'DATE',
            isBooleanAlias: false,
            isNullable: true,
            isPrimaryKey: false,
            isUniqueKey: false,
            hasDefault: false,
            columnDefault: null,
            isBinary: false,
            isAutoIncrement: false,
          },
          {
            name: 'login_time',
            dataType: 'TIME',
            isBooleanAlias: false,
            isNullable: true,
            isPrimaryKey: false,
            isUniqueKey: false,
            hasDefault: false,
            columnDefault: null,
            isBinary: false,
            isAutoIncrement: false,
          },
        ],
        rows: [
          [
            1001,
            'Julian Thorne',
            'j.thorne@example.com',
            'active',
            '2023-11-24 14:30:00',
            '2023-11-24 14:30:00',
            '1990-05-15',
            '09:30:00',
          ],
          [
            1002,
            'Elena Vasquez',
            null,
            'active',
            '2023-12-01 09:00:00',
            '2023-12-01 09:00:00',
            '1985-08-22',
            '14:15:00',
          ],
          [
            1003,
            'Marcus Chen',
            'marcus@db.net',
            'inactive',
            '2024-01-15 16:45:00',
            '2024-01-15 16:45:00',
            null,
            '08:00:00',
          ],
          [
            1004,
            'Sarah Park',
            'sarah@dev.co',
            'active',
            null,
            '2024-02-20 11:30:00',
            '1992-03-10',
            null,
          ],
        ],
        totalRows: 4,
        currentPage: 1,
        totalPages: 1,
        pageSize: 1000,
        primaryKey: {
          keyColumns: ['id'],
          hasAutoIncrement: true,
          isUniqueKeyFallback: false,
        },
        executionTimeMs: 42,
      }
    }

    case 'get_table_foreign_keys': {
      const table = (args as Record<string, unknown>)?.table
      if (table === 'orders') {
        return [
          {
            name: 'fk_orders_user',
            columnName: 'user_id',
            referencedDatabase: 'ecommerce_db',
            referencedTable: 'users',
            referencedColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        ]
      }
      return []
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

    // --- Object editor commands (Phase 8) ---
    case 'get_object_body': {
      const objectType = (args as Record<string, unknown>)?.objectType as string | undefined
      switch (objectType) {
        case 'procedure':
          return 'CREATE PROCEDURE `test_db`.`mock_proc`(\n  IN p_id INT\n)\nBEGIN\n  SELECT p_id;\nEND'
        case 'function':
          return 'CREATE FUNCTION `test_db`.`mock_func`(\n  p_input INT\n) RETURNS INT\nDETERMINISTIC\nBEGIN\n  RETURN p_input;\nEND'
        case 'trigger':
          return 'CREATE TRIGGER `test_db`.`mock_trigger`\nBEFORE INSERT ON `mock_table`\nFOR EACH ROW\nBEGIN\n  SET NEW.created_at = NOW();\nEND'
        case 'event':
          return 'CREATE EVENT `test_db`.`mock_event`\nON SCHEDULE EVERY 1 DAY\nDO BEGIN\n  -- Event body\nEND'
        case 'view':
          return 'CREATE OR REPLACE VIEW `test_db`.`mock_view` AS\nSELECT id, name FROM users'
        default:
          return 'CREATE ...'
      }
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
      if (rtType === 'function') {
        return {
          parameters: [
            { name: '', dataType: 'int', mode: '', ordinalPosition: 0 },
            { name: 'p_id', dataType: 'int', mode: 'IN', ordinalPosition: 1 },
            { name: 'p_result', dataType: 'varchar(255)', mode: 'OUT', ordinalPosition: 2 },
          ],
          found: true,
        }
      }
      return {
        parameters: [
          { name: 'p_id', dataType: 'int', mode: 'IN', ordinalPosition: 1 },
          { name: 'p_result', dataType: 'varchar(255)', mode: 'OUT', ordinalPosition: 2 },
        ],
        found: true,
      }
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
        errorMessage: null,
      }

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

      // Break the response into chunks and emit them asynchronously.
      // Use [\s\S] instead of . so newlines are preserved in chunks —
      // . does not match \n by default, which would strip the newlines
      // that markdown fenced code blocks require.
      const chunks = AI_MOCK_RESPONSE.match(/[\s\S]{1,20}/g) ?? [AI_MOCK_RESPONSE]
      let delay = 10
      for (const chunk of chunks) {
        setTimeout(() => {
          emitMockEvent('ai-stream-chunk', { streamId, content: chunk })
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
        models: [
          { id: 'codellama', name: null },
          { id: 'deepseek-coder', name: null },
          { id: 'llama3.2', name: null },
        ],
      }

    default:
      return null
  }
}
