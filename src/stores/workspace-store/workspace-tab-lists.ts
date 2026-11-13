import type {
  EditableObjectType,
  ObjectEditorTab,
  ProcessListTab,
  SchemaInfoTab,
  TableDataTab,
  TableDesignerTab,
  WorkspaceTab,
} from '../../types/schema'
import { useSettingsStore } from '../settings-store'
import {
  getWorkspaceStackKeyForTab,
  getWorkspaceStackMemberIds,
  isScopedTableDataTab,
  isTabInStack,
  WORKSPACE_TAB_STACK_ORDER,
  type WorkspaceTabStackKey,
} from '../../lib/workspace-tab-stacks'
import type { ObjectRename } from '../workspace-store'

export type ObjectScopedTab = SchemaInfoTab | TableDataTab | TableDesignerTab | ObjectEditorTab
export type StackRecency = Partial<Record<WorkspaceTabStackKey, string>>

export interface ScopedTableNormalization {
  tabs: WorkspaceTab[]
  removedTableTabIds: string[]
  remappedTableTabIds: Map<string, string>
}

export interface StackRecencyInputs {
  tabs: WorkspaceTab[]
  currentRecency: StackRecency | undefined
  activeTabId: string | null
  remappedTableTabIds?: Map<string, string>
}

export interface DatabaseRename {
  oldDatabase: string
  newDatabase: string
}

export interface QueryTabRename {
  tabId: string
  label: string
}

const OBJECT_EDITOR_TYPE_LABELS: Record<EditableObjectType, string> = {
  procedure: 'Stored procedure',
  function: 'Function',
  trigger: 'Trigger',
  event: 'Event',
  view: 'View',
}

export function isTableTabsInBottomPanelEnabled(): boolean {
  return useSettingsStore.getState().getSetting('results.tableTabsInBottomPanel') === 'true'
}

function stackResolutionOptions() {
  return { hideScopedTableDataTabs: isTableTabsInBottomPanelEnabled() }
}

export function isObjectScopedTab(tab: WorkspaceTab): tab is ObjectScopedTab {
  return (
    tab.type === 'schema-info' ||
    tab.type === 'table-data' ||
    tab.type === 'table-designer' ||
    tab.type === 'object-editor'
  )
}

function getObjectEditorLabel(objectType: EditableObjectType, objectName: string): string {
  return `${OBJECT_EDITOR_TYPE_LABELS[objectType]}: ${objectName}`
}

function getUpdatedObjectTabLabel(tab: ObjectScopedTab, objectName: string): string {
  if (tab.type === 'object-editor') {
    return getObjectEditorLabel(tab.objectType, objectName)
  }
  return objectName
}

export function selectActiveTabAfterChange(
  currentActiveId: string | null,
  tabs: WorkspaceTab[]
): string | null {
  const isActiveTabStillOpen = tabs.some((tab) => tab.id === currentActiveId)
  if (currentActiveId && isActiveTabStillOpen) {
    return currentActiveId
  }
  return tabs.length > 0 ? tabs[0].id : null
}

function getAdjacentTabIdAfterClose(
  remainingTabs: WorkspaceTab[],
  closingIndex: number
): string | null {
  if (remainingTabs.length === 0) return null
  if (closingIndex < remainingTabs.length) return remainingTabs[closingIndex].id
  return remainingTabs[remainingTabs.length - 1].id
}

function sameStackNeighbourId(
  remainingTabs: WorkspaceTab[],
  stackKey: WorkspaceTabStackKey,
  closingIndex: number
): string | null {
  const isInClosingStack = (tab: WorkspaceTab): boolean =>
    isTabInStack(tab, stackKey, stackResolutionOptions())
  const sameStackAfterClose = remainingTabs.slice(closingIndex).find(isInClosingStack)
  if (sameStackAfterClose) return sameStackAfterClose.id
  const sameStackBeforeClose = remainingTabs.slice(0, closingIndex).reverse().find(isInClosingStack)
  return sameStackBeforeClose?.id ?? null
}

export function getNextActiveTabIdAfterClose(
  remainingTabs: WorkspaceTab[],
  closingTab: WorkspaceTab,
  closingIndex: number
): string | null {
  const stackKey = getWorkspaceStackKeyForTab(closingTab, stackResolutionOptions())
  const neighbourId = stackKey ? sameStackNeighbourId(remainingTabs, stackKey, closingIndex) : null
  return neighbourId ?? getAdjacentTabIdAfterClose(remainingTabs, closingIndex)
}

export function activeTabIdAfterRemoval(
  activeTabId: string | null,
  closingTab: WorkspaceTab,
  tabs: WorkspaceTab[]
): string | null {
  if (activeTabId !== closingTab.id) return activeTabId
  const remaining = tabs.filter((tab) => tab.id !== closingTab.id)
  const closingIndex = tabs.findIndex((tab) => tab.id === closingTab.id)
  return getNextActiveTabIdAfterClose(remaining, closingTab, closingIndex)
}

function retainedRecencyTabId(
  tabId: string,
  members: Set<string>,
  remappedTableTabIds: Map<string, string> | undefined
): string | undefined {
  if (members.has(tabId)) return tabId
  const remappedTabId = remappedTableTabIds?.get(tabId)
  if (!remappedTabId) return undefined
  return members.has(remappedTabId) ? remappedTabId : undefined
}

function stackKeyOfTab(tabs: WorkspaceTab[], tabId: string): WorkspaceTabStackKey | null {
  const tab = tabs.find((candidate) => candidate.id === tabId)
  if (!tab) return null
  return getWorkspaceStackKeyForTab(tab, stackResolutionOptions())
}

export function getNextStackRecency({
  tabs,
  currentRecency,
  activeTabId,
  remappedTableTabIds,
}: StackRecencyInputs): StackRecency {
  const nextRecency: StackRecency = { ...(currentRecency ?? {}) }
  const memberIds = getWorkspaceStackMemberIds(tabs, stackResolutionOptions())

  for (const stackKey of WORKSPACE_TAB_STACK_ORDER) {
    const tabId = nextRecency[stackKey]
    if (tabId === undefined) continue
    const retainedTabId = retainedRecencyTabId(tabId, memberIds[stackKey], remappedTableTabIds)
    if (!retainedTabId) {
      delete nextRecency[stackKey]
      continue
    }
    nextRecency[stackKey] = retainedTabId
  }

  if (!activeTabId) return nextRecency
  const activeStackKey = stackKeyOfTab(tabs, activeTabId)
  if (activeStackKey) {
    nextRecency[activeStackKey] = activeTabId
  }

  return nextRecency
}

function getTableDataIdentityKey(
  tab: Pick<TableDataTab, 'connectionId' | 'databaseName' | 'objectName'>
) {
  return `${tab.connectionId}::${tab.databaseName}::${tab.objectName}`
}

export function normalizeScopedTableDataTabs(tabs: WorkspaceTab[]): ScopedTableNormalization {
  let changed = false
  const normalizedTabs: WorkspaceTab[] = []
  const standaloneTableTabIdsByKey = new Map<string, string>()
  const removedTableTabIds: string[] = []
  const remappedTableTabIds = new Map<string, string>()

  for (const tab of tabs) {
    if (tab.type !== 'table-data') {
      normalizedTabs.push(tab)
      continue
    }

    const normalizedTab = tab.parentQueryTabId ? { ...tab, parentQueryTabId: undefined } : tab
    if (normalizedTab !== tab) {
      changed = true
    }

    const identityKey = getTableDataIdentityKey(normalizedTab)
    const existingTabId = standaloneTableTabIdsByKey.get(identityKey)
    if (existingTabId) {
      changed = true
      removedTableTabIds.push(normalizedTab.id)
      remappedTableTabIds.set(normalizedTab.id, existingTabId)
      continue
    }

    standaloneTableTabIdsByKey.set(identityKey, normalizedTab.id)
    normalizedTabs.push(normalizedTab)
  }

  return {
    tabs: changed ? normalizedTabs : tabs,
    removedTableTabIds: removedTableTabIds,
    remappedTableTabIds: remappedTableTabIds,
  }
}

export function normalizeWorkspaceActiveTab(
  tabs: WorkspaceTab[],
  activeTabId: string | null
): string | null {
  if (!activeTabId) {
    return tabs.length > 0 ? tabs[0].id : null
  }

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null
  if (!isScopedTableDataTab(activeTab)) return activeTabId
  const isParentOpen = tabs.some((tab) => tab.id === activeTab.parentQueryTabId)
  return isParentOpen ? activeTab.parentQueryTabId : activeTabId
}

export function tabsWithProcessList(tabs: WorkspaceTab[], processListTab: ProcessListTab) {
  const historyIndex = tabs.findIndex((tab) => tab.type === 'history')
  const insertIndex = historyIndex >= 0 ? historyIndex + 1 : 0
  const nextTabs = [...tabs]
  nextTabs.splice(insertIndex, 0, processListTab)
  return nextTabs
}

export function tabsWithQueryTabRenamed(
  tabs: WorkspaceTab[],
  { tabId, label }: QueryTabRename
): WorkspaceTab[] {
  return tabs.map((tab) => {
    if (tab.id !== tabId) return tab
    if (tab.type !== 'query-editor') return tab
    if (tab.label === label) return tab
    return { ...tab, label: label }
  })
}

export function tabsWithDatabaseRenamed(
  tabs: WorkspaceTab[],
  { oldDatabase, newDatabase }: DatabaseRename
): WorkspaceTab[] {
  return tabs.map((tab) => {
    if (!isObjectScopedTab(tab)) return tab
    if (tab.databaseName !== oldDatabase) return tab
    return {
      ...tab,
      databaseName: newDatabase,
      label: getUpdatedObjectTabLabel(tab, tab.objectName),
    }
  })
}

function isRenamedObjectTab(tab: ObjectScopedTab, rename: ObjectRename): boolean {
  return tab.databaseName === rename.databaseName && tab.objectName === rename.oldObjectName
}

export function tabsWithObjectRenamed(tabs: WorkspaceTab[], rename: ObjectRename): WorkspaceTab[] {
  return tabs.map((tab) => {
    if (!isObjectScopedTab(tab)) return tab
    if (!isRenamedObjectTab(tab, rename)) return tab
    return {
      ...tab,
      objectName: rename.newObjectName,
      label: getUpdatedObjectTabLabel(tab, rename.newObjectName),
    }
  })
}

export function tabsWithSubTab(
  tabs: WorkspaceTab[],
  { tabId, subTab }: { tabId: string; subTab: WorkspaceTab['subTabId'] }
): WorkspaceTab[] {
  return tabs.map((tab) => (tab.id === tabId ? { ...tab, subTabId: subTab } : tab))
}
