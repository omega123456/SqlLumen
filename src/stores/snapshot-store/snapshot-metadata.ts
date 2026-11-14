import { type SnapshotConnectionSummary } from '../../lib/session-snapshot-commands'
import type { SessionConnectionState, SessionState } from '../../lib/session-restore-commands'
import { normalizeActiveConnectionOrder, useConnectionStore } from '../connection-store'
import { useWorkspaceStore } from '../workspace-store'

const SERIALIZABLE_TAB_TYPES: ReadonlySet<string> = new Set([
  'query-editor',
  'table-data',
  'schema-info',
  'history',
])

interface SnapshotMetadata {
  connectionCount: number
  tabCount: number
  summary: SnapshotConnectionSummary[]
}

export function computeSnapshotMetadata(): SnapshotMetadata {
  const connectionStore = useConnectionStore.getState()
  const workspaceStore = useWorkspaceStore.getState()

  const orderedConnectionIds = normalizeActiveConnectionOrder(
    connectionStore.activeConnectionOrder,
    connectionStore.activeConnections
  )

  const summary: SnapshotConnectionSummary[] = []
  let tabCount = 0

  for (const sessionId of orderedConnectionIds) {
    const active = connectionStore.activeConnections[sessionId]
    if (!active) {
      continue
    }
    const tabs = workspaceStore.tabsByConnection[sessionId] ?? []
    const connectionTabCount = tabs.filter((tab) => SERIALIZABLE_TAB_TYPES.has(tab.type)).length
    tabCount += connectionTabCount
    summary.push({ name: active.profile.name, tabCount: connectionTabCount })
  }

  return {
    connectionCount: summary.length,
    tabCount: tabCount,
    summary: summary,
  }
}

export function buildRecoveryState(
  beforeRestoreState: SessionState,
  targetedConnectionIds: string[],
  closedConnectionIds: string[]
): SessionState | null {
  if (closedConnectionIds.length === 0) {
    return null
  }

  const closedIdSet = new Set(closedConnectionIds)
  const recoveryConnections: SessionConnectionState[] = []
  const savedIndexToRecoveryIndex = new Map<number, number>()

  targetedConnectionIds.forEach((sessionId, savedIndex) => {
    if (!closedIdSet.has(sessionId)) {
      return
    }

    const connectionState = beforeRestoreState.connections[savedIndex]
    if (!connectionState) {
      return
    }

    savedIndexToRecoveryIndex.set(savedIndex, recoveryConnections.length)
    recoveryConnections.push(connectionState)
  })

  if (recoveryConnections.length === 0) {
    return null
  }

  const recoveryState: SessionState = {
    version: beforeRestoreState.version,
    connections: recoveryConnections,
  }

  if (typeof beforeRestoreState.activeConnectionIndex === 'number') {
    const recoveryActiveIndex = savedIndexToRecoveryIndex.get(
      beforeRestoreState.activeConnectionIndex
    )
    if (typeof recoveryActiveIndex === 'number') {
      recoveryState.activeConnectionIndex = recoveryActiveIndex
    }
  }

  return recoveryState
}
