import { create } from 'zustand'
import type {
  BlobEnvelope,
  ColumnMeta,
  ExportFormat,
  FilterCondition,
  FrontendRowResidencyState,
  FullExportBlockedReason,
  MultiQueryResultItem,
  PrimaryKeyInfo,
  QueryTableEditInfo,
  RemoveResultRowsResult,
  ResultViewSpec,
  ResultWindow,
  RowEditState,
  SelectedCellInfo,
  SetResultViewResult,
  ViewMode,
} from '../types/schema'
import {
  executeQuery as executeQueryCmd,
  executeMultiQuery as executeMultiQueryCmd,
  executeCallQuery as executeCallQueryCmd,
  reexecuteSingleResult as reexecuteSingleResultCmd,
  evictResults as evictResultsCmd,
  setResultView as setResultViewCmd,
  fetchResultWindow as fetchResultWindowCmd,
  removeResultRows as removeResultRowsCmd,
  analyzeQueryForEdit as analyzeQueryForEditCmd,
  updateResultCell as updateResultCellCmd,
  cancelQuery as cancelQueryCmd,
  touchResults as touchResultsCmd,
  type ExecuteQueryResult,
  type ResultSlotRef,
} from '../lib/query-commands'
import {
  insertTableRow as insertTableRowCmd,
  updateTableRow as updateTableRowCmd,
  deleteTableRow as deleteTableRowCmd,
} from '../lib/table-data-commands'
import {
  RESULT_LOADING_STATUS_DELAY_MS,
  RESULT_PAGE_SIZE,
  applyResultView,
  applySavedRowValues,
  clearResultWindowPages,
  dropTabResultWindows,
  getLoadedRow,
  getResultSurface,
  isResultsExpiredError,
  parseSupersededVersion,
  readViewRange,
  retryFailedWindow,
  seedResultWindow,
  setWindowExpiredHandler,
  setWindowStatusHandler,
  type CachedRow,
  type ViewRange,
} from '../lib/result-window-cache'
import { formatCount, formatRowRange } from '../lib/format-row-count'
import {
  cancelResultExport as cancelResultExportCmd,
  getResultExportProgress as getResultExportProgressCmd,
  startResultExport as startResultExportCmd,
  type ResultExportProgress,
  type ResultExportStatus,
} from '../lib/export-commands'
import { showErrorToast, showSuccessToast, showWarningToast } from './toast-store'
import { useTableDataStore } from './table-data-store'
import {
  findAmbiguousColumns,
  buildBoundColumnIndexMap,
  buildEditableColumnMap,
  buildQueryEditColumnBindings,
  validateKeyColumnsPresent,
  buildRowEditState,
  buildInsertPayload,
  buildUpdatePayload,
} from '../lib/query-edit-utils'
import { mapSingleColumnForeignKeys } from '../lib/foreign-key-utils'
import type { ForeignKeyColumnInfo } from '../types/schema'
import { getFirstSqlKeyword } from '../lib/sql-utils'
import { useSettingsStore } from './settings-store'
import { useHistoryStore } from './history-store'
import { useWorkspaceStore } from './workspace-store'

import { logFrontend, logFrontendError, logFrontendWarning } from '../lib/app-log-commands'
import { frontendCacheLifecycle } from '../lib/frontend-cache-lifecycle'
import {
  buildExecuteQueryPlan,
  executeQueryPlan,
  type ExecuteQueryPlan,
} from '../lib/query-execution-plan'
import { isBlobEnvelope } from '../lib/blob-utils'
import { describeQueryFailure, toErrorMessage } from '../lib/error-message'
// Re-export for backward compatibility (used by tests and other modules)
export { stripLeadingSqlComments } from '../lib/sql-utils'

/** Default row-limit fallback used when settings have not been loaded (e.g. in tests). */
export const FALLBACK_ROW_LIMIT = 1000

/**
 * Read the default row limit from the settings store.
 * Returns the settings value if settings have been loaded; otherwise falls back
 * to FALLBACK_ROW_LIMIT (1000) so that existing tests are not affected.
 */
export function getDefaultRowLimit(): number {
  const state = useSettingsStore.getState()
  // Settings are loaded if the settings map has keys
  if (Object.keys(state.settings).length > 0) {
    const parsed = parseInt(state.getSetting('results.pageSize'), 10)
    if (!isNaN(parsed) && parsed > 0) return parsed
  }
  return FALLBACK_ROW_LIMIT
}

/**
 * Returns true if the SQL is a pure SELECT or WITH statement that can
 * potentially be used for inline editing. Returns false for SHOW, DESCRIBE,
 * EXPLAIN, DML, DDL, etc.
 *
 * Strips leading SQL comments (block, line `-- ...`, `# ...`) before
 * checking the first keyword.
 */
export function isEditableSelectSql(sql: string | null): boolean {
  if (!sql) return false
  const firstToken = getFirstSqlKeyword(sql)
  return firstToken === 'SELECT' || firstToken === 'WITH'
}

/**
 * Returns true if the SQL is a CALL statement (stored procedure).
 * Strips leading SQL comments before checking the first keyword.
 */
export function isCallSql(sql: string): boolean {
  return getFirstSqlKeyword(sql) === 'CALL'
}

function isQueryTabVisibleInWorkspace(tabId: string): boolean {
  const workspaceState = useWorkspaceStore.getState()

  for (const [connectionId, tabs] of Object.entries(workspaceState.tabsByConnection)) {
    if (!tabs.some((tab) => tab.id === tabId)) {
      continue
    }

    // A query tab is only globally visible when its connection session is the
    // visible connection AND it is the selected workspace tab. A selected tab
    // inside a hidden (background) connection is inactive for row residency.
    if (workspaceState.visibleConnectionSessionId !== connectionId) {
      return false
    }

    return workspaceState.activeTabByConnection[connectionId] === tabId
  }

  return false
}

export type ExecutionStatus = 'idle' | 'running' | 'success' | 'error'

/** Which rows the Export dialog should offer first ("Current view" / "All rows"). */
export type ExportRowScope = 'currentView' | 'allRows'

/** Polling interval for streaming full-export progress (ms). */
export const RESULT_EXPORT_POLL_MS = 500

interface BackgroundAnalysisRequest {
  tabId: string
  connectionId: string
  sql: string | null
  queryId: string | null
  resultIndex: number
  hasColumns: boolean
  onFailure: (error: unknown) => void
}

interface DeferredAnalysisRequest {
  tabId: string
  connectionId: string
  result: SingleResultState
  resultIndex: number
}

/** What a streaming full export ("All rows") writes, and where. */
export interface FullExportRequest {
  connectionId: string
  /** Result the export was started from. */
  resultIndex: number
  format: ExportFormat
  filePath: string
  includeHeaders: boolean
  /** Table name for SQL INSERT output. */
  tableName?: string
}

/**
 * A tab's streaming full-export job (D22). It lives outside `results[]`, so a
 * re-run that replaces the tab's results keeps it, and the store (not the
 * Export dialog) polls it and shows its toasts.
 */
export interface ResultExportJob extends FullExportRequest {
  /** Backend job id; null while `start_result_export` is pending or after it failed. */
  jobId: string | null
  /** Query id of the result the export was started from. */
  queryId: string
  status: ResultExportStatus
  /** Last polled progress, or null before the first poll. */
  progress: ResultExportProgress | null
  /** True once Cancel export was clicked (the dialog shows "Cancelling…"). */
  cancelRequested: boolean
  /** Failure message for the failed state, or null. */
  error: string | null
  /**
   * Identifies the `startFullExport` call that created this job. Patches
   * (cancel, progress) replace the job object, so the start compares this
   * token, not object identity, to tell whether the job was dropped or
   * replaced while `start_result_export` was pending.
   */
  startToken: number
}

/** Verbs of row actions that can outlive the 1 s progress threshold (wireframes 7 and 8). */
export type RowActionVerb = 'Copying' | 'Cutting' | 'Clearing' | 'Pasting' | 'Deleting'

/** Progress of a row action that fetches or writes many rows. */
export interface RowActionProgress {
  verb: RowActionVerb
  done: number
  total: number
  /** True when the action can be cancelled (fetches spanning more than one chunk). */
  cancellable: boolean
  /** False until the 1 s threshold passed; the toolbar only renders visible progress. */
  visible: boolean
}

/** Maximum checked rows a single bulk delete accepts (wireframe 7). */
export const MAX_BULK_DELETE_ROWS = 10_000
const VIEW_REFRESH_WINDOW_ROWS = 1000
const EDIT_ANALYSIS_ERROR_TOAST_DURATION_MS = 10_000
/** Above this many checked rows the delete dialog warns about duration (wireframe 7). */
export const BULK_DELETE_WARNING_ROWS = 1_000
/** Rows the text view renders at most (the rest needs export). */
export const TEXT_VIEW_ROW_CAP = 5_000

/** Tab-level status extends ExecutionStatus with AI-specific states. */
export type TabStatus = ExecutionStatus | 'ai-pending' | 'ai-reviewing' | 'restoring'
export type ActiveBottomPanelItem = { type: 'result' } | { type: 'table-data'; tabId: string }

// ---------------------------------------------------------------------------
// SingleResultState — per-result fields
// ---------------------------------------------------------------------------

export interface SingleResultState {
  /** Per-result execution status. */
  resultStatus: ExecutionStatus
  /** Column metadata from the query. */
  columns: ColumnMeta[]
  /** Live base rows in the Rust cache (deleted rows excluded). */
  totalRows: number
  /** Rows in the current view (after filter and deletes). */
  viewRowCount: number
  /** View version of the painted view (window fetches use it). */
  viewVersion: number
  /** Latest view version any response reported (compare-and-swap base, D15). */
  latestKnownViewVersion: number
  /** Sequence number of the latest issued `set_result_view` request. */
  viewRequestSeq: number
  /** True when the result hit the row ceiling. */
  truncated: boolean
  /** Row ceiling in force when the result ran. */
  rowCeiling: number
  /** LIMIT actually injected by auto-LIMIT, or null. */
  appliedRowLimit: number | null
  /** Why a truncated result can't be exported in full, or null. */
  fullExportBlockedReason: FullExportBlockedReason | null
  /** Server execution time only (ms), excluding row transfer/serialization. */
  executionTimeMs: number
  /** Total time (ms): execution + row transfer + serialization. */
  totalTimeMs: number
  /** Affected rows (for non-SELECT). */
  affectedRows: number
  /** Query ID for cache/sort/restore guards. */
  queryId: string | null
  /** Row limit (auto-limit cap). */
  rowLimit: number
  /** Whether 1000-row auto-LIMIT was applied. */
  autoLimitApplied: boolean
  /** Error message if status === 'error'. */
  errorMessage: string | null
  /** Current result view mode: grid, form, or text. */
  viewMode: ViewMode
  /** Column currently sorted by (null = no sort). */
  sortColumn: string | null
  /** Sort direction (null = no sort). */
  sortDirection: 'asc' | 'desc' | null
  /** View position of the selected row (null = none). */
  selectedRowIndex: number | null
  /** Checked rows as half-open view-position ranges (multi-select checkbox column). */
  checkedRanges: ViewRange[]
  /** View version the checked ranges belong to (cleared on every view change). */
  checkedViewVersion: number
  /** Whether the export dialog is open. */
  exportDialogOpen: boolean
  /** Row scope the Export dialog should preselect. */
  preferredExportScope: ExportRowScope
  /** The SQL that produced this result set. */
  lastExecutedSql: string | null
  /** Whether this result can be re-executed (false for stored proc results). */
  reExecutable: boolean
  /** Whether edit analysis has been performed for this result. */
  isAnalyzed: boolean
  /** Last clicked cell info (column + value) for filter dialog auto-population. */
  selectedCell: SelectedCellInfo | null

  /** Active filter conditions (mirrors the Rust view spec). */
  filterModel: FilterCondition[]
  /** True while a filter change (`set_result_view`) is pending. */
  isFiltering: boolean
  /** Message of the last failed view request (view-error band), or null. */
  viewError: string | null
  /** View range still loading after 1 s ("Loading rows X–Y…"), or null. */
  pendingWindowRange: ViewRange | null
  /** View range whose window fetch failed (Retry band), or null. */
  failedWindowRange: ViewRange | null
  /** Progress of a long row action (copy/cut/clear/paste/delete), or null. */
  rowActionProgress: RowActionProgress | null

  // --- Edit mode fields ---

  /** Selected table name for editing, or null for read-only. */
  editMode: string | null
  /** Cached table metadata keyed by composite `database.table` key. */
  editTableMetadata: Record<string, QueryTableEditInfo>
  /** FK metadata for the selected edit table (single-column constraints only). */
  editForeignKeys: ForeignKeyColumnInfo[]
  /** Current row edit state. */
  editState: RowEditState | null
  /** True while analyze_query_for_edit is in flight. */
  isAnalyzingQuery: boolean
  /** Column index → editable boolean for the selected edit table. */
  editableColumnMap: Map<number, boolean>
  /** Result column index → bound source-table column name for the edit target. */
  editColumnBindings: Map<number, string>
  /** Bound source-table column name → result column index. */
  editBoundColumnIndexMap: Map<string, number>
  /** Last save error message. */
  saveError: string | null
  /** True when the visible result rows no longer reflect the persisted backend state. */
  isStale: boolean
  /** Connection ID used for edit-mode IPC calls. */
  editConnectionId: string | null
  /** View position of the row being edited (the draft row sits at `viewRowCount`). */
  editingRowIndex: number | null
  /** Base index of the row being edited (saves and cache sync use it); null for a draft. */
  editingBaseIndex: number | null
  /** Unsaved clone draft, shown as a virtual row after the last view row. */
  draftRow: unknown[] | null

  // --- Scroll position ---

  /** Persisted vertical scroll cell index (row). */
  scrollRow: number
  /** Persisted horizontal scroll cell index (column). */
  scrollCol: number
  /** True when cached results have expired and are unrecoverable. */
  isExpired: boolean
  /** Frontend row-payload residency separate from backend cache expiration. */
  rowResidency: FrontendRowResidencyState
  /** Timestamp recorded when frontend rows were evicted from memory. */
  rowsEvictedAt: number | null
  /** True while a sort operation is in flight. */
  isSorting: boolean
}

// ---------------------------------------------------------------------------
// TabQueryState — tab-level fields + results array
// ---------------------------------------------------------------------------

export interface TabQueryState {
  /** The SQL content in the editor for this tab. */
  content: string
  /** Current selected text in the editor; empty string when nothing is selected. */
  selectedText: string
  /** File path if tab was opened from a file (for Save). */
  filePath: string | null
  /** Tab-level execution status. */
  tabStatus: TabStatus
  /** Previous tab status saved before AI lock, for restoration. */
  prevTabStatus: ExecutionStatus
  /** Cursor position (persisted so it can be restored on tab switch). */
  cursorPosition: { lineNumber: number; column: number } | null
  /** Connection ID for this tab (used for deferred analysis). */
  connectionId: string
  /** Array of per-result states. */
  results: SingleResultState[]
  /** Index of the currently active result. */
  activeResultIndex: number
  /** The currently visible item in the query tab's bottom panel. */
  activeBottomPanelItem: ActiveBottomPanelItem
  /** Deferred action waiting on unsaved changes dialog. */
  pendingNavigationAction: (() => void) | null
  /** Date.now() when the query started executing, null when idle. */
  executionStartedAt: number | null
  /** True while cancel IPC is in flight. */
  isCancelling: boolean
  /** True if the current error was caused by user cancellation. */
  wasCancelled: boolean
}

// ---------------------------------------------------------------------------
// Frozen singleton constants for edit-state resets.
// Using module-level singletons ensures Zustand's reference-equality check
// correctly identifies "no change" when edit state is cleared, avoiding
// unnecessary React re-renders.
// ---------------------------------------------------------------------------

const EMPTY_MAP = Object.freeze(new Map()) as Map<never, never>
const EMPTY_ARRAY = Object.freeze([]) as never[]
const EMPTY_OBJECT = Object.freeze({}) as Record<string, QueryTableEditInfo>

export const DEFAULT_RESULT_STATE: SingleResultState = {
  resultStatus: 'idle',
  columns: [],
  totalRows: 0,
  viewRowCount: 0,
  viewVersion: 0,
  latestKnownViewVersion: 0,
  viewRequestSeq: 0,
  truncated: false,
  rowCeiling: 0,
  appliedRowLimit: null,
  fullExportBlockedReason: null,
  executionTimeMs: 0,
  totalTimeMs: 0,
  affectedRows: 0,
  queryId: null,
  rowLimit: FALLBACK_ROW_LIMIT,
  autoLimitApplied: false,
  errorMessage: null,
  viewMode: 'grid',
  sortColumn: null,
  sortDirection: null,
  selectedRowIndex: null,
  checkedRanges: [],
  checkedViewVersion: 0,
  exportDialogOpen: false,
  preferredExportScope: 'currentView',
  lastExecutedSql: null,
  reExecutable: true,
  isAnalyzed: false,
  selectedCell: null,
  filterModel: [],
  isFiltering: false,
  viewError: null,
  pendingWindowRange: null,
  failedWindowRange: null,
  rowActionProgress: null,

  // Edit mode defaults
  editMode: null,
  editTableMetadata: EMPTY_OBJECT,
  editForeignKeys: EMPTY_ARRAY as unknown as ForeignKeyColumnInfo[],
  editState: null,
  isAnalyzingQuery: false,
  editableColumnMap: EMPTY_MAP as unknown as Map<number, boolean>,
  editColumnBindings: EMPTY_MAP as unknown as Map<number, string>,
  editBoundColumnIndexMap: EMPTY_MAP as unknown as Map<string, number>,
  saveError: null,
  isStale: false,
  editConnectionId: null,
  editingRowIndex: null,
  editingBaseIndex: null,
  draftRow: null,
  scrollRow: 0,
  scrollCol: 0,
  isExpired: false,
  rowResidency: {
    status: 'resident',
    isActive: false,
    inactiveSince: null,
  },
  rowsEvictedAt: null,
  isSorting: false,
}

const DEFAULT_TAB_STATE: TabQueryState = {
  content: '',
  selectedText: '',
  filePath: null,
  tabStatus: 'idle',
  prevTabStatus: 'idle',
  cursorPosition: null,
  connectionId: '',
  results: [],
  activeResultIndex: 0,
  activeBottomPanelItem: { type: 'result' },
  pendingNavigationAction: null,
  executionStartedAt: null,
  isCancelling: false,
  wasCancelled: false,
}

/** Default values for all edit-related fields on a SingleResultState (used by clearEditState). */
/** Per-row edit state, dropped when the view changes (edit mode itself stays). */
const ROW_EDIT_STATE_RESET: Partial<SingleResultState> = {
  editState: null,
  editingRowIndex: null,
  editingBaseIndex: null,
  draftRow: null,
  saveError: null,
}

const EDIT_STATE_DEFAULTS: Partial<SingleResultState> = {
  editMode: null,
  editTableMetadata: EMPTY_OBJECT,
  editForeignKeys: EMPTY_ARRAY as unknown as ForeignKeyColumnInfo[],
  editState: null,
  isAnalyzingQuery: false,
  editableColumnMap: EMPTY_MAP as unknown as Map<number, boolean>,
  editColumnBindings: EMPTY_MAP as unknown as Map<number, string>,
  editBoundColumnIndexMap: EMPTY_MAP as unknown as Map<string, number>,
  saveError: null,
  isStale: false,
  editConnectionId: null,
  editingRowIndex: null,
  editingBaseIndex: null,
  draftRow: null,
}

/**
 * Get the active result from a tab, or DEFAULT_RESULT_STATE if none.
 * Exported for use by components.
 */
export function getActiveResult(tab: TabQueryState | undefined): SingleResultState {
  if (!tab || tab.results.length === 0) return DEFAULT_RESULT_STATE
  const index = Math.min(tab.activeResultIndex, tab.results.length - 1)
  return tab.results[index] ?? DEFAULT_RESULT_STATE
}

export function hasUnsavedModifications(result: SingleResultState | undefined): boolean {
  const modifiedColumnCount = result?.editState?.modifiedColumns.size ?? 0
  return modifiedColumnCount > 0
}

export function hasAnyUnsavedEdits(tab: TabQueryState | undefined): boolean {
  if (!tab) return false
  return tab.results.some(hasUnsavedModifications)
}

/**
 * Flat view of a tab state — merges the active result's properties onto
 * the tab-level fields. Useful for backward-compatible read access in
 * components and tests that previously read the flat shape.
 */
export type FlatTabView = TabQueryState & SingleResultState

/**
 * Returns a flat view of the tab state, merging tab-level fields with
 * the active result's fields. If no results exist, returns default values.
 */
export function getFlatTabState(tab: TabQueryState | undefined): FlatTabView {
  const result = getActiveResult(tab)
  return {
    ...(tab ?? ({ ...DEFAULT_TAB_STATE } as TabQueryState)),
    ...result,
  }
}

/** Build a stable composite key for edit table metadata: `database.table`. */
function compositeTableKey(database: string, table: string): string {
  return `${database}.${table}`
}

/** Number of rows covered by half-open view ranges. */
export function countRanges(ranges: readonly ViewRange[]): number {
  return ranges.reduce((sum, [start, end]) => sum + Math.max(0, end - start), 0)
}

/** The view spec a result currently shows (sort and filter mirror the Rust view). */
export function getResultViewSpec(result: SingleResultState): ResultViewSpec {
  return {
    sort:
      result.sortColumn && result.sortDirection
        ? { column: result.sortColumn, direction: result.sortDirection }
        : null,
    filters: result.filterModel,
  }
}

/** The view spec to send with a re-run, or null when the result has no sort or filter. */
function rerunViewSpec(result: SingleResultState | undefined): ResultViewSpec | null {
  if (!result) return null
  const spec = getResultViewSpec(result)
  return spec.sort || spec.filters.length > 0 ? spec : null
}

/**
 * Sort and filter fields after a re-run with a view spec. Rust silently drops
 * conditions and a sort on columns the new result lacks, so mirror that here.
 */
function viewFieldsForColumns(
  spec: ResultViewSpec | null,
  columns: ColumnMeta[]
): Pick<SingleResultState, 'sortColumn' | 'sortDirection' | 'filterModel'> {
  const names = new Set(columns.map((column) => column.name))
  const sort = spec?.sort && names.has(spec.sort.column) ? spec.sort : null
  return {
    sortColumn: sort?.column ?? null,
    sortDirection: sort?.direction ?? null,
    filterModel: (spec?.filters ?? []).filter((condition) => names.has(condition.column)),
  }
}

const EMPTY_WINDOW: ResultWindow = { offset: 0, rows: [], baseIndices: [] }

/** Window/ceiling metadata of an execute response, tolerant of missing fields. */
function windowMetaFromResponse(
  response: Pick<MultiQueryResultItem, 'totalRows'> &
    Partial<
      Pick<
        MultiQueryResultItem,
        | 'viewRowCount'
        | 'viewVersion'
        | 'truncated'
        | 'rowCeiling'
        | 'appliedRowLimit'
        | 'fullExportBlockedReason'
        | 'firstWindow'
      >
    >
): {
  fields: Pick<
    SingleResultState,
    | 'viewRowCount'
    | 'viewVersion'
    | 'latestKnownViewVersion'
    | 'truncated'
    | 'rowCeiling'
    | 'appliedRowLimit'
    | 'fullExportBlockedReason'
  >
  window: ResultWindow
} {
  const viewVersion = response.viewVersion ?? 1
  return {
    fields: {
      viewRowCount: response.viewRowCount ?? response.totalRows,
      viewVersion: viewVersion,
      latestKnownViewVersion: viewVersion,
      truncated: response.truncated ?? false,
      rowCeiling: response.rowCeiling ?? 0,
      appliedRowLimit: response.appliedRowLimit ?? null,
      fullExportBlockedReason: response.fullExportBlockedReason ?? null,
    },
    window: response.firstWindow ?? EMPTY_WINDOW,
  }
}

/** Seed the page cache for a result from its execute response. */
function seedResultFromResponse(
  connectionId: string,
  tabId: string,
  resultIndex: number,
  response: Pick<MultiQueryResultItem, 'queryId' | 'columns' | 'totalRows'> &
    Partial<MultiQueryResultItem>
): void {
  const { fields, window } = windowMetaFromResponse(response)
  seedResultWindow({
    connectionId: connectionId,
    tabId: tabId,
    resultIndex: resultIndex,
    queryId: response.queryId,
    viewVersion: fields.viewVersion,
    viewRowCount: fields.viewRowCount,
    columns: response.columns,
    window: window,
  })
}

function buildEditBindingContext(
  result: SingleResultState,
  tableInfo: QueryTableEditInfo,
  metadataSource: Record<string, QueryTableEditInfo> = result.editTableMetadata
): {
  columnBindings: Map<number, string>
  boundColumnIndexMap: Map<string, number>
} {
  const queryTablesInOrder = Object.values(metadataSource)
  const columnBindings = buildQueryEditColumnBindings(
    result.lastExecutedSql,
    result.columns,
    tableInfo,
    queryTablesInOrder
  )

  return {
    columnBindings: columnBindings,
    boundColumnIndexMap: buildBoundColumnIndexMap(columnBindings),
  }
}

const DISPLAYED_BLOB_VALUE_BY_KIND: Record<
  BlobEnvelope['kind'],
  (envelope: BlobEnvelope) => unknown
> = {
  null: () => null,
  empty: () => '',
  bytes: (envelope) => envelope.base64 ?? '',
}

function toDisplayedQueryCellValue(value: unknown): unknown {
  if (!isBlobEnvelope(value)) {
    return value
  }
  return DISPLAYED_BLOB_VALUE_BY_KIND[value.kind](value)
}

function seedBlobViewerEditValues(
  row: unknown[],
  tableInfo: QueryTableEditInfo,
  editState: RowEditState,
  columnBindings: Map<number, string>
): RowEditState {
  const binaryColumns = new Map(
    tableInfo.columns
      .filter((column) => column.isBinary)
      .map((column) => [column.name.toLowerCase(), column.name])
  )

  if (binaryColumns.size === 0) {
    return editState
  }

  const originalValues = { ...editState.originalValues }
  const currentValues = { ...editState.currentValues }
  let changed = false

  for (const [resultColumnIndex, columnName] of columnBindings) {
    const binaryColumnName = binaryColumns.get(columnName.toLowerCase())
    if (!binaryColumnName) continue

    if (!(binaryColumnName in originalValues)) {
      originalValues[binaryColumnName] = row[resultColumnIndex] ?? null
      changed = true
    }
    if (!(binaryColumnName in currentValues)) {
      currentValues[binaryColumnName] = row[resultColumnIndex] ?? null
      changed = true
    }
  }

  return changed ? { ...editState, originalValues, currentValues } : editState
}

const EXECUTION_LOCKING_STATUSES: ReadonlySet<TabStatus> = new Set<TabStatus>([
  'running',
  'ai-pending',
  'ai-reviewing',
])

function isExecutionLocked(tab: TabQueryState | undefined): boolean {
  return tab !== undefined && EXECUTION_LOCKING_STATUSES.has(tab.tabStatus)
}

function residentRowResidency(
  previous: SingleResultState | undefined
): SingleResultState['rowResidency'] {
  const residency = previous?.rowResidency ?? DEFAULT_RESULT_STATE.rowResidency
  return {
    ...residency,
    status: 'resident',
    inactiveSince: residency.isActive ? null : residency.inactiveSince,
  }
}

function isRestorableEvictedResult(
  result: SingleResultState | undefined
): result is SingleResultState {
  return result !== undefined && result.rowResidency.status === 'evicted' && !result.isExpired
}

function needsDeferredAnalysis(result: SingleResultState | undefined): result is SingleResultState {
  return (
    result !== undefined &&
    !result.isAnalyzed &&
    result.reExecutable &&
    Boolean(result.lastExecutedSql)
  )
}

function restoreWindowStart(result: SingleResultState): number {
  const anchorRow = Math.min(result.scrollRow, Math.max(0, result.viewRowCount - 1))
  return Math.floor(anchorRow / RESULT_PAGE_SIZE) * RESULT_PAGE_SIZE
}

interface RowDeletionPlan {
  connectionId: string
  tableInfo: QueryTableEditInfo
  keyColumns: string[]
  keyColumnIndices: number[]
}

function resolveRowDeletionPlan(result: SingleResultState): RowDeletionPlan | null {
  if (!result.editMode) {
    showErrorToast('Delete failed', 'Enable edit mode to delete rows from the database.')
    return null
  }
  const tableInfo = result.editTableMetadata[result.editMode]
  if (!tableInfo?.primaryKey) {
    showErrorToast('Delete failed', `Cannot delete ${result.editMode}: no primary or unique key.`)
    return null
  }
  if (!result.editConnectionId) {
    showErrorToast('Delete failed', 'No active connection available for deletion.')
    return null
  }
  const keyColumns = tableInfo.primaryKey.keyColumns
  const keyColumnIndices = keyColumns.map(
    (column) => result.editBoundColumnIndexMap.get(column.toLowerCase()) ?? -1
  )
  if (keyColumnIndices.some((index) => index < 0)) {
    showErrorToast(
      'Delete failed',
      `Result set does not contain the key columns (${keyColumns.join(', ')}).`
    )
    return null
  }
  return {
    connectionId: result.editConnectionId,
    tableInfo: tableInfo,
    keyColumns: keyColumns,
    keyColumnIndices: keyColumnIndices,
  }
}

function primaryKeyValuesOf(plan: RowDeletionPlan, row: unknown[]): Record<string, unknown> {
  const primaryKeyValues: Record<string, unknown> = {}
  plan.keyColumns.forEach((column, columnIndex) => {
    primaryKeyValues[column] = row[plan.keyColumnIndices[columnIndex]]
  })
  return primaryKeyValues
}

interface ClonedDraftRow {
  row: unknown[]
  modifiedColumns: Set<string>
  insertEligibleColumns: Set<string>
}

interface CloneSelection {
  editMode: string
  selectedRowIndex: number
}

function resolveCloneSelection(result: SingleResultState): CloneSelection | null {
  if (!result.editMode) return null
  if (hasUnsavedModifications(result)) {
    showErrorToast('Unsaved changes', 'Save or discard the current row before cloning another row.')
    return null
  }
  if (result.editState?.isNewRow) return null
  const selectedRowIndex = result.selectedRowIndex
  if (selectedRowIndex === null || selectedRowIndex < 0) return null
  return { editMode: result.editMode, selectedRowIndex: selectedRowIndex }
}

function buildClonedEditState(
  result: SingleResultState,
  draft: ClonedDraftRow,
  keyColumns: string[]
): RowEditState {
  const editState = buildRowEditState(
    draft.row,
    result.columns,
    result.editableColumnMap,
    keyColumns,
    result.editColumnBindings,
    result.editBoundColumnIndexMap
  )
  for (const columnName of draft.insertEligibleColumns) {
    const boundColumnIndex = result.editBoundColumnIndexMap.get(columnName.toLowerCase())
    if (boundColumnIndex === undefined || boundColumnIndex < 0) continue
    const value = draft.row[boundColumnIndex]
    editState.originalValues[columnName] = value
    editState.currentValues[columnName] = value
  }
  return {
    ...editState,
    isNewRow: true,
    modifiedColumns: draft.modifiedColumns,
    insertEligibleColumns: draft.insertEligibleColumns,
  }
}

function modifiedColumnsAfterEdit(
  editState: RowEditState,
  columnName: string,
  value: unknown
): Set<string> {
  const modifiedColumns = new Set(editState.modifiedColumns)
  const isOriginalValue =
    JSON.stringify(editState.originalValues[columnName]) === JSON.stringify(value)
  if (isOriginalValue) {
    modifiedColumns.delete(columnName)
    return modifiedColumns
  }
  modifiedColumns.add(columnName)
  return modifiedColumns
}

function editStateWithCellValue(
  editState: RowEditState,
  columnName: string,
  value: unknown
): RowEditState {
  return {
    ...editState,
    currentValues: { ...editState.currentValues, [columnName]: value },
    modifiedColumns: modifiedColumnsAfterEdit(editState, columnName, value),
  }
}

function draftRowPatchForCell(
  result: SingleResultState,
  resultColumnIndex: number,
  value: unknown
): Partial<SingleResultState> {
  const draftRow = result.draftRow
  if (!draftRow || result.editingRowIndex !== result.viewRowCount) return {}
  return {
    draftRow: draftRow.map((cell, index) => (index === resultColumnIndex ? value : cell)),
  }
}

function editMetadataWithTable(
  metadata: Record<string, QueryTableEditInfo>,
  tableName: string,
  tableInfo: QueryTableEditInfo
): Record<string, QueryTableEditInfo> {
  if (tableName in metadata) return metadata
  return { ...metadata, [tableName]: tableInfo }
}

interface AmbiguousEditColumnsCheck {
  tableInfo: QueryTableEditInfo
  keyColumns: string[]
  ambiguous: Set<string>
  boundColumnIndexMap: Map<string, number>
}

function warnAboutAmbiguousEditColumns(check: AmbiguousEditColumnsCheck): void {
  const { tableInfo, keyColumns, ambiguous, boundColumnIndexMap } = check
  if (ambiguous.size === 0) return
  const keyColumnsLower = new Set(keyColumns.map((keyColumn) => keyColumn.toLowerCase()))
  const nonKeyAmbiguous = tableInfo.columns
    .map((column) => column.name)
    .filter((columnName) => {
      const lower = columnName.toLowerCase()
      return ambiguous.has(lower) && !keyColumnsLower.has(lower) && !boundColumnIndexMap.has(lower)
    })
  if (nonKeyAmbiguous.length === 0) return
  showWarningToast(
    'Ambiguous columns',
    `Some columns are ambiguous and cannot be edited: ${nonKeyAmbiguous.join(', ')}`
  )
}

function displayedCellUpdates(
  result: SingleResultState,
  editState: RowEditState
): Record<number, unknown> {
  const displayUpdates: Record<number, unknown> = {}
  for (const columnName of editState.modifiedColumns) {
    const columnIndex = result.editBoundColumnIndexMap.get(columnName.toLowerCase()) ?? -1
    if (columnIndex === -1) continue
    displayUpdates[columnIndex] = toDisplayedQueryCellValue(editState.currentValues[columnName])
  }
  return displayUpdates
}

function buildEditTableMetadata(tables: QueryTableEditInfo[]): Record<string, QueryTableEditInfo> {
  const metadata: Record<string, QueryTableEditInfo> = {}
  for (const table of tables) {
    metadata[compositeTableKey(table.database, table.table)] = table
  }
  return metadata
}

function buildSeededRowEditState(
  result: SingleResultState,
  tableInfo: QueryTableEditInfo,
  row: unknown[]
): RowEditState {
  const primaryKeyColumns = tableInfo.primaryKey?.keyColumns ?? []
  const baseEditState = buildRowEditState(
    row,
    result.columns,
    result.editableColumnMap,
    primaryKeyColumns,
    result.editColumnBindings,
    result.editBoundColumnIndexMap
  )
  return seedBlobViewerEditValues(row, tableInfo, baseEditState, result.editColumnBindings)
}

/** Build a SingleResultState from a MultiQueryResultItem. */
function buildSingleResultFromItem(
  item: MultiQueryResultItem,
  defaultRowLimit: number,
  isActive = false
): SingleResultState {
  const resultStatus: ExecutionStatus = item.error ? 'error' : 'success'
  return {
    ...DEFAULT_RESULT_STATE,
    ...windowMetaFromResponse(item).fields,
    resultStatus: resultStatus,
    columns: item.columns,
    totalRows: item.totalRows,
    executionTimeMs: item.executionTimeMs,
    totalTimeMs: item.totalTimeMs,
    affectedRows: item.affectedRows,
    queryId: item.queryId,
    rowLimit: defaultRowLimit,
    autoLimitApplied: item.autoLimitApplied,
    errorMessage: item.error ?? null,
    lastExecutedSql: item.sourceSql,
    reExecutable: item.reExecutable,
    isAnalyzed: false,
    rowResidency: {
      status: 'resident',
      isActive: isActive,
      inactiveSince: isActive ? null : Date.now(),
    },
  }
}

/** Fields shared by every path that replaces a result with a fresh execute response. */
function freshResultFields(
  response: ExecuteQueryResult | MultiQueryResultItem,
  spec: ResultViewSpec | null
): Partial<SingleResultState> {
  return {
    ...windowMetaFromResponse(response).fields,
    ...viewFieldsForColumns(spec, response.columns),
    columns: response.columns,
    totalRows: response.totalRows,
    queryId: response.queryId,
    executionTimeMs: response.executionTimeMs,
    totalTimeMs: response.totalTimeMs,
    affectedRows: response.affectedRows,
    autoLimitApplied: response.autoLimitApplied,
    viewRequestSeq: 0,
    isFiltering: false,
    isSorting: false,
    viewError: null,
    pendingWindowRange: null,
    failedWindowRange: null,
    checkedRanges: [],
    selectedRowIndex: null,
    draftRow: null,
  }
}

/** Handle returned by `beginRowAction`. */
export interface RowActionHandle {
  /** Report rows done so far. */
  update: (done: number) => void
  /** End the action. Returns true when its progress had become visible (1 s threshold). */
  finish: () => boolean
}

interface QueryState {
  /** Per-tab state keyed by tab ID. */
  tabs: Record<string, TabQueryState>

  /** Streaming full-export jobs keyed by tab ID (outside `results[]`, D22). */
  exportJobs: Record<string, ResultExportJob>

  /**
   * Start a streaming full export ("All rows") of a truncated, re-runnable
   * result. The store polls its progress until it ends, shows the completion
   * toast or `showErrorToast` itself (also when the tab is inactive), and
   * closes the Export dialog on completion. Ignored while a job is running.
   */
  startFullExport: (tabId: string, request: FullExportRequest) => Promise<void>

  /** Cancel the tab's running full export ("Cancel export"). */
  cancelFullExport: (tabId: string) => Promise<void>

  /** Get or create state for a tab. */
  getTabState: (tabId: string) => TabQueryState

  /** Update editor content for a tab. */
  setContent: (tabId: string, content: string) => void

  /** Update current selected text for a tab. */
  setSelectedText: (tabId: string, selectedText: string) => void

  /** Update file path for a tab (when opened from or saved to file). */
  setFilePath: (tabId: string, filePath: string | null) => void

  /** Update cursor position for a tab (persisted for tab switching). */
  setCursorPosition: (tabId: string, position: { lineNumber: number; column: number }) => void

  /** Execute a SQL query for a tab (single statement, non-CALL). */
  /**
   * Execute a single statement for a tab. `viewSpec` (sort plus filters) is
   * applied in Rust so the first window arrives already sorted and filtered;
   * it is used when restoring an expired result (D18).
   */
  executeQuery: (
    connectionId: string,
    tabId: string,
    sql: string,
    viewSpec?: ResultViewSpec | null
  ) => Promise<void>

  /** Execute multiple SQL statements for a tab. */
  executeMultiQuery: (connectionId: string, tabId: string, statements: string[]) => Promise<void>

  /** Execute a CALL statement for a tab. */
  executeCallQuery: (connectionId: string, tabId: string, sql: string) => Promise<void>

  /** Set the active result tab index. */
  setActiveResultIndex: (tabId: string, index: number) => void

  /** Set the active bottom-panel item for a query tab. */
  setActiveBottomPanelItem: (tabId: string, item: ActiveBottomPanelItem) => void

  /** Clean up state for a tab (called on tab close). */
  cleanupTab: (connectionId: string, tabId: string) => void

  /** Clean up all tabs for a connection (called on disconnect). */
  cleanupConnection: (connectionId: string, tabIds: string[]) => void

  /** Set the result view mode (grid/form/text). */
  setViewMode: (tabId: string, mode: ViewMode) => void

  /** Set the selected row index. */
  setSelectedRow: (tabId: string, index: number | null) => void

  /**
   * Replace the checked rows of the active result: half-open view-position
   * ranges, tagged with the current view version (cleared on every view change).
   */
  setCheckedRanges: (tabId: string, ranges: ViewRange[]) => void

  /**
   * Delete the checked rows from the bound source table. Only valid in edit mode
   * (a table with a primary/unique key whose key columns are present in the
   * result) — the same gating as cell editing. Rows are deleted one statement at
   * a time; the base indices of the rows MySQL actually deleted are then
   * tombstoned in the Rust cache with `remove_result_rows`, with no query re-run.
   * Refuses more than `MAX_BULK_DELETE_ROWS` rows. Resolves with the number of
   * rows deleted.
   */
  deleteResultRows: (tabId: string) => Promise<number>

  /**
   * Track a long row action (copy/cut/clear/paste/delete). Progress becomes
   * visible after 1 s. `onCancel` (when given) is wired to the toolbar Cancel.
   */
  beginRowAction: (
    tabId: string,
    verb: RowActionVerb,
    total: number,
    onCancel?: () => void
  ) => RowActionHandle

  /** Cancel the running row action of the active result, if it is cancellable. */
  cancelRowAction: (tabId: string) => void

  /** Mark every result of a tab expired (routes to the "Results expired" block). */
  markResultsExpired: (tabId: string) => void

  /** Retry the failed window range of the active result (the Retry band). */
  retryResultWindow: (tabId: string) => void

  /** Re-issue the latest requested sort/filter of the active result (view-error band). */
  retryViewChange: (tabId: string) => void

  /** Set the selected cell info (column + value) for filter dialog auto-population. */
  setSelectedCell: (tabId: string, cell: SelectedCellInfo | null) => void

  /** Persist the scroll position (cell indices) for the active result. */
  setResultScrollCell: (tabId: string, scrollRow: number, scrollColumn: number) => void

  /** Apply filter conditions to a query result (filtering runs in Rust). */
  applyQueryFilters: (tabId: string, resultIndex: number, conditions: FilterCondition[]) => void

  /** Open the export dialog, optionally preselecting a row scope. */
  openExportDialog: (tabId: string, scope?: ExportRowScope) => void

  /** Close the export dialog. */
  closeExportDialog: (tabId: string) => void

  /** Sort results by a column (sorting runs in Rust over a view; clearing needs no re-run). */
  sortResults: (
    connectionId: string,
    tabId: string,
    column: string,
    direction: 'asc' | 'desc' | null
  ) => Promise<void>

  /** Change row limit and re-execute the query. */
  changeRowLimit: (connectionId: string, tabId: string, size: number) => Promise<void>

  /** Cancel a running query for a tab. */
  cancelQuery: (connectionId: string, tabId: string) => Promise<void>

  // --- Edit mode actions ---

  /** Enable or disable edit mode for a table. connectionId needed for IPC. */
  setEditMode: (connectionId: string, tabId: string, tableName: string | null) => Promise<void>

  /**
   * Start editing the row at a view position. `row` supplies the row when it
   * isn't in the page cache (e.g. an FK lookup on a row that was just fetched).
   */
  startEditingRow: (tabId: string, rowIndex: number, row?: CachedRow) => void

  /** Clone the selected persisted row into an unsaved insert draft. */
  cloneSelectedRow: (tabId: string) => void

  /** Update a cell value in the current edit state (editState only). */
  updateCellValue: (tabId: string, resultColumnIndex: number, value: unknown) => void

  /** Update a cell value in the edit state (the grid overlays edit-state values). */
  syncCellValue: (tabId: string, resultColumnIndex: number, value: unknown) => void

  /** Save the currently editing row to the database. Returns true on success, false on failure. */
  saveCurrentRow: (tabId: string) => Promise<boolean>

  /** Discard edits and restore original row values. */
  discardCurrentRow: (tabId: string) => void

  /** Execute action immediately if no pending edits, otherwise defer. */
  requestNavigationAction: (tabId: string, action: () => void) => void

  /** Resolve deferred navigation: save first if shouldSave, then execute. */
  confirmNavigation: (tabId: string, shouldSave: boolean) => Promise<void>

  /** Cancel deferred navigation. */
  cancelNavigation: (tabId: string) => void

  /** Reset all edit-related fields to defaults on the active result. */
  clearEditState: (tabId: string) => void

  /**
   * Set the tab-level status. Used by the AI store to lock/unlock the editor.
   * When setting an AI lock state ('ai-pending' | 'ai-reviewing'), the current
   * tabStatus is saved into prevTabStatus for later restoration.
   */
  setTabStatus: (tabId: string, status: TabStatus) => void

  /** Validate active tab results via touch_results IPC. Marks expired when backend reports expiration. */
  validateActiveTabResults: (tabId: string) => void

  /** Retry an expired result by re-executing the query using the shared execution planner. */
  retryExpiredResult: (tabId: string) => Promise<void>

  /** Mark a query-result surface active and restore evicted frontend rows when needed. */
  markResultSurfaceActive: (tabId: string, resultIndex?: number) => Promise<void>

  /** Mark a query-result surface inactive and schedule frontend row eviction when safe. */
  markResultSurfaceInactive: (tabId: string, resultIndex?: number) => void

  /** Drop the page cache of a hidden query result while preserving restore metadata. */
  evictInactiveResultRows: (tabId: string, resultIndex: number) => void

  /** Re-check the backend cache and refetch the visible window of an evicted result. */
  restoreEvictedResultRows: (tabId: string, resultIndex?: number) => Promise<void>
}

/** Pending full-export progress polls, keyed by tab ID. */
const exportPollTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** Source of `ResultExportJob.startToken`. */
let nextExportStartToken = 0

function stopExportPolling(tabId: string): void {
  const timer = exportPollTimers.get(tabId)
  if (timer !== undefined) {
    clearTimeout(timer)
    exportPollTimers.delete(tabId)
  }
}

export const useQueryStore = create<QueryState>()((set, get) => {
  const getResultSurfaceKey = (tabId: string, resultIndex: number): string =>
    `query-result:${tabId}:${resultIndex}`

  const resultAt = (tabId: string, resultIndex: number): SingleResultState | undefined =>
    get().tabs[tabId]?.results[resultIndex]

  const isDirtyResult = (result: SingleResultState | undefined): boolean => {
    if (!result?.editState) return false
    return result.editState.isNewRow || result.editState.modifiedColumns.size > 0
  }

  /** Merge a partial update into a single tab's state. */
  const patchTab = (tabId: string, partial: Partial<TabQueryState>) => {
    set((state) => ({
      tabs: {
        ...state.tabs,
        [tabId]: { ...(state.tabs[tabId] ?? DEFAULT_TAB_STATE), ...partial },
      },
    }))
  }

  /** Patch a specific result by index within a tab's results array. */
  const patchResultByIndex = (
    tabId: string,
    resultIndex: number,
    partial: Partial<SingleResultState>
  ) => {
    set((state) => {
      const tab = state.tabs[tabId]
      if (!tab || resultIndex < 0 || resultIndex >= tab.results.length) return state
      const newResults = [...tab.results]
      newResults[resultIndex] = { ...newResults[resultIndex], ...partial }
      return {
        tabs: {
          ...state.tabs,
          [tabId]: { ...tab, results: newResults },
        },
      }
    })
  }

  const cancelResultLifecycleTimer = (tabId: string, resultIndex: number) => {
    frontendCacheLifecycle.cancel(getResultSurfaceKey(tabId, resultIndex))
  }

  const cancelAllResultLifecycleTimers = (tabId: string, resultCount: number) => {
    for (let index = 0; index < resultCount; index++) {
      cancelResultLifecycleTimer(tabId, index)
    }
  }

  const patchResultResidency = (
    tabId: string,
    resultIndex: number,
    partial: Partial<FrontendRowResidencyState>
  ) => {
    set((state) => {
      const tab = state.tabs[tabId]
      if (!tab || resultIndex < 0 || resultIndex >= tab.results.length) return state
      const current = tab.results[resultIndex]
      const nextResidency = {
        ...current.rowResidency,
        ...partial,
      }
      const nextResult = {
        ...current,
        rowResidency: nextResidency,
      }
      const nextResults = [...tab.results]
      nextResults[resultIndex] = nextResult
      return {
        tabs: {
          ...state.tabs,
          [tabId]: { ...tab, results: nextResults },
        },
      }
    })
  }

  /** Get the active result index for a tab (safe). */
  const getActiveIndex = (tabId: string): number => {
    const tab = get().tabs[tabId]
    if (!tab || tab.results.length === 0) return 0
    return Math.min(tab.activeResultIndex, tab.results.length - 1)
  }

  // -------------------------------------------------------------------------
  // Streaming full export (D22): job state per tab, polled by the store.
  // -------------------------------------------------------------------------

  const patchExportJob = (tabId: string, partial: Partial<ResultExportJob>) => {
    set((state) => {
      const job = state.exportJobs[tabId]
      if (!job) return state
      return { exportJobs: { ...state.exportJobs, [tabId]: { ...job, ...partial } } }
    })
  }

  const dropExportJob = (tabId: string) => {
    stopExportPolling(tabId)
    set((state) => {
      if (!(tabId in state.exportJobs)) return state
      const exportJobs = { ...state.exportJobs }
      delete exportJobs[tabId]
      return { exportJobs }
    })
  }

  const isExportDialogOpenForTab = (tabId: string): boolean =>
    get().tabs[tabId]?.results.some((result) => result.exportDialogOpen) ?? false

  const closeExportDialogsForTab = (tabId: string) => {
    set((state) => {
      const tab = state.tabs[tabId]
      if (!tab || !tab.results.some((result) => result.exportDialogOpen)) return state
      return {
        tabs: {
          ...state.tabs,
          [tabId]: {
            ...tab,
            results: tab.results.map((result) =>
              result.exportDialogOpen ? { ...result, exportDialogOpen: false } : result
            ),
          },
        },
      }
    })
  }

  /** Cancel a backend job without waiting (tab closed, start raced a close). */
  const cancelExportJobInBackground = (jobId: string, context: string) => {
    cancelResultExportCmd(jobId).catch((error: unknown) => {
      logFrontendError(`[query-store] cancelResultExport failed (${context}):`, error)
    })
  }

  /**
   * End a job. Completed: drop it, close the dialog, show the success toast.
   * Cancelled or failed: keep it while the dialog is open (it renders the
   * InfoBar), otherwise drop it; a failure always shows `showErrorToast`.
   */
  const finishExportJob = (tabId: string, progress: ResultExportProgress) => {
    const job = get().exportJobs[tabId]
    if (!job) return
    stopExportPolling(tabId)
    if (progress.status === 'completed') {
      dropExportJob(tabId)
      closeExportDialogsForTab(tabId)
      const limitNote = progress.stoppedAtSheetLimit
        ? " Stopped at Excel's 1,048,576-row limit."
        : ''
      showSuccessToast(
        'Export completed',
        `${formatCount(progress.rowsWritten)} rows saved to ${job.filePath}${limitNote}`
      )
      if (progress.error) {
        logFrontend('warn', `[query-store] full export: ${progress.error}`)
        showWarningToast('Database not restored', progress.error)
      }
      return
    }
    const error =
      progress.status === 'failed' ? (progress.error ?? 'The export stopped unexpectedly.') : null
    if (progress.status === 'failed') {
      showErrorToast('Export failed', error ?? undefined)
    }
    if (!isExportDialogOpenForTab(tabId)) {
      dropExportJob(tabId)
      return
    }
    patchExportJob(tabId, {
      status: progress.status,
      progress: progress,
      error: error,
      cancelRequested: false,
    })
  }

  const pollExportJob = async (tabId: string, jobId: string) => {
    exportPollTimers.delete(tabId)
    let progress: ResultExportProgress
    try {
      progress = await getResultExportProgressCmd(jobId)
    } catch (error) {
      if (get().exportJobs[tabId]?.jobId !== jobId) return
      const message = toErrorMessage(error)
      logFrontend('error', `[query-store] getResultExportProgress failed: ${message}`)
      finishExportJob(tabId, {
        status: 'failed',
        rowsWritten: get().exportJobs[tabId]?.progress?.rowsWritten ?? 0,
        bytesWritten: 0,
        elapsedMs: 0,
        stoppedAtSheetLimit: false,
        error: message,
      })
      return
    }
    // The job was dropped (tab or connection cleaned up) or replaced meanwhile.
    if (get().exportJobs[tabId]?.jobId !== jobId) return
    if (progress.status === 'running') {
      patchExportJob(tabId, { progress })
      scheduleExportPoll(tabId, jobId, RESULT_EXPORT_POLL_MS)
      return
    }
    finishExportJob(tabId, progress)
  }

  const scheduleExportPoll = (tabId: string, jobId: string, delayMs: number) => {
    stopExportPolling(tabId)
    exportPollTimers.set(
      tabId,
      setTimeout(() => {
        void pollExportJob(tabId, jobId)
      }, delayMs)
    )
  }

  // -------------------------------------------------------------------------
  // Window cache wiring: window-level status is mirrored into result metadata.
  // -------------------------------------------------------------------------

  setWindowStatusHandler((tabId, resultIndex, patch, failure) => {
    const result = resultAt(tabId, resultIndex)
    if (!result) return
    patchResultByIndex(tabId, resultIndex, patch)
    if (failure && patch.failedWindowRange) {
      const [start, end] = patch.failedWindowRange
      showErrorToast(`Couldn't load rows ${formatRowRange(start + 1, end)}`, failure.message)
    }
  })
  setWindowExpiredHandler((tabId) => {
    if (get().tabs[tabId]) markTabResultsExpired(tabId)
  })

  /** The cached-result slot of a result, or null when it has no query id. */
  const slotFor = (tabId: string, resultIndex: number): ResultSlotRef | null => {
    const tab = get().tabs[tabId]
    const result = tab?.results[resultIndex]
    if (!tab || !result?.queryId) return null
    return {
      connectionId: getResultSurface(tabId, resultIndex)?.slot.connectionId || tab.connectionId,
      tabId: tabId,
      resultIndex: resultIndex,
      queryId: result.queryId,
    }
  }

  /** Row of a result at a view position: the clone draft, or a loaded page-cache row. */
  const rowAt = (
    tabId: string,
    resultIndex: number,
    result: SingleResultState,
    position: number
  ): CachedRow | null => {
    if (result.draftRow && position === result.viewRowCount) {
      return { row: result.draftRow, baseIndex: -1 }
    }
    return getLoadedRow(tabId, resultIndex, position) ?? null
  }

  // -------------------------------------------------------------------------
  // Row-action progress (wireframes 7 and 8)
  // -------------------------------------------------------------------------

  const rowActionCancels = new Map<string, () => void>()

  // -------------------------------------------------------------------------
  // View requests: compare-and-swap with sequence numbers and one re-issue (D15)
  // -------------------------------------------------------------------------

  interface ViewTracker {
    queryId: string
    /** Latest requested spec: the base for the next sort or filter change. */
    spec: ResultViewSpec
    /** Spec of the last failed request; Retry re-issues it. */
    retrySpec: ResultViewSpec | null
    lastSuccess: { seq: number; spec: ResultViewSpec; response: SetResultViewResult } | null
  }
  const viewTrackers = new Map<string, ViewTracker>()
  const trackerFor = (tabId: string, resultIndex: number, result: SingleResultState) => {
    const key = `${tabId}:${resultIndex}`
    const existing = viewTrackers.get(key)
    // A result that has issued no view request yet (fresh execute) starts a new tracker.
    if (existing && existing.queryId === result.queryId && result.viewRequestSeq > 0) {
      return existing
    }
    const tracker: ViewTracker = {
      queryId: result.queryId ?? '',
      spec: getResultViewSpec(result),
      retrySpec: null,
      lastSuccess: null,
    }
    viewTrackers.set(key, tracker)
    return tracker
  }

  /** Forget the view trackers of a tab (closed, or its results replaced). */
  const dropViewTrackers = (tabId: string) => {
    for (const key of viewTrackers.keys()) {
      if (key.startsWith(`${tabId}:`)) viewTrackers.delete(key)
    }
  }

  /** Paint a view response: page cache plus result metadata. */
  const paintView = (
    tabId: string,
    resultIndex: number,
    spec: ResultViewSpec,
    view: { viewVersion: number; viewRowCount: number; totalRows: number; window?: ResultWindow },
    extra: Partial<SingleResultState> = {}
  ) => {
    applyResultView(tabId, resultIndex, view)
    const result = resultAt(tabId, resultIndex)
    patchResultByIndex(tabId, resultIndex, {
      viewVersion: view.viewVersion,
      latestKnownViewVersion: Math.max(result?.latestKnownViewVersion ?? 0, view.viewVersion),
      viewRowCount: view.viewRowCount,
      totalRows: view.totalRows,
      sortColumn: spec.sort?.column ?? null,
      sortDirection: spec.sort?.direction ?? null,
      filterModel: spec.filters,
      checkedRanges: [],
      checkedViewVersion: view.viewVersion,
      selectedRowIndex: null,
      selectedCell: null,
      pendingWindowRange: null,
      failedWindowRange: null,
      isSorting: false,
      isFiltering: false,
      viewError: null,
      ...extra,
    })
  }

  interface IssuedViewRequest {
    tabId: string
    resultIndex: number
    seq: number
    spec: ResultViewSpec
    attempt: number
    queryId: string | null
  }

  const currentResultOfRequest = (request: IssuedViewRequest): SingleResultState | null => {
    const latest = get().tabs[request.tabId]?.results[request.resultIndex]
    return latest?.queryId === request.queryId ? latest : null
  }

  const applyViewResponse = async (
    request: IssuedViewRequest,
    latest: SingleResultState,
    response: SetResultViewResult
  ): Promise<void> => {
    const { tabId, resultIndex, seq, spec } = request
    const tracker = trackerFor(tabId, resultIndex, latest)
    tracker.lastSuccess = { seq, spec, response }
    patchResultByIndex(tabId, resultIndex, {
      latestKnownViewVersion: Math.max(latest.latestKnownViewVersion, response.viewVersion),
    })
    if (seq !== latest.viewRequestSeq) return
    if (response.viewVersion < latest.latestKnownViewVersion) {
      await repaintLatestKnownView(tabId, resultIndex, spec)
      return
    }
    paintView(tabId, resultIndex, spec, {
      viewVersion: response.viewVersion,
      viewRowCount: response.viewRowCount,
      totalRows: response.totalRows,
      window: response.firstWindow,
    })
  }

  const recordSupersededViewVersion = (
    request: IssuedViewRequest,
    latest: SingleResultState,
    supersededVersion: number | null
  ) => {
    const isNewerVersion =
      supersededVersion !== null && supersededVersion > latest.latestKnownViewVersion
    if (!isNewerVersion) return
    patchResultByIndex(request.tabId, request.resultIndex, {
      latestKnownViewVersion: supersededVersion,
    })
  }

  const handleViewRequestFailure = async (
    request: IssuedViewRequest,
    latest: SingleResultState,
    error: unknown
  ): Promise<void> => {
    const { tabId, resultIndex, seq, spec } = request
    const supersededVersion = parseSupersededVersion(error)
    recordSupersededViewVersion(request, latest, supersededVersion)
    if (seq !== latest.viewRequestSeq) {
      logFrontend(
        'info',
        `[query-store] set_result_view failed for a superseded request (${tabId}/${resultIndex}): ${toErrorMessage(
          error
        )}`
      )
      return
    }
    const canReissue = supersededVersion !== null && request.attempt === 0
    if (canReissue) {
      await issueViewRequest(tabId, resultIndex, seq, supersededVersion, spec, 1)
      return
    }
    await settleViewFailure(tabId, resultIndex, error)
  }

  const issueViewRequest = async (
    tabId: string,
    resultIndex: number,
    seq: number,
    baseViewVersion: number,
    spec: ResultViewSpec,
    attempt: number
  ): Promise<void> => {
    const slot = slotFor(tabId, resultIndex)
    if (!slot) return
    const request: IssuedViewRequest = {
      tabId: tabId,
      resultIndex: resultIndex,
      seq: seq,
      spec: spec,
      attempt: attempt,
      queryId: slot.queryId,
    }
    try {
      const response = await setResultViewCmd(slot, baseViewVersion, spec)
      const latest = currentResultOfRequest(request)
      if (!latest) return
      await applyViewResponse(request, latest, response)
    } catch (error) {
      const latest = currentResultOfRequest(request)
      if (!latest) return
      await handleViewRequestFailure(request, latest, error)
    }
  }

  const settleViewFailure = async (tabId: string, resultIndex: number, error: unknown) => {
    if (isResultsExpiredError(error)) {
      patchResultByIndex(tabId, resultIndex, { isSorting: false, isFiltering: false })
      markTabResultsExpired(tabId)
      return
    }
    await settleFailedView(tabId, resultIndex, error)
  }

  /**
   * Fetch the first window of the latest view version the server reported and
   * paint it with `spec`. Used when the server moved past the response at hand,
   * so the grid never settles on a version whose windows are all `view_stale`.
   * A failed refetch settles through the D15 terminal rule.
   */
  const repaintLatestKnownView = async (
    tabId: string,
    resultIndex: number,
    spec: ResultViewSpec
  ): Promise<void> => {
    const result = resultAt(tabId, resultIndex)
    const slot = slotFor(tabId, resultIndex)
    if (!result || !slot) return
    try {
      const window = await fetchResultWindowCmd(
        slot,
        result.latestKnownViewVersion,
        0,
        VIEW_REFRESH_WINDOW_ROWS
      )
      if (resultAt(tabId, resultIndex)?.queryId !== slot.queryId) return
      paintView(tabId, resultIndex, spec, {
        viewVersion: window.viewVersion,
        viewRowCount: window.viewRowCount,
        totalRows: resultAt(tabId, resultIndex)?.totalRows ?? result.totalRows,
        window: window,
      })
    } catch (error) {
      if (resultAt(tabId, resultIndex)?.queryId !== slot.queryId) return
      await settleViewFailure(tabId, resultIndex, error)
    }
  }

  interface FailedViewSettlement {
    tabId: string
    resultIndex: number
    result: SingleResultState
    tracker: ViewTracker
    errorPatch: Partial<SingleResultState>
  }

  const repaintLastSuccessfulView = (
    failure: FailedViewSettlement,
    success: NonNullable<ViewTracker['lastSuccess']>
  ) => {
    failure.tracker.spec = success.spec
    paintView(
      failure.tabId,
      failure.resultIndex,
      success.spec,
      {
        viewVersion: success.response.viewVersion,
        viewRowCount: success.response.viewRowCount,
        totalRows: success.response.totalRows,
        window: success.response.firstWindow,
      },
      failure.errorPatch
    )
  }

  const refetchServerViewAfterFailure = async (failure: FailedViewSettlement): Promise<boolean> => {
    const { tabId, resultIndex, result, tracker, errorPatch } = failure
    const fallbackSpec = tracker.lastSuccess?.spec ?? getResultViewSpec(result)
    tracker.spec = fallbackSpec
    const slot = slotFor(tabId, resultIndex)
    try {
      if (!slot) throw new Error('Result is no longer available')
      const window = await fetchResultWindowCmd(
        slot,
        result.latestKnownViewVersion,
        0,
        VIEW_REFRESH_WINDOW_ROWS
      )
      if (resultAt(tabId, resultIndex)?.queryId !== slot.queryId) return false
      paintView(
        tabId,
        resultIndex,
        fallbackSpec,
        {
          viewVersion: window.viewVersion,
          viewRowCount: window.viewRowCount,
          totalRows: result.totalRows,
          window: window,
        },
        errorPatch
      )
    } catch (refetchError) {
      logFrontend(
        'warn',
        `[query-store] could not refetch the current view after a failed view change: ${String(refetchError)}`
      )
      patchResultByIndex(tabId, resultIndex, errorPatch)
    }
    return true
  }

  const revertFailedView = async (failure: FailedViewSettlement): Promise<boolean> => {
    const success = failure.tracker.lastSuccess
    const isLastSuccessServerView =
      success !== null && success.response.viewVersion >= failure.result.latestKnownViewVersion
    if (isLastSuccessServerView) {
      repaintLastSuccessfulView(failure, success)
      return true
    }
    const hasServerViewMovedOn = failure.result.latestKnownViewVersion > failure.result.viewVersion
    if (hasServerViewMovedOn) {
      return refetchServerViewAfterFailure(failure)
    }
    failure.tracker.spec = getResultViewSpec(failure.result)
    patchResultByIndex(failure.tabId, failure.resultIndex, failure.errorPatch)
    return true
  }

  const settleFailedView = async (tabId: string, resultIndex: number, error: unknown) => {
    const message = toErrorMessage(error)
    logFrontend(
      'warn',
      `[query-store] set_result_view failed for ${tabId}/${resultIndex}: ${message}`
    )
    const result = resultAt(tabId, resultIndex)
    if (!result) return
    const tracker = trackerFor(tabId, resultIndex, result)
    tracker.retrySpec = tracker.spec
    const isStillCurrent = await revertFailedView({
      tabId: tabId,
      resultIndex: resultIndex,
      result: result,
      tracker: tracker,
      errorPatch: { isSorting: false, isFiltering: false, viewError: message },
    })
    if (!isStillCurrent) return
    showErrorToast("Couldn't apply sort or filter", message)
  }

  /** Request a new view spec for a result (sort or filter change). */
  const requestView = (
    tabId: string,
    resultIndex: number,
    spec: ResultViewSpec,
    kind: 'sort' | 'filter'
  ): Promise<void> => {
    const result = resultAt(tabId, resultIndex)
    if (!result) return Promise.resolve()
    const tracker = trackerFor(tabId, resultIndex, result)
    tracker.spec = spec
    tracker.retrySpec = null
    const seq = result.viewRequestSeq + 1
    patchResultByIndex(tabId, resultIndex, {
      viewRequestSeq: seq,
      viewError: null,
      ...(kind === 'sort' ? { isSorting: true } : { isFiltering: true }),
    })
    return issueViewRequest(tabId, resultIndex, seq, result.latestKnownViewVersion, spec, 0)
  }

  /** The spec the next request should start from (latest requested, not just painted). */
  const latestRequestedSpec = (tabId: string, resultIndex: number): ResultViewSpec | null => {
    const result = resultAt(tabId, resultIndex)
    if (!result) return null
    return trackerFor(tabId, resultIndex, result).spec
  }

  const ensureResultEditState = (
    tabId: string,
    resultIndex: number,
    result: SingleResultState,
    rowIndex: number
  ): SingleResultState | null => {
    if (!result.editMode) return null

    const tableInfo = result.editTableMetadata[result.editMode]
    const cached = rowAt(tabId, resultIndex, result, rowIndex)
    if (!tableInfo || !cached) return null
    const row = cached.row
    if (!row) return null

    const isAlreadyEditingRow = Boolean(result.editState) && result.editingRowIndex === rowIndex
    if (isAlreadyEditingRow) {
      return result
    }

    patchResultByIndex(tabId, resultIndex, {
      editState: buildSeededRowEditState(result, tableInfo, row),
      editingRowIndex: rowIndex,
      editingBaseIndex: cached.baseIndex >= 0 ? cached.baseIndex : null,
      saveError: null,
    })

    return resultAt(tabId, resultIndex) ?? null
  }

  /** Mark a tab as executing: set running status, record start time, clear stale flags. */
  const beginExecution = (tabId: string) => {
    patchTab(tabId, {
      tabStatus: 'running',
      executionStartedAt: Date.now(),
      isCancelling: false,
      wasCancelled: false,
    })
  }

  const clearExpiredFlags = (tabId: string) => {
    set((state) => {
      const tab = state.tabs[tabId]
      if (!tab || tab.results.length === 0) return state

      const nextResults = tab.results.map((result) =>
        result.isExpired ? { ...result, isExpired: false } : result
      )

      if (nextResults.every((result, index) => result === tab.results[index])) {
        return state
      }

      return {
        tabs: {
          ...state.tabs,
          [tabId]: { ...tab, results: nextResults },
        },
      }
    })
  }

  const markTabResultsExpired = (tabId: string) => {
    set((state) => {
      const tab = state.tabs[tabId]
      if (!tab || tab.results.length === 0) return state

      const nextResults = tab.results.map((result) =>
        result.isExpired ? result : { ...result, isExpired: true }
      )

      if (nextResults.every((result, index) => result === tab.results[index])) {
        return state
      }

      return {
        tabs: {
          ...state.tabs,
          [tabId]: { ...tab, results: nextResults },
        },
      }
    })
  }

  /** Clear execution-time tracking fields after a query completes (success or error). */
  const finalizeExecution = (tabId: string) => {
    patchTab(tabId, {
      executionStartedAt: null,
      isCancelling: false,
      wasCancelled: false,
    })
  }

  /**
   * Generation counter for `_runAnalysis`. Ensures that only the most recent
   * analysis call can clear `isAnalyzingQuery`, preventing a stale (older)
   * analysis from prematurely clearing the flag while a newer one is in flight.
   */
  let _analysisGeneration = 0

  /**
   * Internal helper: run query analysis on a specific result, normalize results into editTableMetadata.
   * Returns the metadata map, or null if the result was stale/discarded.
   * Throws on IPC failure (caller decides whether to show toast or swallow).
   */
  type AnalysisTargetState = 'gone' | 'replaced' | 'current'

  const resolveAnalysisTarget = (
    tabId: string,
    resultIndex: number,
    expectedQueryId: string | null
  ): AnalysisTargetState => {
    const currentResult = resultAt(tabId, resultIndex)
    if (!currentResult) return 'gone'
    const isReplaced = expectedQueryId !== null && currentResult.queryId !== expectedQueryId
    if (isReplaced) return 'replaced'
    return 'current'
  }

  const clearAnalyzingFlagIfLatest = (tabId: string, resultIndex: number, generation: number) => {
    if (generation !== _analysisGeneration) return
    patchResultByIndex(tabId, resultIndex, { isAnalyzingQuery: false })
  }

  const _runAnalysis = async (
    tabId: string,
    connectionId: string,
    sql: string,
    expectedQueryId: string | null,
    resultIndex?: number
  ): Promise<Record<string, QueryTableEditInfo> | null> => {
    const generation = ++_analysisGeneration
    const targetResultIndex = resultIndex ?? getActiveIndex(tabId)

    patchResultByIndex(tabId, targetResultIndex, { isAnalyzingQuery: true })
    try {
      const raw = await analyzeQueryForEditCmd(connectionId, sql)
      const tables = Array.isArray(raw) ? raw : []
      const target = resolveAnalysisTarget(tabId, targetResultIndex, expectedQueryId)
      if (target === 'gone') return null
      if (target === 'replaced') {
        clearAnalyzingFlagIfLatest(tabId, targetResultIndex, generation)
        return null
      }

      const metadata = buildEditTableMetadata(tables)
      patchResultByIndex(tabId, targetResultIndex, {
        editTableMetadata: metadata,
        isAnalyzingQuery: false,
        isAnalyzed: true,
      })
      return metadata
    } catch (error) {
      const target = resolveAnalysisTarget(tabId, targetResultIndex, expectedQueryId)
      if (target === 'gone') return null
      if (target === 'replaced') {
        clearAnalyzingFlagIfLatest(tabId, targetResultIndex, generation)
        return null
      }
      patchResultByIndex(tabId, targetResultIndex, { isAnalyzingQuery: false })
      throw error
    }
  }

  const launchDeferredAnalysis = (request: DeferredAnalysisRequest): void => {
    launchBackgroundAnalysis({
      tabId: request.tabId,
      connectionId: request.connectionId,
      sql: request.result.lastExecutedSql,
      queryId: request.result.queryId,
      resultIndex: request.resultIndex,
      hasColumns: request.result.columns.length > 0,
      onFailure: (error) => logFrontendError('[query-edit] deferred analysis failed:', error),
    })
  }

  const launchBackgroundAnalysis = (request: BackgroundAnalysisRequest): void => {
    const isAnalyzable = request.hasColumns && isEditableSelectSql(request.sql)
    if (!isAnalyzable || request.sql === null) return
    _runAnalysis(
      request.tabId,
      request.connectionId,
      request.sql,
      request.queryId,
      request.resultIndex
    ).catch(request.onFailure)
  }

  const applyExecutionFailure = (connectionId: string, tabId: string, error: unknown) => {
    const wasCancelled = get().tabs[tabId]?.wasCancelled ?? false
    const errorResult: SingleResultState = {
      ...DEFAULT_RESULT_STATE,
      resultStatus: 'error',
      errorMessage: describeQueryFailure(wasCancelled, error),
    }
    patchTab(tabId, {
      tabStatus: 'error',
      results: [errorResult],
      activeResultIndex: 0,
      activeBottomPanelItem: { type: 'result' },
      wasCancelled: false,
    })
    finalizeExecution(tabId)
    useHistoryStore.getState().notifyNewQuery(connectionId)
  }

  interface SingleQueryCompletion {
    connectionId: string
    tabId: string
    sql: string
    viewSpec: ResultViewSpec | null
    response: ExecuteQueryResult
  }

  const buildExecutedSingleResult = (
    completion: SingleQueryCompletion,
    isVisibleOnCompletion: boolean
  ): SingleResultState => {
    const { response, sql, viewSpec } = completion
    return {
      ...DEFAULT_RESULT_STATE,
      ...windowMetaFromResponse(response).fields,
      ...viewFieldsForColumns(viewSpec, response.columns),
      resultStatus: 'success',
      columns: response.columns,
      totalRows: response.totalRows,
      executionTimeMs: response.executionTimeMs,
      totalTimeMs: response.totalTimeMs,
      affectedRows: response.affectedRows,
      queryId: response.queryId,
      rowLimit: getDefaultRowLimit(),
      autoLimitApplied: response.autoLimitApplied,
      lastExecutedSql: sql,
      reExecutable: true,
      isAnalyzed: false,
      rowResidency: {
        status: 'resident',
        isActive: isVisibleOnCompletion,
        inactiveSince: isVisibleOnCompletion ? null : Date.now(),
      },
      rowsEvictedAt: null,
    }
  }

  const applySingleQuerySuccess = (completion: SingleQueryCompletion) => {
    const { connectionId, tabId, sql, response } = completion
    seedResultFromResponse(connectionId, tabId, 0, response)
    const isVisibleOnCompletion = isQueryTabVisibleInWorkspace(tabId)
    patchTab(tabId, {
      tabStatus: 'success',
      results: [buildExecutedSingleResult(completion, isVisibleOnCompletion)],
      activeResultIndex: 0,
      activeBottomPanelItem: { type: 'result' },
      wasCancelled: false,
    })
    finalizeExecution(tabId)
    if (!isVisibleOnCompletion) {
      get().markResultSurfaceInactive(tabId, 0)
    }
    useHistoryStore.getState().notifyNewQuery(connectionId)
    launchBackgroundAnalysis({
      tabId: tabId,
      connectionId: connectionId,
      sql: sql,
      queryId: response.queryId,
      resultIndex: 0,
      hasColumns: response.columns.length > 0,
      onFailure: (error) => {
        logFrontendError('[query-edit] analyze_query_for_edit failed:', error)
        showErrorToast(
          'Edit mode analysis failed',
          toErrorMessage(error),
          EDIT_ANALYSIS_ERROR_TOAST_DURATION_MS
        )
      },
    })
  }

  interface MultiResultRun {
    connectionId: string
    tabId: string
    runPostAnalysis: boolean
    previousResultCount: number
  }

  const launchFirstResultAnalysis = (run: MultiResultRun, results: SingleResultState[]) => {
    const firstResult = results[0]
    const shouldAnalyze = run.runPostAnalysis && firstResult !== undefined
    if (!shouldAnalyze) return
    launchBackgroundAnalysis({
      tabId: run.tabId,
      connectionId: run.connectionId,
      sql: firstResult.lastExecutedSql,
      queryId: firstResult.queryId,
      resultIndex: 0,
      hasColumns: firstResult.columns.length > 0,
      onFailure: (error) =>
        logFrontendError('[query-edit] analyze_query_for_edit failed (multi):', error),
    })
  }

  const applyMultiResultSuccess = (run: MultiResultRun, items: MultiQueryResultItem[]) => {
    const { connectionId, tabId } = run
    cancelAllResultLifecycleTimers(tabId, run.previousResultCount)
    const isVisibleOnCompletion = isQueryTabVisibleInWorkspace(tabId)
    const results = items.map((item, index) =>
      buildSingleResultFromItem(item, getDefaultRowLimit(), index === 0 && isVisibleOnCompletion)
    )
    items.forEach((item, index) => seedResultFromResponse(connectionId, tabId, index, item))

    patchTab(tabId, {
      tabStatus: results.length > 0 ? 'success' : 'idle',
      results: results,
      activeResultIndex: 0,
      activeBottomPanelItem: { type: 'result' },
      wasCancelled: false,
    })
    finalizeExecution(tabId)

    const isInactiveCompletion = !isVisibleOnCompletion && results.length > 0
    if (isInactiveCompletion) {
      get().markResultSurfaceInactive(tabId, 0)
    }
    useHistoryStore.getState().notifyNewQuery(connectionId)
    launchFirstResultAnalysis(run, results)
  }

  const runMultiResultExecution = async (
    connectionId: string,
    tabId: string,
    ipcCall: () => Promise<{ results: MultiQueryResultItem[] }>,
    runPostAnalysis: boolean
  ) => {
    const currentState = get().tabs[tabId]
    if (isExecutionLocked(currentState)) return

    get().clearEditState(tabId)
    patchTab(tabId, { wasCancelled: false, connectionId: connectionId })
    clearExpiredFlags(tabId)
    beginExecution(tabId)

    const run: MultiResultRun = {
      connectionId: connectionId,
      tabId: tabId,
      runPostAnalysis: runPostAnalysis,
      previousResultCount: currentState?.results.length ?? 0,
    }
    try {
      const multiResult = await ipcCall()
      if (!get().tabs[tabId]) return
      applyMultiResultSuccess(run, multiResult.results)
    } catch (error) {
      if (!get().tabs[tabId]) return
      applyExecutionFailure(connectionId, tabId, error)
    }
  }

  /**
   * Re-execute a single result within a multi-result tab via `reexecuteSingleResult`,
   * guard against stale responses, seed the page cache, patch the result, and
   * schedule analysis. The result's current sort and filter are passed as the
   * view spec, so the first window comes back already sorted and filtered (D18).
   *
   * Does NOT set tab-level status to 'running'. Used by `changeRowLimit`,
   * the clone-insert re-run and expired-result restore for multi-result tabs.
   *
   * @param extraPatch - additional fields to merge into the patched result (e.g. rowLimit)
   */
  const reexecuteAndPatchResult = async (
    connectionId: string,
    tabId: string,
    resultIndex: number,
    sql: string,
    rowLimit: number,
    capturedQueryId: string | null,
    extraPatch: Partial<SingleResultState>
  ) => {
    const spec = rerunViewSpec(resultAt(tabId, resultIndex))
    const reResult = await reexecuteSingleResultCmd(
      connectionId,
      tabId,
      resultIndex,
      sql,
      rowLimit,
      spec
    )

    if (!get().tabs[tabId]) return

    const postResult = resultAt(tabId, resultIndex)
    const isReplacedResult = Boolean(capturedQueryId) && postResult?.queryId !== capturedQueryId
    if (isReplacedResult) {
      logFrontend(
        'warn',
        '[query-store] reexecuteAndPatchResult: discarding stale re-execution result (queryId mismatch)'
      )
      return
    }

    seedResultFromResponse(connectionId, tabId, resultIndex, reResult)
    patchResultByIndex(tabId, resultIndex, {
      ...freshResultFields(reResult, spec),
      resultStatus: 'success',
      errorMessage: reResult.error ?? null,
      isExpired: false,
      rowsEvictedAt: null,
      rowResidency: residentRowResidency(postResult),
      ...extraPatch,
    })

    launchBackgroundAnalysis({
      tabId: tabId,
      connectionId: connectionId,
      sql: sql,
      queryId: reResult.queryId,
      resultIndex: resultIndex,
      hasColumns: reResult.columns.length > 0,
      onFailure: (error) =>
        logFrontendError('[query-edit] analyze_query_for_edit failed (re-exec):', error),
    })
  }

  interface EvictedResultRestore {
    connectionId: string
    tabId: string
    resultIndex: number
    result: SingleResultState
  }

  const reloadEvictedResultWindow = async (restore: EvictedResultRestore): Promise<void> => {
    const { connectionId, tabId, resultIndex, result } = restore
    const touchResponse = await touchResultsCmd(connectionId, tabId)
    if (!get().tabs[tabId]) return

    if (touchResponse.status !== 'available') {
      markTabResultsExpired(tabId)
      patchResultResidency(tabId, resultIndex, { status: 'evicted' })
      return
    }

    const slot = slotFor(tabId, resultIndex)
    if (!slot) {
      markTabResultsExpired(tabId)
      return
    }
    const window = await fetchResultWindowCmd(
      slot,
      result.viewVersion,
      restoreWindowStart(result),
      VIEW_REFRESH_WINDOW_ROWS
    )

    if (!get().tabs[tabId]) return
    const latestResult = resultAt(tabId, resultIndex) ?? result
    if (latestResult.queryId !== slot.queryId) return

    seedResultWindow({
      ...slot,
      viewVersion: window.viewVersion,
      viewRowCount: window.viewRowCount,
      columns: latestResult.columns,
      window: window,
    })
    patchResultByIndex(tabId, resultIndex, {
      viewVersion: window.viewVersion,
      viewRowCount: window.viewRowCount,
      isExpired: false,
      rowsEvictedAt: null,
      rowResidency: residentRowResidency(latestResult),
    })
  }

  const handleEvictedResultRestoreFailure = (
    tabId: string,
    resultIndex: number,
    error: unknown
  ) => {
    const errorMessage = toErrorMessage(error)
    if (get().tabs[tabId]) {
      patchResultResidency(tabId, resultIndex, { status: 'evicted' })
    }
    if (errorMessage.includes('results_expired')) {
      markTabResultsExpired(tabId)
      return
    }
    logFrontend(
      'warn',
      `[query-store] restoreEvictedResultRows failed for ${tabId}/${resultIndex}: ${errorMessage}`
    )
  }

  const restoreTabStatusAfterRestore = (tabId: string, previousTabStatus: TabStatus) => {
    if (!get().tabs[tabId]) return
    patchTab(tabId, {
      tabStatus: previousTabStatus === 'restoring' ? 'success' : previousTabStatus,
    })
  }

  const launchDeferredAnalysisIfNeeded = (tabId: string, resultIndex: number) => {
    const afterSwitch = get().tabs[tabId]
    if (!afterSwitch) return
    const newResult = afterSwitch.results[resultIndex]
    if (!needsDeferredAnalysis(newResult)) return
    launchDeferredAnalysis({
      tabId: tabId,
      connectionId: afterSwitch.connectionId,
      result: newResult,
      resultIndex: resultIndex,
    })
  }

  const isResultPanelShown = (tabId: string): boolean =>
    get().tabs[tabId]?.activeBottomPanelItem.type === 'result'

  const switchActiveResult = (tabId: string, previousIndex: number, nextIndex: number) => {
    const isVisible = isQueryTabVisibleInWorkspace(tabId)
    if (isVisible && isResultPanelShown(tabId)) {
      get().markResultSurfaceInactive(tabId, previousIndex)
    }
    patchTab(tabId, { activeResultIndex: nextIndex })
    if (isVisible && isResultPanelShown(tabId)) {
      void get().markResultSurfaceActive(tabId, nextIndex)
    }
    launchDeferredAnalysisIfNeeded(tabId, nextIndex)
  }

  const markBottomPanelItemInactive = (tabId: string, tab: TabQueryState) => {
    const previousItem = tab.activeBottomPanelItem
    if (previousItem.type === 'result') {
      get().markResultSurfaceInactive(tabId, tab.activeResultIndex)
      return
    }
    useTableDataStore.getState().markTableDataSurfaceInactive(previousItem.tabId)
  }

  interface RowDeletionContext {
    tabId: string
    resultIndex: number
    result: SingleResultState
  }

  interface RowDeletionOutcome {
    deletedBaseIndices: number[]
    failureMessage: string | null
    isTabClosed: boolean
  }

  const loadCheckedRowsToDelete = async (deletion: RowDeletionContext): Promise<CachedRow[]> => {
    const { tabId, resultIndex, result } = deletion
    try {
      const targets: CachedRow[] = []
      for (const range of result.checkedRanges) {
        targets.push(...(await readViewRange(tabId, resultIndex, range)))
      }
      return targets
    } catch (error) {
      if (isResultsExpiredError(error)) {
        markTabResultsExpired(tabId)
        return []
      }
      const message = toErrorMessage(error)
      logFrontend('warn', `[query-store] could not load the checked rows to delete: ${message}`)
      showErrorToast('Delete failed', message)
      return []
    }
  }

  const deleteRowsInDatabase = async (
    tabId: string,
    plan: RowDeletionPlan,
    targets: CachedRow[]
  ): Promise<RowDeletionOutcome> => {
    const action = get().beginRowAction(tabId, 'Deleting', targets.length)
    const outcome: RowDeletionOutcome = {
      deletedBaseIndices: [],
      failureMessage: null,
      isTabClosed: false,
    }
    for (const target of targets) {
      if (!get().tabs[tabId]) {
        outcome.isTabClosed = true
        break
      }
      try {
        await deleteTableRowCmd({
          connectionId: plan.connectionId,
          database: plan.tableInfo.database,
          table: plan.tableInfo.table,
          pkColumns: plan.keyColumns,
          pkValues: primaryKeyValuesOf(plan, target.row),
        })
        outcome.deletedBaseIndices.push(target.baseIndex)
        action.update(outcome.deletedBaseIndices.length)
      } catch (error) {
        outcome.failureMessage = toErrorMessage(error)
        showErrorToast('Delete failed', outcome.failureMessage)
        break
      }
    }
    action.finish()
    return outcome
  }

  const removeDeletedRowsFromView = async (
    slot: ResultSlotRef | null,
    baseVersion: number,
    deletedBaseIndices: number[]
  ): Promise<RemoveResultRowsResult> => {
    if (!slot) throw new Error('Result is no longer available')
    try {
      return await removeResultRowsCmd(slot, baseVersion, deletedBaseIndices)
    } catch (error) {
      const supersededVersion = parseSupersededVersion(error)
      if (supersededVersion === null) throw error
      return removeResultRowsCmd(slot, supersededVersion, deletedBaseIndices)
    }
  }

  interface TombstonedRows {
    afterResult: SingleResultState
    removed: RemoveResultRowsResult
  }

  const applyTombstonedView = (
    deletion: RowDeletionContext,
    outcome: RowDeletionOutcome,
    tombstoned: TombstonedRows
  ) => {
    const { tabId, resultIndex } = deletion
    const { afterResult, removed } = tombstoned
    const deletePatch: Partial<SingleResultState> = {
      editState: null,
      editingRowIndex: null,
      editingBaseIndex: null,
      saveError: outcome.failureMessage,
    }
    const isNewerViewCommitted =
      removed.viewVersion < Math.max(afterResult.latestKnownViewVersion, afterResult.viewVersion)
    if (isNewerViewCommitted) {
      patchResultByIndex(tabId, resultIndex, { ...deletePatch, checkedRanges: [] })
      return
    }
    paintView(
      tabId,
      resultIndex,
      getResultViewSpec(afterResult),
      {
        viewVersion: removed.viewVersion,
        viewRowCount: removed.viewRowCount,
        totalRows: removed.totalRows,
      },
      deletePatch
    )
  }

  const reportTombstoneFailure = (
    deletion: RowDeletionContext,
    outcome: RowDeletionOutcome,
    refreshError: unknown
  ) => {
    const { tabId, resultIndex } = deletion
    const deletedCount = outcome.deletedBaseIndices.length
    logFrontend(
      'warn',
      `[query-store] remove_result_rows failed after deleting ${deletedCount} rows: ${toErrorMessage(refreshError)}`
    )
    if (get().tabs[tabId]) {
      patchResultByIndex(tabId, resultIndex, {
        isStale: true,
        checkedRanges: [],
        saveError: outcome.failureMessage,
      })
    }
    showErrorToast(
      'Refresh failed',
      `${formatCount(deletedCount)} ${deletedCount === 1 ? 'row' : 'rows'} deleted, but the result couldn't be updated. Re-run the query to refresh.`
    )
  }

  const tombstoneDeletedRows = async (
    deletion: RowDeletionContext,
    outcome: RowDeletionOutcome
  ): Promise<boolean> => {
    const { tabId, resultIndex, result } = deletion
    const slot = slotFor(tabId, resultIndex)
    try {
      const latest = resultAt(tabId, resultIndex) ?? result
      const removed = await removeDeletedRowsFromView(
        slot,
        latest.latestKnownViewVersion,
        outcome.deletedBaseIndices
      )
      if (!get().tabs[tabId]) return false
      const afterResult = resultAt(tabId, resultIndex)
      if (afterResult?.queryId !== result.queryId) return false
      applyTombstonedView(deletion, outcome, { afterResult: afterResult, removed: removed })
      return true
    } catch (refreshError) {
      reportTombstoneFailure(deletion, outcome, refreshError)
      return false
    }
  }

  const finishRowDeletion = async (deletion: RowDeletionContext, outcome: RowDeletionOutcome) => {
    const deletedCount = outcome.deletedBaseIndices.length
    if (deletedCount === 0) {
      if (outcome.failureMessage) {
        patchResultByIndex(deletion.tabId, deletion.resultIndex, {
          saveError: outcome.failureMessage,
        })
      }
      return
    }
    const isResultRefreshed = await tombstoneDeletedRows(deletion, outcome)
    if (!isResultRefreshed) return
    if (outcome.failureMessage) return
    showSuccessToast(
      'Rows deleted',
      `${deletedCount} row${deletedCount === 1 ? '' : 's'} deleted successfully.`
    )
  }

  const handleExportStartFailure = (tabId: string, message: string, isStillThisJob: boolean) => {
    if (!isStillThisJob) {
      logFrontend(
        'info',
        `[query-store] start_result_export failed after its job was dropped: ${message}`
      )
      return
    }
    if (isResultsExpiredError(message)) {
      get().markResultsExpired(tabId)
      dropExportJob(tabId)
      closeExportDialogsForTab(tabId)
      return
    }
    showErrorToast('Export failed', message)
    patchExportJob(tabId, { status: 'failed', error: message })
  }

  interface RowLimitRerun {
    connectionId: string
    tabId: string
    resultIndex: number
    result: SingleResultState
    sql: string
    rowLimit: number
  }

  const isRerunResultReplaced = (rerun: RowLimitRerun): boolean => {
    const capturedQueryId = rerun.result.queryId
    const postResult = resultAt(rerun.tabId, rerun.resultIndex)
    return Boolean(capturedQueryId) && postResult?.queryId !== capturedQueryId
  }

  const handleMultiResultRerunFailure = (rerun: RowLimitRerun, error: unknown) => {
    const { tabId, resultIndex } = rerun
    if (!get().tabs[tabId]) return
    if (isRerunResultReplaced(rerun)) {
      logFrontend('warn', '[query-store] changeRowLimit: discarding stale error (queryId mismatch)')
      return
    }
    const errorMessage = toErrorMessage(error)
    if (errorMessage.includes('results_expired')) {
      markTabResultsExpired(tabId)
      return
    }
    patchResultByIndex(tabId, resultIndex, {
      resultStatus: 'error',
      errorMessage: errorMessage,
    })
  }

  const rerunMultiResultWithRowLimit = async (rerun: RowLimitRerun) => {
    try {
      await reexecuteAndPatchResult(
        rerun.connectionId,
        rerun.tabId,
        rerun.resultIndex,
        rerun.sql,
        rerun.rowLimit,
        rerun.result.queryId,
        { rowLimit: rerun.rowLimit }
      )
    } catch (error) {
      handleMultiResultRerunFailure(rerun, error)
    }
  }

  const applySingleResultRerun = (
    rerun: RowLimitRerun,
    spec: ResultViewSpec | null,
    response: ExecuteQueryResult
  ) => {
    const { connectionId, tabId, sql } = rerun
    seedResultFromResponse(connectionId, tabId, 0, response)
    const updatedResult: SingleResultState = {
      ...DEFAULT_RESULT_STATE,
      ...freshResultFields(response, spec),
      resultStatus: 'success',
      rowLimit: rerun.rowLimit,
      lastExecutedSql: sql,
      reExecutable: true,
      rowResidency: {
        status: 'resident',
        isActive: true,
        inactiveSince: null,
      },
      rowsEvictedAt: null,
    }
    patchTab(tabId, {
      tabStatus: 'success',
      results: [updatedResult],
      activeResultIndex: 0,
      wasCancelled: false,
    })
    finalizeExecution(tabId)
    launchBackgroundAnalysis({
      tabId: tabId,
      connectionId: connectionId,
      sql: sql,
      queryId: response.queryId,
      resultIndex: 0,
      hasColumns: response.columns.length > 0,
      onFailure: (error) =>
        logFrontendError('[query-edit] analyze_query_for_edit failed (page re-exec):', error),
    })
  }

  const handleSingleResultRerunFailure = (tabId: string, error: unknown) => {
    const wasCancelled = get().tabs[tabId]?.wasCancelled ?? false
    const errorMessage = describeQueryFailure(wasCancelled, error)
    if (errorMessage.includes('results_expired')) {
      markTabResultsExpired(tabId)
    }
    patchResultByIndex(tabId, 0, {
      resultStatus: 'error',
      errorMessage: errorMessage,
    })
    patchTab(tabId, {
      tabStatus: 'error',
      wasCancelled: false,
    })
    finalizeExecution(tabId)
  }

  const rerunSingleResultWithRowLimit = async (rerun: RowLimitRerun) => {
    const { connectionId, tabId } = rerun
    beginExecution(tabId)
    try {
      const spec = rerunViewSpec(rerun.result)
      const response = await executeQueryCmd(connectionId, tabId, rerun.sql, rerun.rowLimit, spec)
      if (!get().tabs[tabId]) return
      applySingleResultRerun(rerun, spec, response)
    } catch (error) {
      if (!get().tabs[tabId]) return
      handleSingleResultRerunFailure(tabId, error)
    }
  }

  interface EditModeRequest {
    connectionId: string
    tabId: string
    resultIndex: number
    tableName: string
  }

  interface EditModeActivation {
    request: EditModeRequest
    result: SingleResultState
    tableInfo: QueryTableEditInfo
    keyColumns: string[]
  }

  const loadEditTableInfo = async (
    request: EditModeRequest,
    result: SingleResultState
  ): Promise<QueryTableEditInfo | null> => {
    const cachedTableInfo = result.editTableMetadata[request.tableName]
    if (cachedTableInfo) return cachedTableInfo

    if (!result.lastExecutedSql) {
      showErrorToast('Edit mode failed', 'No SQL query available for analysis')
      return null
    }

    try {
      const metadata = await _runAnalysis(
        request.tabId,
        request.connectionId,
        result.lastExecutedSql,
        result.queryId,
        request.resultIndex
      )
      if (!metadata) return null
      const tableInfo = metadata[request.tableName]
      if (!tableInfo) {
        showErrorToast('Edit mode failed', `Table metadata not available for ${request.tableName}`)
        return null
      }
      return tableInfo
    } catch (error) {
      logFrontendError('[query-store] setEditMode analyze_query_for_edit failed:', error)
      showErrorToast('Edit mode failed', toErrorMessage(error))
      return null
    }
  }

  const activateEditMode = (activation: EditModeActivation) => {
    const { request, result, tableInfo, keyColumns } = activation
    const ambiguous = findAmbiguousColumns(result.columns)
    const metadataSource = editMetadataWithTable(
      result.editTableMetadata,
      request.tableName,
      tableInfo
    )
    const { columnBindings, boundColumnIndexMap } = buildEditBindingContext(
      result,
      tableInfo,
      metadataSource
    )

    const validation = validateKeyColumnsPresent(
      keyColumns,
      result.columns,
      ambiguous,
      boundColumnIndexMap
    )
    if (!validation.valid) {
      showErrorToast(
        'Edit mode failed',
        `Cannot edit ${request.tableName}: result set does not contain the unique key columns (${validation.missingColumns.join(', ')})`
      )
      return
    }

    warnAboutAmbiguousEditColumns({
      tableInfo: tableInfo,
      keyColumns: keyColumns,
      ambiguous: ambiguous,
      boundColumnIndexMap: boundColumnIndexMap,
    })

    patchResultByIndex(request.tabId, request.resultIndex, {
      editMode: request.tableName,
      editableColumnMap: buildEditableColumnMap(
        result.columns,
        tableInfo.columns,
        ambiguous,
        columnBindings
      ),
      editColumnBindings: columnBindings,
      editBoundColumnIndexMap: boundColumnIndexMap,
      editForeignKeys: mapSingleColumnForeignKeys(tableInfo.foreignKeys),
      editState: null,
      editConnectionId: request.connectionId,
      editingRowIndex: null,
      saveError: null,
    })
  }

  interface CloneSource {
    tableInfo: QueryTableEditInfo
    keyColumns: string[]
    sourceRow: unknown[]
  }

  const resolveCloneSource = (
    tabId: string,
    resultIndex: number,
    result: SingleResultState
  ): CloneSource | null => {
    const selection = resolveCloneSelection(result)
    if (!selection) return null

    const tableInfo = result.editTableMetadata[selection.editMode]
    if (!tableInfo?.primaryKey) return null

    if (tableInfo.primaryKey.isUniqueKeyFallback) {
      showErrorToast(
        'Clone failed',
        'Cannot clone query-result rows when edit mode is using a unique-key fallback.'
      )
      return null
    }

    const sourceRow = rowAt(tabId, resultIndex, result, selection.selectedRowIndex)?.row
    if (!sourceRow || result.draftRow) return null
    return {
      tableInfo: tableInfo,
      keyColumns: tableInfo.primaryKey.keyColumns,
      sourceRow: sourceRow,
    }
  }

  interface CellEditTarget {
    resultIndex: number
    result: SingleResultState
    editState: RowEditState
    columnName: string
  }

  const resolveCellEditTarget = (
    tabId: string,
    resultColumnIndex: number
  ): CellEditTarget | null => {
    const resultIndex = getActiveIndex(tabId)
    const result = resultAt(tabId, resultIndex)
    if (!result) return null

    const editingRowIndex = result.editingRowIndex ?? result.selectedRowIndex
    if (editingRowIndex === null) return null

    const activeResult = ensureResultEditState(tabId, resultIndex, result, editingRowIndex)
    if (!activeResult?.editState) return null

    const columnName =
      activeResult.editColumnBindings.get(resultColumnIndex) ??
      activeResult.columns[resultColumnIndex]?.name
    if (!columnName) return null
    return {
      resultIndex: resultIndex,
      result: activeResult,
      editState: activeResult.editState,
      columnName: columnName,
    }
  }

  interface RowSaveContext {
    tabId: string
    resultIndex: number
    result: SingleResultState
    editState: RowEditState
    editMode: string
    isMultiResultTab: boolean
  }

  interface RowSaveTarget {
    tableInfo: QueryTableEditInfo
    primaryKey: PrimaryKeyInfo
  }

  interface SavedRowCacheUpdate {
    baseIndex: number
    queryId: string
    displayUpdates: Record<number, unknown>
  }

  const resolveRowSave = (tabId: string): RowSaveContext | null => {
    const resultIndex = getActiveIndex(tabId)
    const tab = get().tabs[tabId]
    const result = tab?.results[resultIndex]
    if (!result?.editState || !result.editMode) return null
    if (result.editingRowIndex === null) return null
    return {
      tabId: tabId,
      resultIndex: resultIndex,
      result: result,
      editState: result.editState,
      editMode: result.editMode,
      isMultiResultTab: (tab?.results.length ?? 0) > 1,
    }
  }

  const clearUnmodifiedRowEdit = (save: RowSaveContext) => {
    const draftReset: Partial<SingleResultState> = save.editState.isNewRow
      ? { draftRow: null, selectedRowIndex: null }
      : {}
    patchResultByIndex(save.tabId, save.resultIndex, {
      ...draftReset,
      editState: null,
      editingRowIndex: null,
      editingBaseIndex: null,
      saveError: null,
    })
  }

  const reportRowSaveFailure = (save: RowSaveContext, error: unknown): boolean => {
    if (!get().tabs[save.tabId]) return false
    const errorMessage = toErrorMessage(error)
    patchResultByIndex(save.tabId, save.resultIndex, { saveError: errorMessage })
    showErrorToast('Save failed', errorMessage)
    return false
  }

  const rerunResultAfterMutation = async (save: RowSaveContext, connectionId: string) => {
    const rerun = save.isMultiResultTab
      ? reexecuteSingleResultAfterMutation
      : reexecuteOnlyResultAfterMutation
    await rerun(connectionId, save.tabId, save.resultIndex, save.result)
  }

  const refreshResultAfterInsert = async (save: RowSaveContext) => {
    const { tabId, resultIndex, result } = save
    const connectionId = result.editConnectionId
    if (!result.lastExecutedSql || !connectionId) {
      showSuccessToast('Row saved', 'Changes saved successfully.')
      return
    }
    try {
      await rerunResultAfterMutation(save, connectionId)
    } catch (refreshError) {
      if (!get().tabs[tabId]) return
      patchResultByIndex(tabId, resultIndex, { isStale: true })
      showErrorToast(
        'Refresh failed',
        `Row inserted successfully, but the query result could not be refreshed: ${toErrorMessage(refreshError)}`
      )
      return
    }
    showSuccessToast('Row saved', 'Changes saved successfully.')
  }

  const insertEditedRow = async (save: RowSaveContext, target: RowSaveTarget): Promise<boolean> => {
    const { tabId, resultIndex, result } = save
    try {
      await insertTableRowCmd({
        connectionId: result.editConnectionId!,
        database: target.tableInfo.database,
        table: target.tableInfo.table,
        values: buildInsertPayload(save.editState, target.tableInfo.columns),
        pkInfo: target.primaryKey,
      })
    } catch (error) {
      return reportRowSaveFailure(save, error)
    }
    if (!get().tabs[tabId]) return true
    patchResultByIndex(tabId, resultIndex, {
      draftRow: null,
      editState: null,
      editingRowIndex: null,
      editingBaseIndex: null,
      selectedRowIndex: null,
      saveError: null,
      isStale: false,
    })
    await refreshResultAfterInsert(save)
    return true
  }

  const handleResultCacheSyncFailure = (tabId: string, cacheError: unknown): boolean => {
    const cacheErrorMessage = toErrorMessage(cacheError)
    if (cacheErrorMessage.includes('Results were refreshed')) {
      logFrontend(
        'info',
        `[query-store] saved row not synced into a replaced result: ${cacheErrorMessage}`
      )
      return true
    }
    logFrontendWarning('[query-store] Result cache sync failed:', cacheError)
    if (cacheErrorMessage.includes('results_expired')) {
      markTabResultsExpired(tabId)
    }
    showWarningToast(
      'Cache sync warning',
      'Row saved successfully, but the result cache may be stale. Re-run the query to refresh pagination/sort/export.'
    )
    return false
  }

  const pushSavedRowToResultCache = async (
    save: RowSaveContext,
    update: SavedRowCacheUpdate
  ): Promise<boolean> => {
    try {
      await updateResultCellCmd(
        save.result.editConnectionId!,
        save.tabId,
        update.baseIndex,
        update.displayUpdates,
        update.queryId,
        save.resultIndex
      )
      return false
    } catch (cacheError) {
      return handleResultCacheSyncFailure(save.tabId, cacheError)
    }
  }

  const syncSavedRowIntoResult = async (save: RowSaveContext) => {
    const baseIndex = save.result.editingBaseIndex
    const queryId = save.result.queryId
    if (baseIndex === null || !queryId) return
    const displayUpdates = displayedCellUpdates(save.result, save.editState)
    const isResultReplaced = await pushSavedRowToResultCache(save, {
      baseIndex: baseIndex,
      queryId: queryId,
      displayUpdates: displayUpdates,
    })
    if (isResultReplaced) return
    applySavedRowValues(save.tabId, save.resultIndex, queryId, baseIndex, displayUpdates)
  }

  const updateEditedRow = async (save: RowSaveContext, target: RowSaveTarget): Promise<boolean> => {
    const { tabId, resultIndex, result } = save
    const {
      pkColumns,
      originalPkValues: originalPrimaryKeyValues,
      updatedValues,
    } = buildUpdatePayload(save.editState, target.primaryKey.keyColumns, target.tableInfo.columns)

    try {
      await updateTableRowCmd({
        connectionId: result.editConnectionId!,
        database: target.tableInfo.database,
        table: target.tableInfo.table,
        primaryKeyColumns: pkColumns,
        originalPkValues: originalPrimaryKeyValues,
        updatedValues: updatedValues,
      })
      if (!get().tabs[tabId]) return true
      await syncSavedRowIntoResult(save)
      if (!get().tabs[tabId]) return true
      patchResultByIndex(tabId, resultIndex, {
        editState: null,
        editingRowIndex: null,
        editingBaseIndex: null,
        saveError: null,
        isStale: false,
      })
      showSuccessToast('Row saved', 'Changes saved successfully.')
      return true
    } catch (error) {
      return reportRowSaveFailure(save, error)
    }
  }

  interface ExpiredResultRetry {
    connectionId: string
    tabId: string
    result: SingleResultState
    plan: ExecuteQueryPlan
  }

  const retryExpiredResultOfMultiResultTab = async (retry: ExpiredResultRetry) => {
    const { connectionId, tabId, result, plan } = retry
    if (plan.kind !== 'single') return
    const activeResultIndex = getActiveIndex(tabId)
    beginExecution(tabId)
    try {
      await reexecuteAndPatchResult(
        connectionId,
        tabId,
        activeResultIndex,
        plan.payload,
        result.rowLimit,
        result.queryId,
        { isExpired: false, errorMessage: null }
      )
      if (!get().tabs[tabId]) return
      patchTab(tabId, { tabStatus: 'success' })
      finalizeExecution(tabId)
    } catch (error) {
      logFrontendWarning('[query-store] retryExpiredResult re-execution failed:', error)
      if (get().tabs[tabId]) {
        patchTab(tabId, { tabStatus: 'error' })
        finalizeExecution(tabId)
      }
      markTabResultsExpired(tabId)
    }
  }

  const runExpiredResultPlan = async (retry: ExpiredResultRetry) => {
    const { connectionId, tabId, plan } = retry
    if (plan.kind === 'single') {
      await get().executeQuery(connectionId, tabId, plan.payload, rerunViewSpec(retry.result))
      return
    }
    await executeQueryPlan(get(), connectionId, tabId, plan)
  }

  const retryExpiredResultOfSingleResultTab = async (retry: ExpiredResultRetry) => {
    const { tabId } = retry
    try {
      await runExpiredResultPlan(retry)
    } catch (error) {
      logFrontendWarning('[query-store] retryExpiredResult re-execution failed:', error)
    }

    const postRetryTab = get().tabs[tabId]
    if (!postRetryTab) return

    const postRetryResult = postRetryTab.results[getActiveIndex(tabId)]
    const isRetrySuccessful =
      postRetryTab.tabStatus === 'success' && postRetryResult?.resultStatus === 'success'
    if (!isRetrySuccessful) {
      markTabResultsExpired(tabId)
    }
  }

  const buildClonedDraftRow = (
    result: SingleResultState,
    tableInfo: QueryTableEditInfo,
    sourceRow: unknown[]
  ): ClonedDraftRow => {
    const primaryKeyColumns = new Set(
      tableInfo.primaryKey?.keyColumns.map((column) => column.toLowerCase()) ?? []
    )
    const row = result.columns.map((column, index) => {
      const boundColumnName = result.editColumnBindings.get(index) ?? column.name
      if (primaryKeyColumns.has(boundColumnName.toLowerCase())) {
        return null
      }
      return sourceRow[index] ?? null
    })

    const modifiedColumns = new Set<string>()
    const insertEligibleColumns = new Set<string>()
    for (const tableColumn of tableInfo.columns) {
      if (tableColumn.isPrimaryKey) {
        continue
      }
      if (result.editBoundColumnIndexMap.has(tableColumn.name.toLowerCase())) {
        modifiedColumns.add(tableColumn.name)
        insertEligibleColumns.add(tableColumn.name)
      }
    }

    return { row, modifiedColumns, insertEligibleColumns }
  }

  const reexecuteSingleResultAfterMutation = async (
    connectionId: string,
    tabId: string,
    resultIndex: number,
    result: SingleResultState
  ) => {
    const capturedQueryId = result.queryId
    await reexecuteAndPatchResult(
      connectionId,
      tabId,
      resultIndex,
      result.lastExecutedSql!,
      result.rowLimit,
      capturedQueryId,
      {
        isStale: false,
        saveError: null,
      }
    )
  }

  const reexecuteOnlyResultAfterMutation = async (
    connectionId: string,
    tabId: string,
    resultIndex: number,
    result: SingleResultState
  ) => {
    const capturedQueryId = result.queryId
    const spec = rerunViewSpec(resultAt(tabId, resultIndex) ?? result)
    const execResult = await executeQueryCmd(
      connectionId,
      tabId,
      result.lastExecutedSql!,
      result.rowLimit,
      spec
    )

    if (!get().tabs[tabId]) return

    const postTab = get().tabs[tabId]
    const postResult = postTab?.results[resultIndex]
    if (capturedQueryId && postResult?.queryId !== capturedQueryId) {
      logFrontend(
        'warn',
        '[query-store] reexecuteOnlyResultAfterMutation: discarding stale refresh result (queryId mismatch)'
      )
      return
    }

    seedResultFromResponse(connectionId, tabId, resultIndex, execResult)
    patchResultByIndex(tabId, resultIndex, {
      ...freshResultFields(execResult, spec),
      resultStatus: 'success',
      errorMessage: null,
      isStale: false,
      saveError: null,
    })

    launchBackgroundAnalysis({
      tabId: tabId,
      connectionId: connectionId,
      sql: result.lastExecutedSql,
      queryId: execResult.queryId,
      resultIndex: resultIndex,
      hasColumns: execResult.columns.length > 0,
      onFailure: (error) =>
        logFrontend(
          'warn',
          `[query-edit] analyze_query_for_edit failed (insert re-exec): ${toErrorMessage(error)}`
        ),
    })
  }

  return {
    tabs: {},
    exportJobs: {},

    getTabState: (tabId: string) => {
      return get().tabs[tabId] ?? { ...DEFAULT_TAB_STATE }
    },

    setContent: (tabId: string, content: string) => {
      patchTab(tabId, { content })
    },

    setSelectedText: (tabId: string, selectedText: string) => {
      if (get().tabs[tabId]?.selectedText === selectedText) return
      patchTab(tabId, { selectedText })
    },

    setFilePath: (tabId: string, filePath: string | null) => {
      patchTab(tabId, { filePath })
    },

    setCursorPosition: (tabId: string, position: { lineNumber: number; column: number }) => {
      patchTab(tabId, { cursorPosition: position })
    },

    executeQuery: async (
      connectionId: string,
      tabId: string,
      sql: string,
      viewSpec: ResultViewSpec | null = null
    ) => {
      const currentState = get().tabs[tabId]
      if (isExecutionLocked(currentState)) return

      get().clearEditState(tabId)
      cancelAllResultLifecycleTimers(tabId, currentState?.results.length ?? 0)
      patchTab(tabId, { wasCancelled: false, connectionId: connectionId })
      clearExpiredFlags(tabId)
      beginExecution(tabId)

      try {
        const result = await executeQueryCmd(
          connectionId,
          tabId,
          sql,
          getDefaultRowLimit(),
          viewSpec
        )
        if (!get().tabs[tabId]) return
        applySingleQuerySuccess({
          connectionId: connectionId,
          tabId: tabId,
          sql: sql,
          viewSpec: viewSpec,
          response: result,
        })
      } catch (error) {
        if (!get().tabs[tabId]) return
        applyExecutionFailure(connectionId, tabId, error)
      }
    },

    executeMultiQuery: async (connectionId: string, tabId: string, statements: string[]) => {
      await runMultiResultExecution(
        connectionId,
        tabId,
        () => executeMultiQueryCmd(connectionId, tabId, statements, getDefaultRowLimit()),
        true
      )
    },

    executeCallQuery: async (connectionId: string, tabId: string, sql: string) => {
      await runMultiResultExecution(
        connectionId,
        tabId,
        () => executeCallQueryCmd(connectionId, tabId, sql, getDefaultRowLimit()),
        false
      )
    },

    markResultSurfaceActive: async (tabId: string, resultIndex?: number) => {
      const tab = get().tabs[tabId]
      if (!tab) return

      const targetIndex = resultIndex ?? getActiveIndex(tabId)
      const result = tab.results[targetIndex]
      if (!result) return

      cancelResultLifecycleTimer(tabId, targetIndex)
      patchResultResidency(tabId, targetIndex, {
        isActive: true,
        inactiveSince: null,
      })

      if (result.rowResidency.status === 'evicted' && !result.isExpired) {
        await get().restoreEvictedResultRows(tabId, targetIndex)
      }
    },

    markResultSurfaceInactive: (tabId: string, resultIndex?: number) => {
      const tab = get().tabs[tabId]
      if (!tab) return

      const targetIndex = resultIndex ?? getActiveIndex(tabId)
      const result = tab.results[targetIndex]
      if (!result) return

      patchResultResidency(tabId, targetIndex, {
        isActive: false,
        inactiveSince: Date.now(),
      })

      if (
        result.rowResidency.status !== 'resident' ||
        result.isExpired ||
        isDirtyResult(result) ||
        result.viewRowCount === 0
      ) {
        return
      }

      frontendCacheLifecycle.scheduleInactive(getResultSurfaceKey(tabId, targetIndex), () => {
        get().evictInactiveResultRows(tabId, targetIndex)
      })
    },

    evictInactiveResultRows: (tabId: string, resultIndex: number) => {
      cancelResultLifecycleTimer(tabId, resultIndex)
      set((state) => {
        const tab = state.tabs[tabId]
        if (!tab || resultIndex < 0 || resultIndex >= tab.results.length) return state

        const result = tab.results[resultIndex]
        if (
          result.rowResidency.isActive ||
          result.rowResidency.status !== 'resident' ||
          result.isExpired ||
          isDirtyResult(result)
        ) {
          return state
        }

        // Only the page cache is dropped; result metadata (counts, view, sort,
        // filter, scroll position) stays so reactivation can refetch the window.
        clearResultWindowPages(tabId, resultIndex)
        const nextResults = [...tab.results]
        nextResults[resultIndex] = {
          ...result,
          editingRowIndex: null,
          editingBaseIndex: null,
          editState: null,
          pendingWindowRange: null,
          rowsEvictedAt: Date.now(),
          rowResidency: {
            ...result.rowResidency,
            status: 'evicted',
          },
        }

        return {
          tabs: {
            ...state.tabs,
            [tabId]: {
              ...tab,
              results: nextResults,
            },
          },
        }
      })
    },

    restoreEvictedResultRows: async (tabId: string, resultIndex?: number) => {
      const tab = get().tabs[tabId]
      if (!tab) return

      const targetIndex = resultIndex ?? getActiveIndex(tabId)
      const result = tab.results[targetIndex]
      if (!isRestorableEvictedResult(result)) return

      const hasRestoreSource = Boolean(tab.connectionId) && Boolean(result.queryId)
      if (!hasRestoreSource) {
        markTabResultsExpired(tabId)
        return
      }

      const previousTabStatus = tab.tabStatus
      patchTab(tabId, { tabStatus: 'restoring' })
      patchResultResidency(tabId, targetIndex, { status: 'restoring' })

      try {
        await reloadEvictedResultWindow({
          connectionId: tab.connectionId,
          tabId: tabId,
          resultIndex: targetIndex,
          result: result,
        })
      } catch (error) {
        handleEvictedResultRestoreFailure(tabId, targetIndex, error)
      } finally {
        restoreTabStatusAfterRestore(tabId, previousTabStatus)
      }
    },

    setActiveResultIndex: (tabId: string, index: number) => {
      const tab = get().tabs[tabId]
      if (!tab) return

      const isValidIndex = index >= 0 && index < tab.results.length
      if (!isValidIndex) return

      const currentResult = tab.results[tab.activeResultIndex]
      if (hasUnsavedModifications(currentResult)) {
        get().requestNavigationAction(tabId, () => {
          const previousIndex = get().tabs[tabId]?.activeResultIndex ?? tab.activeResultIndex
          switchActiveResult(tabId, previousIndex, index)
        })
        return
      }

      if (currentResult?.editState) {
        patchResultByIndex(tabId, tab.activeResultIndex, {
          editState: null,
          editingRowIndex: null,
          saveError: null,
        })
      }
      switchActiveResult(tabId, tab.activeResultIndex, index)
    },

    setActiveBottomPanelItem: (tabId: string, item: ActiveBottomPanelItem) => {
      const tabBeforePatch = get().tabs[tabId]
      if (!tabBeforePatch) {
        patchTab(tabId, { activeBottomPanelItem: item })
        return
      }

      const isVisible = isQueryTabVisibleInWorkspace(tabId)
      if (isVisible) {
        markBottomPanelItemInactive(tabId, tabBeforePatch)
      }

      patchTab(tabId, { activeBottomPanelItem: item })

      if (item.type === 'result') {
        if (isVisible) {
          void get().markResultSurfaceActive(tabId, get().tabs[tabId]?.activeResultIndex)
        }
        return
      }

      if (isVisible) {
        void useTableDataStore.getState().markTableDataSurfaceActive(item.tabId)
      }
    },

    cleanupTab: (connectionId: string, tabId: string) => {
      const exportJob = get().exportJobs[tabId]
      if (exportJob?.status === 'running' && exportJob.jobId !== null) {
        cancelExportJobInBackground(exportJob.jobId, 'cleanupTab')
      }
      dropExportJob(tabId)
      cancelAllResultLifecycleTimers(tabId, get().tabs[tabId]?.results.length ?? 0)
      dropTabResultWindows(tabId)
      dropViewTrackers(tabId)
      rowActionCancels.delete(tabId)
      // Fire-and-forget eviction
      evictResultsCmd(connectionId, tabId).catch((error) => {
        logFrontendError('[query-store] evictResults failed (cleanupTab):', error)
      })
      set((state) => {
        const newTabs = { ...state.tabs }
        delete newTabs[tabId]
        return { tabs: newTabs }
      })
    },

    cleanupConnection: (connectionId: string, tabIds: string[]) => {
      // Evict Rust-side results for each tab (fire-and-forget)
      for (const id of tabIds) {
        // The backend cancels the connection's exports in close_connection.
        dropExportJob(id)
        cancelAllResultLifecycleTimers(id, get().tabs[id]?.results.length ?? 0)
        dropTabResultWindows(id)
        dropViewTrackers(id)
        rowActionCancels.delete(id)
        evictResultsCmd(connectionId, id).catch((error) => {
          logFrontendError('[query-store] evictResults failed (cleanupConnection):', error)
        })
      }
      set((state) => {
        const newTabs = { ...state.tabs }
        for (const id of tabIds) {
          delete newTabs[id]
        }
        return { tabs: newTabs }
      })
    },

    setViewMode: (tabId: string, mode: ViewMode) => {
      const tab = get().tabs[tabId]
      const resultIndex = getActiveIndex(tabId)
      const result = tab?.results[resultIndex]

      if (!tab || !result) {
        // Create with single result
        patchTab(tabId, {
          results: [{ ...DEFAULT_RESULT_STATE, viewMode: mode }],
          activeResultIndex: 0,
        })
        return
      }

      // Auto-save when switching to text view with pending edits
      if (mode === 'text' && hasUnsavedModifications(result)) {
        get()
          .saveCurrentRow(tabId)
          .then(() => {
            const afterResult = resultAt(tabId, resultIndex)
            const isSavedCleanly = afterResult !== undefined && !afterResult.saveError
            if (!isSavedCleanly) {
              showErrorToast(
                'Cannot switch to text view',
                'Save failed. Fix or discard edits before switching to text view.'
              )
              return
            }
            patchResultByIndex(tabId, resultIndex, { viewMode: mode })
          })
          .catch((error) => {
            logFrontendError(
              '[query-store] saveCurrentRow failed while switching to text view:',
              error
            )
            showErrorToast(
              'Cannot switch to text view',
              'Save failed. Fix or discard edits before switching to text view.'
            )
          })
        return
      }

      patchResultByIndex(tabId, resultIndex, { viewMode: mode })
    },

    setSelectedRow: (tabId: string, index: number | null) => {
      const resultIndex = getActiveIndex(tabId)
      const result = resultAt(tabId, resultIndex)
      if (result?.selectedRowIndex === index) return
      patchResultByIndex(tabId, resultIndex, { selectedRowIndex: index })
    },

    setCheckedRanges: (tabId: string, ranges: ViewRange[]) => {
      const resultIndex = getActiveIndex(tabId)
      const result = resultAt(tabId, resultIndex)
      if (!result) return
      if (ranges.length === 0 && result.checkedRanges.length === 0) return
      patchResultByIndex(tabId, resultIndex, {
        checkedRanges: ranges,
        checkedViewVersion: result.viewVersion,
      })
    },

    deleteResultRows: async (tabId: string): Promise<number> => {
      const resultIndex = getActiveIndex(tabId)
      const result = resultAt(tabId, resultIndex)
      if (!result || result.checkedRanges.length === 0) return 0

      const plan = resolveRowDeletionPlan(result)
      if (!plan) return 0

      if (result.checkedViewVersion !== result.viewVersion) {
        patchResultByIndex(tabId, resultIndex, { checkedRanges: [] })
        return 0
      }
      if (countRanges(result.checkedRanges) > MAX_BULK_DELETE_ROWS) return 0

      const deletion: RowDeletionContext = {
        tabId: tabId,
        resultIndex: resultIndex,
        result: result,
      }
      const targets = await loadCheckedRowsToDelete(deletion)
      if (targets.length === 0) return 0

      const outcome = await deleteRowsInDatabase(tabId, plan, targets)
      if (!outcome.isTabClosed) {
        await finishRowDeletion(deletion, outcome)
      }
      return outcome.deletedBaseIndices.length
    },

    beginRowAction: (
      tabId: string,
      verb: RowActionVerb,
      total: number,
      onCancel?: () => void
    ): RowActionHandle => {
      const resultIndex = getActiveIndex(tabId)
      const queryId = resultAt(tabId, resultIndex)?.queryId ?? null
      let done = 0
      let visible = false
      let finished = false
      const patchProgress = (progress: RowActionProgress | null) => {
        const current = resultAt(tabId, resultIndex)
        if (!current || current.queryId !== queryId) return
        patchResultByIndex(tabId, resultIndex, { rowActionProgress: progress })
      }
      const snapshot = (): RowActionProgress => ({
        verb: verb,
        done: done,
        total: total,
        cancellable: onCancel !== undefined,
        visible: visible,
      })
      if (onCancel) rowActionCancels.set(tabId, onCancel)
      patchProgress(snapshot())
      const timer = setTimeout(() => {
        if (finished) return
        visible = true
        patchProgress(snapshot())
      }, RESULT_LOADING_STATUS_DELAY_MS)
      return {
        update: (nextDone: number) => {
          done = nextDone
          if (visible && !finished) patchProgress(snapshot())
        },
        finish: () => {
          finished = true
          clearTimeout(timer)
          if (rowActionCancels.get(tabId) === onCancel) rowActionCancels.delete(tabId)
          patchProgress(null)
          return visible
        },
      }
    },

    cancelRowAction: (tabId: string) => {
      const cancel = rowActionCancels.get(tabId)
      if (!cancel) return
      rowActionCancels.delete(tabId)
      cancel()
    },

    markResultsExpired: (tabId: string) => {
      markTabResultsExpired(tabId)
    },

    retryResultWindow: (tabId: string) => {
      retryFailedWindow(tabId, getActiveIndex(tabId))
    },

    retryViewChange: (tabId: string) => {
      const resultIndex = getActiveIndex(tabId)
      const result = resultAt(tabId, resultIndex)
      if (!result) return
      const tracker = trackerFor(tabId, resultIndex, result)
      const spec = tracker.retrySpec ?? tracker.spec
      void requestView(tabId, resultIndex, spec, spec.filters.length > 0 ? 'filter' : 'sort')
    },

    setSelectedCell: (tabId: string, cell: SelectedCellInfo | null) => {
      const resultIndex = getActiveIndex(tabId)
      const currentCell = resultAt(tabId, resultIndex)?.selectedCell ?? null
      if (
        currentCell?.columnKey === cell?.columnKey &&
        Object.is(currentCell?.value, cell?.value)
      ) {
        return
      }
      patchResultByIndex(tabId, resultIndex, { selectedCell: cell })
    },

    setResultScrollCell: (tabId: string, scrollRow: number, scrollColumn: number) => {
      const resultIndex = getActiveIndex(tabId)
      const result = resultAt(tabId, resultIndex)
      if (!result) return
      if (result.scrollRow === scrollRow && result.scrollCol === scrollColumn) return
      patchResultByIndex(tabId, resultIndex, { scrollRow: scrollRow, scrollCol: scrollColumn })
    },

    applyQueryFilters: (tabId: string, resultIndex: number, conditions: FilterCondition[]) => {
      const tab = get().tabs[tabId]
      if (!tab || resultIndex < 0 || resultIndex >= tab.results.length) return
      const base = latestRequestedSpec(tabId, resultIndex)
      // Filtering runs in Rust and never blocks the UI ("Filtering…" status).
      void requestView(
        tabId,
        resultIndex,
        { sort: base?.sort ?? null, filters: conditions },
        'filter'
      )
    },

    openExportDialog: (tabId: string, scope: ExportRowScope = 'currentView') => {
      const resultIndex = getActiveIndex(tabId)
      patchResultByIndex(tabId, resultIndex, {
        exportDialogOpen: true,
        preferredExportScope: scope,
      })
    },

    closeExportDialog: (tabId: string) => {
      const resultIndex = getActiveIndex(tabId)
      patchResultByIndex(tabId, resultIndex, { exportDialogOpen: false })
      // A running export keeps going; a finished one's InfoBar is dismissed.
      const job = get().exportJobs[tabId]
      if (job && job.status !== 'running') dropExportJob(tabId)
    },

    startFullExport: async (tabId: string, request: FullExportRequest) => {
      if (get().exportJobs[tabId]?.status === 'running') return
      const queryId = resultAt(tabId, request.resultIndex)?.queryId ?? ''
      const startToken = ++nextExportStartToken
      stopExportPolling(tabId)
      set((state) => ({
        exportJobs: {
          ...state.exportJobs,
          [tabId]: {
            ...request,
            jobId: null,
            queryId: queryId,
            status: 'running',
            progress: null,
            cancelRequested: false,
            error: null,
            startToken: startToken,
          },
        },
      }))
      // Cancel patches the job (a new object), so match by token, not identity.
      const isStillThisJob = () => get().exportJobs[tabId]?.startToken === startToken

      let jobId: string
      try {
        jobId = await startResultExportCmd({
          connectionId: request.connectionId,
          tabId: tabId,
          resultIndex: request.resultIndex,
          queryId: queryId,
          format: request.format,
          filePath: request.filePath,
          includeHeaders: request.includeHeaders,
          tableName: request.tableName,
        })
      } catch (error) {
        handleExportStartFailure(tabId, toErrorMessage(error), isStillThisJob())
        return
      }

      if (!isStillThisJob()) {
        cancelExportJobInBackground(jobId, 'start raced cleanup')
        return
      }
      patchExportJob(tabId, { jobId })
      if (get().exportJobs[tabId]?.cancelRequested) {
        cancelExportJobInBackground(jobId, 'queued cancel')
      }
      scheduleExportPoll(tabId, jobId, 0)
    },

    cancelFullExport: async (tabId: string) => {
      const job = get().exportJobs[tabId]
      if (!job || job.status !== 'running' || job.cancelRequested) return
      patchExportJob(tabId, { cancelRequested: true })
      // Still starting: the cancel is sent as soon as the job id arrives.
      if (job.jobId === null) return
      try {
        await cancelResultExportCmd(job.jobId)
      } catch (error) {
        const message = toErrorMessage(error)
        if (get().exportJobs[tabId]?.jobId === job.jobId) {
          patchExportJob(tabId, { cancelRequested: false })
        }
        showErrorToast('Cancel failed', message)
      }
    },

    sortResults: async (
      _connectionId: string,
      tabId: string,
      column: string,
      direction: 'asc' | 'desc' | null
    ) => {
      const resultIndex = getActiveIndex(tabId)
      const result = resultAt(tabId, resultIndex)
      if (!result) return
      // Sorting (and clearing a sort, which restores base order) runs in Rust
      // with no query re-run, so edit mode stays on. Only the per-row edit
      // state is dropped: the new view moves rows to other positions.
      patchResultByIndex(tabId, resultIndex, ROW_EDIT_STATE_RESET)
      const base = latestRequestedSpec(tabId, resultIndex)
      await requestView(
        tabId,
        resultIndex,
        {
          sort: direction ? { column, direction } : null,
          filters: base?.filters ?? result.filterModel,
        },
        'sort'
      )
    },

    changeRowLimit: async (connectionId: string, tabId: string, size: number) => {
      const tab = get().tabs[tabId]
      const resultIndex = getActiveIndex(tabId)
      const result = tab?.results[resultIndex]

      if (!result?.lastExecutedSql) return

      if (!result.reExecutable) {
        showWarningToast(
          'Cannot change row limit',
          'This result is from a stored procedure and cannot be re-executed.'
        )
        return
      }

      patchResultByIndex(tabId, resultIndex, { ...EDIT_STATE_DEFAULTS, rowLimit: size })
      clearExpiredFlags(tabId)

      const rerun: RowLimitRerun = {
        connectionId: connectionId,
        tabId: tabId,
        resultIndex: resultIndex,
        result: result,
        sql: result.lastExecutedSql,
        rowLimit: size,
      }
      const isMultiResultTab = (tab?.results.length ?? 0) > 1
      if (isMultiResultTab) {
        await rerunMultiResultWithRowLimit(rerun)
        return
      }
      await rerunSingleResultWithRowLimit(rerun)
    },

    cancelQuery: async (connectionId: string, tabId: string) => {
      // Guard: tab doesn't exist, bail
      if (!get().tabs[tabId]) return

      const state = get()
      // Guard: prevent double-cancel
      if (state.tabs[tabId]?.isCancelling) return

      // Set cancel flags
      patchTab(tabId, { isCancelling: true, wasCancelled: true })

      try {
        const isCancelled = await cancelQueryCmd(connectionId, tabId)

        if (!get().tabs[tabId]) return

        if (!isCancelled) {
          patchTab(tabId, { isCancelling: false, wasCancelled: false })
          return
        }
        showSuccessToast('Query cancelled')
      } catch (error) {
        if (!get().tabs[tabId]) return

        patchTab(tabId, { isCancelling: false, wasCancelled: false })
        const errorMessage = toErrorMessage(error)
        showErrorToast('Cancel failed', errorMessage)
      }
    },

    // ------------------------------------------------------------------
    // Edit mode actions — operate on active result
    // ------------------------------------------------------------------

    setEditMode: async (connectionId: string, tabId: string, tableName: string | null) => {
      const resultIndex = getActiveIndex(tabId)

      if (tableName === null) {
        patchResultByIndex(tabId, resultIndex, {
          ...EDIT_STATE_DEFAULTS,
          editTableMetadata: resultAt(tabId, resultIndex)?.editTableMetadata ?? EMPTY_OBJECT,
        })
        return
      }

      const result = resultAt(tabId, resultIndex)
      if (!result || result.columns.length === 0) return

      const request: EditModeRequest = {
        connectionId: connectionId,
        tabId: tabId,
        resultIndex: resultIndex,
        tableName: tableName,
      }
      const tableInfo = await loadEditTableInfo(request, result)
      if (!tableInfo) return

      if (!tableInfo.primaryKey) {
        showErrorToast('Edit mode failed', `Cannot edit ${tableName}: no primary or unique key`)
        return
      }

      const currentResult = resultAt(tabId, resultIndex)
      if (!currentResult) return

      activateEditMode({
        request: request,
        result: currentResult,
        tableInfo: tableInfo,
        keyColumns: tableInfo.primaryKey.keyColumns,
      })
    },

    startEditingRow: (tabId: string, rowIndex: number, cachedRow?: CachedRow) => {
      const resultIndex = getActiveIndex(tabId)
      const tab = get().tabs[tabId]
      const result = tab?.results[resultIndex]
      if (!result?.editMode || !result.editTableMetadata[result.editMode]) return

      const cached = cachedRow ?? rowAt(tabId, resultIndex, result, rowIndex)
      if (!cached) return
      const row = cached.row

      const tableInfo = result.editTableMetadata[result.editMode]
      patchResultByIndex(tabId, resultIndex, {
        editState: buildSeededRowEditState(result, tableInfo, row),
        editingRowIndex: rowIndex,
        editingBaseIndex: cached.baseIndex >= 0 ? cached.baseIndex : null,
        saveError: null,
      })
    },

    cloneSelectedRow: (tabId: string) => {
      const resultIndex = getActiveIndex(tabId)
      const result = resultAt(tabId, resultIndex)
      if (!result) return

      const source = resolveCloneSource(tabId, resultIndex, result)
      if (!source) return

      const draft = buildClonedDraftRow(result, source.tableInfo, source.sourceRow)
      const hasClonableColumns =
        draft.modifiedColumns.size > 0 || draft.insertEligibleColumns.size > 0
      if (!hasClonableColumns) return

      const draftRowIndex = result.viewRowCount
      patchResultByIndex(tabId, resultIndex, {
        draftRow: draft.row,
        selectedRowIndex: draftRowIndex,
        editingRowIndex: draftRowIndex,
        editingBaseIndex: null,
        editState: buildClonedEditState(result, draft, source.keyColumns),
        saveError: null,
        isStale: false,
      })
    },

    updateCellValue: (tabId: string, resultColumnIndex: number, value: unknown) => {
      const target = resolveCellEditTarget(tabId, resultColumnIndex)
      if (!target) return

      patchResultByIndex(tabId, target.resultIndex, {
        editState: editStateWithCellValue(target.editState, target.columnName, value),
        saveError: null,
      })
    },

    syncCellValue: (tabId: string, resultColumnIndex: number, value: unknown) => {
      const target = resolveCellEditTarget(tabId, resultColumnIndex)
      if (!target) return
      if (target.result.editingRowIndex === null) return

      patchResultByIndex(tabId, target.resultIndex, {
        ...draftRowPatchForCell(target.result, resultColumnIndex, value),
        editState: editStateWithCellValue(target.editState, target.columnName, value),
        saveError: null,
      })
    },

    saveCurrentRow: async (tabId: string): Promise<boolean> => {
      const save = resolveRowSave(tabId)
      if (!save) return true

      if (save.editState.modifiedColumns.size === 0) {
        clearUnmodifiedRowEdit(save)
        return true
      }

      const tableInfo = save.result.editTableMetadata[save.editMode]
      const primaryKey = tableInfo?.primaryKey
      if (!primaryKey) {
        const message = 'No primary key info available'
        patchResultByIndex(tabId, save.resultIndex, { saveError: message })
        showErrorToast('Save failed', message)
        return false
      }

      const target: RowSaveTarget = { tableInfo: tableInfo, primaryKey: primaryKey }
      if (save.editState.isNewRow) {
        return insertEditedRow(save, target)
      }
      return updateEditedRow(save, target)
    },

    discardCurrentRow: (tabId: string) => {
      const resultIndex = getActiveIndex(tabId)
      const tab = get().tabs[tabId]
      const result = tab?.results[resultIndex]
      if (!result?.editState) return

      // Cached rows are never mutated while editing (the grid overlays edit
      // values), so discarding only drops the edit state (and any clone draft).
      patchResultByIndex(tabId, resultIndex, {
        ...(result.editState.isNewRow ? { draftRow: null, selectedRowIndex: null } : {}),
        editState: null,
        editingRowIndex: null,
        editingBaseIndex: null,
        saveError: null,
      })
    },

    requestNavigationAction: (tabId: string, action: () => void) => {
      const tab = get().tabs[tabId]
      const resultIndex = getActiveIndex(tabId)
      const result = tab?.results[resultIndex]

      if (!result?.editState) {
        action()
        return
      }
      // Active edit state with no modifications — discard silently and proceed
      if (result.editState.modifiedColumns.size === 0) {
        get().discardCurrentRow(tabId)
        action()
        return
      }
      // Modifications exist — defer and show unsaved changes dialog
      patchTab(tabId, { pendingNavigationAction: action })
    },

    confirmNavigation: async (tabId: string, shouldSave: boolean) => {
      const tab = get().tabs[tabId]
      if (!tab) return

      if (!shouldSave) {
        const action = tab.pendingNavigationAction
        get().discardCurrentRow(tabId)
        patchTab(tabId, { pendingNavigationAction: null })
        action?.()
        return
      }

      await get().saveCurrentRow(tabId)
      const afterSave = get().tabs[tabId]
      const afterResult = afterSave?.results[getActiveIndex(tabId)]
      const isSavedCleanly = afterResult !== undefined && !afterResult.saveError
      if (!isSavedCleanly) return
      const action = afterSave?.pendingNavigationAction
      patchTab(tabId, { pendingNavigationAction: null })
      action?.()
    },

    cancelNavigation: (tabId: string) => {
      patchTab(tabId, { pendingNavigationAction: null })
    },

    clearEditState: (tabId: string) => {
      const tab = get().tabs[tabId]
      if (!tab) return
      const resultIndex = getActiveIndex(tabId)
      if (resultIndex < tab.results.length) {
        patchResultByIndex(tabId, resultIndex, { ...EDIT_STATE_DEFAULTS })
      }
    },

    setTabStatus: (tabId: string, newStatus: TabStatus) => {
      const tab = get().tabs[tabId]
      if (!tab) return

      // When entering an AI lock state, save the current execution status
      // so it can be restored later. Only save if the current status is an
      // ExecutionStatus (not already an AI state).
      const isAiLock = newStatus === 'ai-pending' || newStatus === 'ai-reviewing'
      const currentIsExecution =
        tab.tabStatus === 'idle' ||
        tab.tabStatus === 'running' ||
        tab.tabStatus === 'success' ||
        tab.tabStatus === 'error' ||
        tab.tabStatus === 'restoring'

      if (!isAiLock || !currentIsExecution) {
        patchTab(tabId, { tabStatus: newStatus })
        return
      }
      patchTab(tabId, {
        tabStatus: newStatus,
        prevTabStatus: tab.tabStatus as ExecutionStatus,
      })
    },

    validateActiveTabResults: (tabId: string) => {
      const tab = get().tabs[tabId]
      if (!tab) return
      const resultIndex = getActiveIndex(tabId)
      const result = tab.results[resultIndex]
      if (!result?.queryId) return

      const connectionId = tab.connectionId
      if (!connectionId) return

      const previousStatus = tab.tabStatus
      const shouldShowRestoringState = previousStatus !== 'success'
      if (shouldShowRestoringState) {
        patchTab(tabId, { tabStatus: 'restoring' })
      }

      touchResultsCmd(connectionId, tabId)
        .then((response) => {
          if (!get().tabs[tabId]) return
          if (response.status === 'expired') {
            markTabResultsExpired(tabId)
          }
          if (shouldShowRestoringState) {
            patchTab(tabId, { tabStatus: previousStatus })
          }
        })
        .catch((error) => {
          if (shouldShowRestoringState) {
            patchTab(tabId, { tabStatus: previousStatus })
          }
          logFrontendWarning('[query-store] validateActiveTabResults failed:', error)
        })
    },

    retryExpiredResult: async (tabId: string) => {
      const tab = get().tabs[tabId]
      if (!tab) return

      const connectionId = tab.connectionId
      if (!connectionId) return

      const result = getActiveResult(tab)
      if (!result.isExpired || !result.reExecutable) return

      const plan = buildExecuteQueryPlan(tab.content, tab.selectedText ?? '', tab.cursorPosition)
      if (!plan) return

      const isMultiResultTab = tab.results.length > 1
      if (isMultiResultTab && plan.kind === 'multi') return

      clearExpiredFlags(tabId)

      const retry: ExpiredResultRetry = {
        connectionId: connectionId,
        tabId: tabId,
        result: result,
        plan: plan,
      }
      if (isMultiResultTab) {
        await retryExpiredResultOfMultiResultTab(retry)
        return
      }
      await retryExpiredResultOfSingleResultTab(retry)
    },
  }
})
