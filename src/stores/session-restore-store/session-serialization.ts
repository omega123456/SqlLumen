import { normalizeActiveConnectionOrder, useConnectionStore } from '../connection-store'
import { useWorkspaceStore } from '../workspace-store'
import { useQueryStore } from '../query-store'
import type {
  SessionState,
  SessionConnectionState,
  SessionTabState,
} from '../../lib/session-restore-commands'
import type { WorkspaceTab } from '../../types/schema'

export function buildSessionState(): SessionState {
  const connectionStore = useConnectionStore.getState()
  const workspaceStore = useWorkspaceStore.getState()
  const queryStore = useQueryStore.getState()

  const connections: SessionConnectionState[] = []

  const orderedConnectionIds = normalizeActiveConnectionOrder(
    connectionStore.activeConnectionOrder,
    connectionStore.activeConnections
  )
  const activeConnectionIndex =
    connectionStore.activeTabId != null
      ? orderedConnectionIds.indexOf(connectionStore.activeTabId)
      : -1

  for (const sessionId of orderedConnectionIds) {
    const active = connectionStore.activeConnections[sessionId]
    if (!active) {
      continue
    }
    const profileId = active.profile.id
    const tabs = workspaceStore.tabsByConnection[sessionId] ?? []
    const activeTabId = workspaceStore.activeTabByConnection[sessionId] ?? null

    const serializedTabs = tabs
      .map((tab) => serializeTab(tab, queryStore))
      .filter((serialized): serialized is SessionTabState => serialized !== null)
    const activeTabIndex = activeTabIndexOf(serializedTabs, activeTabId)

    connections.push({
      profileId: profileId,
      activeTabIndex: activeTabIndex,
      tabs: serializedTabs,
    })
  }

  return {
    version: 1,
    connections: connections,
    activeConnectionIndex: activeConnectionIndex >= 0 ? activeConnectionIndex : undefined,
  }
}

function serializeTab(
  tab: WorkspaceTab,
  queryStore: ReturnType<(typeof useQueryStore)['getState']>
): SessionTabState | null {
  switch (tab.type) {
    case 'query-editor':
      return serializeQueryEditorTab(tab, queryStore)
    case 'table-data':
      return {
        type: 'table-data',
        tabId: tab.id,
        databaseName: tab.databaseName,
        tableName: tab.objectName,
        parentQueryTabId: tab.parentQueryTabId,
        objectType: tab.objectType === 'view' ? 'view' : 'table',
      }
    case 'schema-info':
      return {
        type: 'schema-info',
        tabId: tab.id,
        databaseName: tab.databaseName,
        objectName: tab.objectName,
        objectType: tab.objectType,
      }
    case 'history':
      return {
        type: 'history',
        tabId: tab.id,
      }
    case 'table-designer':
    case 'object-editor':
    case 'processlist':
      return null
    default:
      return null
  }
}

export type SavedTableDataTab = Extract<SessionTabState, { type: 'table-data' }>

export type SavedSchemaInfoTab = Extract<SessionTabState, { type: 'schema-info' }>

export type SavedQueryEditorTab = Extract<SessionTabState, { type: 'query-editor' }>

type QueryStoreState = ReturnType<(typeof useQueryStore)['getState']>

function activeTabIndexOf(serializedTabs: SessionTabState[], activeTabId: string | null): number {
  if (!activeTabId) return 0
  const index = serializedTabs.findIndex((serialized) => serialized.tabId === activeTabId)
  return Math.max(index, 0)
}

function serializeQueryEditorTab(
  tab: WorkspaceTab,
  queryStore: QueryStoreState
): SavedQueryEditorTab {
  const tabState = queryStore.tabs[tab.id]
  const bottomPanelItem = tabState?.activeBottomPanelItem
  return {
    type: 'query-editor',
    tabId: tab.id,
    sql: tabState?.content ?? '',
    cursorLine: tabState?.cursorPosition?.lineNumber,
    cursorColumn: tabState?.cursorPosition?.column,
    label: tab.label,
    activeBottomPanelTableTabId:
      bottomPanelItem?.type === 'table-data' ? bottomPanelItem.tabId : undefined,
  }
}
