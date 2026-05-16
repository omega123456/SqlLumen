import { create } from 'zustand'
import type { ProcessRow, KillResult } from '../lib/processlist-commands'
import { getProcesslist, killQueries } from '../lib/processlist-commands'
import { filterProcessListRows } from '../lib/processlist-filter'
import { getProcessListRefreshTimestamp } from '../lib/processlist-time'
import { showErrorToast } from './toast-store'

import { logFrontend } from '../lib/app-log-commands'
const DEFAULT_REFRESH_INTERVAL_MS = 1000
const DEFAULT_EXCLUDE_IDLE_CONNECTIONS = true
const ERROR_TOAST_COOLDOWN_MS = 30_000

function reconcileExistingSelectedIds(rows: ProcessRow[], selectedIds: Set<number>): Set<number> {
  const existingRowIds = new Set(rows.map((row) => row.id))
  return new Set([...selectedIds].filter((id) => existingRowIds.has(id)))
}

interface ProcessListState {
  rowsByConnection: Record<string, ProcessRow[]>
  lastRefreshedAtByConnection: Record<string, number | null>
  selectedIdsByConnection: Record<string, Set<number>>
  refreshIntervalMsByConnection: Record<string, number>
  excludeIdleConnectionsByConnection: Record<string, boolean>
  isConfirmDialogOpenByConnection: Record<string, boolean>
  isSummaryDialogOpenByConnection: Record<string, boolean>
  sortColumnByConnection: Record<string, { columnKey: string; direction: 'ASC' | 'DESC' } | null>
  lastErrorToastAtByConnection: Record<string, number | null>
  fetchErrorByConnection: Record<string, string | null>
  isFetchingByConnection: Record<string, boolean>
  fetchGenerationByConnection: Record<string, number>
  hasFetchedByConnection: Record<string, boolean>

  // Actions
  fetchProcessList: (connectionId: string, sessionId: string, isManual: boolean) => Promise<void>
  killSelectedProcesses: (connectionId: string, sessionId: string) => Promise<KillResult[]>
  setSelectedIds: (connectionId: string, ids: Set<number>) => void
  toggleSelectedId: (connectionId: string, id: number) => void
  setRefreshInterval: (connectionId: string, ms: number) => void
  setExcludeIdleConnections: (connectionId: string, excludeIdleConnections: boolean) => void
  setConfirmDialogOpen: (connectionId: string, open: boolean) => void
  setSummaryDialogOpen: (connectionId: string, open: boolean) => void
  setSortColumn: (
    connectionId: string,
    sort: { columnKey: string; direction: 'ASC' | 'DESC' } | null
  ) => void
  resetConnection: (connectionId: string) => void
}

export const useProcessListStore = create<ProcessListState>()((set, get) => ({
  rowsByConnection: {},
  lastRefreshedAtByConnection: {},
  selectedIdsByConnection: {},
  refreshIntervalMsByConnection: {},
  excludeIdleConnectionsByConnection: {},
  isConfirmDialogOpenByConnection: {},
  isSummaryDialogOpenByConnection: {},
  sortColumnByConnection: {},
  lastErrorToastAtByConnection: {},
  fetchErrorByConnection: {},
  isFetchingByConnection: {},
  fetchGenerationByConnection: {},
  hasFetchedByConnection: {},

  fetchProcessList: async (connectionId: string, sessionId: string, isManual: boolean) => {
    const state = get()
    if (state.isFetchingByConnection[connectionId]) return

    const generation = (state.fetchGenerationByConnection[connectionId] ?? 0) + 1
    set({
      isFetchingByConnection: {
        ...get().isFetchingByConnection,
        [connectionId]: true,
      },
      fetchGenerationByConnection: {
        ...get().fetchGenerationByConnection,
        [connectionId]: generation,
      },
    })

    try {
      const rows = await getProcesslist(sessionId)

      // Stale guard: if generation changed (e.g. resetConnection was called), discard results
      if (get().fetchGenerationByConnection[connectionId] !== generation) return

      const currentSelected = get().selectedIdsByConnection[connectionId] ?? new Set<number>()
      const excludeIdle =
        get().excludeIdleConnectionsByConnection[connectionId] ?? DEFAULT_EXCLUDE_IDLE_CONNECTIONS
      const visibleRows = filterProcessListRows(rows, excludeIdle)
      const reconciledSelected = reconcileExistingSelectedIds(visibleRows, currentSelected)

      set({
        rowsByConnection: { ...get().rowsByConnection, [connectionId]: rows },
        selectedIdsByConnection: {
          ...get().selectedIdsByConnection,
          [connectionId]: reconciledSelected,
        },
        lastRefreshedAtByConnection: {
          ...get().lastRefreshedAtByConnection,
          [connectionId]: getProcessListRefreshTimestamp(),
        },
        isFetchingByConnection: {
          ...get().isFetchingByConnection,
          [connectionId]: false,
        },
        fetchErrorByConnection: { ...get().fetchErrorByConnection, [connectionId]: null },
        hasFetchedByConnection: { ...get().hasFetchedByConnection, [connectionId]: true },
      })
    } catch (err) {
      // Stale guard on error path too
      if (get().fetchGenerationByConnection[connectionId] !== generation) return

      const msg = err instanceof Error ? err.message : String(err)

      set({
        isFetchingByConnection: {
          ...get().isFetchingByConnection,
          [connectionId]: false,
        },
        fetchErrorByConnection: { ...get().fetchErrorByConnection, [connectionId]: msg },
        hasFetchedByConnection: { ...get().hasFetchedByConnection, [connectionId]: true },
      })

      if (isManual) {
        showErrorToast('Failed to fetch process list', msg)
      } else {
        logFrontend('warn', `[processlist] Auto-refresh failed for ${connectionId}: ${msg}`)
        const lastToastAt = get().lastErrorToastAtByConnection[connectionId] ?? null
        const now = Date.now()
        if (lastToastAt === null || now - lastToastAt > ERROR_TOAST_COOLDOWN_MS) {
          showErrorToast('Process list refresh failed', msg)
          set({
            lastErrorToastAtByConnection: {
              ...get().lastErrorToastAtByConnection,
              [connectionId]: now,
            },
          })
        }
      }
    }
  },

  killSelectedProcesses: async (connectionId: string, sessionId: string): Promise<KillResult[]> => {
    const selected = get().selectedIdsByConnection[connectionId] ?? new Set<number>()
    if (selected.size === 0) return []
    const ids = [...selected]
    return killQueries(sessionId, ids)
  },

  setSelectedIds: (connectionId: string, ids: Set<number>) => {
    set({
      selectedIdsByConnection: {
        ...get().selectedIdsByConnection,
        [connectionId]: ids,
      },
    })
  },

  toggleSelectedId: (connectionId: string, id: number) => {
    const current = get().selectedIdsByConnection[connectionId] ?? new Set<number>()
    const next = new Set(current)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    set({
      selectedIdsByConnection: {
        ...get().selectedIdsByConnection,
        [connectionId]: next,
      },
    })
  },

  setRefreshInterval: (connectionId: string, ms: number) => {
    set({
      refreshIntervalMsByConnection: {
        ...get().refreshIntervalMsByConnection,
        [connectionId]: ms,
      },
    })
  },

  setExcludeIdleConnections: (connectionId: string, excludeIdleConnections: boolean) => {
    const rows = get().rowsByConnection[connectionId] ?? []
    const visibleRows = filterProcessListRows(rows, excludeIdleConnections)
    const currentSelected = get().selectedIdsByConnection[connectionId] ?? new Set<number>()
    const reconciledSelected = reconcileExistingSelectedIds(visibleRows, currentSelected)

    set({
      excludeIdleConnectionsByConnection: {
        ...get().excludeIdleConnectionsByConnection,
        [connectionId]: excludeIdleConnections,
      },
      selectedIdsByConnection: {
        ...get().selectedIdsByConnection,
        [connectionId]: reconciledSelected,
      },
    })
  },

  setConfirmDialogOpen: (connectionId: string, open: boolean) => {
    set({
      isConfirmDialogOpenByConnection: {
        ...get().isConfirmDialogOpenByConnection,
        [connectionId]: open,
      },
    })
  },

  setSummaryDialogOpen: (connectionId: string, open: boolean) => {
    set({
      isSummaryDialogOpenByConnection: {
        ...get().isSummaryDialogOpenByConnection,
        [connectionId]: open,
      },
    })
  },

  setSortColumn: (
    connectionId: string,
    sort: { columnKey: string; direction: 'ASC' | 'DESC' } | null
  ) => {
    set({
      sortColumnByConnection: {
        ...get().sortColumnByConnection,
        [connectionId]: sort,
      },
    })
  },

  resetConnection: (connectionId: string) => {
    set((state) => {
      const deleteKey = <T>(rec: Record<string, T>): Record<string, T> => {
        const copy = { ...rec }
        delete copy[connectionId]
        return copy
      }
      // Increment generation to invalidate any in-flight fetches
      const nextGeneration = (state.fetchGenerationByConnection[connectionId] ?? 0) + 1
      return {
        ...state,
        rowsByConnection: deleteKey(state.rowsByConnection),
        lastRefreshedAtByConnection: deleteKey(state.lastRefreshedAtByConnection),
        selectedIdsByConnection: deleteKey(state.selectedIdsByConnection),
        refreshIntervalMsByConnection: deleteKey(state.refreshIntervalMsByConnection),
        excludeIdleConnectionsByConnection: deleteKey(state.excludeIdleConnectionsByConnection),
        isConfirmDialogOpenByConnection: deleteKey(state.isConfirmDialogOpenByConnection),
        isSummaryDialogOpenByConnection: deleteKey(state.isSummaryDialogOpenByConnection),
        sortColumnByConnection: deleteKey(state.sortColumnByConnection),
        lastErrorToastAtByConnection: deleteKey(state.lastErrorToastAtByConnection),
        fetchErrorByConnection: deleteKey(state.fetchErrorByConnection),
        isFetchingByConnection: deleteKey(state.isFetchingByConnection),
        hasFetchedByConnection: deleteKey(state.hasFetchedByConnection),
        fetchGenerationByConnection: {
          ...state.fetchGenerationByConnection,
          [connectionId]: nextGeneration,
        },
      }
    })
  },
}))

/** Default refresh interval in milliseconds. */
export { DEFAULT_EXCLUDE_IDLE_CONNECTIONS, DEFAULT_REFRESH_INTERVAL_MS }
