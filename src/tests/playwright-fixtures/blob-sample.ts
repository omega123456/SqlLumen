import type { PlaywrightListColumn, PlaywrightTableDataResult } from './types'

/**
 * A small table with a binary (`LONGBLOB`) column so E2E flows can double-click a
 * `[BLOB - <size>]` cell and open the BlobViewerDialog. The dialog fetches the
 * actual bytes lazily via `fetch_blob_value` (served by the blob-value fixture,
 * keyed on column name), so the placeholder text here is irrelevant.
 */
export const BLOB_SAMPLE_LIST_COLUMNS: PlaywrightListColumn[] = [
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
    name: 'label',
    dataType: 'varchar(64)',
    nullable: true,
    columnKey: '',
    defaultValue: null,
    extra: '',
    ordinalPosition: 2,
  },
  {
    name: 'photo',
    dataType: 'longblob',
    nullable: true,
    columnKey: '',
    defaultValue: null,
    extra: '',
    ordinalPosition: 3,
  },
  {
    name: 'photo_large',
    dataType: 'longblob',
    nullable: true,
    columnKey: '',
    defaultValue: null,
    extra: '',
    ordinalPosition: 4,
  },
]

export const BLOB_SAMPLE_TABLE_DATA: PlaywrightTableDataResult = {
  columns: [
    {
      name: 'id',
      dataType: 'BIGINT',
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
      name: 'label',
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
      name: 'photo',
      dataType: 'LONGBLOB',
      isBooleanAlias: false,
      isNullable: true,
      isPrimaryKey: false,
      isUniqueKey: false,
      hasDefault: false,
      columnDefault: null,
      isBinary: true,
      isAutoIncrement: false,
    },
    {
      name: 'photo_large',
      dataType: 'LONGBLOB',
      isBooleanAlias: false,
      isNullable: true,
      isPrimaryKey: false,
      isUniqueKey: false,
      hasDefault: false,
      columnDefault: null,
      isBinary: true,
      isAutoIncrement: false,
    },
  ],
  rows: [
    [1, 'Avatar', '[BLOB - 70 B]', '[BLOB - 12 MB]'],
    [2, 'Banner', '[BLOB - 70 B]', '[BLOB - 12 MB]'],
  ],
  currentPage: 1,
  pageSize: 1000,
  primaryKey: {
    keyColumns: ['id'],
    hasAutoIncrement: true,
    isUniqueKeyFallback: false,
  },
  executionTimeMs: 18,
}
