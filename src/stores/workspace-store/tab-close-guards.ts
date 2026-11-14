import type { WorkspaceTab, TableDataTab } from '../../types/schema'
import { useQueryStore } from '../query-store'
import { useTableDataStore } from '../table-data-store'
import { useTableDesignerStore } from '../table-designer-store'
import { useObjectEditorStore } from '../object-editor-store'
import { useAiStore } from '../ai-store'
import { useSettingsStore } from '../settings-store'
import { getWorkspaceStackKeyForTab, isTabInStack } from '../../lib/workspace-tab-stacks'
import { activeTabIdAfterRemoval, normalizeWorkspaceActiveTab } from './workspace-tab-lists'
import { connectionTabs, markTabPendingClose, removeClosedTab } from './workspace-reducers'
import { getScopedTableDataChildren } from './table-tab-activation'
import {
  NO_VISIBLE_SURFACE,
  finalizeWorkspaceActivation,
  getVisibleWorkspaceSurface,
} from './workspace-surfaces'
import { useWorkspaceStore } from '../workspace-store'

const UNSAVED_CHANGE_CHECKS: Partial<Record<WorkspaceTab['type'], (tabId: string) => boolean>> = {
  'table-data': (tabId) =>
    (useTableDataStore.getState().tabs[tabId]?.editState?.modifiedColumns.size ?? 0) > 0,
  'table-designer': (tabId) => useTableDesignerStore.getState().tabs[tabId]?.isDirty ?? false,
  'object-editor': (tabId) => useObjectEditorStore.getState().isDirty(tabId),
}

function hasUnsavedChanges(tab: WorkspaceTab): boolean {
  const hasUnsavedChangesInTab = UNSAVED_CHANGE_CHECKS[tab.type]
  if (!hasUnsavedChangesInTab) return false
  return hasUnsavedChangesInTab(tab.id)
}

export function enforceTabLimit(connectionId: string, newTabId: string): void {
  const limit = Number(useSettingsStore.getState().getSetting('results.maxTabsPerGroup'))
  if (!limit) return

  const { tabsByConnection, tabLastUsedAt, forceCloseTab } = useWorkspaceStore.getState()
  const tabs = tabsByConnection[connectionId] ?? []
  const options = { hideScopedTableDataTabs: true }
  const newTab = tabs.find((tab) => tab.id === newTabId)
  const stackKey = newTab ? getWorkspaceStackKeyForTab(newTab, options) : null
  if (!stackKey) return
  if (stackKey === 'queries') return

  const group = tabs.filter((tab) => isTabInStack(tab, stackKey, options))
  const overflow = group.length - limit
  if (overflow <= 0) return

  const canEvict = (tab: WorkspaceTab): boolean => tab.id !== newTabId && !hasUnsavedChanges(tab)
  group
    .filter(canEvict)
    .sort((left, right) => (tabLastUsedAt[left.id] ?? 0) - (tabLastUsedAt[right.id] ?? 0))
    .slice(0, overflow)
    .forEach((tab) => forceCloseTab(connectionId, tab.id))
}

type CloseOutcome = 'proceed' | 'handled'

type ClosePreparer = (
  connectionId: string,
  closingTab: WorkspaceTab,
  tabs: WorkspaceTab[]
) => CloseOutcome

type TabStoreCleanup = (connectionId: string, tabId: string) => void

interface GuardedTabStore {
  isDirty: (tabId: string) => boolean
  requestNavigationAction: (tabId: string, action: () => void) => void
  cleanupTab: (tabId: string) => void
}

interface WorkspaceTabRemoval {
  connectionId: string
  closingTab: WorkspaceTab
  afterSurfaceCaptured?: () => void
}

function forceCloseWorkspaceTab(connectionId: string, tabId: string): void {
  useWorkspaceStore.getState().forceCloseTab(connectionId, tabId)
}

function hasModifiedTableDataRow(tabId: string): boolean {
  const modifiedColumnCount =
    useTableDataStore.getState().tabs[tabId]?.editState?.modifiedColumns.size ?? 0
  return modifiedColumnCount > 0
}

function hasModifiedResultRow(result: {
  editState?: { modifiedColumns: Set<string> } | null
}): boolean {
  return (result.editState?.modifiedColumns.size ?? 0) > 0
}

function markWorkspaceTabPendingClose(connectionId: string, tabId: string): void {
  useWorkspaceStore.setState((state) =>
    markTabPendingClose(state, { connectionId: connectionId, tabId: tabId })
  )
}

function tableDataGuard(): GuardedTabStore {
  const store = useTableDataStore.getState()
  return {
    isDirty: hasModifiedTableDataRow,
    requestNavigationAction: store.requestNavigationAction,
    cleanupTab: store.cleanupTab,
  }
}

function tableDesignerGuard(): GuardedTabStore {
  const store = useTableDesignerStore.getState()
  return {
    isDirty: (tabId) => store.tabs[tabId]?.isDirty === true,
    requestNavigationAction: store.requestNavigationAction,
    cleanupTab: store.cleanupTab,
  }
}

function objectEditorGuard(): GuardedTabStore {
  const store = useObjectEditorStore.getState()
  return {
    isDirty: store.isDirty,
    requestNavigationAction: store.requestNavigationAction,
    cleanupTab: store.cleanupTab,
  }
}

function prepareGuardedClose(
  connectionId: string,
  tabId: string,
  guard: GuardedTabStore
): CloseOutcome {
  if (guard.isDirty(tabId)) {
    markWorkspaceTabPendingClose(connectionId, tabId)
    guard.requestNavigationAction(tabId, () => forceCloseWorkspaceTab(connectionId, tabId))
    return 'handled'
  }
  guard.cleanupTab(tabId)
  useAiStore.getState().cleanupTab(tabId)
  return 'proceed'
}

function dirtyQueryResultLabels(queryTabId: string): string[] {
  const results = useQueryStore.getState().tabs[queryTabId]?.results ?? []
  return results.flatMap((result, index) =>
    hasModifiedResultRow(result) ? [`Result ${index + 1}`] : []
  )
}

function closeQueryTabWithScopedTables(
  connectionId: string,
  queryTabId: string,
  scopedTableTabs: TableDataTab[]
): void {
  const closeQueryTabAndChildren = () => {
    for (const childTab of scopedTableTabs) {
      forceCloseWorkspaceTab(connectionId, childTab.id)
    }
    forceCloseWorkspaceTab(connectionId, queryTabId)
  }
  const queryResultItems = dirtyQueryResultLabels(queryTabId)
  const tableDataItems = scopedTableTabs
    .filter((tab) => hasModifiedTableDataRow(tab.id))
    .map((tab) => tab.label)
  const hasDirtyItems = queryResultItems.length > 0 || tableDataItems.length > 0
  if (!hasDirtyItems) {
    closeQueryTabAndChildren()
    return
  }
  useWorkspaceStore.setState({
    pendingCascadeClose: {
      queryTabId: queryTabId,
      queryResultItems: queryResultItems,
      tableDataItems: tableDataItems,
      onConfirm: () => {
        useWorkspaceStore.setState({ pendingCascadeClose: null })
        closeQueryTabAndChildren()
      },
      onCancel: () => useWorkspaceStore.setState({ pendingCascadeClose: null }),
    },
  })
}

function closeNextDirtyResultOrTab(connectionId: string, queryTabId: string): void {
  const queryTab = useQueryStore.getState().tabs[queryTabId]
  const nextDirtyIndex = queryTab?.results?.findIndex(hasModifiedResultRow) ?? -1
  const hasNoDirtyResult = !queryTab || nextDirtyIndex < 0
  if (hasNoDirtyResult) {
    forceCloseWorkspaceTab(connectionId, queryTabId)
    return
  }
  if (nextDirtyIndex !== (queryTab.activeResultIndex ?? 0)) {
    useQueryStore.getState().setActiveResultIndex(queryTabId, nextDirtyIndex)
  }
  useQueryStore
    .getState()
    .requestNavigationAction(queryTabId, () => closeNextDirtyResultOrTab(connectionId, queryTabId))
}

function prepareQueryEditorClose(
  connectionId: string,
  closingTab: WorkspaceTab,
  tabs: WorkspaceTab[]
): CloseOutcome {
  const scopedTableTabs = getScopedTableDataChildren(tabs, closingTab.id)
  if (scopedTableTabs.length > 0) {
    closeQueryTabWithScopedTables(connectionId, closingTab.id, scopedTableTabs)
    return 'handled'
  }
  if (dirtyQueryResultLabels(closingTab.id).length > 0) {
    markWorkspaceTabPendingClose(connectionId, closingTab.id)
    closeNextDirtyResultOrTab(connectionId, closingTab.id)
    return 'handled'
  }
  return 'proceed'
}

export const CLOSE_PREPARERS: Partial<Record<WorkspaceTab['type'], ClosePreparer>> = {
  'table-data': (connectionId, closingTab) =>
    prepareGuardedClose(connectionId, closingTab.id, tableDataGuard()),
  'table-designer': (connectionId, closingTab) =>
    prepareGuardedClose(connectionId, closingTab.id, tableDesignerGuard()),
  'object-editor': (connectionId, closingTab) =>
    prepareGuardedClose(connectionId, closingTab.id, objectEditorGuard()),
  'query-editor': prepareQueryEditorClose,
}

const TAB_STORE_CLEANUPS: Partial<Record<WorkspaceTab['type'], TabStoreCleanup>> = {
  'table-data': (_connectionId, tabId) => useTableDataStore.getState().cleanupTab(tabId),
  'query-editor': (connectionId, tabId) => useQueryStore.getState().cleanupTab(connectionId, tabId),
  'table-designer': (_connectionId, tabId) => useTableDesignerStore.getState().cleanupTab(tabId),
  'object-editor': (_connectionId, tabId) => useObjectEditorStore.getState().cleanupTab(tabId),
}

export function cleanupTabStore(connectionId: string, tab: WorkspaceTab): void {
  TAB_STORE_CLEANUPS[tab.type]?.(connectionId, tab.id)
}

export function cleanupClosedQueryTab(connectionId: string, closingTab: WorkspaceTab): void {
  if (closingTab.type !== 'query-editor') return
  useQueryStore.getState().cleanupTab(connectionId, closingTab.id)
  useAiStore.getState().cleanupTab(closingTab.id)
}

export function removeWorkspaceTab(removal: WorkspaceTabRemoval): void {
  const { connectionId, closingTab } = removal
  const state = useWorkspaceStore.getState()
  const tabs = connectionTabs(state, connectionId)
  const remaining = tabs.filter((tab) => tab.id !== closingTab.id)
  const currentActiveTabId = state.activeTabByConnection[connectionId]
  const wasActive = currentActiveTabId === closingTab.id
  const previousSurface = wasActive
    ? getVisibleWorkspaceSurface(connectionId, closingTab.id)
    : NO_VISIBLE_SURFACE
  const newActive = activeTabIdAfterRemoval(currentActiveTabId, closingTab, tabs)
  removal.afterSurfaceCaptured?.()
  const closedTabRemoval = {
    connectionId: connectionId,
    closingTabId: closingTab.id,
    nextActiveTabId: normalizeWorkspaceActiveTab(remaining, newActive),
  }
  useWorkspaceStore.setState((current) => removeClosedTab(current, closedTabRemoval))

  if (wasActive) {
    finalizeWorkspaceActivation(connectionId, previousSurface, closedTabRemoval.nextActiveTabId)
  }
}

export function cleanupConnectionQueryTabs(connectionId: string, tabs: WorkspaceTab[]): void {
  const queryTabIds = tabs.filter((tab) => tab.type === 'query-editor').map((tab) => tab.id)
  if (queryTabIds.length === 0) return
  useQueryStore.getState().cleanupConnection(connectionId, queryTabIds)
}
