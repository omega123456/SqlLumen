import type { ProcessListState } from '../processlist-store'
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
