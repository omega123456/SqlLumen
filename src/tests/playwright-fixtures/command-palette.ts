import type { SchemaMetadataFull } from '../../types/schema'

export const COMMAND_PALETTE_SCHEMA_FIXTURE: SchemaMetadataFull = {
  databases: ['analytics_db', 'ecommerce_db', 'staging_db'],
  tables: {
    ecommerce_db: [
      { name: 'users', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 1000, dataSize: 1048576 },
      {
        name: 'user_profiles',
        engine: 'InnoDB',
        charset: 'utf8mb4',
        rowCount: 1000,
        dataSize: 786432,
      },
      { name: 'orders', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 5000, dataSize: 2097152 },
      { name: 'products', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 200, dataSize: 524288 },
      { name: 'bit_test', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 4, dataSize: 16384 },
    ],
    analytics_db: [
      { name: 'events', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 50000, dataSize: 8388608 },
      {
        name: 'user_journeys',
        engine: 'InnoDB',
        charset: 'utf8mb4',
        rowCount: 4200,
        dataSize: 1572864,
      },
    ],
  },
  views: {
    ecommerce_db: [{ name: 'user_summary_view' }],
    analytics_db: [{ name: 'user_activity_rollup' }],
  },
  columns: {
    'ecommerce_db.users': [
      { name: 'id', dataType: 'BIGINT' },
      { name: 'name', dataType: 'VARCHAR' },
      { name: 'email', dataType: 'VARCHAR' },
      { name: 'status', dataType: 'VARCHAR' },
      { name: 'created_at', dataType: 'DATETIME' },
    ],
    'ecommerce_db.user_profiles': [
      { name: 'user_id', dataType: 'BIGINT' },
      { name: 'avatar_url', dataType: 'VARCHAR' },
      { name: 'timezone', dataType: 'VARCHAR' },
    ],
    'ecommerce_db.orders': [
      { name: 'id', dataType: 'BIGINT' },
      { name: 'user_id', dataType: 'BIGINT' },
      { name: 'status', dataType: 'VARCHAR' },
      { name: 'total', dataType: 'DECIMAL' },
    ],
    'ecommerce_db.products': [
      { name: 'id', dataType: 'BIGINT' },
      { name: 'name', dataType: 'VARCHAR' },
      { name: 'price', dataType: 'DECIMAL' },
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
    'analytics_db.user_journeys': [
      { name: 'journey_id', dataType: 'BIGINT' },
      { name: 'user_id', dataType: 'BIGINT' },
      { name: 'segment', dataType: 'VARCHAR' },
    ],
  },
  routines: {
    ecommerce_db: [
      { name: 'sp_get_orders', routineType: 'PROCEDURE' },
      { name: 'fn_calculate_total', routineType: 'FUNCTION' },
    ],
    analytics_db: [{ name: 'sp_user_retention_rollup', routineType: 'PROCEDURE' }],
  },
  triggers: {
    ecommerce_db: [{ name: 'trg_users_before_insert' }],
    analytics_db: [{ name: 'trg_user_journeys_after_insert' }],
  },
  foreignKeys: {},
  indexes: {},
}

export const COMMAND_PALETTE_RECENTS_FIXTURE = JSON.stringify({
  'conn-playwright-1': [
    {
      database: 'analytics_db',
      objectType: 'view',
      name: 'user_activity_rollup',
      lastUsedAt: '2026-06-05T09:15:00.000Z',
    },
    {
      database: 'ecommerce_db',
      objectType: 'table',
      name: 'users',
      lastUsedAt: '2026-06-05T08:45:00.000Z',
    },
    {
      database: 'ecommerce_db',
      objectType: 'procedure',
      name: 'sp_get_orders',
      lastUsedAt: '2026-06-04T17:30:00.000Z',
    },
  ],
})
