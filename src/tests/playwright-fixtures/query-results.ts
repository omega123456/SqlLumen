import type { PlaywrightQueryResult } from './types'

export function createCurrentDatabaseQueryResult(
  activeMockDatabase: string | null
): PlaywrightQueryResult {
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

export const SCROLL_TEST_QUERY_RESULT: PlaywrightQueryResult = {
  queryId: 'mock-query-scroll-test',
  columns: [
    { name: 'id', dataType: 'BIGINT' },
    { name: 'name', dataType: 'VARCHAR' },
    { name: 'status', dataType: 'VARCHAR' },
  ],
  totalRows: 120,
  executionTimeMs: 42,
  affectedRows: 0,
  firstPage: Array.from({ length: 120 }, (_, index) => [
    index + 1,
    `Scroll user ${index + 1}`,
    index % 2 === 0 ? 'active' : 'inactive',
  ]),
  totalPages: 1,
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
