import { closeConnection as closeConnectionIPC } from '../../lib/connection-commands'
import type { ActiveConnection } from '../../types/connection'
import { useSchemaStore } from '../schema-store'
import { useWorkspaceStore } from '../workspace-store'
import { useSchemaIndexStore } from '../schema-index-store'
import { useProcessListStore } from '../processlist-store'
import { showErrorToast } from '../toast-store'
import { invalidateCache } from '../../components/query-editor/schema-metadata-cache'
import { invalidateRoutineCache } from '../../components/query-editor/routine-parameter-cache'
import { toErrorMessage } from '../../lib/error-message'
import { normalizeActiveConnectionOrder } from '../connection-store/active-connections'
import { useConnectionStore } from '../connection-store'
import { settleUnsavedEditsBeforeClose } from './unsaved-edits-before-close'

interface ConnectionSelection {
  activeConnections: Record<string, ActiveConnection>
  activeConnectionOrder: string[]
  activeTabId: string | null
}

function resolveFallbackTabId(remainingIds: string[], closedIndex: number): string | null {
  if (remainingIds.length === 0) return null
  if (closedIndex < 0) return remainingIds[0]
  return remainingIds[Math.min(closedIndex, remainingIds.length - 1)]
}

function resolveSelectionAfterClose(
  state: ConnectionSelection,
  closedId: string
): ConnectionSelection {
  const orderedIdsBeforeClose = normalizeActiveConnectionOrder(
    state.activeConnectionOrder,
    state.activeConnections
  )
  const closedIndex = orderedIdsBeforeClose.indexOf(closedId)
  const remaining = { ...state.activeConnections }
  delete remaining[closedId]
  const remainingIds = normalizeActiveConnectionOrder(
    state.activeConnectionOrder.filter((sessionId) => sessionId !== closedId),
    remaining
  )
  const isClosingActiveTab = state.activeTabId === closedId
  return {
    activeConnections: remaining,
    activeConnectionOrder: remainingIds,
    activeTabId: isClosingActiveTab
      ? resolveFallbackTabId(remainingIds, closedIndex)
      : state.activeTabId,
  }
}

function clearClosedConnectionState(connectionId: string): void {
  useSchemaStore.getState().clearConnectionState(connectionId)
  useWorkspaceStore.getState().clearConnectionTabs(connectionId)
  useSchemaIndexStore.getState().unregisterSession(connectionId)
  useProcessListStore.getState().resetConnection(connectionId)
  invalidateCache(connectionId)
  invalidateRoutineCache(connectionId)
}

async function isReadyToCloseConnection(
  id: string,
  options?: { force?: boolean }
): Promise<boolean> {
  if (options?.force) return true
  return settleUnsavedEditsBeforeClose(id)
}

export async function closeConnection(id: string, options?: { force?: boolean }): Promise<boolean> {
  try {
    const isReadyToClose = await isReadyToCloseConnection(id, options)
    if (!isReadyToClose) return false

    await closeConnectionIPC(id)

    const selection = resolveSelectionAfterClose(useConnectionStore.getState(), id)

    if (useWorkspaceStore.getState().visibleConnectionSessionId === id) {
      useWorkspaceStore.getState().setVisibleConnectionSession(selection.activeTabId ?? '')
    }

    clearClosedConnectionState(id)

    useConnectionStore.setState({
      activeConnections: selection.activeConnections,
      activeConnectionOrder: selection.activeConnectionOrder,
      activeTabId: selection.activeTabId,
      error: null,
    })
    return true
  } catch (error) {
    const message = toErrorMessage(error)
    useConnectionStore.setState({ error: message })
    showErrorToast('Failed to close connection', message)
    return false
  }
}

export async function closeAllConnections(options?: { force?: boolean }): Promise<boolean> {
  const sessionIds = normalizeActiveConnectionOrder(
    useConnectionStore.getState().activeConnectionOrder,
    useConnectionStore.getState().activeConnections
  )
  let allClosed = true
  for (const sessionId of sessionIds) {
    const closed = await useConnectionStore.getState().closeConnection(sessionId, options)
    if (!closed) {
      allClosed = false
    }
  }
  return allClosed
}
