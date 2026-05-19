import type { PlaywrightTableDataResult } from './types'

export const USER_STATS_VIEW_TABLE_DATA: PlaywrightTableDataResult = {
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
  currentPage: 1,
  pageSize: 100,
  primaryKey: null,
  executionTimeMs: 6,
}
