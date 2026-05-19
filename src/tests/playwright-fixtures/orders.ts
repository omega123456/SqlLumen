import type {
  PlaywrightForeignKey,
  PlaywrightListColumn,
  PlaywrightTableDataResult,
} from './types'

export const ORDERS_LIST_COLUMNS: PlaywrightListColumn[] = [
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

export const ORDERS_TABLE_DATA: PlaywrightTableDataResult = {
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
      dataType: 'ENUM',
      isBooleanAlias: false,
      enumValues: ['active', 'inactive'],
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
  currentPage: 1,
  pageSize: 1000,
  primaryKey: {
    keyColumns: ['id'],
    hasAutoIncrement: true,
    isUniqueKeyFallback: false,
  },
  executionTimeMs: 8,
}

export const ORDERS_FOREIGN_KEYS: PlaywrightForeignKey[] = [
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
