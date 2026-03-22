import type { SavedConnection } from '../types/connection'

const MOCK_TS = '2025-01-01T00:00:00.000Z'

/** Deterministic saved profile for Playwright / VITE_PLAYWRIGHT browser runs. */
export const PLAYWRIGHT_MOCK_CONNECTION: SavedConnection = {
  id: 'conn-playwright-1',
  name: 'Sample MySQL',
  host: '127.0.0.1',
  port: 3306,
  username: 'appuser',
  hasPassword: true,
  defaultDatabase: 'appdb',
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

    // --- Connection management ---
    case 'list_connections':
      return [PLAYWRIGHT_MOCK_CONNECTION]
    case 'list_connection_groups':
      return []
    case 'open_connection':
      return { sessionId: 'session-playwright-1', serverVersion: '8.0.33-mock' }
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
          [1003, 'Marcus Reed', 'm.reed@dbstudio.io', 'inactive', '2024-03-05T09:15:00'],
          [1004, 'Sarah Kim', 's.kim@devtools.co', 'active', '2024-04-12T16:45:00'],
          [1005, 'Alex Chen', 'alex.c@datacraft.net', 'active', '2024-05-08T11:00:00'],
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

    case 'fetch_schema_metadata':
      return {
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
        },
        routines: {
          ecommerce_db: [
            { name: 'sp_get_orders', routineType: 'PROCEDURE' },
            { name: 'fn_calculate_total', routineType: 'FUNCTION' },
          ],
        },
      }

    case 'read_file':
      return "SELECT * FROM users\nWHERE status = 'active'\nLIMIT 100;"

    case 'write_file':
      return null

    default:
      return null
  }
}
