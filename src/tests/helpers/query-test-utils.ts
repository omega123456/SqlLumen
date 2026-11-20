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
import type { TabQueryState, SingleResultState, ResultPatch } from '../../stores/query-store'
import { useQueryStore, getFlatTabState, DEFAULT_RESULT_STATE } from '../../stores/query-store'
import { patchedResult } from '../../stores/query-store/query-tab-reducers'
import type { DataViewPatch } from '../../stores/data-view/data-view-types'
import { mergeViewPatches } from '../../stores/data-view/data-view-reducers'
import {
  getLoadedRow,
  getResultSurface,
  seedResultWindow,
  type CachedRow,
} from '../../lib/result-window-cache'
import type { ExecuteQueryResult } from '../../lib/query-commands'
import type { MultiQueryResultItem, ResultViewSpec } from '../../types/schema'

/**
 * Shorthand: get a flat (tab + active result) view for the given tab ID.
 * Use this instead of defining a local `flat` function in each query-store test.
 */
export function flat(tabId: string) {
  const tab = useQueryStore.getState().getTabState(tabId)
  const resultIndex = Math.max(0, Math.min(tab.activeResultIndex, tab.results.length - 1))
  return { ...getFlatTabState(tab), rows: rowsOf(tabId, resultIndex) }
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

/** Rows a test result shows; seeded into the page cache once the result reaches the store. */
export const PENDING_ROWS = Symbol('pendingRows')

export interface PendingRows {
  [PENDING_ROWS]?: unknown[][]
}

export function pendingRowsOf(source: object): unknown[][] | undefined {
  return (source as PendingRows)[PENDING_ROWS]
}

export function withPendingRows<Target extends object>(
  target: Target,
  rows: unknown[][] | undefined
): Target {
  if (rows) (target as PendingRows)[PENDING_ROWS] = rows
  return target
}

/**
 * Result-patch marker for a result that shows `rows` (identity view). The rows
 * are seeded into the real page cache when the result reaches the store; the
 * store itself never holds rows.
 */
export function withRows(rows: unknown[][]): PendingRows {
  return { [PENDING_ROWS]: rows }
}

interface ResultOverrides extends ResultPatch, PendingRows {
  /** Rows of the result (seeded into the page cache, not stored in the store). */
  rows?: unknown[][]
  /** Checked row positions, converted to single-row view ranges. */
  checkedRowIndices?: number[]
}

type TabOverrides = Partial<Omit<TabQueryState, 'tabStatus'>>

type TabStatusValue = TabQueryState['tabStatus'] & SingleResultState['resultStatus']

export type MakeTabStateOverrides = ResultOverrides &
  TabOverrides & {
    tabStatus?: TabQueryState['tabStatus']
    /** Shorthand: sets both tabStatus and resultStatus. */
    status?: TabStatusValue
  }

const RESULT_FIELD_KEYS = new Set<string>([
  'resultStatus',
  'latestKnownViewVersion',
  'viewRequestSeq',
  'truncated',
  'rowCeiling',
  'exportedRowCount',
  'appliedRowLimit',
  'fullExportBlockedReason',
  'executionTimeMs',
  'totalTimeMs',
  'affectedRows',
  'rowLimit',
  'autoLimitApplied',
  'errorMessage',
  'lastExecutedSql',
  'reExecutable',
  'isAnalyzed',
  'isAnalyzingQuery',
  'view',
])

const HELPER_KEYS = new Set<string>(['rows', 'checkedRowIndices', 'status', 'tabStatus'])

interface SplitOverrides {
  result: ResultPatch
  tab: Partial<TabQueryState>
}

function splitOverrides(overrides: MakeTabStateOverrides): SplitOverrides {
  const result: Record<string, unknown> = {}
  const tab: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(overrides)) {
    if (HELPER_KEYS.has(key)) continue
    const target = RESULT_FIELD_KEYS.has(key) ? result : tab
    target[key] = value
  }
  return { result: result as ResultPatch, tab: tab as Partial<TabQueryState> }
}

function statusPatchOf(overrides: MakeTabStateOverrides): SplitOverrides {
  const tabStatus = overrides.tabStatus ?? overrides.status
  const resultStatus = overrides.resultStatus ?? overrides.status
  return {
    result: resultStatus ? { resultStatus: resultStatus } : {},
    tab: tabStatus ? { tabStatus: tabStatus } : {},
  }
}

function checkedRangesOf(overrides: MakeTabStateOverrides): DataViewPatch {
  const checkedRowIndices = overrides.checkedRowIndices
  if (!checkedRowIndices) return {}
  const ranges = checkedRowIndices.map((index) => [index, index + 1] as const)
  return { checked: { ranges: ranges } }
}

function rowsSlotOf(view: DataViewPatch, rows: unknown[][]): DataViewPatch {
  const slot = view.slot ?? {}
  const totalRows = slot.totalRows ?? rows.length
  const viewVersion = slot.viewVersion ?? 1
  return {
    slot: {
      totalRows: totalRows,
      viewRowCount: slot.viewRowCount ?? totalRows,
      viewVersion: viewVersion,
      queryId: slot.queryId ?? 'q-test',
    },
  }
}

function resultViewPatchOf(overrides: MakeTabStateOverrides, view: DataViewPatch): DataViewPatch {
  const withChecked = mergeViewPatches(checkedRangesOf(overrides), view)
  const rows = overrides.rows
  const withRowsSlot = rows
    ? mergeViewPatches(withChecked, rowsSlotOf(withChecked, rows))
    : withChecked
  const checkedViewVersion =
    withRowsSlot.checked?.viewVersion ?? withRowsSlot.slot?.viewVersion ?? 0
  return mergeViewPatches(withRowsSlot, { checked: { viewVersion: checkedViewVersion } })
}

function rowsVersionOf(overrides: MakeTabStateOverrides, view: DataViewPatch): ResultPatch {
  if (!overrides.rows) return {}
  return { latestKnownViewVersion: view.slot?.viewVersion ?? 1 }
}

function makeTestResult(overrides: MakeTabStateOverrides): SingleResultState {
  const split = splitOverrides(overrides)
  const status = statusPatchOf(overrides)
  const view = resultViewPatchOf(overrides, split.result.view ?? {})
  const result = patchedResult(DEFAULT_RESULT_STATE, {
    ...split.result,
    ...status.result,
    ...rowsVersionOf(overrides, view),
    view: view,
  })
  return withPendingRows(result, overrides.rows ?? pendingRowsOf(overrides))
}

/** `override` on top of `base`, merging their `view` patches group by group. */
export function mergedTabStateOverrides(
  base: MakeTabStateOverrides,
  override: MakeTabStateOverrides
): MakeTabStateOverrides {
  return { ...base, ...override, view: mergeViewPatches(base.view ?? {}, override.view ?? {}) }
}

/**
 * Build a TabQueryState holding one result. Result fields (and the nested
 * `view` patch) go to the result; everything else goes to the tab.
 */
export function makeTabState(overrides: MakeTabStateOverrides = {}): TabQueryState {
  const split = splitOverrides(overrides)
  const status = statusPatchOf(overrides)
  return {
    content: '',
    selectedText: '',
    filePath: null,
    tabStatus: 'idle',
    prevTabStatus: 'idle',
    cursorPosition: null,
    connectionId: '',
    results: [makeTestResult(overrides)],
    activeResultIndex: 0,
    activeBottomPanelItem: { type: 'result' },
    executionStartedAt: null,
    isCancelling: false,
    wasCancelled: false,
    runExport: null,
    ...split.tab,
    ...status.tab,
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
      const rows = pendingRowsOf(result)
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
