import type { SavedConnection } from '../types/connection'
import type { SchemaMetadataResponse } from '../types/schema'

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
    // --- Settings ---
    case 'get_setting':
      return null
    case 'set_setting':
      return null
    case 'get_all_settings':
      return {}

    case 'log_frontend':
      return null

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
    case 'execute_query':
      // Support error simulation for Playwright tests
      if (
        typeof window !== 'undefined' &&
        (window as unknown as Record<string, unknown>).__mockQueryError__
      ) {
        throw new Error("Table 'app_db.nonexistent' doesn't exist")
      }

      if (/^\s*SELECT\s+DATABASE\s*\(\s*\)\s*;?\s*$/i.test(String(args?.sql ?? ''))) {
        return {
          queryId: 'mock-query-current-db',
          columns: [{ name: 'DATABASE()', dataType: 'VARCHAR' }],
          totalRows: 1,
          executionTimeMs: 7,
          affectedRows: 0,
          firstPage: [[activeMockDatabase]],
          totalPages: 1,
          autoLimitApplied: false,
        }
      }

      return {
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

    case 'fetch_result_page':
      return {
        rows: [[1001, 'Julian Thorne', 'j.thorne@example.com', 'active', '2024-01-15T10:30:00']],
        page: 1,
        totalPages: 1,
      }

    case 'evict_results':
      return null

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

    // --- Table data browser/editor ---
    case 'fetch_table_data':
      return {
        columns: [
          {
            name: 'id',
            dataType: 'INT',
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

    case 'read_file':
      return "SELECT * FROM users\nWHERE status = 'active'\nLIMIT 100;"

    case 'write_file':
      return null

    default:
      return null
  }
}
