import type {
  WorkspaceTab,
  SchemaInfoTab,
  TableDataTab,
  ObjectEditorTab,
  EditableObjectType,
} from '../../types/schema'
import { useTableDataStore } from '../table-data-store'
import { useAiStore } from '../ai-store'
import {
  isSameObjectIdentity,
  isTableDataTabOfObject,
  type ObjectTabIdentity,
} from '../../lib/workspace-tab-matching'
import { isObjectScopedTab, type ObjectScopedTab } from './workspace-tab-lists'
import { activeTabIdOf, connectionTabs, removeMatchingTabs } from './workspace-reducers'
import type { OpenableTab, WorkspaceState } from '../workspace-store'
import { cleanupTabStore } from './tab-close-guards'
import {
  finalizeActivationIfVisibleChanged,
  getVisibleWorkspaceSurface,
  resetRemovedScopedBottomPanelTables,
} from './workspace-surfaces'
import { useWorkspaceStore } from '../workspace-store'

export function cleanupRemovedTableTabs(tabIds: string[]) {
  for (const tabId of tabIds) {
    useTableDataStore.getState().cleanupTab(tabId)
    useAiStore.getState().cleanupTab(tabId)
  }
}

export interface DroppedObjectTarget {
  databaseName: string
  objectName: string
  objectType?: EditableObjectType
}

export interface ObjectRename {
  databaseName: string
  oldObjectName: string
  newObjectName: string
}

export function removeTabsFromConnection(
  connectionId: string,
  shouldRemove: (tab: WorkspaceTab) => boolean
): void {
  const state = useWorkspaceStore.getState()
  const tabs = connectionTabs(state, connectionId)
  const previousActiveTabId = activeTabIdOf(state, connectionId)
  const previousSurface = getVisibleWorkspaceSurface(connectionId, previousActiveTabId)

  resetRemovedScopedBottomPanelTables(tabs, shouldRemove)
  const tabsRemoval = { connectionId: connectionId, shouldRemove: shouldRemove }
  useWorkspaceStore.setState((current) => removeMatchingTabs(current, tabsRemoval))

  finalizeActivationIfVisibleChanged(connectionId, {
    activeTabId: previousActiveTabId,
    surface: previousSurface,
  })
}

function isTabForObject(tab: WorkspaceTab, target: ObjectTabIdentity): tab is ObjectScopedTab {
  if (!isObjectScopedTab(tab)) return false
  return isSameObjectIdentity(tab, target)
}

function isStandaloneTableTabOf(
  candidate: WorkspaceTab,
  identity: ObjectTabIdentity
): candidate is TableDataTab {
  if (!isTableDataTabOfObject(candidate, identity)) return false
  return candidate.parentQueryTabId === undefined
}

function isViewTableDataTab(tab: ObjectScopedTab): boolean {
  return tab.type === 'table-data' && tab.objectType === 'view'
}

function isTableBoundTab(tab: ObjectScopedTab): boolean {
  return tab.type === 'table-data' || tab.type === 'table-designer'
}

function hasTypedObject(tab: ObjectScopedTab): tab is ObjectEditorTab | SchemaInfoTab {
  return tab.type === 'object-editor' || tab.type === 'schema-info'
}

export function shouldRemoveTabForDroppedObject(
  tab: WorkspaceTab,
  target: DroppedObjectTarget
): boolean {
  if (!isTabForObject(tab, target)) return false
  const { objectType } = target
  if (!objectType) return true
  if (isTableBoundTab(tab)) return objectType === 'view' && isViewTableDataTab(tab)
  if (hasTypedObject(tab)) return tab.objectType === objectType
  return true
}

function isSameObjectTab(
  candidate: ObjectScopedTab,
  tab: OpenableTab,
  parentQueryTabId: string | undefined
): boolean {
  const isObjectEditorPair = candidate.type === 'object-editor' && tab.type === 'object-editor'
  if (isObjectEditorPair) {
    return candidate.objectType === tab.objectType
  }
  if (candidate.type === 'table-data') {
    return candidate.parentQueryTabId === parentQueryTabId
  }
  return true
}

function isMatchingOpenObjectTab(
  candidate: WorkspaceTab,
  tab: OpenableTab,
  parentQueryTabId: string | undefined
): candidate is ObjectScopedTab {
  if (!isTabForObject(candidate, tab)) return false
  if (candidate.type !== tab.type) return false
  return isSameObjectTab(candidate, tab, parentQueryTabId)
}

export function findOpenObjectTab(
  tabs: WorkspaceTab[],
  tab: OpenableTab,
  parentQueryTabId: string | undefined
): ObjectScopedTab | undefined {
  return tabs.find((candidate): candidate is ObjectScopedTab =>
    isMatchingOpenObjectTab(candidate, tab, parentQueryTabId)
  )
}

export function findOpenStandaloneTableTab(
  tab: Omit<TableDataTab, 'id'>
): TableDataTab | undefined {
  if (tab.parentQueryTabId !== undefined) return undefined
  return connectionTabs(useWorkspaceStore.getState(), tab.connectionId).find(
    (candidate): candidate is TableDataTab => isStandaloneTableTabOf(candidate, tab)
  )
}

export function findConnectionIdOfTab(state: WorkspaceState, tabId: string): string | undefined {
  const connectionEntry = Object.entries(state.tabsByConnection).find(([, tabs]) =>
    tabs.some((tab) => tab.id === tabId)
  )
  return connectionEntry?.[0]
}

export function cleanupRemovedObjectTabs(connectionId: string, removedTabs: WorkspaceTab[]): void {
  removedTabs.forEach((tab) => cleanupTabStore(connectionId, tab))
  removedTabs.forEach((tab) => useAiStore.getState().cleanupTab(tab.id))
}
