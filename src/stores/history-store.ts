import { create } from 'zustand'
import type { HistoryEntry, HistoryPage } from '../types/schema'
import {
  listHistory as listHistoryCmd,
  deleteHistoryEntry as deleteHistoryEntryCmd,
  clearHistory as clearHistoryCmd,
} from '../lib/history-commands'
import { showErrorToast, showSuccessToast } from './toast-store'

const DEFAULT_PAGE_SIZE = 50

interface HistoryState {
  /** Entries keyed by connection ID. */
  entriesByConnection: Record<string, HistoryEntry[]>
  /** Total count per connection (for pagination). */
  totalByConnection: Record<string, number>
  /** Current page per connection (1-indexed). */
  pageByConnection: Record<string, number>
  /** Search filter per connection. */
  searchByConnection: Record<string, string>
  /** Loading state per connection. */
  isLoadingByConnection: Record<string, boolean>
  /** Error message per connection. */
  errorByConnection: Record<string, string | null>
  /** Page size (global constant). */
  pageSize: number

  // Actions
  loadHistory: (connectionId: string, page?: number, search?: string) => Promise<void>
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
  isLoadingByConnection: {} as Record<string, boolean>,
  errorByConnection: {} as Record<string, string | null>,
  pageSize: DEFAULT_PAGE_SIZE,
}

export const useHistoryStore = create<HistoryState>()((set, get) => ({
  ...INITIAL_STATE,

  loadHistory: async (connectionId: string, page?: number, search?: string) => {
    const state = get()
    const currentPage = page ?? state.pageByConnection[connectionId] ?? 1
    const currentSearch = search ?? state.searchByConnection[connectionId] ?? ''

    set({
      isLoadingByConnection: { ...get().isLoadingByConnection, [connectionId]: true },
      errorByConnection: { ...get().errorByConnection, [connectionId]: null },
    })

    try {
      const result: HistoryPage = await listHistoryCmd(
        connectionId,
        currentPage,
        get().pageSize,
        currentSearch || null
      )

      set({
        entriesByConnection: { ...get().entriesByConnection, [connectionId]: result.entries },
        totalByConnection: { ...get().totalByConnection, [connectionId]: result.total },
        pageByConnection: { ...get().pageByConnection, [connectionId]: result.page },
        isLoadingByConnection: { ...get().isLoadingByConnection, [connectionId]: false },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[history-store] loadHistory failed:', err)
      set({
        isLoadingByConnection: { ...get().isLoadingByConnection, [connectionId]: false },
        errorByConnection: { ...get().errorByConnection, [connectionId]: msg },
      })
    }
  },

  deleteEntry: async (connectionId: string, id: number) => {
    try {
      await deleteHistoryEntryCmd(id)
      // Refresh current page for the connection
      const state = get()
      const page = state.pageByConnection[connectionId] ?? 1
      const search = state.searchByConnection[connectionId] ?? ''
      await get().loadHistory(connectionId, page, search)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[history-store] deleteEntry failed:', err)
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
      console.error('[history-store] clearAll failed:', err)
      showErrorToast('Failed to clear history', msg)
    }
  },

  setSearch: (connectionId: string, search: string) => {
    set({
      searchByConnection: { ...get().searchByConnection, [connectionId]: search },
      pageByConnection: { ...get().pageByConnection, [connectionId]: 1 },
    })
    get().loadHistory(connectionId, 1, search)
  },

  setPage: (connectionId: string, page: number) => {
    set({
      pageByConnection: { ...get().pageByConnection, [connectionId]: page },
    })
    const search = get().searchByConnection[connectionId] ?? ''
    get().loadHistory(connectionId, page, search)
  },

  reset: () => {
    set(INITIAL_STATE)
  },

  notifyNewQuery: (connectionId: string) => {
    const state = get()
    // Only refresh if history has been loaded (panel is open) for this connection.
    // Use `in` to distinguish "never loaded" (key absent) from "loaded but empty" ([]).
    if (connectionId in state.entriesByConnection) {
      const search = state.searchByConnection[connectionId] ?? ''
      // Re-fetch the first page to show the new query at the top
      void get().loadHistory(connectionId, 1, search)
    }
  },
}))
