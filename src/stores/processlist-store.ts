import { create } from 'zustand'
import type { ProcessRow, KillResult } from '../lib/processlist-commands'
import { getProcesslist, killQueries } from '../lib/processlist-commands'
import { filterProcessListRows } from '../lib/processlist-filter'
import { getProcessListRefreshTimestamp } from '../lib/processlist-time'
import { showErrorToast } from './toast-store'
import { useHistoryStore } from './history-store'

import { logFrontend } from '../lib/app-log-commands'
import { toErrorMessage } from '../lib/error-message'
import { resetProcessListConnection } from './processlist-store/processlist-reducers'
const DEFAULT_REFRESH_INTERVAL_MS = 2000
const DEFAULT_EXCLUDE_IDLE_CONNECTIONS = true
const ERROR_TOAST_COOLDOWN_MS = 30_000

function reconcileExistingSelectedIds(rows: ProcessRow[], selectedIds: Set<number>): Set<number> {
  const existingRowIds = new Set(rows.map((row) => row.id))
  return new Set([...selectedIds].filter((id) => existingRowIds.has(id)))
}

export interface ProcessListState {
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

function isToastCooldownOver(lastToastAt: number | null, now: number): boolean {
  return lastToastAt === null || now - lastToastAt > ERROR_TOAST_COOLDOWN_MS
}

function reportAutoRefreshFailure(connectionId: string, message: string): void {
  logFrontend('warn', `[processlist] Auto-refresh failed for ${connectionId}: ${message}`)
  const state = useProcessListStore.getState()
  const lastToastAt = state.lastErrorToastAtByConnection[connectionId] ?? null
  const now = Date.now()
  if (!isToastCooldownOver(lastToastAt, now)) return
  showErrorToast('Process list refresh failed', message)
  useProcessListStore.setState({
    lastErrorToastAtByConnection: { ...state.lastErrorToastAtByConnection, [connectionId]: now },
  })
}

function withMembershipToggled(ids: Set<number>, id: number): Set<number> {
  const next = new Set(ids)
  if (next.has(id)) {
    next.delete(id)
    return next
  }
  next.add(id)
  return next
}

function isCurrentFetchGeneration(connectionId: string, generation: number): boolean {
  return useProcessListStore.getState().fetchGenerationByConnection[connectionId] === generation
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

      if (!isCurrentFetchGeneration(connectionId, generation)) return

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
    } catch (error) {
      if (!isCurrentFetchGeneration(connectionId, generation)) return

      const message = toErrorMessage(error)

      set({
        isFetchingByConnection: {
          ...get().isFetchingByConnection,
          [connectionId]: false,
        },
        fetchErrorByConnection: { ...get().fetchErrorByConnection, [connectionId]: message },
        hasFetchedByConnection: { ...get().hasFetchedByConnection, [connectionId]: true },
      })

      if (isManual) {
        showErrorToast('Failed to fetch process list', message)
        return
      }
      reportAutoRefreshFailure(connectionId, message)
    }
  },

  killSelectedProcesses: async (connectionId: string, sessionId: string): Promise<KillResult[]> => {
    const selected = get().selectedIdsByConnection[connectionId] ?? new Set<number>()
    if (selected.size === 0) return []
    const ids = [...selected]
    const results = await killQueries(sessionId, ids)
    useHistoryStore.getState().notifyNewQuery(connectionId)
    return results
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
    const next = withMembershipToggled(current, id)
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
    set((state) => resetProcessListConnection(state, connectionId))
  },
}))

/** Default refresh interval in milliseconds. */
export { DEFAULT_EXCLUDE_IDLE_CONNECTIONS, DEFAULT_REFRESH_INTERVAL_MS }
