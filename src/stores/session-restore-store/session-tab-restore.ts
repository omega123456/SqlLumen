import { useSettingsStore } from '../settings-store'
import { rewriteTabList } from '../workspace-store/workspace-reducers'
import { useWorkspaceStore } from '../workspace-store'
import { useQueryStore } from '../query-store'
import type { SessionConnectionState, SessionTabState } from '../../lib/session-restore-commands'
import { isScopedTableDataTab, isScopedTableDataTabOf } from '../../lib/workspace-tab-stacks'
import type { WorkspaceTab } from '../../types/schema'
import { isSchemaInfoTabOfObject, isTableDataTabOfObject } from '../../lib/workspace-tab-matching'
import type {
  SavedQueryEditorTab,
  SavedSchemaInfoTab,
  SavedTableDataTab,
} from './session-serialization'

interface TabRestoreContext {
  sessionId: string
  bottomPanelEnabled: boolean
  savedToRuntimeTabId: Map<string, string>
  queryBottomPanelSelections: Map<string, string>
}

function restoreQueryEditorTab(context: TabRestoreContext, tabState: SavedQueryEditorTab): void {
  const queryStore = useQueryStore.getState()
  const runtimeTabId = useWorkspaceStore.getState().openQueryTab(context.sessionId, tabState.label)
  context.savedToRuntimeTabId.set(tabState.tabId, runtimeTabId)
  if (tabState.sql) {
    queryStore.setContent(runtimeTabId, tabState.sql)
  }
  const { cursorLine, cursorColumn } = tabState
  const hasCursorPosition = cursorLine != null && cursorColumn != null
  if (hasCursorPosition) {
    queryStore.setCursorPosition(runtimeTabId, {
      lineNumber: cursorLine,
      column: cursorColumn,
    })
  }
  if (tabState.activeBottomPanelTableTabId) {
    context.queryBottomPanelSelections.set(runtimeTabId, tabState.activeBottomPanelTableTabId)
  }
}

function restoreTableDataTab(context: TabRestoreContext, tabState: SavedTableDataTab): string {
  const restoredTabId = useWorkspaceStore.getState().restoreTableDataTab({
    type: 'table-data',
    label: tabState.tableName,
    connectionId: context.sessionId,
    databaseName: tabState.databaseName,
    objectName: tabState.tableName,
    objectType: tabState.objectType ?? 'table',
    parentQueryTabId: tabState.parentQueryTabId,
  })
  context.savedToRuntimeTabId.set(tabState.tabId, restoredTabId)
  return restoredTabId
}

function sessionTabs(sessionId: string): WorkspaceTab[] {
  return useWorkspaceStore.getState().tabsByConnection[sessionId] ?? []
}

function rememberRestoredTab(
  context: TabRestoreContext,
  savedTabId: string,
  restoredTab: WorkspaceTab | undefined
): string | null {
  if (!restoredTab) return null
  context.savedToRuntimeTabId.set(savedTabId, restoredTab.id)
  return restoredTab.id
}

function restoreSchemaInfoTab(context: TabRestoreContext, tabState: SavedSchemaInfoTab) {
  useWorkspaceStore.getState().openTab({
    type: 'schema-info',
    label: tabState.objectName,
    connectionId: context.sessionId,
    databaseName: tabState.databaseName,
    objectName: tabState.objectName,
    objectType: tabState.objectType as
      'table' | 'view' | 'procedure' | 'function' | 'trigger' | 'event',
  })
  const created = sessionTabs(context.sessionId).find((tab) =>
    isSchemaInfoTabOfObject(tab, tabState)
  )
  return rememberRestoredTab(context, tabState.tabId, created)
}

function restoreHistoryTab(context: TabRestoreContext, tabState: SessionTabState): string | null {
  const workspaceStore = useWorkspaceStore.getState()
  workspaceStore.openHistoryTab(context.sessionId, false)
  const created = sessionTabs(context.sessionId).find((tab) => tab.type === 'history')
  const restoredTabId = rememberRestoredTab(context, tabState.tabId, created)
  workspaceStore.openProcessListTab(context.sessionId)
  return restoredTabId
}

function restoreSavedTab(context: TabRestoreContext, tabState: SessionTabState): string | null {
  if (tabState.type === 'query-editor') {
    return context.savedToRuntimeTabId.get(tabState.tabId) ?? null
  }
  if (tabState.type === 'table-data') return restoreTableDataTab(context, tabState)
  if (tabState.type === 'schema-info') return restoreSchemaInfoTab(context, tabState)
  if (tabState.type === 'history') return restoreHistoryTab(context, tabState)
  return null
}

function isSavedTableTabRestoredAs(
  savedTab: SessionTabState,
  context: TabRestoreContext,
  runtimeTabId: string
): savedTab is SavedTableDataTab {
  if (savedTab.type !== 'table-data') return false
  return context.savedToRuntimeTabId.get(savedTab.tabId) === runtimeTabId
}

function savedTableTabFor(
  savedTabs: SessionTabState[],
  context: TabRestoreContext,
  runtimeTabId: string
): SavedTableDataTab | undefined {
  return savedTabs.find((savedTab): savedTab is SavedTableDataTab =>
    isSavedTableTabRestoredAs(savedTab, context, runtimeTabId)
  )
}

function restoredParentQueryTabId(
  context: TabRestoreContext,
  savedTableTab: SavedTableDataTab | undefined
): string | undefined {
  const savedParentId = savedTableTab?.parentQueryTabId
  if (!context.bottomPanelEnabled) return undefined
  if (!savedParentId) return undefined
  return context.savedToRuntimeTabId.get(savedParentId)
}

function orderRestoredTabs(
  runtimeTabs: WorkspaceTab[],
  savedTabs: SessionTabState[],
  context: TabRestoreContext
): WorkspaceTab[] {
  const orderedRuntimeTabIds = savedTabs
    .map((savedTab) => context.savedToRuntimeTabId.get(savedTab.tabId) ?? null)
    .filter((tabId): tabId is string => tabId != null)
  const savedOrderTabs = orderedRuntimeTabIds
    .map((tabId) => runtimeTabs.find((tab) => tab.id === tabId) ?? null)
    .filter((tab): tab is WorkspaceTab => tab != null)
  const unsavedTabs = runtimeTabs.filter((tab) => !orderedRuntimeTabIds.includes(tab.id))
  return [...savedOrderTabs, ...unsavedTabs].map((tab) => {
    if (tab.type !== 'table-data') return tab
    const savedTableTab = savedTableTabFor(savedTabs, context, tab.id)
    return { ...tab, parentQueryTabId: restoredParentQueryTabId(context, savedTableTab) }
  })
}

function applyBottomPanelSelections(context: TabRestoreContext): void {
  for (const [runtimeQueryTabId, savedTableTabId] of context.queryBottomPanelSelections) {
    const runtimeTableTabId = context.savedToRuntimeTabId.get(savedTableTabId)
    if (!runtimeTableTabId) continue
    const runtimeTableTab = sessionTabs(context.sessionId).find(
      (tab) => tab.id === runtimeTableTabId
    )
    if (!isScopedTableDataTabOf(runtimeTableTab, runtimeQueryTabId)) continue
    useQueryStore.getState().setActiveBottomPanelItem(runtimeQueryTabId, {
      type: 'table-data',
      tabId: runtimeTableTabId,
    })
  }
}

function activateFlattenedTableTab(
  context: TabRestoreContext,
  savedActiveTab: SessionTabState | null
): void {
  if (context.bottomPanelEnabled) return
  if (savedActiveTab?.type !== 'table-data') return
  const savedTableIdentity = {
    databaseName: savedActiveTab.databaseName,
    objectName: savedActiveTab.tableName,
  }
  const flattenedActiveTable = sessionTabs(context.sessionId).find((tab) =>
    isTableDataTabOfObject(tab, savedTableIdentity)
  )
  if (flattenedActiveTable) {
    useWorkspaceStore.getState().setActiveTab(context.sessionId, flattenedActiveTable.id)
  }
}

function activateRestoredTab(
  context: TabRestoreContext,
  activeTabId: string,
  savedActiveTab: SessionTabState | null
): void {
  const activeTab = sessionTabs(context.sessionId).find((tab) => tab.id === activeTabId)
  if (!activeTab) {
    activateFlattenedTableTab(context, savedActiveTab)
    return
  }
  if (!isScopedTableDataTab(activeTab)) {
    useWorkspaceStore.getState().setActiveTab(context.sessionId, activeTabId)
    return
  }
  useWorkspaceStore.getState().setActiveTab(context.sessionId, activeTab.parentQueryTabId)
  useQueryStore.getState().setActiveBottomPanelItem(activeTab.parentQueryTabId, {
    type: 'table-data',
    tabId: activeTab.id,
  })
}

function savedActiveTabOf(connectionState: SessionConnectionState): SessionTabState | null {
  if (connectionState.activeTabIndex < 0) return null
  return connectionState.tabs[connectionState.activeTabIndex] ?? null
}

export async function restoreConnectionTabs(
  sessionId: string,
  connectionState: SessionConnectionState
): Promise<void> {
  const context: TabRestoreContext = {
    sessionId: sessionId,
    bottomPanelEnabled:
      useSettingsStore.getState().getSetting('results.tableTabsInBottomPanel') === 'true',
    savedToRuntimeTabId: new Map<string, string>(),
    queryBottomPanelSelections: new Map<string, string>(),
  }
  const savedActiveTab = savedActiveTabOf(connectionState)

  for (const tabState of connectionState.tabs) {
    if (tabState.type === 'query-editor') {
      restoreQueryEditorTab(context, tabState)
    }
  }

  let activeTabId: string | null = null
  for (const [tabIndex, tabState] of connectionState.tabs.entries()) {
    const restoredTabId = restoreSavedTab(context, tabState)
    const isSavedActiveTab = tabIndex === connectionState.activeTabIndex
    if (isSavedActiveTab && restoredTabId) {
      activeTabId = restoredTabId
    }
  }

  const restoreSavedOrder = (runtimeTabs: WorkspaceTab[]): WorkspaceTab[] =>
    orderRestoredTabs(runtimeTabs, connectionState.tabs, context)
  useWorkspaceStore.setState((state) =>
    rewriteTabList(state, { connectionId: sessionId, transform: restoreSavedOrder })
  )

  applyBottomPanelSelections(context)

  if (!context.bottomPanelEnabled) {
    useWorkspaceStore.getState().normalizeTableDataTabScopes()
  }

  if (activeTabId) {
    activateRestoredTab(context, activeTabId, savedActiveTab)
  }
}
