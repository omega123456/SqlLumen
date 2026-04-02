import { create } from 'zustand'
import type { ColumnMeta, QueryTableEditInfo, RowEditState, ViewMode } from '../types/schema'
import {
  executeQuery as executeQueryCmd,
  fetchResultPage as fetchResultPageCmd,
  evictResults as evictResultsCmd,
  sortResults as sortResultsCmd,
  analyzeQueryForEdit as analyzeQueryForEditCmd,
  updateResultCell as updateResultCellCmd,
} from '../lib/query-commands'
import { updateTableRow as updateTableRowCmd } from '../lib/table-data-commands'
import { showErrorToast, showInfoToast, showSuccessToast } from './toast-store'
import {
  findAmbiguousColumns,
  buildBoundColumnIndexMap,
  buildEditableColumnMap,
  buildQueryEditColumnBindings,
  validateKeyColumnsPresent,
  buildRowEditState,
  buildUpdatePayload,
} from '../lib/query-edit-utils'

/**
 * Strip leading SQL comments (block, line `-- ...`, and `# ...`)
 * so we can identify the first real keyword for editability checks.
 */
function stripLeadingSqlComments(sql: string): string {
  let s = sql

  while (true) {
    s = s.trimStart()
    if (s.startsWith('/*')) {
      // Block comment — find the matching close. Support nested /* ... */
      let depth = 0
      let i = 0
      while (i < s.length) {
        if (s[i] === '/' && s[i + 1] === '*') {
          depth++
          i += 2
        } else if (s[i] === '*' && s[i + 1] === '/') {
          depth--
          i += 2
          if (depth === 0) break
        } else {
          i++
        }
      }
      s = s.slice(i)
    } else if (s.startsWith('--')) {
      // Line comment (-- style)
      const newlineIdx = s.indexOf('\n')
      s = newlineIdx === -1 ? '' : s.slice(newlineIdx + 1)
    } else if (s.startsWith('#')) {
      // Line comment (# style)
      const newlineIdx = s.indexOf('\n')
      s = newlineIdx === -1 ? '' : s.slice(newlineIdx + 1)
    } else {
      break
    }
  }
  return s
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
  const stripped = stripLeadingSqlComments(sql)
  // Extract first whitespace-delimited token, uppercased
  const firstToken = stripped.split(/\s+/)[0]?.toUpperCase() ?? ''
  return firstToken === 'SELECT' || firstToken === 'WITH'
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

export interface TabQueryState {
  /** The SQL content in the editor for this tab. */
  content: string
  /** File path if tab was opened from a file (for Save). */
  filePath: string | null
  /** Current execution status. */
  status: ExecutionStatus
  /** Column metadata from the last successful query. */
  columns: ColumnMeta[]
  /** Current page rows. */
  rows: unknown[][]
  /** Total row count from the last query. */
  totalRows: number
  /** Execution time of the last query (ms). */
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
  /** Cursor position (persisted so it can be restored on tab switch). */
  cursorPosition: { lineNumber: number; column: number } | null
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
  /** The SQL that produced the current result set. */
  lastExecutedSql: string | null

  // --- Edit mode fields ---

  /** Selected table name for editing, or null for read-only. */
  editMode: string | null
  /** Cached table metadata keyed by composite `database.table` key. */
  editTableMetadata: Record<string, QueryTableEditInfo>
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
  /** Deferred action waiting on unsaved changes dialog. */
  pendingNavigationAction: (() => void) | null
  /** Last save error message. */
  saveError: string | null
  /** Connection ID used for edit-mode IPC calls. */
  editConnectionId: string | null
  /** Index of the row being edited in the current page's rows array. */
  editingRowIndex: number | null
}

const DEFAULT_TAB_STATE: TabQueryState = {
  content: '',
  filePath: null,
  status: 'idle',
  columns: [],
  rows: [],
  totalRows: 0,
  executionTimeMs: 0,
  affectedRows: 0,
  queryId: null,
  currentPage: 1,
  totalPages: 1,
  pageSize: 1000,
  autoLimitApplied: false,
  errorMessage: null,
  cursorPosition: null,
  viewMode: 'grid',
  sortColumn: null,
  sortDirection: null,
  selectedRowIndex: null,
  exportDialogOpen: false,
  lastExecutedSql: null,

  // Edit mode defaults
  editMode: null,
  editTableMetadata: {},
  editState: null,
  isAnalyzingQuery: false,
  editableColumnMap: new Map(),
  editColumnBindings: new Map(),
  editBoundColumnIndexMap: new Map(),
  pendingNavigationAction: null,
  saveError: null,
  editConnectionId: null,
  editingRowIndex: null,
}

/** Default values for all edit-related fields (used by clearEditState). */
const EDIT_STATE_DEFAULTS: Partial<TabQueryState> = {
  editMode: null,
  editTableMetadata: {},
  editState: null,
  isAnalyzingQuery: false,
  editableColumnMap: new Map(),
  editColumnBindings: new Map(),
  editBoundColumnIndexMap: new Map(),
  pendingNavigationAction: null,
  saveError: null,
  editConnectionId: null,
  editingRowIndex: null,
}

/** Build a stable composite key for edit table metadata: `database.table`. */
function compositeTableKey(database: string, table: string): string {
  return `${database}.${table}`
}

function buildEditBindingContext(
  tab: TabQueryState,
  tableInfo: QueryTableEditInfo,
  metadataSource: Record<string, QueryTableEditInfo> = tab.editTableMetadata
): {
  columnBindings: Map<number, string>
  boundColumnIndexMap: Map<string, number>
} {
  const queryTablesInOrder = Object.values(metadataSource)
  const columnBindings = buildQueryEditColumnBindings(
    tab.lastExecutedSql,
    tab.columns,
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

  /** Execute a SQL query for a tab. */
  executeQuery: (connectionId: string, tabId: string, sql: string) => Promise<void>

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

  /** Reset all edit-related fields to defaults. */
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

  /**
   * Generation counter for `_runAnalysis`. Ensures that only the most recent
   * analysis call can clear `isAnalyzingQuery`, preventing a stale (older)
   * analysis from prematurely clearing the flag while a newer one is in flight.
   */
  let _analysisGeneration = 0

  /**
   * Internal helper: run query analysis, normalize results into editTableMetadata.
   * Returns the metadata map, or null if the result was stale/discarded.
   * Throws on IPC failure (caller decides whether to show toast or swallow).
   */
  const _runAnalysis = async (
    tabId: string,
    connectionId: string,
    sql: string,
    expectedQueryId: string | null
  ): Promise<Record<string, QueryTableEditInfo> | null> => {
    const generation = ++_analysisGeneration
    patchTab(tabId, { isAnalyzingQuery: true })
    try {
      const raw = await analyzeQueryForEditCmd(connectionId, sql)
      const tables = Array.isArray(raw) ? raw : []

      // Guard: tab closed or a newer query has replaced this one
      const currentTab = get().tabs[tabId]
      if (!currentTab) return null
      if (expectedQueryId !== null && currentTab.queryId !== expectedQueryId) {
        // Stale response — only clear flag if no newer analysis has started
        if (generation === _analysisGeneration) {
          patchTab(tabId, { isAnalyzingQuery: false })
        }
        return null
      }

      const metadata: Record<string, QueryTableEditInfo> = {}
      for (const t of tables) {
        metadata[compositeTableKey(t.database, t.table)] = t
      }

      patchTab(tabId, {
        editTableMetadata: metadata,
        isAnalyzingQuery: false,
      })

      return metadata
    } catch (err) {
      const currentTab = get().tabs[tabId]
      if (!currentTab) return null
      if (expectedQueryId !== null && currentTab.queryId !== expectedQueryId) {
        // Stale error — only clear flag if no newer analysis has started
        if (generation === _analysisGeneration) {
          patchTab(tabId, { isAnalyzingQuery: false })
        }
        return null
      }
      patchTab(tabId, { isAnalyzingQuery: false })
      throw err
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
      // Grab the current page size before setting running status
      const currentPageSize = get().tabs[tabId]?.pageSize ?? DEFAULT_TAB_STATE.pageSize

      // Clear edit state before the new query
      get().clearEditState(tabId)

      // Set running status
      patchTab(tabId, { status: 'running', errorMessage: null })

      try {
        const result = await executeQueryCmd(connectionId, tabId, sql, currentPageSize)
        const normalizedRows = normalizeQueryRows(result.columns, result.firstPage)

        // Guard: if the tab was closed while query was running, skip the update
        if (!get().tabs[tabId]) return

        patchTab(tabId, {
          status: 'success',
          columns: result.columns,
          rows: normalizedRows,
          totalRows: result.totalRows,
          executionTimeMs: result.executionTimeMs,
          affectedRows: result.affectedRows,
          queryId: result.queryId,
          currentPage: 1,
          totalPages: result.totalPages,
          autoLimitApplied: result.autoLimitApplied,
          errorMessage: null,
          lastExecutedSql: sql,
          // Reset stale sort/selection state on new query
          sortColumn: null,
          sortDirection: null,
          selectedRowIndex: null,
        })

        // Fire-and-forget background query analysis
        // Only for SELECT/WITH queries with columns (skip SHOW, DESCRIBE, EXPLAIN, DML, DDL)
        if (result.columns.length > 0 && isEditableSelectSql(sql)) {
          _runAnalysis(tabId, connectionId, sql, result.queryId).catch((err) => {
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

        patchTab(tabId, {
          status: 'error',
          columns: [],
          rows: [],
          totalRows: 0,
          errorMessage: err instanceof Error ? err.message : String(err),
        })
      }
    },

    fetchPage: async (connectionId: string, tabId: string, page: number) => {
      const tabState = get().tabs[tabId]
      if (!tabState?.queryId) return

      try {
        const raw = await fetchResultPageCmd(connectionId, tabId, tabState.queryId, page)
        const result = parseResultPagePayload(raw)
        if (!result) {
          console.error(
            '[query-store] fetchPage failed: invalid fetch_result_page payload (expected rows, page, totalPages)'
          )
          return
        }
        const normalizedRows = normalizeQueryRows(tabState.columns, result.rows)

        // Guard: if the tab was closed while fetching, skip the update
        if (!get().tabs[tabId]) return

        patchTab(tabId, {
          rows: normalizedRows,
          currentPage: result.page,
          totalPages: result.totalPages,
        })
      } catch (err) {
        console.error('[query-store] fetchPage failed:', err)
        // Page fetch failure — don't change status
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
      if (!tab) {
        patchTab(tabId, { viewMode: mode })
        return
      }

      // Auto-save when switching to text view with pending edits
      if (mode === 'text' && tab.editState && tab.editState.modifiedColumns.size > 0) {
        // Auto-save — only switch to text view if save succeeds
        get()
          .saveCurrentRow(tabId)
          .then(() => {
            const afterSave = get().tabs[tabId]
            if (afterSave && !afterSave.saveError) {
              patchTab(tabId, { viewMode: mode })
            } else {
              // Save failed — keep current view and edit state active
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

      patchTab(tabId, { viewMode: mode })
    },

    setSelectedRow: (tabId: string, index: number | null) => {
      patchTab(tabId, { selectedRowIndex: index })
    },

    openExportDialog: (tabId: string) => {
      patchTab(tabId, { exportDialogOpen: true })
    },

    closeExportDialog: (tabId: string) => {
      patchTab(tabId, { exportDialogOpen: false })
    },

    sortResults: async (
      connectionId: string,
      tabId: string,
      column: string,
      direction: 'asc' | 'desc' | null
    ) => {
      try {
        if (!direction) {
          // Sort cleared — re-execute the original query to restore natural order
          const tabState = get().tabs[tabId]
          const lastSql = tabState?.lastExecutedSql
          if (lastSql) {
            const currentPageSize = tabState?.pageSize ?? DEFAULT_TAB_STATE.pageSize

            // Clear edit state before re-execution to prevent stale metadata writes
            patchTab(tabId, {
              editMode: null,
              editableColumnMap: new Map(),
              editColumnBindings: new Map(),
              editBoundColumnIndexMap: new Map(),
              editTableMetadata: {},
              editState: null,
              editingRowIndex: null,
            })

            const result = await executeQueryCmd(connectionId, tabId, lastSql, currentPageSize)
            const normalizedRows = normalizeQueryRows(result.columns, result.firstPage)

            // Guard: if the tab was closed while re-executing, skip the update
            if (!get().tabs[tabId]) return

            patchTab(tabId, {
              sortColumn: null,
              sortDirection: null,
              rows: normalizedRows,
              columns: result.columns,
              currentPage: 1,
              totalPages: result.totalPages,
              totalRows: result.totalRows,
              queryId: result.queryId,
              executionTimeMs: result.executionTimeMs,
              affectedRows: result.affectedRows,
              autoLimitApplied: result.autoLimitApplied,
              status: 'success',
              errorMessage: null,
              selectedRowIndex: null,
            })

            // Re-trigger analysis for the new queryId (fire-and-forget)
            if (result.columns.length > 0 && isEditableSelectSql(lastSql)) {
              _runAnalysis(tabId, connectionId, lastSql, result.queryId).catch((err) => {
                console.error('[query-edit] analyze_query_for_edit failed (sort re-exec):', err)
              })
            }
          } else {
            // No lastSql — just clear sort state visually
            patchTab(tabId, { sortColumn: null, sortDirection: null })
          }
          return
        }

        // Reset selection before performing sort
        patchTab(tabId, { selectedRowIndex: null })

        const currentColumns = get().tabs[tabId]?.columns ?? []

        const raw = await sortResultsCmd(connectionId, tabId, column, direction)
        const result = parseResultPagePayload(raw)
        if (!result) {
          console.error(
            '[query-store] sortResults failed: invalid sort_results payload (expected rows, page, totalPages)'
          )
          return
        }
        const normalizedRows = normalizeQueryRows(currentColumns, result.rows)

        // Guard: if the tab was closed while sorting, skip the update
        if (!get().tabs[tabId]) return

        patchTab(tabId, {
          sortColumn: column,
          sortDirection: direction,
          rows: normalizedRows,
          currentPage: result.page,
          totalPages: result.totalPages,
        })
      } catch (error) {
        console.error('[query-store] sortResults failed:', error)
      }
    },

    changePageSize: async (connectionId: string, tabId: string, size: number) => {
      const tabState = get().tabs[tabId]
      if (!tabState?.lastExecutedSql) return

      // Clear edit state before re-execution to prevent stale metadata writes
      patchTab(tabId, {
        editMode: null,
        editableColumnMap: new Map(),
        editColumnBindings: new Map(),
        editBoundColumnIndexMap: new Map(),
        editTableMetadata: {},
        editState: null,
        editingRowIndex: null,
      })

      // Set running status and update pageSize
      patchTab(tabId, { pageSize: size, status: 'running', errorMessage: null })

      try {
        const result = await executeQueryCmd(connectionId, tabId, tabState.lastExecutedSql, size)
        const normalizedRows = normalizeQueryRows(result.columns, result.firstPage)

        // Guard: if the tab was closed while re-executing, skip the update
        if (!get().tabs[tabId]) return

        patchTab(tabId, {
          rows: normalizedRows,
          columns: result.columns,
          currentPage: 1,
          totalPages: result.totalPages,
          totalRows: result.totalRows,
          pageSize: size,
          status: 'success',
          queryId: result.queryId,
          executionTimeMs: result.executionTimeMs,
          affectedRows: result.affectedRows,
          autoLimitApplied: result.autoLimitApplied,
          errorMessage: null,
          // Reset sort and selection since data was re-fetched from MySQL
          sortColumn: null,
          sortDirection: null,
          selectedRowIndex: null,
        })

        // Re-trigger analysis for the new queryId (fire-and-forget)
        if (result.columns.length > 0 && isEditableSelectSql(tabState.lastExecutedSql)) {
          _runAnalysis(tabId, connectionId, tabState.lastExecutedSql, result.queryId).catch(
            (err) => {
              console.error('[query-edit] analyze_query_for_edit failed (page re-exec):', err)
            }
          )
        }
      } catch (error) {
        // Guard: if the tab was closed while re-executing, skip the update
        if (!get().tabs[tabId]) return

        patchTab(tabId, {
          status: 'error',
          errorMessage: error instanceof Error ? error.message : String(error),
        })
      }
    },

    // ------------------------------------------------------------------
    // Edit mode actions
    // ------------------------------------------------------------------

    setEditMode: async (connectionId: string, tabId: string, tableName: string | null) => {
      // Disable edit mode
      if (tableName === null) {
        patchTab(tabId, {
          editMode: null,
          editableColumnMap: new Map(),
          editColumnBindings: new Map(),
          editBoundColumnIndexMap: new Map(),
          editState: null,
          editConnectionId: null,
          editingRowIndex: null,
          saveError: null,
        })
        return
      }

      const tab = get().tabs[tabId]
      if (!tab || tab.columns.length === 0) return

      // Check metadata cache
      let tableInfo = tab.editTableMetadata[tableName]

      if (!tableInfo) {
        if (!tab.lastExecutedSql) {
          showErrorToast('Edit mode failed', 'No SQL query available for analysis')
          return
        }

        try {
          const metadata = await _runAnalysis(tabId, connectionId, tab.lastExecutedSql, tab.queryId)
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

      const currentTab = get().tabs[tabId]
      if (!currentTab) return

      // Find ambiguous columns in the result set (local — not persisted in state)
      const ambiguous = findAmbiguousColumns(currentTab.columns)
      const metadataSource =
        tableName in currentTab.editTableMetadata
          ? currentTab.editTableMetadata
          : {
              ...currentTab.editTableMetadata,
              ...((tableInfo ? { [tableName]: tableInfo } : {}) as Record<
                string,
                QueryTableEditInfo
              >),
            }
      const { columnBindings, boundColumnIndexMap } = buildEditBindingContext(
        currentTab,
        tableInfo,
        metadataSource
      )

      // Validate PK columns are present and non-ambiguous
      const validation = validateKeyColumnsPresent(
        tableInfo.primaryKey.keyColumns,
        currentTab.columns,
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

      // Warn about ambiguous non-key columns (editing still allowed)
      if (ambiguous.size > 0) {
        const keyColsLower = new Set(tableInfo.primaryKey.keyColumns.map((k) => k.toLowerCase()))
        const nonKeyAmbiguous = [...ambiguous].filter((a) => !keyColsLower.has(a))
        if (nonKeyAmbiguous.length > 0) {
          showInfoToast(
            'Ambiguous columns',
            `Some columns are ambiguous and cannot be edited: ${nonKeyAmbiguous.join(', ')}`,
            20000
          )
        }
      }

      // Build editable column map
      const editableMap = buildEditableColumnMap(
        currentTab.columns,
        tableInfo.columns,
        ambiguous,
        columnBindings
      )

      patchTab(tabId, {
        editMode: tableName,
        editableColumnMap: editableMap,
        editColumnBindings: columnBindings,
        editBoundColumnIndexMap: boundColumnIndexMap,
        editState: null,
        editConnectionId: connectionId,
        editingRowIndex: null,
        saveError: null,
      })
    },

    startEditingRow: (tabId: string, rowIndex: number) => {
      const tab = get().tabs[tabId]
      if (!tab?.editMode || !tab.editTableMetadata[tab.editMode]) return

      const row = tab.rows[rowIndex]
      if (!row) return

      const tableInfo = tab.editTableMetadata[tab.editMode]
      const pkColumns = tableInfo.primaryKey?.keyColumns ?? []
      const editState = buildRowEditState(
        row,
        tab.columns,
        tab.editableColumnMap,
        pkColumns,
        tab.editColumnBindings,
        tab.editBoundColumnIndexMap
      )

      patchTab(tabId, { editState, editingRowIndex: rowIndex, saveError: null })
    },

    updateCellValue: (tabId: string, resultColumnIndex: number, value: unknown) => {
      const tab = get().tabs[tabId]
      if (!tab?.editState) return

      const resolvedColumnName =
        tab.editColumnBindings.get(resultColumnIndex) ?? tab.columns[resultColumnIndex]?.name
      if (!resolvedColumnName) return

      const newModified = new Set(tab.editState.modifiedColumns)
      if (
        JSON.stringify(tab.editState.originalValues[resolvedColumnName]) === JSON.stringify(value)
      ) {
        newModified.delete(resolvedColumnName)
      } else {
        newModified.add(resolvedColumnName)
      }

      patchTab(tabId, {
        editState: {
          ...tab.editState,
          currentValues: { ...tab.editState.currentValues, [resolvedColumnName]: value },
          modifiedColumns: newModified,
        },
        saveError: null,
      })
    },

    syncCellValue: (tabId: string, resultColumnIndex: number, value: unknown) => {
      const tab = get().tabs[tabId]
      if (!tab?.editState || tab.editingRowIndex === null) return

      const resolvedColumnName =
        tab.editColumnBindings.get(resultColumnIndex) ?? tab.columns[resultColumnIndex]?.name
      if (!resolvedColumnName) return

      // Update editState (same logic as updateCellValue)
      const newModified = new Set(tab.editState.modifiedColumns)
      if (
        JSON.stringify(tab.editState.originalValues[resolvedColumnName]) === JSON.stringify(value)
      ) {
        newModified.delete(resolvedColumnName)
      } else {
        newModified.add(resolvedColumnName)
      }

      // Also update the local row in the rows array for grid re-render
      const colIdx = resultColumnIndex
      let nextRows = tab.rows
      if (colIdx !== -1 && tab.editingRowIndex < tab.rows.length) {
        nextRows = [...tab.rows]
        const nextRow = [...nextRows[tab.editingRowIndex]]
        nextRow[colIdx] = value
        nextRows[tab.editingRowIndex] = nextRow
      }

      patchTab(tabId, {
        rows: nextRows,
        editState: {
          ...tab.editState,
          currentValues: { ...tab.editState.currentValues, [resolvedColumnName]: value },
          modifiedColumns: newModified,
        },
        saveError: null,
      })
    },

    saveCurrentRow: async (tabId: string): Promise<boolean> => {
      const tab = get().tabs[tabId]
      if (!tab?.editState || !tab.editMode || tab.editingRowIndex === null) return true

      // Nothing modified — just clear editState
      if (tab.editState.modifiedColumns.size === 0) {
        patchTab(tabId, { editState: null, editingRowIndex: null, saveError: null })
        return true
      }

      const tableInfo = tab.editTableMetadata[tab.editMode]
      if (!tableInfo?.primaryKey) {
        const msg = 'No primary key info available'
        patchTab(tabId, { saveError: msg })
        showErrorToast('Save failed', msg)
        return false
      }

      const { pkColumns, originalPkValues, updatedValues } = buildUpdatePayload(
        tab.editState,
        tableInfo.primaryKey.keyColumns
      )

      try {
        await updateTableRowCmd({
          connectionId: tab.editConnectionId!,
          database: tableInfo.database,
          table: tableInfo.table,
          primaryKeyColumns: pkColumns,
          originalPkValues,
          updatedValues,
        })

        if (!get().tabs[tabId]) return true

        // Update local row data
        const newRows = [...tab.rows]
        const updatedRow = [...newRows[tab.editingRowIndex]]
        for (const colName of tab.editState.modifiedColumns) {
          const colIdx = tab.editBoundColumnIndexMap.get(colName.toLowerCase()) ?? -1
          if (colIdx !== -1) {
            updatedRow[colIdx] = tab.editState.currentValues[colName]
          }
        }
        newRows[tab.editingRowIndex] = updatedRow

        // Sync backend result cache — await to catch errors
        const absoluteRowIndex = (tab.currentPage - 1) * tab.pageSize + tab.editingRowIndex
        const columnUpdates: Record<number, unknown> = {}
        for (const colName of tab.editState.modifiedColumns) {
          const colIdx = tab.editBoundColumnIndexMap.get(colName.toLowerCase()) ?? -1
          if (colIdx !== -1) {
            columnUpdates[colIdx] = tab.editState.currentValues[colName]
          }
        }
        try {
          await updateResultCellCmd(tab.editConnectionId!, tabId, absoluteRowIndex, columnUpdates)
        } catch (cacheErr) {
          // Cache sync is non-critical — the row IS saved in the database
          // but the local cache may be stale until the query is re-run
          console.warn('[query-store] Result cache sync failed:', cacheErr)
          showInfoToast(
            'Cache sync warning',
            'Row saved successfully, but the result cache may be stale. Re-run the query to refresh pagination/sort/export.',
            10000
          )
        }

        // Guard: tab may have been closed during the async cache-sync
        if (!get().tabs[tabId]) return true

        patchTab(tabId, {
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
        patchTab(tabId, { saveError: errorMsg })
        showErrorToast('Save failed', errorMsg)
        return false
      }
    },

    discardCurrentRow: (tabId: string) => {
      const tab = get().tabs[tabId]
      if (!tab?.editState) return

      if (tab.editingRowIndex !== null && tab.editingRowIndex < tab.rows.length) {
        // Restore original values in the row
        const newRows = [...tab.rows]
        const restoredRow = [...newRows[tab.editingRowIndex]]
        for (const [colName, value] of Object.entries(tab.editState.originalValues)) {
          const colIdx = tab.editBoundColumnIndexMap.get(colName.toLowerCase()) ?? -1
          if (colIdx !== -1) {
            restoredRow[colIdx] = value
          }
        }
        newRows[tab.editingRowIndex] = restoredRow
        patchTab(tabId, {
          rows: newRows,
          editState: null,
          editingRowIndex: null,
          saveError: null,
        })
      } else {
        patchTab(tabId, { editState: null, editingRowIndex: null, saveError: null })
      }
    },

    requestNavigationAction: (tabId: string, action: () => void) => {
      const tab = get().tabs[tabId]
      if (!tab?.editState) {
        action()
        return
      }
      // Active edit state with no modifications — discard silently and proceed
      // (the dataset is about to change, invalidating loaded original values)
      if (tab.editState.modifiedColumns.size === 0) {
        patchTab(tabId, { editState: null, editingRowIndex: null, saveError: null })
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
        if (afterSave && !afterSave.saveError) {
          const action = afterSave.pendingNavigationAction
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
      patchTab(tabId, { ...EDIT_STATE_DEFAULTS })
    },
  }
})
