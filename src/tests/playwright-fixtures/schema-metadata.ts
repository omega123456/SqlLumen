import type { ExportableDatabase, ExportableTable } from '../../lib/sql-dump-commands'
import type { SchemaMetadataResponse, TableInfo } from '../../types/schema'
import { PLAYWRIGHT_MOCK_DATABASE } from './connections'

export const SCHEMA_METADATA: SchemaMetadataResponse = {
  databases: [PLAYWRIGHT_MOCK_DATABASE, 'analytics_db', 'staging_db'],
  tables: {
    [PLAYWRIGHT_MOCK_DATABASE]: [
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
    [`${PLAYWRIGHT_MOCK_DATABASE}.users`]: [
      { name: 'id', dataType: 'BIGINT' },
      { name: 'name', dataType: 'VARCHAR' },
      { name: 'email', dataType: 'VARCHAR' },
      { name: 'status', dataType: 'VARCHAR' },
      { name: 'created_at', dataType: 'DATETIME' },
    ],
    [`${PLAYWRIGHT_MOCK_DATABASE}.orders`]: [
      { name: 'id', dataType: 'BIGINT' },
      { name: 'user_id', dataType: 'BIGINT' },
      { name: 'status', dataType: 'VARCHAR' },
      { name: 'total', dataType: 'DECIMAL' },
    ],
    [`${PLAYWRIGHT_MOCK_DATABASE}.bit_test`]: [
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
    [PLAYWRIGHT_MOCK_DATABASE]: [
      { name: 'sp_get_orders', routineType: 'PROCEDURE' },
      { name: 'fn_calculate_total', routineType: 'FUNCTION' },
    ],
  },
}

const EXPORTABLE_VIEWS_BY_DATABASE: Record<string, ExportableTable[]> = {
  [PLAYWRIGHT_MOCK_DATABASE]: [{ name: 'user_stats_view', objectType: 'view', estimatedRows: 0 }],
}

function toExportableTable(table: TableInfo): ExportableTable {
  return { name: table.name, objectType: 'table', estimatedRows: table.rowCount }
}

function toExportableDatabase([databaseName, tables]: [string, TableInfo[]]): ExportableDatabase {
  const views = EXPORTABLE_VIEWS_BY_DATABASE[databaseName] ?? []
  return { name: databaseName, tables: [...tables.map(toExportableTable), ...views] }
}

export const EXPORTABLE_DATABASES: ExportableDatabase[] = Object.entries(
  SCHEMA_METADATA.tables
).map(toExportableDatabase)
