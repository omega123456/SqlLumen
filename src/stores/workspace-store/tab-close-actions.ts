import type { WorkspaceTab } from '../../types/schema'
import { useAiStore } from '../ai-store'
import { isPinnedWorkspaceTab } from '../../lib/workspace-tab-stacks'
import { isObjectScopedTab } from './workspace-tab-lists'
import { connectionTabs, removeConnection } from './workspace-reducers'
import {
  cleanupRemovedObjectTabs,
  removeTabsFromConnection,
  shouldRemoveTabForDroppedObject,
} from './object-tab-matching'
import type { DroppedObjectTarget } from './object-tab-matching'
import {
  CLOSE_PREPARERS,
  cleanupClosedQueryTab,
  cleanupConnectionQueryTabs,
  cleanupTabStore,
  removeWorkspaceTab,
} from './tab-close-guards'
import { useWorkspaceStore } from '../workspace-store'

export function closeTab(connectionId: string, tabId: string): void {
  const tabs = connectionTabs(useWorkspaceStore.getState(), connectionId)
  const closingTab = tabs.find((tab) => tab.id === tabId)
  if (!closingTab) return
  if (isPinnedWorkspaceTab(closingTab)) return

  const prepareClose = CLOSE_PREPARERS[closingTab.type]
  const closeOutcome = prepareClose?.(connectionId, closingTab, tabs)
  if (closeOutcome === 'handled') return

  removeWorkspaceTab({
    connectionId: connectionId,
    closingTab: closingTab,
    afterSurfaceCaptured: () => cleanupClosedQueryTab(connectionId, closingTab),
  })
}

export function forceCloseTab(connectionId: string, tabId: string): void {
  const closingTab = connectionTabs(useWorkspaceStore.getState(), connectionId).find(
    (tab) => tab.id === tabId
  )
  if (!closingTab) return
  if (isPinnedWorkspaceTab(closingTab)) return

  cleanupTabStore(connectionId, closingTab)
  useAiStore.getState().cleanupTab(tabId)
  removeWorkspaceTab({ connectionId: connectionId, closingTab: closingTab })
}

export function closeTabsByDatabase(connectionId: string, databaseName: string): void {
  const shouldRemove = (tab: WorkspaceTab): boolean =>
    isObjectScopedTab(tab) && tab.databaseName === databaseName
  const removedTabs = connectionTabs(useWorkspaceStore.getState(), connectionId).filter(
    shouldRemove
  )
  cleanupRemovedObjectTabs(connectionId, removedTabs)
  removeTabsFromConnection(connectionId, shouldRemove)
}

export function closeTabsByObject(connectionId: string, target: DroppedObjectTarget): void {
  const shouldRemove = (tab: WorkspaceTab): boolean => shouldRemoveTabForDroppedObject(tab, target)
  const removedTabs = connectionTabs(useWorkspaceStore.getState(), connectionId).filter(
    shouldRemove
  )
  cleanupRemovedObjectTabs(connectionId, removedTabs)
  removeTabsFromConnection(connectionId, shouldRemove)
}

export function clearConnectionTabs(connectionId: string): void {
  const tabs = connectionTabs(useWorkspaceStore.getState(), connectionId)
  cleanupConnectionQueryTabs(connectionId, tabs)
  tabs.filter(isObjectScopedTab).forEach((tab) => cleanupTabStore(connectionId, tab))
  tabs.forEach((tab) => useAiStore.getState().cleanupTab(tab.id))
  useWorkspaceStore.setState((state) => removeConnection(state, connectionId))
}

export function tabCloseActions() {
  return { closeTab, forceCloseTab, closeTabsByDatabase, closeTabsByObject, clearConnectionTabs }
}
