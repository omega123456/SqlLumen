import type { PlaywrightCachedRowsResult, PlaywrightQueryResult } from './types'

export function createCurrentDatabaseQueryResult(
  activeMockDatabase: string | null
): PlaywrightQueryResult {
  return {
    queryId: 'mock-query-current-db',
    columns: [{ name: 'DATABASE()', dataType: 'VARCHAR' }],
    totalRows: 1,
    executionTimeMs: 7,
    totalTimeMs: 9,
    affectedRows: 0,
    rows: [[activeMockDatabase]],

    autoLimitApplied: false,
  }
}

export const SCROLL_TEST_QUERY_RESULT: PlaywrightQueryResult = {
  queryId: 'mock-query-scroll-test',
  columns: [
    { name: 'id', dataType: 'BIGINT' },
    { name: 'name', dataType: 'VARCHAR' },
    { name: 'status', dataType: 'VARCHAR' },
  ],
  totalRows: 120,
  executionTimeMs: 42,
  totalTimeMs: 58,
  affectedRows: 0,
  rows: Array.from({ length: 120 }, (_, index) => [
    index + 1,
    `Scroll user ${index + 1}`,
    index % 2 === 0 ? 'active' : 'inactive',
  ]),

  autoLimitApplied: false,
}

export const DEFAULT_EXECUTE_QUERY_RESULT: PlaywrightQueryResult = {
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
  totalTimeMs: 51,
  affectedRows: 0,
  rows: [
    [1001, 'Julian Thorne', 'j.thorne@example.com', 'active', '2024-01-15T10:30:00'],
    [1002, 'Elena Vance', 'vance.e@techcorp.com', 'active', '2024-02-20T14:22:00'],
    [1003, 'Marcus Reed', null, 'inactive', '2024-03-05T09:15:00'],
    [1004, 'Sarah Kim', 's.kim@devtools.co', null, '2024-04-12T16:45:00'],
    [1005, 'Alex Chen', 'alex.c@datacraft.net', 'active', null],
  ],

  autoLimitApplied: true,
}

export const JSON_QUERY_RESULT: PlaywrightQueryResult = {
  queryId: 'mock-query-json',
  columns: [
    { name: 'id', dataType: 'BIGINT' },
    { name: 'profile', dataType: 'JSON' },
    { name: 'updated_at', dataType: 'DATETIME' },
  ],
  totalRows: 2,
  executionTimeMs: 18,
  totalTimeMs: 24,
  affectedRows: 0,
  rows: [
    [
      1,
      '{"name":"Ada Lovelace","roles":["admin","analyst"],"flags":{"beta":true,"score":42},"theme":null}',
      '2025-01-15 10:30:00',
    ],
    [
      2,
      '{"name":"Linus Torvalds","roles":["maintainer"],"flags":{"beta":false,"score":7},"theme":"light"}',
      '2025-02-01 08:15:00',
    ],
  ],

  autoLimitApplied: false,
}

/**
 * A query result containing a binary (`LONGBLOB`) column whose bytes are inlined
 * as base64 (the same 1x1 PNG the blob-value fixture serves). Used to exercise
 * the view-only BlobViewerDialog opened from a query-result grid.
 */
const BLOB_QUERY_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

export const BLOB_QUERY_RESULT: PlaywrightQueryResult = {
  queryId: 'mock-query-blob',
  columns: [
    { name: 'id', dataType: 'BIGINT' },
    { name: 'label', dataType: 'VARCHAR' },
    { name: 'photo', dataType: 'LONGBLOB' },
  ],
  totalRows: 2,
  executionTimeMs: 12,
  totalTimeMs: 16,
  affectedRows: 0,
  rows: [
    [1, 'Avatar', BLOB_QUERY_BASE64],
    [2, 'Banner', BLOB_QUERY_BASE64],
  ],

  autoLimitApplied: false,
}

export const BLOB_CACHED_ROWS_RESULT: PlaywrightCachedRowsResult = {
  queryId: BLOB_QUERY_RESULT.queryId,
  resultIndex: 0,
  columns: BLOB_QUERY_RESULT.columns,
  rows: BLOB_QUERY_RESULT.rows,
}

export const DEFAULT_CACHED_ROWS_RESULT: PlaywrightCachedRowsResult = {
  queryId: DEFAULT_EXECUTE_QUERY_RESULT.queryId,
  resultIndex: 0,
  columns: DEFAULT_EXECUTE_QUERY_RESULT.columns,
  rows: DEFAULT_EXECUTE_QUERY_RESULT.rows,
}

export const DEFAULT_SECOND_RESULT_CACHED_ROWS_RESULT: PlaywrightCachedRowsResult = {
  queryId: 'mock-query-id-1',
  resultIndex: 1,
  columns: [
    { name: 'order_id', dataType: 'INT' },
    { name: 'total', dataType: 'DECIMAL' },
  ],
  rows: [
    [1, '150.00'],
    [2, '230.50'],
  ],
}

export const JSON_CACHED_ROWS_RESULT: PlaywrightCachedRowsResult = {
  queryId: JSON_QUERY_RESULT.queryId,
  resultIndex: 0,
  columns: JSON_QUERY_RESULT.columns,
  rows: JSON_QUERY_RESULT.rows,
}
