import type { ProcessListState } from '../processlist-store'
import type { ProcessRow } from '../../lib/processlist-commands'
import { withoutKey } from '../../lib/record-utils'

type ProcessListData = Omit<
  ProcessListState,
  | 'fetchProcessList'
  | 'killSelectedProcesses'
  | 'setSelectedIds'
  | 'toggleSelectedId'
  | 'setRefreshInterval'
  | 'setExcludeIdleConnections'
  | 'setConfirmDialogOpen'
  | 'setSummaryDialogOpen'
  | 'setSortColumn'
  | 'resetConnection'
>

export function resetProcessListConnection(
  state: ProcessListData,
  connectionId: string
): ProcessListData {
  const nextGeneration = (state.fetchGenerationByConnection[connectionId] ?? 0) + 1
  return {
    rowsByConnection: withoutKey(state.rowsByConnection, connectionId),
    lastRefreshedAtByConnection: withoutKey(state.lastRefreshedAtByConnection, connectionId),
    selectedIdsByConnection: withoutKey(state.selectedIdsByConnection, connectionId),
    refreshIntervalMsByConnection: withoutKey(state.refreshIntervalMsByConnection, connectionId),
    excludeIdleConnectionsByConnection: withoutKey(
      state.excludeIdleConnectionsByConnection,
      connectionId
    ),
    isConfirmDialogOpenByConnection: withoutKey(
      state.isConfirmDialogOpenByConnection,
      connectionId
    ),
    isSummaryDialogOpenByConnection: withoutKey(
      state.isSummaryDialogOpenByConnection,
      connectionId
    ),
    sortColumnByConnection: withoutKey(state.sortColumnByConnection, connectionId),
    lastErrorToastAtByConnection: withoutKey(state.lastErrorToastAtByConnection, connectionId),
    fetchErrorByConnection: withoutKey(state.fetchErrorByConnection, connectionId),
    isFetchingByConnection: withoutKey(state.isFetchingByConnection, connectionId),
    hasFetchedByConnection: withoutKey(state.hasFetchedByConnection, connectionId),
    fetchGenerationByConnection: {
      ...state.fetchGenerationByConnection,
      [connectionId]: nextGeneration,
    },
  }
}

export interface ProcessListFetchStart {
  connectionId: string
  generation: number
}

export function startProcessListFetch(
  state: ProcessListData,
  { connectionId, generation }: ProcessListFetchStart
): Partial<ProcessListData> {
  return {
    isFetchingByConnection: { ...state.isFetchingByConnection, [connectionId]: true },
    fetchGenerationByConnection: {
      ...state.fetchGenerationByConnection,
      [connectionId]: generation,
    },
  }
}

export interface FetchedProcessList {
  connectionId: string
  rows: ProcessRow[]
  selectedIds: Set<number>
  refreshedAt: number
}

export function applyFetchedProcessList(
  state: ProcessListData,
  { connectionId, rows, selectedIds, refreshedAt }: FetchedProcessList
): Partial<ProcessListData> {
  return {
    rowsByConnection: { ...state.rowsByConnection, [connectionId]: rows },
    selectedIdsByConnection: { ...state.selectedIdsByConnection, [connectionId]: selectedIds },
    lastRefreshedAtByConnection: {
      ...state.lastRefreshedAtByConnection,
      [connectionId]: refreshedAt,
    },
    isFetchingByConnection: { ...state.isFetchingByConnection, [connectionId]: false },
    fetchErrorByConnection: { ...state.fetchErrorByConnection, [connectionId]: null },
    hasFetchedByConnection: { ...state.hasFetchedByConnection, [connectionId]: true },
  }
}

export interface ProcessListFetchFailure {
  connectionId: string
  message: string
}

export function applyProcessListFetchFailure(
  state: ProcessListData,
  { connectionId, message }: ProcessListFetchFailure
): Partial<ProcessListData> {
  return {
    isFetchingByConnection: { ...state.isFetchingByConnection, [connectionId]: false },
    fetchErrorByConnection: { ...state.fetchErrorByConnection, [connectionId]: message },
    hasFetchedByConnection: { ...state.hasFetchedByConnection, [connectionId]: true },
  }
}
