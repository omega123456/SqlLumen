import { create } from 'zustand'
import type {
  ColumnMeta,
  MultiQueryResultItem,
  QueryTableEditInfo,
  RowEditState,
  ViewMode,
} from '../types/schema'
import {
  executeQuery as executeQueryCmd,
  executeMultiQuery as executeMultiQueryCmd,
  executeCallQuery as executeCallQueryCmd,
  reexecuteSingleResult as reexecuteSingleResultCmd,
  fetchResultPage as fetchResultPageCmd,
  evictResults as evictResultsCmd,
  sortResults as sortResultsCmd,
  analyzeQueryForEdit as analyzeQueryForEditCmd,
  updateResultCell as updateResultCellCmd,
  cancelQuery as cancelQueryCmd,
} from '../lib/query-commands'
import { updateTableRow as updateTableRowCmd } from '../lib/table-data-commands'
import { showErrorToast, showSuccessToast, showWarningToast } from './toast-store'
import {
  findAmbiguousColumns,
  buildBoundColumnIndexMap,
  buildEditableColumnMap,
  buildQueryEditColumnBindings,
  validateKeyColumnsPresent,
  buildRowEditState,
  buildUpdatePayload,
} from '../lib/query-edit-utils'
import { mapSingleColumnForeignKeys } from '../lib/foreign-key-utils'
import type { ForeignKeyColumnInfo } from '../types/schema'
import { getFirstSqlKeyword } from '../lib/sql-utils'
import { useSettingsStore } from './settings-store'
import { useHistoryStore } from './history-store'

// Re-export for backward compatibility (used by tests and other modules)
export { stripLeadingSqlComments } from '../lib/sql-utils'

/** Default page-size fallback used when settings have not been loaded (e.g. in tests). */
const FALLBACK_PAGE_SIZE = 1000

/**
 * Read the default page size from the settings store.
 * Returns the settings value if settings have been loaded; otherwise falls back
 * to FALLBACK_PAGE_SIZE (1000) so that existing tests are not affected.
 */
export function getDefaultPageSize(): number {
  const state = useSettingsStore.getState()
  // Settings are loaded if the settings map has keys
  if (Object.keys(state.settings).length > 0) {
    const parsed = parseInt(state.getSetting('results.pageSize'), 10)
    if (!isNaN(parsed) && parsed > 0) return parsed
  }
  return FALLBACK_PAGE_SIZE
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

/** Ensures IPC returned a usable result page (avoids TypeError on null mocks). */
function parseResultPagePayload(value: unknown): {
  rows: unknown[][]
  page: number
  totalPages: number
} | null {
  if (value == null || typeof value !== 'object') {
    return null
  }
  const o = value as Record<string, unknown>
  if (!Array.isArray(o.rows) || typeof o.page !== 'number' || typeof o.totalPages !== 'number') {
    return null
  }
  return { rows: o.rows, page: o.page, totalPages: o.totalPages }
}

export type ExecutionStatus = 'idle' | 'running' | 'success' | 'error'

// ---------------------------------------------------------------------------
// SingleResultState — per-result fields
// ---------------------------------------------------------------------------

export interface SingleResultState {
  /** Per-result execution status. */
  status: ExecutionStatus
  /** Column metadata from the query. */
  columns: ColumnMeta[]
  /** Current page rows. */
  rows: unknown[][]
  /** Total row count. */
  totalRows: number
  /** Execution time (ms). */
  executionTimeMs: number
  /** Affected rows (for non-SELECT). */
  affectedRows: number
  /** Query ID for pagination. */
  queryId: string | null
  /** Current page number (1-indexed). */
  currentPage: number
  /** Total pages. */
  totalPages: number
  /** Page size. */
  pageSize: number
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
  /** Index of the selected row (null = none). */
  selectedRowIndex: number | null
  /** Whether the export dialog is open. */
  exportDialogOpen: boolean
  /** The SQL that produced this result set. */
  lastExecutedSql: string | null
  /** Whether this result can be re-executed (false for stored proc results). */
  reExecutable: boolean
  /** Whether edit analysis has been performed for this result. */
  isAnalyzed: boolean

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
  /** Connection ID used for edit-mode IPC calls. */
  editConnectionId: string | null
  /** Index of the row being edited in the current page's rows array. */
  editingRowIndex: number | null
}

// ---------------------------------------------------------------------------
// TabQueryState — tab-level fields + results array
// ---------------------------------------------------------------------------

export interface TabQueryState {
  /** The SQL content in the editor for this tab. */
  content: string
  /** File path if tab was opened from a file (for Save). */
  filePath: string | null
  /** Tab-level execution status. */
  status: ExecutionStatus
  /** Cursor position (persisted so it can be restored on tab switch). */
  cursorPosition: { lineNumber: number; column: number } | null
  /** Connection ID for this tab (used for deferred analysis). */
  connectionId: string
  /** Array of per-result states. */
  results: SingleResultState[]
  /** Index of the currently active result. */
  activeResultIndex: number
  /** Deferred action waiting on unsaved changes dialog. */
  pendingNavigationAction: (() => void) | null
  /** Date.now() when the query started executing, null when idle. */
  executionStartedAt: number | null
  /** True while cancel IPC is in flight. */
  isCancelling: boolean
  /** True if the current error was caused by user cancellation. */
  wasCancelled: boolean
}

export const DEFAULT_RESULT_STATE: SingleResultState = {
  status: 'idle',
  columns: [],
  rows: [],
  totalRows: 0,
  executionTimeMs: 0,
  affectedRows: 0,
  queryId: null,
  currentPage: 1,
  totalPages: 1,
  pageSize: FALLBACK_PAGE_SIZE,
  autoLimitApplied: false,
  errorMessage: null,
  viewMode: 'grid',
  sortColumn: null,
  sortDirection: null,
  selectedRowIndex: null,
  exportDialogOpen: false,
  lastExecutedSql: null,
  reExecutable: true,
  isAnalyzed: false,

  // Edit mode defaults
  editMode: null,
  editTableMetadata: {},
  editForeignKeys: [],
  editState: null,
  isAnalyzingQuery: false,
  editableColumnMap: new Map(),
  editColumnBindings: new Map(),
  editBoundColumnIndexMap: new Map(),
  saveError: null,
  editConnectionId: null,
  editingRowIndex: null,
}

const DEFAULT_TAB_STATE: TabQueryState = {
  content: '',
  filePath: null,
  status: 'idle',
  cursorPosition: null,
  connectionId: '',
  results: [],
  activeResultIndex: 0,
  pendingNavigationAction: null,
  executionStartedAt: null,
  isCancelling: false,
  wasCancelled: false,
}

/** Default values for all edit-related fields on a SingleResultState (used by clearEditState). */
const EDIT_STATE_DEFAULTS: Partial<SingleResultState> = {
  editMode: null,
  editTableMetadata: {},
  editForeignKeys: [],
  editState: null,
  isAnalyzingQuery: false,
  editableColumnMap: new Map(),
  editColumnBindings: new Map(),
  editBoundColumnIndexMap: new Map(),
  saveError: null,
  editConnectionId: null,
  editingRowIndex: null,
}

/**
 * Get the active result from a tab, or DEFAULT_RESULT_STATE if none.
 * Exported for use by components.
 */
export function getActiveResult(tab: TabQueryState | undefined): SingleResultState {
  if (!tab || tab.results.length === 0) return DEFAULT_RESULT_STATE
  const idx = Math.min(tab.activeResultIndex, tab.results.length - 1)
  return tab.results[idx] ?? DEFAULT_RESULT_STATE
}

/**
 * Check if any result in a tab has unsaved edits.
 * Used by close-tab and close-connection guards.
 */
export function hasAnyUnsavedEdits(tab: TabQueryState | undefined): boolean {
  if (!tab) return false
  return tab.results.some((r) => r.editState !== null && r.editState.modifiedColumns.size > 0)
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
    columnBindings,
    boundColumnIndexMap: buildBoundColumnIndexMap(columnBindings),
  }
}

function isTinyIntBooleanAlias(dataType: string): boolean {
  const normalized = dataType.trim().toUpperCase()
  return normalized === 'BOOL' || normalized === 'BOOLEAN'
}

function normalizeQueryRows(columns: ColumnMeta[], rows: unknown[][]): unknown[][] {
  if (columns.length === 0 || rows.length === 0) {
    return rows
  }

  const booleanAliasIndexes = columns.reduce<Set<number>>((indexes, column, index) => {
    if (isTinyIntBooleanAlias(column.dataType)) {
      indexes.add(index)
    }
    return indexes
  }, new Set())

  if (booleanAliasIndexes.size === 0) {
    return rows
  }

  return rows.map((row) => {
    let changed = false

    const normalizedRow = row.map((value, index) => {
      if (typeof value === 'boolean' && booleanAliasIndexes.has(index)) {
        changed = true
        return value ? 1 : 0
      }

      return value
    })

    return changed ? normalizedRow : row
  })
}

/** Build a SingleResultState from a MultiQueryResultItem. */
function buildSingleResultFromItem(
  item: MultiQueryResultItem,
  defaultPageSize: number
): SingleResultState {
  const normalizedRows = normalizeQueryRows(item.columns, item.firstPage)
  const status: ExecutionStatus = item.error ? 'error' : 'success'
  return {
    ...DEFAULT_RESULT_STATE,
    status,
    columns: item.columns,
    rows: normalizedRows,
    totalRows: item.totalRows,
    executionTimeMs: item.executionTimeMs,
    affectedRows: item.affectedRows,
    queryId: item.queryId,
    currentPage: 1,
    totalPages: item.totalPages,
    pageSize: defaultPageSize,
    autoLimitApplied: item.autoLimitApplied,
    errorMessage: item.error ?? null,
    lastExecutedSql: item.sourceSql,
    reExecutable: item.reExecutable,
    isAnalyzed: false,
  }
}

interface QueryState {
  /** Per-tab state keyed by tab ID. */
  tabs: Record<string, TabQueryState>

  /** Get or create state for a tab. */
  getTabState: (tabId: string) => TabQueryState

  /** Update editor content for a tab. */
  setContent: (tabId: string, content: string) => void

  /** Update file path for a tab (when opened from or saved to file). */
  setFilePath: (tabId: string, filePath: string | null) => void

  /** Update cursor position for a tab (persisted for tab switching). */
  setCursorPosition: (tabId: string, position: { lineNumber: number; column: number }) => void

  /** Execute a SQL query for a tab (single statement, non-CALL). */
  executeQuery: (connectionId: string, tabId: string, sql: string) => Promise<void>

  /** Execute multiple SQL statements for a tab. */
  executeMultiQuery: (connectionId: string, tabId: string, statements: string[]) => Promise<void>

  /** Execute a CALL statement for a tab. */
  executeCallQuery: (connectionId: string, tabId: string, sql: string) => Promise<void>

  /** Set the active result tab index. */
  setActiveResultIndex: (tabId: string, index: number) => void

  /** Fetch a page of results for a tab. */
  fetchPage: (connectionId: string, tabId: string, page: number) => Promise<void>

  /** Clean up state for a tab (called on tab close). */
  cleanupTab: (connectionId: string, tabId: string) => void

  /** Clean up all tabs for a connection (called on disconnect). */
  cleanupConnection: (connectionId: string, tabIds: string[]) => void

  /** Set the result view mode (grid/form/text). */
  setViewMode: (tabId: string, mode: ViewMode) => void

  /** Set the selected row index. */
  setSelectedRow: (tabId: string, index: number | null) => void

  /** Open the export dialog. */
  openExportDialog: (tabId: string) => void

  /** Close the export dialog. */
  closeExportDialog: (tabId: string) => void

  /** Sort results by a column via server-side sort IPC. */
  sortResults: (
    connectionId: string,
    tabId: string,
    column: string,
    direction: 'asc' | 'desc' | null
  ) => Promise<void>

  /** Change page size and re-execute the query with new pagination. */
  changePageSize: (connectionId: string, tabId: string, size: number) => Promise<void>

  /** Cancel a running query for a tab. */
  cancelQuery: (connectionId: string, tabId: string) => Promise<void>

  // --- Edit mode actions ---

  /** Enable or disable edit mode for a table. connectionId needed for IPC. */
  setEditMode: (connectionId: string, tabId: string, tableName: string | null) => Promise<void>

  /** Start editing a specific row by its page-local index. */
  startEditingRow: (tabId: string, rowIndex: number) => void

  /** Update a cell value in the current edit state (editState only). */
  updateCellValue: (tabId: string, resultColumnIndex: number, value: unknown) => void

  /** Update a cell value and also sync the local rows array for grid re-render. */
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
}

export const useQueryStore = create<QueryState>()((set, get) => {
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

  /** Get the active result index for a tab (safe). */
  const getActiveIndex = (tabId: string): number => {
    const tab = get().tabs[tabId]
    if (!tab || tab.results.length === 0) return 0
    return Math.min(tab.activeResultIndex, tab.results.length - 1)
  }

  /** Get the active result for a tab. */
  const getActiveResultState = (tabId: string): SingleResultState | null => {
    const tab = get().tabs[tabId]
    if (!tab || tab.results.length === 0) return null
    const idx = getActiveIndex(tabId)
    return tab.results[idx] ?? null
  }

  /** Mark a tab as executing: set running status, record start time, clear stale flags. */
  const beginExecution = (tabId: string) => {
    patchTab(tabId, {
      status: 'running',
      executionStartedAt: Date.now(),
      isCancelling: false,
      wasCancelled: false,
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
  const _runAnalysis = async (
    tabId: string,
    connectionId: string,
    sql: string,
    expectedQueryId: string | null,
    resultIndex?: number
  ): Promise<Record<string, QueryTableEditInfo> | null> => {
    const generation = ++_analysisGeneration
    const rIdx = resultIndex ?? getActiveIndex(tabId)

    patchResultByIndex(tabId, rIdx, { isAnalyzingQuery: true })
    try {
      const raw = await analyzeQueryForEditCmd(connectionId, sql)
      const tables = Array.isArray(raw) ? raw : []

      // Guard: tab closed or a newer query has replaced this one
      const currentTab = get().tabs[tabId]
      if (!currentTab) return null
      const currentResult = currentTab.results[rIdx]
      if (!currentResult) return null
      if (expectedQueryId !== null && currentResult.queryId !== expectedQueryId) {
        // Stale response — only clear flag if no newer analysis has started
        if (generation === _analysisGeneration) {
          patchResultByIndex(tabId, rIdx, { isAnalyzingQuery: false })
        }
        return null
      }

      const metadata: Record<string, QueryTableEditInfo> = {}
      for (const t of tables) {
        metadata[compositeTableKey(t.database, t.table)] = t
      }

      patchResultByIndex(tabId, rIdx, {
        editTableMetadata: metadata,
        isAnalyzingQuery: false,
        isAnalyzed: true,
      })

      return metadata
    } catch (err) {
      const currentTab = get().tabs[tabId]
      if (!currentTab) return null
      const currentResult = currentTab.results[rIdx]
      if (!currentResult) return null
      if (expectedQueryId !== null && currentResult.queryId !== expectedQueryId) {
        // Stale error — only clear flag if no newer analysis has started
        if (generation === _analysisGeneration) {
          patchResultByIndex(tabId, rIdx, { isAnalyzingQuery: false })
        }
        return null
      }
      patchResultByIndex(tabId, rIdx, { isAnalyzingQuery: false })
      throw err
    }
  }

  /**
   * Shared implementation for multi-result executions (batch and CALL).
   *
   * @param ipcCall - the IPC function returning `MultiQueryResult`
   * @param runPostAnalysis - whether to fire-and-forget analysis on the first SELECT result
   */
  const runMultiResultExecution = async (
    connectionId: string,
    tabId: string,
    ipcCall: () => Promise<{ results: MultiQueryResultItem[] }>,
    runPostAnalysis: boolean
  ) => {
    // Guard against double execution
    const currentState = get().tabs[tabId]
    if (currentState?.status === 'running') return

    const activeResult = getActiveResultState(tabId)
    const currentPageSize = activeResult?.pageSize ?? getDefaultPageSize()

    // Clear edit state
    get().clearEditState(tabId)

    patchTab(tabId, { wasCancelled: false, connectionId })
    beginExecution(tabId)

    try {
      const multiResult = await ipcCall()

      if (!get().tabs[tabId]) return

      const results = multiResult.results.map((item) =>
        buildSingleResultFromItem(item, currentPageSize)
      )

      // Tab-level status: 'success' if at least one result exists
      const tabStatus: ExecutionStatus = results.length > 0 ? 'success' : 'idle'

      patchTab(tabId, {
        status: tabStatus,
        results,
        activeResultIndex: 0,
        wasCancelled: false,
      })
      finalizeExecution(tabId)

      // Notify history store so the panel auto-refreshes
      useHistoryStore.getState().notifyNewQuery(connectionId)

      // Fire-and-forget analysis on the first result if it's a SELECT
      if (
        runPostAnalysis &&
        results.length > 0 &&
        results[0].columns.length > 0 &&
        isEditableSelectSql(results[0].lastExecutedSql)
      ) {
        _runAnalysis(tabId, connectionId, results[0].lastExecutedSql!, results[0].queryId, 0).catch(
          (err) => {
            console.error('[query-edit] analyze_query_for_edit failed (multi):', err)
          }
        )
      }
    } catch (err) {
      if (!get().tabs[tabId]) return

      const wasCancelled = get().tabs[tabId]?.wasCancelled ?? false
      const errorMessage = wasCancelled
        ? 'Query cancelled by user'
        : err instanceof Error
          ? err.message
          : String(err)

      const errorResult: SingleResultState = {
        ...DEFAULT_RESULT_STATE,
        status: 'error',
        errorMessage,
      }

      patchTab(tabId, {
        status: 'error',
        results: [errorResult],
        activeResultIndex: 0,
        wasCancelled: false,
      })
      finalizeExecution(tabId)

      // Notify history store so the panel auto-refreshes (error queries are logged too)
      useHistoryStore.getState().notifyNewQuery(connectionId)
    }
  }

  /**
   * Re-execute a single result within a multi-result tab via `reexecuteSingleResult`,
   * guard against stale responses, normalize rows, patch the result, and schedule analysis.
   *
   * Does NOT set tab-level status to 'running'. Used by `sortResults` (sort-clear)
   * and `changePageSize` for the multi-result path.
   *
   * @param extraPatch - additional fields to merge into the patched result (e.g. sortColumn reset, pageSize)
   */
  const reexecuteAndPatchResult = async (
    connectionId: string,
    tabId: string,
    resultIndex: number,
    sql: string,
    pageSize: number,
    capturedQueryId: string | null,
    extraPatch: Partial<SingleResultState>
  ) => {
    const reResult = await reexecuteSingleResultCmd(connectionId, tabId, resultIndex, sql, pageSize)

    if (!get().tabs[tabId]) return

    // Guard: verify the result hasn't been replaced by a newer execution
    const postTab = get().tabs[tabId]
    const postResult = postTab?.results[resultIndex]
    if (capturedQueryId && postResult?.queryId !== capturedQueryId) {
      // Stale re-execution — silently discard
      console.warn(
        '[query-store] reexecuteAndPatchResult: discarding stale re-execution result (queryId mismatch)'
      )
      return
    }

    const normalizedRows = normalizeQueryRows(reResult.columns, reResult.firstPage)
    patchResultByIndex(tabId, resultIndex, {
      rows: normalizedRows,
      columns: reResult.columns,
      currentPage: 1,
      totalPages: reResult.totalPages,
      totalRows: reResult.totalRows,
      queryId: reResult.queryId,
      executionTimeMs: reResult.executionTimeMs,
      affectedRows: reResult.affectedRows,
      autoLimitApplied: reResult.autoLimitApplied,
      status: 'success',
      errorMessage: reResult.error ?? null,
      selectedRowIndex: null,
      ...extraPatch,
    })

    if (reResult.columns.length > 0 && isEditableSelectSql(sql)) {
      _runAnalysis(tabId, connectionId, sql, reResult.queryId, resultIndex).catch((err) => {
        console.error('[query-edit] analyze_query_for_edit failed (re-exec):', err)
      })
    }
  }

  return {
    tabs: {},

    getTabState: (tabId: string) => {
      return get().tabs[tabId] ?? { ...DEFAULT_TAB_STATE }
    },

    setContent: (tabId: string, content: string) => {
      patchTab(tabId, { content })
    },

    setFilePath: (tabId: string, filePath: string | null) => {
      patchTab(tabId, { filePath })
    },

    setCursorPosition: (tabId: string, position: { lineNumber: number; column: number }) => {
      patchTab(tabId, { cursorPosition: position })
    },

    executeQuery: async (connectionId: string, tabId: string, sql: string) => {
      // Guard against double execution for the same tab
      const currentState = get().tabs[tabId]
      if (currentState?.status === 'running') {
        return // already running, ignore
      }

      // Grab the current page size from active result
      const activeResult = getActiveResultState(tabId)
      const currentPageSize = activeResult?.pageSize ?? getDefaultPageSize()

      // Clear edit state before the new query
      get().clearEditState(tabId)

      // Reset cancel flags at start
      patchTab(tabId, { wasCancelled: false, connectionId })

      // Set running status
      beginExecution(tabId)

      try {
        const result = await executeQueryCmd(connectionId, tabId, sql, currentPageSize)

        // Guard: if the tab was closed while query was running, skip the update
        if (!get().tabs[tabId]) return

        const normalizedRows = normalizeQueryRows(result.columns, result.firstPage)

        const singleResult: SingleResultState = {
          ...DEFAULT_RESULT_STATE,
          status: 'success',
          columns: result.columns,
          rows: normalizedRows,
          totalRows: result.totalRows,
          executionTimeMs: result.executionTimeMs,
          affectedRows: result.affectedRows,
          queryId: result.queryId,
          currentPage: 1,
          totalPages: result.totalPages,
          pageSize: currentPageSize,
          autoLimitApplied: result.autoLimitApplied,
          lastExecutedSql: sql,
          reExecutable: true,
          isAnalyzed: false,
        }

        patchTab(tabId, {
          status: 'success',
          results: [singleResult],
          activeResultIndex: 0,
          // Clear cancel flags on completion
          wasCancelled: false,
        })
        finalizeExecution(tabId)

        // Notify history store so the panel auto-refreshes
        useHistoryStore.getState().notifyNewQuery(connectionId)

        // Fire-and-forget background query analysis
        // Only for SELECT/WITH queries with columns
        if (result.columns.length > 0 && isEditableSelectSql(sql)) {
          _runAnalysis(tabId, connectionId, sql, result.queryId, 0).catch((err) => {
            console.error('[query-edit] analyze_query_for_edit failed:', err)
            showErrorToast(
              'Edit mode analysis failed',
              err instanceof Error ? err.message : String(err),
              10_000
            )
          })
        }
      } catch (err) {
        // Guard: if the tab was closed while query was running, skip the update
        if (!get().tabs[tabId]) return

        const wasCancelled = get().tabs[tabId]?.wasCancelled ?? false
        const errorMessage = wasCancelled
          ? 'Query cancelled by user'
          : err instanceof Error
            ? err.message
            : String(err)

        const errorResult: SingleResultState = {
          ...DEFAULT_RESULT_STATE,
          status: 'error',
          errorMessage,
        }

        patchTab(tabId, {
          status: 'error',
          results: [errorResult],
          activeResultIndex: 0,
          // Clear cancel flags on completion
          wasCancelled: false,
        })
        finalizeExecution(tabId)

        // Notify history store so the panel auto-refreshes (error queries are logged too)
        useHistoryStore.getState().notifyNewQuery(connectionId)
      }
    },

    executeMultiQuery: async (connectionId: string, tabId: string, statements: string[]) => {
      await runMultiResultExecution(
        connectionId,
        tabId,
        () =>
          executeMultiQueryCmd(
            connectionId,
            tabId,
            statements,
            getActiveResultState(tabId)?.pageSize ?? getDefaultPageSize()
          ),
        true
      )
    },

    executeCallQuery: async (connectionId: string, tabId: string, sql: string) => {
      await runMultiResultExecution(
        connectionId,
        tabId,
        () =>
          executeCallQueryCmd(
            connectionId,
            tabId,
            sql,
            getActiveResultState(tabId)?.pageSize ?? getDefaultPageSize()
          ),
        false
      )
    },

    setActiveResultIndex: (tabId: string, index: number) => {
      const tab = get().tabs[tabId]
      if (!tab) return

      // Guard: index must be valid
      if (index < 0 || index >= tab.results.length) return

      // Check if active result has unsaved edits
      const currentResult = tab.results[tab.activeResultIndex]
      if (currentResult?.editState && currentResult.editState.modifiedColumns.size > 0) {
        // Defer via navigation guard
        const store = get()
        store.requestNavigationAction(tabId, () => {
          patchTab(tabId, { activeResultIndex: index })
          // Trigger deferred analysis if needed
          const afterSwitch = get().tabs[tabId]
          if (!afterSwitch) return
          const newResult = afterSwitch.results[index]
          if (
            newResult &&
            !newResult.isAnalyzed &&
            newResult.reExecutable &&
            newResult.lastExecutedSql
          ) {
            if (newResult.columns.length > 0 && isEditableSelectSql(newResult.lastExecutedSql)) {
              _runAnalysis(
                tabId,
                afterSwitch.connectionId,
                newResult.lastExecutedSql,
                newResult.queryId,
                index
              ).catch((err) => {
                console.error('[query-edit] deferred analysis failed:', err)
              })
            }
          }
        })
        return
      }

      // If current result has an edit state with no modifications, discard silently
      if (currentResult?.editState) {
        patchResultByIndex(tabId, tab.activeResultIndex, {
          editState: null,
          editingRowIndex: null,
          saveError: null,
        })
      }

      patchTab(tabId, { activeResultIndex: index })

      // Trigger deferred analysis if needed
      const afterSwitch = get().tabs[tabId]
      if (!afterSwitch) return
      const newResult = afterSwitch.results[index]
      if (
        newResult &&
        !newResult.isAnalyzed &&
        newResult.reExecutable &&
        newResult.lastExecutedSql
      ) {
        if (newResult.columns.length > 0 && isEditableSelectSql(newResult.lastExecutedSql)) {
          _runAnalysis(
            tabId,
            afterSwitch.connectionId,
            newResult.lastExecutedSql,
            newResult.queryId,
            index
          ).catch((err) => {
            console.error('[query-edit] deferred analysis failed:', err)
          })
        }
      }
    },

    fetchPage: async (connectionId: string, tabId: string, page: number) => {
      const tab = get().tabs[tabId]
      if (!tab) return
      const resultIndex = getActiveIndex(tabId)
      const result = tab.results[resultIndex]
      if (!result?.queryId) return

      try {
        const raw = await fetchResultPageCmd(connectionId, tabId, result.queryId, page, resultIndex)
        const parsed = parseResultPagePayload(raw)
        if (!parsed) {
          console.error(
            '[query-store] fetchPage failed: invalid fetch_result_page payload (expected rows, page, totalPages)'
          )
          return
        }
        const normalizedRows = normalizeQueryRows(result.columns, parsed.rows)

        // Guard: if the tab was closed while fetching, skip the update
        if (!get().tabs[tabId]) return

        patchResultByIndex(tabId, resultIndex, {
          rows: normalizedRows,
          currentPage: parsed.page,
          totalPages: parsed.totalPages,
        })
      } catch (err) {
        console.error('[query-store] fetchPage failed:', err)
      }
    },

    cleanupTab: (connectionId: string, tabId: string) => {
      // Fire-and-forget eviction
      evictResultsCmd(connectionId, tabId).catch((err) => {
        console.error('[query-store] evictResults failed (cleanupTab):', err)
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
        evictResultsCmd(connectionId, id).catch((err) => {
          console.error('[query-store] evictResults failed (cleanupConnection):', err)
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
      if (mode === 'text' && result.editState && result.editState.modifiedColumns.size > 0) {
        get()
          .saveCurrentRow(tabId)
          .then(() => {
            const afterSave = get().tabs[tabId]
            const afterResult = afterSave?.results[resultIndex]
            if (afterResult && !afterResult.saveError) {
              patchResultByIndex(tabId, resultIndex, { viewMode: mode })
            } else {
              showErrorToast(
                'Cannot switch to text view',
                'Save failed. Fix or discard edits before switching to text view.'
              )
            }
          })
          .catch((err) => {
            console.error('[query-store] saveCurrentRow failed while switching to text view:', err)
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
      patchResultByIndex(tabId, resultIndex, { selectedRowIndex: index })
    },

    openExportDialog: (tabId: string) => {
      const resultIndex = getActiveIndex(tabId)
      patchResultByIndex(tabId, resultIndex, { exportDialogOpen: true })
    },

    closeExportDialog: (tabId: string) => {
      const resultIndex = getActiveIndex(tabId)
      patchResultByIndex(tabId, resultIndex, { exportDialogOpen: false })
    },

    sortResults: async (
      connectionId: string,
      tabId: string,
      column: string,
      direction: 'asc' | 'desc' | null
    ) => {
      const resultIndex = getActiveIndex(tabId)

      try {
        if (!direction) {
          // Sort cleared — re-execute to restore natural order
          const tab = get().tabs[tabId]
          const result = tab?.results[resultIndex]
          const lastSql = result?.lastExecutedSql

          if (lastSql && result) {
            // Cache-only results: cannot re-execute to restore natural order
            if (!result.reExecutable) {
              showWarningToast(
                'Sort not available',
                'Sort cannot be cleared for cached results (stored procedure). Re-run the query to restore natural order.'
              )
              return
            }

            const currentPageSize = result.pageSize

            // Capture queryId before the await so we can detect stale responses
            const capturedQueryId = result.queryId

            // Clear edit state before re-execution
            patchResultByIndex(tabId, resultIndex, {
              editMode: null,
              editableColumnMap: new Map(),
              editColumnBindings: new Map(),
              editBoundColumnIndexMap: new Map(),
              editForeignKeys: [],
              editTableMetadata: {},
              editState: null,
              editingRowIndex: null,
            })

            // Use reexecuteSingleResult for multi-result tabs
            if ((tab?.results.length ?? 0) > 1) {
              await reexecuteAndPatchResult(
                connectionId,
                tabId,
                resultIndex,
                lastSql,
                currentPageSize,
                capturedQueryId,
                { sortColumn: null, sortDirection: null }
              )
            } else {
              // Single-result tab: use executeQuery as before
              const execResult = await executeQueryCmd(
                connectionId,
                tabId,
                lastSql,
                currentPageSize
              )
              const normalizedRows = normalizeQueryRows(execResult.columns, execResult.firstPage)

              if (!get().tabs[tabId]) return

              patchResultByIndex(tabId, resultIndex, {
                sortColumn: null,
                sortDirection: null,
                rows: normalizedRows,
                columns: execResult.columns,
                currentPage: 1,
                totalPages: execResult.totalPages,
                totalRows: execResult.totalRows,
                queryId: execResult.queryId,
                executionTimeMs: execResult.executionTimeMs,
                affectedRows: execResult.affectedRows,
                autoLimitApplied: execResult.autoLimitApplied,
                status: 'success',
                errorMessage: null,
                selectedRowIndex: null,
              })

              if (execResult.columns.length > 0 && isEditableSelectSql(lastSql)) {
                _runAnalysis(tabId, connectionId, lastSql, execResult.queryId, resultIndex).catch(
                  (err) => {
                    console.error('[query-edit] analyze_query_for_edit failed (sort re-exec):', err)
                  }
                )
              }
            }
          } else {
            // No lastSql — just clear sort state visually
            patchResultByIndex(tabId, resultIndex, { sortColumn: null, sortDirection: null })
          }
          return
        }

        // Reset selection before performing sort
        patchResultByIndex(tabId, resultIndex, { selectedRowIndex: null })

        const currentResult = get().tabs[tabId]?.results[resultIndex]
        const currentColumns = currentResult?.columns ?? []

        const raw = await sortResultsCmd(connectionId, tabId, column, direction, resultIndex)
        const parsed = parseResultPagePayload(raw)
        if (!parsed) {
          console.error(
            '[query-store] sortResults failed: invalid sort_results payload (expected rows, page, totalPages)'
          )
          return
        }
        const normalizedRows = normalizeQueryRows(currentColumns, parsed.rows)

        // Guard: if the tab was closed while sorting, skip the update
        if (!get().tabs[tabId]) return

        patchResultByIndex(tabId, resultIndex, {
          sortColumn: column,
          sortDirection: direction,
          rows: normalizedRows,
          currentPage: parsed.page,
          totalPages: parsed.totalPages,
        })
      } catch (error) {
        console.error('[query-store] sortResults failed:', error)
      }
    },

    changePageSize: async (connectionId: string, tabId: string, size: number) => {
      const tab = get().tabs[tabId]
      const resultIndex = getActiveIndex(tabId)
      const result = tab?.results[resultIndex]

      if (!result?.lastExecutedSql) return

      // Cache-only results: show toast and do nothing
      if (!result.reExecutable) {
        showWarningToast(
          'Cannot change page size',
          'This result is from a stored procedure and cannot be re-executed.'
        )
        return
      }

      // Capture queryId before the await so we can detect stale responses
      const capturedQueryId = result.queryId

      // Clear edit state before re-execution
      patchResultByIndex(tabId, resultIndex, {
        editMode: null,
        editableColumnMap: new Map(),
        editColumnBindings: new Map(),
        editBoundColumnIndexMap: new Map(),
        editForeignKeys: [],
        editTableMetadata: {},
        editState: null,
        editingRowIndex: null,
        pageSize: size,
      })

      // For multi-result tabs, use reexecuteSingleResult (no tab-level running status)
      if ((tab?.results.length ?? 0) > 1) {
        try {
          await reexecuteAndPatchResult(
            connectionId,
            tabId,
            resultIndex,
            result.lastExecutedSql,
            size,
            capturedQueryId,
            { pageSize: size, sortColumn: null, sortDirection: null }
          )
        } catch (error) {
          if (!get().tabs[tabId]) return
          // Guard: if the result was replaced by a newer execution, discard the stale error
          const postTab = get().tabs[tabId]
          const postResult = postTab?.results[resultIndex]
          if (capturedQueryId && postResult?.queryId !== capturedQueryId) {
            console.warn('[query-store] changePageSize: discarding stale error (queryId mismatch)')
            return
          }
          const errorMessage = error instanceof Error ? error.message : String(error)
          patchResultByIndex(tabId, resultIndex, {
            status: 'error',
            errorMessage,
          })
        }
      } else {
        // Single-result tab: full re-execution with tab-level running status
        beginExecution(tabId)

        try {
          const execResult = await executeQueryCmd(
            connectionId,
            tabId,
            result.lastExecutedSql,
            size
          )
          const normalizedRows = normalizeQueryRows(execResult.columns, execResult.firstPage)

          if (!get().tabs[tabId]) return

          const updatedResult: SingleResultState = {
            ...DEFAULT_RESULT_STATE,
            status: 'success',
            rows: normalizedRows,
            columns: execResult.columns,
            currentPage: 1,
            totalPages: execResult.totalPages,
            totalRows: execResult.totalRows,
            pageSize: size,
            queryId: execResult.queryId,
            executionTimeMs: execResult.executionTimeMs,
            affectedRows: execResult.affectedRows,
            autoLimitApplied: execResult.autoLimitApplied,
            lastExecutedSql: result.lastExecutedSql,
            reExecutable: true,
          }

          patchTab(tabId, {
            status: 'success',
            results: [updatedResult],
            activeResultIndex: 0,
            wasCancelled: false,
          })
          finalizeExecution(tabId)

          if (execResult.columns.length > 0 && isEditableSelectSql(result.lastExecutedSql)) {
            _runAnalysis(tabId, connectionId, result.lastExecutedSql!, execResult.queryId, 0).catch(
              (err) => {
                console.error('[query-edit] analyze_query_for_edit failed (page re-exec):', err)
              }
            )
          }
        } catch (error) {
          if (!get().tabs[tabId]) return

          const wasCancelled = get().tabs[tabId]?.wasCancelled ?? false
          const errorMessage = wasCancelled
            ? 'Query cancelled by user'
            : error instanceof Error
              ? error.message
              : String(error)

          patchResultByIndex(tabId, 0, {
            status: 'error',
            errorMessage,
          })
          patchTab(tabId, {
            status: 'error',
            wasCancelled: false,
          })
          finalizeExecution(tabId)
        }
      }
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
        const result = await cancelQueryCmd(connectionId, tabId)

        if (!get().tabs[tabId]) return

        if (result) {
          showSuccessToast('Query cancelled')
        } else {
          patchTab(tabId, { isCancelling: false, wasCancelled: false })
        }
      } catch (err) {
        if (!get().tabs[tabId]) return

        patchTab(tabId, { isCancelling: false, wasCancelled: false })
        const errorMsg = err instanceof Error ? err.message : String(err)
        showErrorToast('Cancel failed', errorMsg)
      }
    },

    // ------------------------------------------------------------------
    // Edit mode actions — operate on active result
    // ------------------------------------------------------------------

    setEditMode: async (connectionId: string, tabId: string, tableName: string | null) => {
      const resultIndex = getActiveIndex(tabId)

      // Disable edit mode
      if (tableName === null) {
        patchResultByIndex(tabId, resultIndex, {
          editMode: null,
          editableColumnMap: new Map(),
          editColumnBindings: new Map(),
          editBoundColumnIndexMap: new Map(),
          editForeignKeys: [],
          editState: null,
          editConnectionId: null,
          editingRowIndex: null,
          saveError: null,
        })
        return
      }

      const tab = get().tabs[tabId]
      const result = tab?.results[resultIndex]
      if (!result || result.columns.length === 0) return

      // Check metadata cache
      let tableInfo = result.editTableMetadata[tableName]

      if (!tableInfo) {
        if (!result.lastExecutedSql) {
          showErrorToast('Edit mode failed', 'No SQL query available for analysis')
          return
        }

        try {
          const metadata = await _runAnalysis(
            tabId,
            connectionId,
            result.lastExecutedSql,
            result.queryId,
            resultIndex
          )
          if (!metadata) return // stale or tab closed
          tableInfo = metadata[tableName]
        } catch (err) {
          console.error('[query-store] setEditMode analyze_query_for_edit failed:', err)
          showErrorToast('Edit mode failed', err instanceof Error ? err.message : String(err))
          return
        }
      }

      if (!tableInfo) {
        showErrorToast('Edit mode failed', `Table metadata not available for ${tableName}`)
        return
      }

      if (!tableInfo.primaryKey) {
        showErrorToast('Edit mode failed', `Cannot edit ${tableName}: no primary or unique key`)
        return
      }

      // Re-read in case analysis updated it
      const currentTab = get().tabs[tabId]
      const currentResult = currentTab?.results[resultIndex]
      if (!currentResult) return

      // Find ambiguous columns in the result set
      const ambiguous = findAmbiguousColumns(currentResult.columns)
      const metadataSource =
        tableName in currentResult.editTableMetadata
          ? currentResult.editTableMetadata
          : {
              ...currentResult.editTableMetadata,
              ...((tableInfo ? { [tableName]: tableInfo } : {}) as Record<
                string,
                QueryTableEditInfo
              >),
            }
      const { columnBindings, boundColumnIndexMap } = buildEditBindingContext(
        currentResult,
        tableInfo,
        metadataSource
      )

      // Validate PK columns are present and non-ambiguous
      const validation = validateKeyColumnsPresent(
        tableInfo.primaryKey.keyColumns,
        currentResult.columns,
        ambiguous,
        boundColumnIndexMap
      )
      if (!validation.valid) {
        showErrorToast(
          'Edit mode failed',
          `Cannot edit ${tableName}: result set does not contain the unique key columns (${validation.missingColumns.join(', ')})`
        )
        return
      }

      // Warn only for selected-table columns that remain ambiguous after binding
      if (ambiguous.size > 0) {
        const keyColsLower = new Set(tableInfo.primaryKey.keyColumns.map((k) => k.toLowerCase()))
        const nonKeyAmbiguous = tableInfo.columns
          .map((column) => column.name)
          .filter((columnName) => {
            const lower = columnName.toLowerCase()
            return (
              ambiguous.has(lower) && !keyColsLower.has(lower) && !boundColumnIndexMap.has(lower)
            )
          })
        if (nonKeyAmbiguous.length > 0) {
          showWarningToast(
            'Ambiguous columns',
            `Some columns are ambiguous and cannot be edited: ${nonKeyAmbiguous.join(', ')}`
          )
        }
      }

      // Build editable column map
      const editableMap = buildEditableColumnMap(
        currentResult.columns,
        tableInfo.columns,
        ambiguous,
        columnBindings
      )

      patchResultByIndex(tabId, resultIndex, {
        editMode: tableName,
        editableColumnMap: editableMap,
        editColumnBindings: columnBindings,
        editBoundColumnIndexMap: boundColumnIndexMap,
        editForeignKeys: mapSingleColumnForeignKeys(tableInfo.foreignKeys),
        editState: null,
        editConnectionId: connectionId,
        editingRowIndex: null,
        saveError: null,
      })
    },

    startEditingRow: (tabId: string, rowIndex: number) => {
      const resultIndex = getActiveIndex(tabId)
      const tab = get().tabs[tabId]
      const result = tab?.results[resultIndex]
      if (!result?.editMode || !result.editTableMetadata[result.editMode]) return

      const row = result.rows[rowIndex]
      if (!row) return

      const tableInfo = result.editTableMetadata[result.editMode]
      const pkColumns = tableInfo.primaryKey?.keyColumns ?? []
      const editState = buildRowEditState(
        row,
        result.columns,
        result.editableColumnMap,
        pkColumns,
        result.editColumnBindings,
        result.editBoundColumnIndexMap
      )

      patchResultByIndex(tabId, resultIndex, {
        editState,
        editingRowIndex: rowIndex,
        saveError: null,
      })
    },

    updateCellValue: (tabId: string, resultColumnIndex: number, value: unknown) => {
      const resultIndex = getActiveIndex(tabId)
      const tab = get().tabs[tabId]
      const result = tab?.results[resultIndex]
      if (!result?.editState) return

      const resolvedColumnName =
        result.editColumnBindings.get(resultColumnIndex) ?? result.columns[resultColumnIndex]?.name
      if (!resolvedColumnName) return

      const newModified = new Set(result.editState.modifiedColumns)
      if (
        JSON.stringify(result.editState.originalValues[resolvedColumnName]) ===
        JSON.stringify(value)
      ) {
        newModified.delete(resolvedColumnName)
      } else {
        newModified.add(resolvedColumnName)
      }

      patchResultByIndex(tabId, resultIndex, {
        editState: {
          ...result.editState,
          currentValues: { ...result.editState.currentValues, [resolvedColumnName]: value },
          modifiedColumns: newModified,
        },
        saveError: null,
      })
    },

    syncCellValue: (tabId: string, resultColumnIndex: number, value: unknown) => {
      const resultIndex = getActiveIndex(tabId)
      const tab = get().tabs[tabId]
      const result = tab?.results[resultIndex]
      if (!result?.editState || result.editingRowIndex === null) return

      const resolvedColumnName =
        result.editColumnBindings.get(resultColumnIndex) ?? result.columns[resultColumnIndex]?.name
      if (!resolvedColumnName) return

      // Update editState
      const newModified = new Set(result.editState.modifiedColumns)
      if (
        JSON.stringify(result.editState.originalValues[resolvedColumnName]) ===
        JSON.stringify(value)
      ) {
        newModified.delete(resolvedColumnName)
      } else {
        newModified.add(resolvedColumnName)
      }

      // Also update the local row in the rows array for grid re-render
      const colIdx = resultColumnIndex
      let nextRows = result.rows
      if (colIdx !== -1 && result.editingRowIndex < result.rows.length) {
        nextRows = [...result.rows]
        const nextRow = [...nextRows[result.editingRowIndex]]
        nextRow[colIdx] = value
        nextRows[result.editingRowIndex] = nextRow
      }

      patchResultByIndex(tabId, resultIndex, {
        rows: nextRows,
        editState: {
          ...result.editState,
          currentValues: { ...result.editState.currentValues, [resolvedColumnName]: value },
          modifiedColumns: newModified,
        },
        saveError: null,
      })
    },

    saveCurrentRow: async (tabId: string): Promise<boolean> => {
      const resultIndex = getActiveIndex(tabId)
      const tab = get().tabs[tabId]
      const result = tab?.results[resultIndex]
      if (!result?.editState || !result.editMode || result.editingRowIndex === null) return true

      // Nothing modified — just clear editState
      if (result.editState.modifiedColumns.size === 0) {
        patchResultByIndex(tabId, resultIndex, {
          editState: null,
          editingRowIndex: null,
          saveError: null,
        })
        return true
      }

      const tableInfo = result.editTableMetadata[result.editMode]
      if (!tableInfo?.primaryKey) {
        const msg = 'No primary key info available'
        patchResultByIndex(tabId, resultIndex, { saveError: msg })
        showErrorToast('Save failed', msg)
        return false
      }

      const { pkColumns, originalPkValues, updatedValues } = buildUpdatePayload(
        result.editState,
        tableInfo.primaryKey.keyColumns
      )

      try {
        await updateTableRowCmd({
          connectionId: result.editConnectionId!,
          database: tableInfo.database,
          table: tableInfo.table,
          primaryKeyColumns: pkColumns,
          originalPkValues,
          updatedValues,
        })

        if (!get().tabs[tabId]) return true

        // Update local row data
        const newRows = [...result.rows]
        const updatedRow = [...newRows[result.editingRowIndex]]
        for (const colName of result.editState.modifiedColumns) {
          const colIdx = result.editBoundColumnIndexMap.get(colName.toLowerCase()) ?? -1
          if (colIdx !== -1) {
            updatedRow[colIdx] = result.editState.currentValues[colName]
          }
        }
        newRows[result.editingRowIndex] = updatedRow

        // Sync backend result cache
        const absoluteRowIndex = (result.currentPage - 1) * result.pageSize + result.editingRowIndex
        const columnUpdates: Record<number, unknown> = {}
        for (const colName of result.editState.modifiedColumns) {
          const colIdx = result.editBoundColumnIndexMap.get(colName.toLowerCase()) ?? -1
          if (colIdx !== -1) {
            columnUpdates[colIdx] = result.editState.currentValues[colName]
          }
        }
        try {
          await updateResultCellCmd(
            result.editConnectionId!,
            tabId,
            absoluteRowIndex,
            columnUpdates,
            resultIndex
          )
        } catch (cacheErr) {
          console.warn('[query-store] Result cache sync failed:', cacheErr)
          showWarningToast(
            'Cache sync warning',
            'Row saved successfully, but the result cache may be stale. Re-run the query to refresh pagination/sort/export.'
          )
        }

        // Guard: tab may have been closed during the async cache-sync
        if (!get().tabs[tabId]) return true

        patchResultByIndex(tabId, resultIndex, {
          rows: newRows,
          editState: null,
          editingRowIndex: null,
          saveError: null,
        })
        showSuccessToast('Row saved', 'Changes saved successfully.')
        return true
      } catch (err) {
        if (!get().tabs[tabId]) return false

        const errorMsg = err instanceof Error ? err.message : String(err)
        patchResultByIndex(tabId, resultIndex, { saveError: errorMsg })
        showErrorToast('Save failed', errorMsg)
        return false
      }
    },

    discardCurrentRow: (tabId: string) => {
      const resultIndex = getActiveIndex(tabId)
      const tab = get().tabs[tabId]
      const result = tab?.results[resultIndex]
      if (!result?.editState) return

      if (result.editingRowIndex !== null && result.editingRowIndex < result.rows.length) {
        // Restore original values in the row
        const newRows = [...result.rows]
        const restoredRow = [...newRows[result.editingRowIndex]]
        for (const [colName, value] of Object.entries(result.editState.originalValues)) {
          const colIdx = result.editBoundColumnIndexMap.get(colName.toLowerCase()) ?? -1
          if (colIdx !== -1) {
            restoredRow[colIdx] = value
          }
        }
        newRows[result.editingRowIndex] = restoredRow
        patchResultByIndex(tabId, resultIndex, {
          rows: newRows,
          editState: null,
          editingRowIndex: null,
          saveError: null,
        })
      } else {
        patchResultByIndex(tabId, resultIndex, {
          editState: null,
          editingRowIndex: null,
          saveError: null,
        })
      }
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
        patchResultByIndex(tabId, resultIndex, {
          editState: null,
          editingRowIndex: null,
          saveError: null,
        })
        action()
        return
      }
      // Modifications exist — defer and show unsaved changes dialog
      patchTab(tabId, { pendingNavigationAction: action })
    },

    confirmNavigation: async (tabId: string, shouldSave: boolean) => {
      const tab = get().tabs[tabId]
      if (!tab) return

      if (shouldSave) {
        await get().saveCurrentRow(tabId)

        const afterSave = get().tabs[tabId]
        const resultIndex = getActiveIndex(tabId)
        const afterResult = afterSave?.results[resultIndex]
        if (afterResult && !afterResult.saveError) {
          const action = afterSave?.pendingNavigationAction
          patchTab(tabId, { pendingNavigationAction: null })
          action?.()
        }
        // If save failed, pendingNavigationAction stays set (dialog remains open)
      } else {
        const action = tab.pendingNavigationAction
        get().discardCurrentRow(tabId)
        patchTab(tabId, { pendingNavigationAction: null })
        action?.()
      }
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
  }
})
