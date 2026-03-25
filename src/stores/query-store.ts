import { create } from 'zustand'
import type { ColumnMeta, ViewMode } from '../types/schema'
import {
  executeQuery as executeQueryCmd,
  fetchResultPage as fetchResultPageCmd,
  evictResults as evictResultsCmd,
  sortResults as sortResultsCmd,
} from '../lib/query-commands'

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

      // Set running status
      patchTab(tabId, { status: 'running', errorMessage: null })

      try {
        const result = await executeQueryCmd(connectionId, tabId, sql, currentPageSize)

        // Guard: if the tab was closed while query was running, skip the update
        if (!get().tabs[tabId]) return

        patchTab(tabId, {
          status: 'success',
          columns: result.columns,
          rows: result.firstPage,
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
        const result = await fetchResultPageCmd(connectionId, tabId, tabState.queryId, page)

        // Guard: if the tab was closed while fetching, skip the update
        if (!get().tabs[tabId]) return

        patchTab(tabId, {
          rows: result.rows,
          currentPage: result.page,
          totalPages: result.totalPages,
        })
      } catch {
        // Page fetch failure — don't change status
      }
    },

    cleanupTab: (connectionId: string, tabId: string) => {
      // Fire-and-forget eviction
      evictResultsCmd(connectionId, tabId).catch(() => {})
      set((state) => {
        const newTabs = { ...state.tabs }
        delete newTabs[tabId]
        return { tabs: newTabs }
      })
    },

    cleanupConnection: (connectionId: string, tabIds: string[]) => {
      // Evict Rust-side results for each tab (fire-and-forget)
      for (const id of tabIds) {
        evictResultsCmd(connectionId, id).catch(() => {})
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
            const result = await executeQueryCmd(connectionId, tabId, lastSql, currentPageSize)

            // Guard: if the tab was closed while re-executing, skip the update
            if (!get().tabs[tabId]) return

            patchTab(tabId, {
              sortColumn: null,
              sortDirection: null,
              rows: result.firstPage,
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
          } else {
            // No lastSql — just clear sort state visually
            patchTab(tabId, { sortColumn: null, sortDirection: null })
          }
          return
        }

        // Reset selection before performing sort
        patchTab(tabId, { selectedRowIndex: null })

        const result = await sortResultsCmd(connectionId, tabId, column, direction)

        // Guard: if the tab was closed while sorting, skip the update
        if (!get().tabs[tabId]) return

        patchTab(tabId, {
          sortColumn: column,
          sortDirection: direction,
          rows: result.rows,
          currentPage: result.page,
          totalPages: result.totalPages,
        })
      } catch (error) {
        console.error('sortResults failed:', error)
      }
    },

    changePageSize: async (connectionId: string, tabId: string, size: number) => {
      const tabState = get().tabs[tabId]
      if (!tabState?.lastExecutedSql) return

      // Set running status and update pageSize
      patchTab(tabId, { pageSize: size, status: 'running', errorMessage: null })

      try {
        const result = await executeQueryCmd(connectionId, tabId, tabState.lastExecutedSql, size)

        // Guard: if the tab was closed while re-executing, skip the update
        if (!get().tabs[tabId]) return

        patchTab(tabId, {
          rows: result.firstPage,
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
      } catch (error) {
        // Guard: if the tab was closed while re-executing, skip the update
        if (!get().tabs[tabId]) return

        patchTab(tabId, {
          status: 'error',
          errorMessage: error instanceof Error ? error.message : String(error),
        })
      }
    },
  }
})
