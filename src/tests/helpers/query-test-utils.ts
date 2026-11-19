/**
 * Shared query-store test utilities.
 *
 * Exports `flat`, `makeTabState`, `getTestActiveResult`, `seedResultRows` and
 * the windowed-response builders `windowedResponse` / `windowedItem`.
 *
 * Results are windowed: rows live in the (real) page cache
 * (`src/lib/result-window-cache.ts`), not in the store. `makeTabState({ rows })`
 * remembers the rows and seeds the page cache as soon as the result is put in
 * the store (through a store subscription), so component tests can keep
 * describing results by their rows.
 */
import { beforeEach } from 'vitest'
import type { TabQueryState, SingleResultState } from '../../stores/query-store'
import { useQueryStore, getFlatTabState, DEFAULT_RESULT_STATE } from '../../stores/query-store'
import {
  PENDING_ROWS,
  legacyFieldsOf,
  resultState,
  type LegacyResultFields,
} from './legacy-result-fields'
import {
  getLoadedRow,
  getResultSurface,
  seedResultWindow,
  type CachedRow,
} from '../../lib/result-window-cache'
import type { ExecuteQueryResult } from '../../lib/query-commands'
import type {
  MultiQueryResultItem,
  ResultViewSpec,
  ColumnMeta,
  ForeignKeyColumnInfo,
  QueryTableEditInfo,
  RowEditState,
} from '../../types/schema'
import type { ViewMode } from '../../types/shared-data-view'

/**
 * Shorthand: get a flat (tab + active result) view for the given tab ID.
 * Use this instead of defining a local `flat` function in each query-store test.
 */
export function flat(tabId: string) {
  const tab = useQueryStore.getState().getTabState(tabId)
  const resultIndex = Math.max(0, Math.min(tab.activeResultIndex, tab.results.length - 1))
  const flatTab = getFlatTabState(tab)
  return { ...flatTab, ...legacyFieldsOf(flatTab), rows: rowsOf(tabId, resultIndex) }
}

/**
 * The rows of a result currently loaded in the (real) page cache, in view
 * order. Results are windowed, so this is what the grid can show without a
 * fetch — for small test results, the whole view.
 */
export function rowsOf(tabId: string, resultIndex = 0): unknown[][] {
  return loadedRowsOf(tabId, resultIndex).map((cached) => cached.row)
}

/** Base indices of the loaded rows of a result, in view order. */
export function baseIndicesOf(tabId: string, resultIndex = 0): number[] {
  return loadedRowsOf(tabId, resultIndex).map((cached) => cached.baseIndex)
}

/** True when the page cache holds no rows for a result (e.g. after eviction). */
export function hasNoLoadedRows(tabId: string, resultIndex = 0): boolean {
  return loadedRowsOf(tabId, resultIndex).length === 0
}

/** Every loaded row of a result surface, in view order. */
function loadedRowsOf(tabId: string, resultIndex: number): CachedRow[] {
  const viewRowCount = getResultSurface(tabId, resultIndex)?.viewRowCount ?? 0
  const rows: CachedRow[] = []
  for (let position = 0; position < viewRowCount; position++) {
    const cached = getLoadedRow(tabId, resultIndex, position)
    if (cached) rows.push(cached)
  }
  return rows
}

export { PENDING_ROWS }

/**
 * Result-state patch for a result that shows `rows` (identity view). The rows
 * are seeded into the real page cache when the result reaches the store; the
 * store itself never holds rows.
 */
export function withRows(rows: unknown[][]): Record<string, unknown> {
  return { viewRowCount: rows.length, [PENDING_ROWS]: rows }
}

/**
 * Test helper to build TabQueryState with the new multi-result shape.
 *
 * Converts flat result-level fields into a results[] array,
 * minimizing the changes needed in existing test files.
 */

/** Fields that belong on a SingleResultState (per-result). */
interface ResultOverrides {
  resultStatus?: 'idle' | 'running' | 'success' | 'error'
  columns?: ColumnMeta[]
  /** Rows of the result (seeded into the page cache, not stored in the store). */
  rows?: unknown[][]
  totalRows?: number
  viewRowCount?: number
  viewVersion?: number
  truncated?: boolean
  rowCeiling?: number
  appliedRowLimit?: number | null
  fullExportBlockedReason?: SingleResultState['fullExportBlockedReason']
  filterModel?: LegacyResultFields['filterModel']
  draftRow?: unknown[] | null
  editingBaseIndex?: number | null
  checkedRanges?: LegacyResultFields['checkedRanges']
  checkedViewVersion?: number
  isStale?: boolean
  isFiltering?: boolean
  viewError?: string | null
  pendingWindowRange?: LegacyResultFields['pendingWindowRange']
  failedWindowRange?: LegacyResultFields['failedWindowRange']
  rowActionProgress?: LegacyResultFields['rowActionProgress']
  isExpired?: boolean
  isSorting?: boolean
  executionTimeMs?: number
  totalTimeMs?: number
  affectedRows?: number
  queryId?: string | null
  rowLimit?: number
  autoLimitApplied?: boolean
  errorMessage?: string | null
  viewMode?: ViewMode
  sortColumn?: string | null
  sortDirection?: 'asc' | 'desc' | null
  selectedRowIndex?: number | null
  /** Legacy: checked row positions, converted to single-row view ranges. */
  checkedRowIndices?: number[]
  exportDialogOpen?: boolean
  lastExecutedSql?: string | null
  reExecutable?: boolean
  isAnalyzed?: boolean

  editMode?: string | null
  editTableMetadata?: Record<string, QueryTableEditInfo>
  editForeignKeys?: ForeignKeyColumnInfo[]
  editState?: RowEditState | null
  isAnalyzingQuery?: boolean
  editableColumnMap?: Map<number, boolean>
  editColumnBindings?: Map<number, string>
  editBoundColumnIndexMap?: Map<string, number>
  saveError?: string | null
  editConnectionId?: string | null
  editingRowIndex?: number | null
}

/** Fields that belong on TabQueryState (tab-level). */
interface TabOverrides {
  content?: string
  selectedText?: string
  filePath?: string | null
  cursorPosition?: { lineNumber: number; column: number } | null
  connectionId?: string
  pendingNavigationAction?: (() => void) | null
  executionStartedAt?: number | null
  isCancelling?: boolean
  wasCancelled?: boolean
  activeBottomPanelItem?: TabQueryState['activeBottomPanelItem']
  activeResultIndex?: number
  results?: TabQueryState['results']
  runExport?: TabQueryState['runExport']
}

// All keys that belong to SingleResultState
const RESULT_KEYS = new Set<string>([
  'resultStatus',
  'columns',
  'totalRows',
  'viewRowCount',
  'viewVersion',
  'truncated',
  'rowCeiling',
  'appliedRowLimit',
  'fullExportBlockedReason',
  'filterModel',
  'draftRow',
  'editingBaseIndex',
  'checkedRanges',
  'checkedViewVersion',
  'isStale',
  'isFiltering',
  'viewError',
  'pendingWindowRange',
  'failedWindowRange',
  'rowActionProgress',
  'isExpired',
  'isSorting',
  'executionTimeMs',
  'totalTimeMs',
  'affectedRows',
  'queryId',

  'rowLimit',
  'autoLimitApplied',
  'errorMessage',
  'viewMode',
  'sortColumn',
  'sortDirection',
  'selectedRowIndex',
  'exportDialogOpen',
  'lastExecutedSql',
  'reExecutable',
  'isAnalyzed',
  'editMode',
  'editTableMetadata',
  'editForeignKeys',
  'editState',
  'isAnalyzingQuery',
  'editableColumnMap',
  'editColumnBindings',
  'editBoundColumnIndexMap',
  'saveError',
  'editConnectionId',
  'editingRowIndex',
  'scrollRow',
  'scrollCol',
  'pendingNavigationAction',
])

/**
 * Build a TabQueryState from flat overrides (old shape compatibility).
 * Splits the overrides into tab-level and result-level fields,
 * creating a single-element results array.
 *
 * The `tabStatus` field is applied to the tab level; `resultStatus` to the result level.
 * The legacy `status` shorthand sets both `tabStatus` and `resultStatus` at once.
 * For convenience, if none are provided, both default to 'idle'.
 */
export function makeTabState(
  overrides: ResultOverrides &
    TabOverrides & {
      tabStatus?: 'idle' | 'running' | 'success' | 'error'
      /** Legacy shorthand: sets both tabStatus and resultStatus. */
      status?: 'idle' | 'running' | 'success' | 'error'
    } = {}
): TabQueryState {
  const resultOverrides: Record<string, unknown> = {}
  const tabOverrides: Partial<TabQueryState> = {}
  let rows: unknown[][] | undefined

  for (const [key, value] of Object.entries(overrides)) {
    if (key === 'rows') {
      rows = value as unknown[][]
    } else if (key === 'checkedRowIndices') {
      resultOverrides.checkedRanges = (value as number[]).map(
        (index) => [index, index + 1] as const
      )
    } else if (key === 'status') {
      // Legacy shorthand: apply to both tab and result level
      tabOverrides.tabStatus = value as TabQueryState['tabStatus']
      resultOverrides.resultStatus = value as SingleResultState['resultStatus']
    } else if (key === 'tabStatus') {
      tabOverrides.tabStatus = value as TabQueryState['tabStatus']
    } else if (key === 'resultStatus') {
      resultOverrides.resultStatus = value as SingleResultState['resultStatus']
    } else if (RESULT_KEYS.has(key)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(resultOverrides as any)[key] = value
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(tabOverrides as any)[key] = value
    }
  }

  if (rows) {
    resultOverrides.totalRows ??= rows.length
    resultOverrides.viewRowCount ??= resultOverrides.totalRows
    resultOverrides.viewVersion ??= 1
    resultOverrides.latestKnownViewVersion = resultOverrides.viewVersion
    resultOverrides.queryId ??= 'q-test'
  }
  resultOverrides.checkedViewVersion ??= resultOverrides.viewVersion ?? 0

  const singleResult = resultState(resultOverrides)
  if (rows) (singleResult as unknown as Record<symbol, unknown>)[PENDING_ROWS] = rows

  return {
    content: '',
    selectedText: '',
    filePath: null,
    tabStatus: 'idle',
    prevTabStatus: 'idle',
    cursorPosition: null,
    connectionId: '',
    results: [singleResult],
    activeResultIndex: 0,
    activeBottomPanelItem: { type: 'result' },
    executionStartedAt: null,
    isCancelling: false,
    wasCancelled: false,
    runExport: null,
    ...tabOverrides,
  }
}

/**
 * Get the active result from a tab state (for assertions in tests).
 */
export function getTestActiveResult(tab: TabQueryState): SingleResultState {
  if (tab.results.length === 0) return { ...DEFAULT_RESULT_STATE }
  const idx = Math.min(tab.activeResultIndex, tab.results.length - 1)
  return tab.results[idx] ?? { ...DEFAULT_RESULT_STATE }
}

// ---------------------------------------------------------------------------
// Page-cache seeding for results built by makeTabState({ rows })
// ---------------------------------------------------------------------------

/** Row arrays already seeded (a spread result keeps its marker but must not reseed). */
let seededRowArrays = new WeakSet<unknown[][]>()
// The page cache is cleared after every test (setup.ts), so seeding starts over too.
beforeEach(() => {
  seededRowArrays = new WeakSet()
})

/**
 * Seed the real page cache with `rows` (base indices 0..n-1, identity view)
 * for a result surface.
 */
export function seedResultRows(
  tabId: string,
  resultIndex: number,
  result: SingleResultState,
  rows: unknown[][],
  connectionId = 'conn-1'
): void {
  seedResultWindow({
    route: 'query',
    connectionId,
    tabId,
    resultIndex,
    queryId: result.view.slot.queryId ?? 'q-test',
    viewVersion: result.view.slot.viewVersion,
    viewRowCount: result.view.slot.viewRowCount,
    columns: result.view.slot.columns,
    window: { offset: 0, rows, baseIndices: rows.map((_, index) => index) },
  })
}

useQueryStore.subscribe((state) => {
  for (const [tabId, tab] of Object.entries(state.tabs)) {
    tab.results.forEach((result, resultIndex) => {
      const rows = (result as unknown as Record<symbol, unknown[][] | undefined>)[PENDING_ROWS]
      if (!rows || seededRowArrays.has(rows)) return
      seededRowArrays.add(rows)
      seedResultRows(tabId, resultIndex, result, rows, tab.connectionId || 'conn-1')
    })
  }
})

// ---------------------------------------------------------------------------
// Windowed IPC response builders
// ---------------------------------------------------------------------------

/** First window for `rows` (offset 0, base indices 0..n-1, capped at 1,000 rows). */
export function firstWindowFor(rows: unknown[][], baseIndices?: number[]) {
  const shown = rows.slice(0, 1000)
  return {
    offset: 0,
    rows: shown,
    baseIndices: baseIndices?.slice(0, 1000) ?? shown.map((_, index) => index),
  }
}

/** An `execute_query` response for `rows` (identity view, untruncated by default). */
export function windowedResponse(
  overrides: Partial<ExecuteQueryResult> & { rows?: unknown[][] } = {}
): ExecuteQueryResult {
  const { rows = [], ...rest } = overrides
  return {
    queryId: 'q-1',
    columns: [],
    totalRows: rows.length,
    executionTimeMs: 5,
    totalTimeMs: 6,
    affectedRows: 0,
    autoLimitApplied: false,
    viewRowCount: rest.totalRows ?? rows.length,
    viewVersion: 1,
    truncated: false,
    rowCeiling: 100_000,
    appliedRowLimit: null,
    fullExportBlockedReason: null,
    firstWindow: firstWindowFor(rows),
    ...rest,
  }
}

/** A `MultiQueryResultItem` for `rows`. */
export function windowedItem(
  overrides: Partial<MultiQueryResultItem> & { rows?: unknown[][] } = {}
): MultiQueryResultItem {
  const { rows = [], ...rest } = overrides
  return {
    ...windowedResponse({ rows }),
    sourceSql: 'SELECT 1',
    error: null,
    reExecutable: true,
    ...rest,
  }
}

/** A view spec helper. */
export function viewSpec(
  sort: ResultViewSpec['sort'] = null,
  filters: ResultViewSpec['filters'] = []
): ResultViewSpec {
  return { sort, filters }
}
