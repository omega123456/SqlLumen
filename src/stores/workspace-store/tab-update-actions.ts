import type { WorkspaceTab, TableDesignerTab, ObjectEditorTab } from '../../types/schema'
import {
  tabsWithDatabaseRenamed,
  tabsWithObjectRenamed,
  tabsWithQueryTabRenamed,
  tabsWithSubTab,
} from './workspace-tab-lists'
import { tabsWithTabMoved } from './workspace-tab-order'
import {
  activeTabIdOf,
  clearStackRecency,
  patchObjectEditorTab,
  patchTableDesignerTab,
  rememberFocusedSurface,
  setTabNavigationBlock,
  transformConnectionTabs,
} from './workspace-reducers'
import type { WorkspaceFocusSurface, WorkspaceState } from '../workspace-store'
import { findConnectionIdOfTab } from './object-tab-matching'
import type { ObjectRename } from './object-tab-matching'
import {
  activateVisibleSurfaceOf,
  activateWorkspaceTab,
  deactivateVisibleSurfaceOf,
} from './workspace-surfaces'
import { useWorkspaceStore } from '../workspace-store'

function isNavigationBlockedFor(state: WorkspaceState, connectionId: string): boolean {
  const currentActiveTabId = activeTabIdOf(state, connectionId)
  if (currentActiveTabId === null) return false
  return Boolean(state.blockingNavigationByTab[currentActiveTabId])
}

function transformTabs(connectionId: string, transform: (tabs: WorkspaceTab[]) => WorkspaceTab[]) {
  useWorkspaceStore.setState((state) =>
    transformConnectionTabs(state, { connectionId: connectionId, transform: transform })
  )
}

export function setActiveTab(connectionId: string, tabId: string): void {
  activateWorkspaceTab(connectionId, tabId)
}

export function requestActivateTab(tabId: string): void {
  const state = useWorkspaceStore.getState()
  const connectionId = findConnectionIdOfTab(state, tabId)
  if (connectionId === undefined) return
  if (isNavigationBlockedFor(state, connectionId)) return
  activateWorkspaceTab(connectionId, tabId)
}

export function setLastFocusedSurface(tabId: string, surface: WorkspaceFocusSurface): void {
  useWorkspaceStore.setState((state) =>
    rememberFocusedSurface(state, { tabId: tabId, surface: surface })
  )
}

export function setBlockingNavigation(tabId: string, blocking: boolean): void {
  useWorkspaceStore.setState((state) =>
    setTabNavigationBlock(state, { tabId: tabId, blocking: blocking })
  )
}

export function renameQueryTab(connectionId: string, tabId: string, nextLabel: string): void {
  const normalizedLabel = nextLabel.trim()
  if (!normalizedLabel) return
  transformTabs(connectionId, (tabs) =>
    tabsWithQueryTabRenamed(tabs, { tabId: tabId, label: normalizedLabel })
  )
}

export function reorderWorkspaceTab(
  connectionId: string,
  tabId: string,
  insertIndex: number
): void {
  transformTabs(connectionId, (tabs) =>
    tabsWithTabMoved(tabs, { tabId: tabId, insertIndex: insertIndex })
  )
}

export function updateTabDatabase(
  connectionId: string,
  oldDatabase: string,
  newDatabase: string
): void {
  transformTabs(connectionId, (tabs) =>
    tabsWithDatabaseRenamed(tabs, { oldDatabase: oldDatabase, newDatabase: newDatabase })
  )
}

export function updateTabObject(connectionId: string, rename: ObjectRename): void {
  transformTabs(connectionId, (tabs) => tabsWithObjectRenamed(tabs, rename))
}

export function updateTableDesignerTab(
  tabId: string,
  partial: Partial<Omit<TableDesignerTab, 'type' | 'id'>>
): void {
  useWorkspaceStore.setState((state) =>
    patchTableDesignerTab(state, { tabId: tabId, partial: partial })
  )
}

export function updateObjectEditorTab(
  tabId: string,
  partial: Partial<Omit<ObjectEditorTab, 'type' | 'id'>>
): void {
  useWorkspaceStore.setState((state) =>
    patchObjectEditorTab(state, { tabId: tabId, partial: partial })
  )
}

export function setSubTab(
  connectionId: string,
  tabId: string,
  subTab: WorkspaceTab['subTabId']
): void {
  transformTabs(connectionId, (tabs) => tabsWithSubTab(tabs, { tabId: tabId, subTab: subTab }))
}

export function setVisibleConnectionSession(newSessionId: string): void {
  const state = useWorkspaceStore.getState()
  const previousSessionId = state.visibleConnectionSessionId
  if (previousSessionId === newSessionId) return

  deactivateVisibleSurfaceOf(state, previousSessionId)
  useWorkspaceStore.setState({ visibleConnectionSessionId: newSessionId })
  activateVisibleSurfaceOf(newSessionId)
}

export function resetStackRecency(connectionId?: string): void {
  useWorkspaceStore.setState((state) => clearStackRecency(state, connectionId))
}

export function tabUpdateActions() {
  return {
    setActiveTab,
    requestActivateTab,
    setLastFocusedSurface,
    setBlockingNavigation,
    renameQueryTab,
    reorderWorkspaceTab,
    updateTabDatabase,
    updateTabObject,
    updateTableDesignerTab,
    updateObjectEditorTab,
    setSubTab,
    setVisibleConnectionSession,
    resetStackRecency,
  }
}
