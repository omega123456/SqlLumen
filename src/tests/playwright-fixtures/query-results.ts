/**
 * Query-result fixtures for the Playwright IPC mock, plus the pure helpers the
 * registry uses to serve them the way the Rust result cache does: a view
 * (sort + filter + tombstones) over the base rows, sliced into windows.
 */
import type {
  PlaywrightQueryResult,
  PlaywrightQueryResultFixture,
  PlaywrightResultWindow,
  PlaywrightViewSpec,
} from './types'

/** First-window size of every execute response (as in Rust). */
export const FIRST_WINDOW_ROWS = 1000
/** Maximum rows per window request (as in Rust). */
export const MAX_WINDOW_ROWS = 2000
/** Default row ceiling (`results.maxRows`). */
export const DEFAULT_ROW_CEILING = 100_000

export function createCurrentDatabaseQueryResult(
  activeMockDatabase: string | null
): PlaywrightQueryResultFixture {
  return {
    queryId: 'mock-query-current-db',
    columns: [{ name: 'DATABASE()', dataType: 'VARCHAR' }],
    executionTimeMs: 7,
    totalTimeMs: 9,
    affectedRows: 0,
    rows: [[activeMockDatabase]],
    autoLimitApplied: false,
  }
}

export const SCROLL_TEST_QUERY_RESULT: PlaywrightQueryResultFixture = {
  queryId: 'mock-query-scroll-test',
  columns: [
    { name: 'id', dataType: 'BIGINT' },
    { name: 'name', dataType: 'VARCHAR' },
    { name: 'status', dataType: 'VARCHAR' },
  ],
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

export const DEFAULT_EXECUTE_QUERY_RESULT: PlaywrightQueryResultFixture = {
  queryId: 'mock-query-id-1',
  columns: [
    { name: 'id', dataType: 'BIGINT' },
    { name: 'name', dataType: 'VARCHAR' },
    { name: 'email', dataType: 'VARCHAR' },
    { name: 'status', dataType: 'VARCHAR' },
    { name: 'created_at', dataType: 'DATETIME' },
  ],
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
  appliedRowLimit: 500,
}

export const JSON_QUERY_RESULT: PlaywrightQueryResultFixture = {
  queryId: 'mock-query-json',
  columns: [
    { name: 'id', dataType: 'BIGINT' },
    { name: 'profile', dataType: 'JSON' },
    { name: 'updated_at', dataType: 'DATETIME' },
  ],
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

export const BLOB_QUERY_RESULT: PlaywrightQueryResultFixture = {
  queryId: 'mock-query-blob',
  columns: [
    { name: 'id', dataType: 'BIGINT' },
    { name: 'label', dataType: 'VARCHAR' },
    { name: 'photo', dataType: 'LONGBLOB' },
  ],
  executionTimeMs: 12,
  totalTimeMs: 16,
  affectedRows: 0,
  rows: [
    [1, 'Avatar', BLOB_QUERY_BASE64],
    [2, 'Banner', BLOB_QUERY_BASE64],
  ],
  autoLimitApplied: false,
}

const LARGE_RESULT_COLUMNS = [
  { name: 'id', dataType: 'BIGINT' },
  { name: 'name', dataType: 'VARCHAR' },
  { name: 'status', dataType: 'VARCHAR' },
]

function largeRows(count: number): unknown[][] {
  return Array.from({ length: count }, (_, index) => [
    index + 1,
    `Large user ${String(index + 1).padStart(5, '0')}`,
    index % 3 === 0 ? 'inactive' : 'active',
  ])
}

/** Memoize a fixture factory (large fixtures are only built when a test asks for them). */
function lazy<T>(factory: () => T): () => T {
  let value: T | undefined
  return () => (value ??= factory())
}

/** A large, untruncated result (12,340 rows) for windowing: later pages load on scroll. */
export const createLargeQueryResult = lazy<PlaywrightQueryResultFixture>(() => ({
  queryId: 'mock-query-large',
  columns: LARGE_RESULT_COLUMNS,
  executionTimeMs: 35,
  totalTimeMs: 48,
  affectedRows: 0,
  rows: largeRows(12340),
  autoLimitApplied: false,
}))

/** A truncated, re-runnable SELECT (wireframe 1): the ceiling stopped storing rows. */
export const createTruncatedQueryResult = lazy<PlaywrightQueryResultFixture>(() => ({
  queryId: 'mock-query-truncated',
  columns: LARGE_RESULT_COLUMNS,
  executionTimeMs: 42,
  totalTimeMs: 51,
  affectedRows: 0,
  rows: largeRows(DEFAULT_ROW_CEILING),
  autoLimitApplied: false,
  truncated: true,
  rowCeiling: DEFAULT_ROW_CEILING,
  fullExportBlockedReason: null,
}))

export const DEFAULT_MULTI_QUERY_RESULTS: PlaywrightQueryResultFixture[] = [
  {
    queryId: 'mock-multi-q1',
    sourceSql: 'SELECT id, name FROM users',
    columns: [
      { name: 'id', dataType: 'BIGINT' },
      { name: 'name', dataType: 'VARCHAR' },
    ],
    executionTimeMs: 15,
    totalTimeMs: 19,
    affectedRows: 0,
    rows: [
      [1, 'Alice'],
      [2, 'Bob'],
    ],
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
    executionTimeMs: 8,
    totalTimeMs: 11,
    affectedRows: 0,
    rows: [
      [101, '29.99'],
      [102, '49.99'],
    ],
    autoLimitApplied: false,
    error: null,
    reExecutable: true,
  },
  {
    queryId: 'mock-multi-q3',
    sourceSql: "UPDATE users SET status = 'active' WHERE id = 1",
    columns: [],
    executionTimeMs: 3,
    totalTimeMs: 3,
    affectedRows: 1,
    rows: [],
    autoLimitApplied: false,
    error: null,
    reExecutable: true,
  },
]

export const DEFAULT_CALL_QUERY_RESULTS: PlaywrightQueryResultFixture[] = [
  {
    queryId: 'mock-call-q1',
    sourceSql: 'CALL sp_get_orders()',
    columns: [
      { name: 'order_id', dataType: 'INT' },
      { name: 'total', dataType: 'DECIMAL' },
    ],
    executionTimeMs: 20,
    totalTimeMs: 26,
    affectedRows: 0,
    rows: [
      [1, '150.00'],
      [2, '230.50'],
    ],
    autoLimitApplied: false,
    error: null,
    reExecutable: false,
    fullExportBlockedReason: 'call',
  },
  {
    queryId: 'mock-call-q2',
    sourceSql: 'CALL sp_get_orders()',
    columns: [
      { name: 'summary_key', dataType: 'VARCHAR' },
      { name: 'summary_value', dataType: 'INT' },
    ],
    executionTimeMs: 5,
    totalTimeMs: 7,
    affectedRows: 0,
    rows: [['total_orders', 42]],
    autoLimitApplied: false,
    error: null,
    reExecutable: false,
    fullExportBlockedReason: 'call',
  },
]

/** A CALL whose last result set hit the ceiling (wireframe 1b: no full export). */
export const createTruncatedCallQueryResults = lazy<PlaywrightQueryResultFixture[]>(() => [
  {
    ...createTruncatedQueryResult(),
    queryId: 'mock-call-truncated',
    sourceSql: 'CALL sp_truncated_call()',
    reExecutable: false,
    error: null,
    fullExportBlockedReason: 'call',
  },
])

export function createReexecuteResultFixture(sql: string): PlaywrightQueryResultFixture {
  return {
    queryId: 'mock-reexec-q1',
    sourceSql: sql,
    columns: [
      { name: 'id', dataType: 'BIGINT' },
      { name: 'name', dataType: 'VARCHAR' },
    ],
    executionTimeMs: 10,
    totalTimeMs: 13,
    affectedRows: 0,
    rows: [
      [1, 'Alice'],
      [2, 'Bob'],
    ],
    autoLimitApplied: false,
    error: null,
    reExecutable: true,
  }
}

// ---------------------------------------------------------------------------
// View model (mirrors src-tauri/src/mysql/result_view.rs closely enough for E2E)
// ---------------------------------------------------------------------------

/** `compare_json_values`: NULLs last (ascending), numbers numeric, strings by code unit. */
export function compareResultValues(a: unknown, b: unknown): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1
  if (b === null || b === undefined) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const sa = typeof a === 'string' ? a : JSON.stringify(a)
  const sb = typeof b === 'string' ? b : JSON.stringify(b)
  return sa < sb ? -1 : sa > sb ? 1 : 0
}

function likeToRegExp(pattern: string): RegExp {
  let source = ''
  for (const char of pattern) {
    if (char === '%') source += '[\\s\\S]*'
    else if (char === '_') source += '[\\s\\S]'
    else source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`, 'i')
}

function matchesCondition(value: unknown, operator: string, conditionValue: string): boolean {
  if (operator === 'IS NULL') return value === null || value === undefined
  if (operator === 'IS NOT NULL') return value !== null && value !== undefined
  if (value === null || value === undefined) return false
  const text = String(value)
  const numeric = Number(text)
  const target = Number(conditionValue)
  const bothNumeric =
    text.trim() !== '' &&
    conditionValue.trim() !== '' &&
    Number.isFinite(numeric) &&
    Number.isFinite(target)
  switch (operator) {
    case '==':
      return bothNumeric ? numeric === target : text === conditionValue
    case '!=':
      return bothNumeric ? numeric !== target : text !== conditionValue
    case '>':
      return bothNumeric ? numeric > target : text > conditionValue
    case '>=':
      return bothNumeric ? numeric >= target : text >= conditionValue
    case '<':
      return bothNumeric ? numeric < target : text < conditionValue
    case '<=':
      return bothNumeric ? numeric <= target : text <= conditionValue
    case 'LIKE':
      return likeToRegExp(conditionValue).test(text)
    case 'NOT LIKE':
      return !likeToRegExp(conditionValue).test(text)
    default:
      return true
  }
}

/**
 * The view of a result: base indices in view order. Tombstoned rows are
 * excluded, conditions on unknown columns are dropped, and the sort is stable
 * over base order (each sort starts from base order).
 */
export function buildResultView(
  fixture: Pick<PlaywrightQueryResultFixture, 'rows' | 'columns'>,
  spec: PlaywrightViewSpec | null,
  tombstones: ReadonlySet<number> = new Set()
): number[] {
  const columnIndex = (name: string) => fixture.columns.findIndex((column) => column.name === name)
  const filters = (spec?.filters ?? [])
    .map((condition) => ({ ...condition, index: columnIndex(condition.column) }))
    .filter((condition) => condition.index >= 0)
  const indices: number[] = []
  fixture.rows.forEach((row, base) => {
    if (tombstones.has(base)) return
    if (filters.every((f) => matchesCondition(row[f.index], f.operator, f.value))) {
      indices.push(base)
    }
  })
  const sortIndex = spec?.sort ? columnIndex(spec.sort.column) : -1
  if (spec?.sort && sortIndex >= 0) {
    const direction = spec.sort.direction === 'desc' ? -1 : 1
    indices.sort(
      (a, b) =>
        direction * compareResultValues(fixture.rows[a][sortIndex], fixture.rows[b][sortIndex]) ||
        a - b
    )
  }
  return indices
}

/** Slice a window of the view (limit clamped to 2,000; offset clamped to the view). */
export function sliceResultWindow(
  fixture: Pick<PlaywrightQueryResultFixture, 'rows'>,
  view: readonly number[],
  offset: number,
  limit: number
): PlaywrightResultWindow {
  const start = Math.max(0, Math.min(offset, view.length))
  const end = Math.min(view.length, start + Math.max(0, Math.min(limit, MAX_WINDOW_ROWS)))
  const baseIndices = view.slice(start, end)
  return { offset: start, rows: baseIndices.map((base) => fixture.rows[base]), baseIndices }
}

/** The windowed execute response for a fixture and its current view. */
export function toWindowedQueryResult(
  fixture: PlaywrightQueryResultFixture,
  view: readonly number[],
  viewVersion: number,
  liveRows: number
): PlaywrightQueryResult {
  const firstWindow = sliceResultWindow(fixture, view, 0, FIRST_WINDOW_ROWS)
  return {
    queryId: fixture.queryId,
    columns: fixture.columns,
    totalRows: liveRows,
    executionTimeMs: fixture.executionTimeMs,
    totalTimeMs: fixture.totalTimeMs,
    affectedRows: fixture.affectedRows,
    autoLimitApplied: fixture.autoLimitApplied,
    viewRowCount: view.length,
    viewVersion,
    truncated: fixture.truncated ?? false,
    rowCeiling: fixture.rowCeiling ?? DEFAULT_ROW_CEILING,
    appliedRowLimit: fixture.appliedRowLimit ?? null,
    fullExportBlockedReason: fixture.fullExportBlockedReason ?? null,
    firstWindow,
    ...(fixture.sourceSql !== undefined
      ? {
          sourceSql: fixture.sourceSql,
          reExecutable: fixture.reExecutable ?? true,
          error: fixture.error ?? null,
        }
      : {}),
  }
}
