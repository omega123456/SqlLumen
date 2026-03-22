import { create } from 'zustand'
import type { ColumnMeta } from '../types/schema'
import {
  executeQuery as executeQueryCmd,
  fetchResultPage as fetchResultPageCmd,
  evictResults as evictResultsCmd,
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
}

export const useQueryStore = create<QueryState>()((set, get) => ({
  tabs: {},

  getTabState: (tabId: string) => {
    return get().tabs[tabId] ?? { ...DEFAULT_TAB_STATE }
  },

  setContent: (tabId: string, content: string) => {
    set((state) => ({
      tabs: {
        ...state.tabs,
        [tabId]: {
          ...(state.tabs[tabId] ?? DEFAULT_TAB_STATE),
          content,
        },
      },
    }))
  },

  setFilePath: (tabId: string, filePath: string | null) => {
    set((state) => ({
      tabs: {
        ...state.tabs,
        [tabId]: {
          ...(state.tabs[tabId] ?? DEFAULT_TAB_STATE),
          filePath,
        },
      },
    }))
  },

  setCursorPosition: (tabId: string, position: { lineNumber: number; column: number }) => {
    set((state) => ({
      tabs: {
        ...state.tabs,
        [tabId]: {
          ...(state.tabs[tabId] ?? DEFAULT_TAB_STATE),
          cursorPosition: position,
        },
      },
    }))
  },

  executeQuery: async (connectionId: string, tabId: string, sql: string) => {
    // Set running status
    set((state) => ({
      tabs: {
        ...state.tabs,
        [tabId]: {
          ...(state.tabs[tabId] ?? DEFAULT_TAB_STATE),
          status: 'running' as const,
          errorMessage: null,
        },
      },
    }))

    try {
      const result = await executeQueryCmd(connectionId, tabId, sql)

      // Guard: if the tab was closed while query was running, skip the update
      if (!get().tabs[tabId]) return

      set((state) => ({
        tabs: {
          ...state.tabs,
          [tabId]: {
            ...(state.tabs[tabId] ?? DEFAULT_TAB_STATE),
            status: 'success' as const,
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
          },
        },
      }))
    } catch (err) {
      // Guard: if the tab was closed while query was running, skip the update
      if (!get().tabs[tabId]) return

      set((state) => ({
        tabs: {
          ...state.tabs,
          [tabId]: {
            ...(state.tabs[tabId] ?? DEFAULT_TAB_STATE),
            status: 'error' as const,
            columns: [],
            rows: [],
            totalRows: 0,
            errorMessage: err instanceof Error ? err.message : String(err),
          },
        },
      }))
    }
  },

  fetchPage: async (connectionId: string, tabId: string, page: number) => {
    const tabState = get().tabs[tabId]
    if (!tabState?.queryId) return

    try {
      const result = await fetchResultPageCmd(connectionId, tabId, tabState.queryId, page)

      // Guard: if the tab was closed while fetching, skip the update
      if (!get().tabs[tabId]) return

      set((state) => ({
        tabs: {
          ...state.tabs,
          [tabId]: {
            ...(state.tabs[tabId] ?? DEFAULT_TAB_STATE),
            rows: result.rows,
            currentPage: result.page,
            totalPages: result.totalPages,
          },
        },
      }))
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
}))
