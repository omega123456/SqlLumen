import { create } from 'zustand'
import type { ProcessRow, KillResult } from '../lib/processlist-commands'
import { getProcesslist, killQueries } from '../lib/processlist-commands'
import { filterProcessListRows } from '../lib/processlist-filter'
import { getProcessListRefreshTimestamp } from '../lib/processlist-time'
import { showErrorToast } from './toast-store'
import { useHistoryStore } from './history-store'

import { logFrontend } from '../lib/app-log-commands'
import { toErrorMessage } from '../lib/error-message'
import {
  applyFetchedProcessList,
  applyProcessListFetchFailure,
  resetProcessListConnection,
  startProcessListFetch,
} from './processlist-store/processlist-reducers'

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

function reconciledSelectionFor(connectionId: string, rows: ProcessRow[]): Set<number> {
  const state = useProcessListStore.getState()
  const currentSelected = state.selectedIdsByConnection[connectionId] ?? new Set<number>()
  const excludeIdle =
    state.excludeIdleConnectionsByConnection[connectionId] ?? DEFAULT_EXCLUDE_IDLE_CONNECTIONS
  const visibleRows = filterProcessListRows(rows, excludeIdle)
  return reconcileExistingSelectedIds(visibleRows, currentSelected)
}

async function fetchProcessList(
  connectionId: string,
  sessionId: string,
  isManual: boolean
): Promise<void> {
  const state = useProcessListStore.getState()
  if (state.isFetchingByConnection[connectionId]) return

  const generation = (state.fetchGenerationByConnection[connectionId] ?? 0) + 1
  useProcessListStore.setState((current) =>
    startProcessListFetch(current, { connectionId: connectionId, generation: generation })
  )

  try {
    const rows = await getProcesslist(sessionId)
    if (!isCurrentFetchGeneration(connectionId, generation)) return
    const fetched = {
      connectionId: connectionId,
      rows: rows,
      selectedIds: reconciledSelectionFor(connectionId, rows),
      refreshedAt: getProcessListRefreshTimestamp(),
    }
    useProcessListStore.setState((current) => applyFetchedProcessList(current, fetched))
  } catch (error) {
    if (!isCurrentFetchGeneration(connectionId, generation)) return
    const message = toErrorMessage(error)
    useProcessListStore.setState((current) =>
      applyProcessListFetchFailure(current, { connectionId: connectionId, message: message })
    )
    if (isManual) {
      showErrorToast('Failed to fetch process list', message)
      return
    }
    reportAutoRefreshFailure(connectionId, message)
  }
}

async function killSelectedProcesses(
  connectionId: string,
  sessionId: string
): Promise<KillResult[]> {
  const selected =
    useProcessListStore.getState().selectedIdsByConnection[connectionId] ?? new Set<number>()
  if (selected.size === 0) return []
  const ids = [...selected]
  const results = await killQueries(sessionId, ids)
  useHistoryStore.getState().notifyNewQuery(connectionId)
  return results
}

function setSelectedIds(connectionId: string, ids: Set<number>): void {
  useProcessListStore.setState({
    selectedIdsByConnection: {
      ...useProcessListStore.getState().selectedIdsByConnection,
      [connectionId]: ids,
    },
  })
}

function toggleSelectedId(connectionId: string, id: number): void {
  const current =
    useProcessListStore.getState().selectedIdsByConnection[connectionId] ?? new Set<number>()
  const next = withMembershipToggled(current, id)
  useProcessListStore.setState({
    selectedIdsByConnection: {
      ...useProcessListStore.getState().selectedIdsByConnection,
      [connectionId]: next,
    },
  })
}

function setRefreshInterval(connectionId: string, ms: number): void {
  useProcessListStore.setState({
    refreshIntervalMsByConnection: {
      ...useProcessListStore.getState().refreshIntervalMsByConnection,
      [connectionId]: ms,
    },
  })
}

function setExcludeIdleConnections(connectionId: string, excludeIdleConnections: boolean): void {
  const rows = useProcessListStore.getState().rowsByConnection[connectionId] ?? []
  const visibleRows = filterProcessListRows(rows, excludeIdleConnections)
  const currentSelected =
    useProcessListStore.getState().selectedIdsByConnection[connectionId] ?? new Set<number>()
  const reconciledSelected = reconcileExistingSelectedIds(visibleRows, currentSelected)

  useProcessListStore.setState({
    excludeIdleConnectionsByConnection: {
      ...useProcessListStore.getState().excludeIdleConnectionsByConnection,
      [connectionId]: excludeIdleConnections,
    },
    selectedIdsByConnection: {
      ...useProcessListStore.getState().selectedIdsByConnection,
      [connectionId]: reconciledSelected,
    },
  })
}

function setConfirmDialogOpen(connectionId: string, open: boolean): void {
  useProcessListStore.setState({
    isConfirmDialogOpenByConnection: {
      ...useProcessListStore.getState().isConfirmDialogOpenByConnection,
      [connectionId]: open,
    },
  })
}

function setSummaryDialogOpen(connectionId: string, open: boolean): void {
  useProcessListStore.setState({
    isSummaryDialogOpenByConnection: {
      ...useProcessListStore.getState().isSummaryDialogOpenByConnection,
      [connectionId]: open,
    },
  })
}

function setSortColumn(
  connectionId: string,
  sort: { columnKey: string; direction: 'ASC' | 'DESC' } | null
): void {
  useProcessListStore.setState({
    sortColumnByConnection: {
      ...useProcessListStore.getState().sortColumnByConnection,
      [connectionId]: sort,
    },
  })
}

function resetConnection(connectionId: string): void {
  useProcessListStore.setState((state) => resetProcessListConnection(state, connectionId))
}

export const useProcessListStore = create<ProcessListState>()(() => ({
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
  fetchProcessList: fetchProcessList,
  killSelectedProcesses: killSelectedProcesses,
  setSelectedIds: setSelectedIds,
  toggleSelectedId: toggleSelectedId,
  setRefreshInterval: setRefreshInterval,
  setExcludeIdleConnections: setExcludeIdleConnections,
  setConfirmDialogOpen: setConfirmDialogOpen,
  setSummaryDialogOpen: setSummaryDialogOpen,
  setSortColumn: setSortColumn,
  resetConnection: resetConnection,
}))

/** Default refresh interval in milliseconds. */
export { DEFAULT_EXCLUDE_IDLE_CONNECTIONS, DEFAULT_REFRESH_INTERVAL_MS }
