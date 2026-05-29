import { create } from 'zustand'
import type { HistoryEntry, HistoryPage } from '../types/schema'
import {
  listHistory as listHistoryCmd,
  deleteHistoryEntry as deleteHistoryEntryCmd,
  clearHistory as clearHistoryCmd,
} from '../lib/history-commands'
import { showErrorToast, showSuccessToast } from './toast-store'

import { logFrontend } from '../lib/app-log-commands'
const DEFAULT_PAGE_SIZE = 50

/** Options for {@link HistoryState.loadHistory}. */
interface LoadHistoryOptions {
  /** 1-indexed page to fetch. Defaults to the connection's current page (or 1). */
  page?: number
  /** Search term. Defaults to the connection's stored search. */
  search?: string
  /**
   * RFC-3339 lower bound on `timestamp`; only entries at/after this instant are
   * returned and counted. `null` means "no time filter". Defaults to the
   * connection's stored `since`.
   */
  since?: string | null
  /**
   * When `true`, append the fetched rows to the existing list ("load more")
   * instead of replacing it. Uses `isLoadingMoreByConnection` for the spinner
   * and never raises the full-panel error state.
   */
  append?: boolean
}

interface HistoryState {
  /** Entries keyed by connection ID (accumulated when loading more). */
  entriesByConnection: Record<string, HistoryEntry[]>
  /** Total count per connection within the current search/time-range filter. */
  totalByConnection: Record<string, number>
  /** Highest page loaded per connection (1-indexed). */
  pageByConnection: Record<string, number>
  /** Search filter per connection. */
  searchByConnection: Record<string, string>
  /** RFC-3339 time-range lower bound per connection (`null` = no filter). */
  sinceByConnection: Record<string, string | null>
  /** Loading state per connection (initial / replace load). */
  isLoadingByConnection: Record<string, boolean>
  /** Loading state per connection for "load more" (append) requests. */
  isLoadingMoreByConnection: Record<string, boolean>
  /** Error message per connection. */
  errorByConnection: Record<string, string | null>
  /** Page size (global constant). */
  pageSize: number

  // Actions
  loadHistory: (connectionId: string, opts?: LoadHistoryOptions) => Promise<void>
  loadMore: (connectionId: string) => Promise<void>
  deleteEntry: (connectionId: string, id: number) => Promise<void>
  clearAll: (connectionId: string) => Promise<void>
  setSearch: (connectionId: string, search: string) => void
  setPage: (connectionId: string, page: number) => void
  reset: () => void
  /** Re-fetch the first page if history is loaded for this connection. */
  notifyNewQuery: (connectionId: string) => void
}

const INITIAL_STATE = {
  entriesByConnection: {} as Record<string, HistoryEntry[]>,
  totalByConnection: {} as Record<string, number>,
  pageByConnection: {} as Record<string, number>,
  searchByConnection: {} as Record<string, string>,
  sinceByConnection: {} as Record<string, string | null>,
  isLoadingByConnection: {} as Record<string, boolean>,
  isLoadingMoreByConnection: {} as Record<string, boolean>,
  errorByConnection: {} as Record<string, string | null>,
  pageSize: DEFAULT_PAGE_SIZE,
}

export const useHistoryStore = create<HistoryState>()((set, get) => ({
  ...INITIAL_STATE,

  loadHistory: async (connectionId: string, opts: LoadHistoryOptions = {}) => {
    const state = get()
    const append = opts.append ?? false
    const page = opts.page ?? state.pageByConnection[connectionId] ?? 1
    const search =
      opts.search !== undefined ? opts.search : (state.searchByConnection[connectionId] ?? '')
    const since =
      opts.since !== undefined ? opts.since : (state.sinceByConnection[connectionId] ?? null)

    if (append) {
      set({
        isLoadingMoreByConnection: {
          ...get().isLoadingMoreByConnection,
          [connectionId]: true,
        },
      })
    } else {
      set({
        isLoadingByConnection: { ...get().isLoadingByConnection, [connectionId]: true },
        errorByConnection: { ...get().errorByConnection, [connectionId]: null },
      })
    }

    try {
      const result: HistoryPage = await listHistoryCmd(
        connectionId,
        page,
        get().pageSize,
        search || null,
        since
      )

      const previous = get().entriesByConnection[connectionId] ?? []
      const entries = append ? [...previous, ...result.entries] : result.entries

      set({
        entriesByConnection: { ...get().entriesByConnection, [connectionId]: entries },
        totalByConnection: { ...get().totalByConnection, [connectionId]: result.total },
        pageByConnection: { ...get().pageByConnection, [connectionId]: page },
        searchByConnection: { ...get().searchByConnection, [connectionId]: search },
        sinceByConnection: { ...get().sinceByConnection, [connectionId]: since },
        isLoadingByConnection: { ...get().isLoadingByConnection, [connectionId]: false },
        isLoadingMoreByConnection: {
          ...get().isLoadingMoreByConnection,
          [connectionId]: false,
        },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logFrontend('error', ['[history-store] loadHistory failed:', err].map(String).join(' '))
      if (append) {
        // Keep the already-loaded rows visible; surface the failure as a toast.
        set({
          isLoadingMoreByConnection: {
            ...get().isLoadingMoreByConnection,
            [connectionId]: false,
          },
        })
        showErrorToast('Failed to load more history', msg)
      } else {
        set({
          isLoadingByConnection: { ...get().isLoadingByConnection, [connectionId]: false },
          errorByConnection: { ...get().errorByConnection, [connectionId]: msg },
        })
      }
    }
  },

  loadMore: async (connectionId: string) => {
    const nextPage = (get().pageByConnection[connectionId] ?? 1) + 1
    await get().loadHistory(connectionId, { page: nextPage, append: true })
  },

  deleteEntry: async (connectionId: string, id: number) => {
    try {
      await deleteHistoryEntryCmd(id)
      // Refresh current page for the connection
      const state = get()
      const page = state.pageByConnection[connectionId] ?? 1
      await get().loadHistory(connectionId, { page })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logFrontend('error', ['[history-store] deleteEntry failed:', err].map(String).join(' '))
      showErrorToast('Failed to delete history entry', msg)
    }
  },

  clearAll: async (connectionId: string) => {
    try {
      const count = await clearHistoryCmd(connectionId)
      set({
        entriesByConnection: { ...get().entriesByConnection, [connectionId]: [] },
        totalByConnection: { ...get().totalByConnection, [connectionId]: 0 },
        pageByConnection: { ...get().pageByConnection, [connectionId]: 1 },
      })
      showSuccessToast('History cleared', `Removed ${count} entries`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logFrontend('error', ['[history-store] clearAll failed:', err].map(String).join(' '))
      showErrorToast('Failed to clear history', msg)
    }
  },

  setSearch: (connectionId: string, search: string) => {
    // A new search resets the load-more window back to the first page.
    void get().loadHistory(connectionId, { page: 1, search })
  },

  setPage: (connectionId: string, page: number) => {
    void get().loadHistory(connectionId, { page })
  },

  reset: () => {
    set(INITIAL_STATE)
  },

  notifyNewQuery: (connectionId: string) => {
    const state = get()
    // Only refresh if history has been loaded (panel is open) for this connection.
    // Use `in` to distinguish "never loaded" (key absent) from "loaded but empty" ([]).
    if (connectionId in state.entriesByConnection) {
      // Re-fetch the first page so the new query shows at the top; this also
      // resets any "load more" window, preserving the active search/time range.
      void get().loadHistory(connectionId, { page: 1 })
    }
  },
}))
