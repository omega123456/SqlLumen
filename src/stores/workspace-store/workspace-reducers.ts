import type {
  HistoryTab,
  ObjectEditorTab,
  ProcessListTab,
  TableDesignerTab,
  WorkspaceTab,
} from '../../types/schema'
import type { WorkspaceFocusSurface, WorkspaceState } from '../workspace-store'
import {
  getNextActiveTabIdAfterClose,
  getNextStackRecency,
  normalizeWorkspaceActiveTab,
  selectActiveTabAfterChange,
  tabsWithProcessList,
  type ScopedTableNormalization,
} from './workspace-tab-lists'
import { withoutKey } from '../../lib/record-utils'

type TabsByConnection = Pick<WorkspaceState, 'tabsByConnection'>
type ActiveTabs = Pick<WorkspaceState, 'activeTabByConnection'>
type StackRecencies = Pick<WorkspaceState, 'stackRecencyByConnection'>
export type WorkspaceTabsState = TabsByConnection & ActiveTabs & StackRecencies

export interface ConnectionTabsUpdate {
  connectionId: string
  tabs: WorkspaceTab[]
  activeTabId: string | null
  remappedTableTabIds?: Map<string, string>
}

export interface ConnectionTabsTransform {
  connectionId: string
  transform: (tabs: WorkspaceTab[]) => WorkspaceTab[]
}

export interface ConnectionTabsRemoval {
  connectionId: string
  shouldRemove: (tab: WorkspaceTab) => boolean
}

export interface TabActivation {
  connectionId: string
  tabId: string
  usedAt: number
}

export interface TabReference {
  connectionId: string
  tabId: string
}

export interface HistoryTabOpening {
  tab: HistoryTab
  activate: boolean
}

export interface ClosedTabRemoval {
  connectionId: string
  closingTabId: string
  nextActiveTabId: string | null
}

export interface ConnectionNormalization {
  connectionId: string
  normalized: ScopedTableNormalization
  preferredActiveTabId: string | null
}

export interface TableDesignerTabPatch {
  tabId: string
  partial: Partial<Omit<TableDesignerTab, 'type' | 'id'>>
}

export interface ObjectEditorTabPatch {
  tabId: string
  partial: Partial<Omit<ObjectEditorTab, 'type' | 'id'>>
}

export interface FocusedSurface {
  tabId: string
  surface: WorkspaceFocusSurface
}

export interface TabNavigationBlock {
  tabId: string
  blocking: boolean
}

export function connectionTabs(state: TabsByConnection, connectionId: string): WorkspaceTab[] {
  return state.tabsByConnection[connectionId] || []
}

export function activeTabIdOf(state: ActiveTabs, connectionId: string): string | null {
  return state.activeTabByConnection[connectionId] ?? null
}

function withTabs(
  state: TabsByConnection,
  connectionId: string,
  tabs: WorkspaceTab[]
): TabsByConnection {
  return { tabsByConnection: { ...state.tabsByConnection, [connectionId]: tabs } }
}

function withActiveTab(state: ActiveTabs, { connectionId, tabId }: TabReference): ActiveTabs {
  return { activeTabByConnection: { ...state.activeTabByConnection, [connectionId]: tabId } }
}

export function replaceConnectionTabs(
  state: WorkspaceTabsState,
  { connectionId, tabs, activeTabId, remappedTableTabIds }: ConnectionTabsUpdate
): WorkspaceTabsState {
  const stackRecency = getNextStackRecency({
    tabs: tabs,
    currentRecency: state.stackRecencyByConnection[connectionId],
    activeTabId: activeTabId,
    remappedTableTabIds: remappedTableTabIds,
  })
  return {
    tabsByConnection: { ...state.tabsByConnection, [connectionId]: tabs },
    activeTabByConnection: { ...state.activeTabByConnection, [connectionId]: activeTabId },
    stackRecencyByConnection: { ...state.stackRecencyByConnection, [connectionId]: stackRecency },
  }
}

export function rewriteTabList(
  state: TabsByConnection,
  { connectionId, transform }: ConnectionTabsTransform
): TabsByConnection {
  return withTabs(state, connectionId, transform(connectionTabs(state, connectionId)))
}

export function transformConnectionTabs(
  state: WorkspaceTabsState,
  { connectionId, transform }: ConnectionTabsTransform
): WorkspaceTabsState {
  const tabs = transform(connectionTabs(state, connectionId))
  const activeTabId = selectActiveTabAfterChange(activeTabIdOf(state, connectionId), tabs)
  return replaceConnectionTabs(state, {
    connectionId: connectionId,
    tabs: tabs,
    activeTabId: activeTabId,
  })
}

function activeTabIdAfterRemovingMatches(
  state: WorkspaceTabsState,
  { connectionId, shouldRemove }: ConnectionTabsRemoval
): string | null {
  const tabs = connectionTabs(state, connectionId)
  const currentActiveTabId = activeTabIdOf(state, connectionId)
  const activeTab = tabs.find((tab) => tab.id === currentActiveTabId)
  if (!activeTab) return currentActiveTabId
  if (!shouldRemove(activeTab)) return currentActiveTabId
  const remainingTabs = tabs.filter((tab) => !shouldRemove(tab))
  return getNextActiveTabIdAfterClose(remainingTabs, activeTab, tabs.indexOf(activeTab))
}

export function removeMatchingTabs(
  state: WorkspaceTabsState,
  removal: ConnectionTabsRemoval
): WorkspaceTabsState {
  const remainingTabs = connectionTabs(state, removal.connectionId).filter(
    (tab) => !removal.shouldRemove(tab)
  )
  const nextActiveTabId = activeTabIdAfterRemovingMatches(state, removal)
  return replaceConnectionTabs(state, {
    connectionId: removal.connectionId,
    tabs: remainingTabs,
    activeTabId: normalizeWorkspaceActiveTab(remainingTabs, nextActiveTabId),
  })
}

export function activateTab(
  state: WorkspaceTabsState & Pick<WorkspaceState, 'tabLastUsedAt'>,
  { connectionId, tabId, usedAt }: TabActivation
): ActiveTabs & StackRecencies & Pick<WorkspaceState, 'tabLastUsedAt'> {
  const stackRecency = getNextStackRecency({
    tabs: connectionTabs(state, connectionId),
    currentRecency: state.stackRecencyByConnection[connectionId],
    activeTabId: tabId,
  })
  return {
    activeTabByConnection: { ...state.activeTabByConnection, [connectionId]: tabId },
    tabLastUsedAt: { ...state.tabLastUsedAt, [tabId]: usedAt },
    stackRecencyByConnection: { ...state.stackRecencyByConnection, [connectionId]: stackRecency },
  }
}

export function appendTab(state: TabsByConnection, tab: WorkspaceTab): TabsByConnection {
  const tabs = [...connectionTabs(state, tab.connectionId), tab]
  return withTabs(state, tab.connectionId, tabs)
}

export function appendRestoredTab(
  state: WorkspaceTabsState,
  tab: WorkspaceTab
): WorkspaceTabsState {
  const tabs = [...connectionTabs(state, tab.connectionId), tab]
  const activeTabId = normalizeWorkspaceActiveTab(tabs, activeTabIdOf(state, tab.connectionId))
  return replaceConnectionTabs(state, {
    connectionId: tab.connectionId,
    tabs: tabs,
    activeTabId: activeTabId,
  })
}

export function showTab(state: ActiveTabs, reference: TabReference): ActiveTabs {
  return withActiveTab(state, reference)
}

export function prependHistoryTab(
  state: TabsByConnection & ActiveTabs,
  { tab, activate }: HistoryTabOpening
): TabsByConnection | (TabsByConnection & ActiveTabs) {
  const tabs = [tab, ...connectionTabs(state, tab.connectionId)]
  const opened = withTabs(state, tab.connectionId, tabs)
  if (!activate) return opened
  return {
    ...opened,
    ...withActiveTab(state, { connectionId: tab.connectionId, tabId: tab.id }),
  }
}

export function insertProcessListTab(state: TabsByConnection, tab: ProcessListTab) {
  const tabs = tabsWithProcessList(connectionTabs(state, tab.connectionId), tab)
  return withTabs(state, tab.connectionId, tabs)
}

export function markTabPendingClose(
  state: TabsByConnection,
  { connectionId, tabId }: TabReference
): TabsByConnection {
  const tabs = connectionTabs(state, connectionId).map((tab) =>
    tab.id === tabId ? { ...tab, pendingClose: true } : tab
  )
  return withTabs(state, connectionId, tabs)
}

function cascadeCloseAfterClosing(
  pendingCascadeClose: WorkspaceState['pendingCascadeClose'],
  closingTabId: string
): WorkspaceState['pendingCascadeClose'] {
  if (pendingCascadeClose?.queryTabId === closingTabId) return null
  return pendingCascadeClose
}

export function removeClosedTab(
  state: WorkspaceTabsState & Pick<WorkspaceState, 'pendingCascadeClose'>,
  { connectionId, closingTabId, nextActiveTabId }: ClosedTabRemoval
): WorkspaceTabsState & Pick<WorkspaceState, 'pendingCascadeClose'> {
  const remainingTabs = connectionTabs(state, connectionId).filter((tab) => tab.id !== closingTabId)
  const remainingState = replaceConnectionTabs(state, {
    connectionId: connectionId,
    tabs: remainingTabs,
    activeTabId: nextActiveTabId,
  })
  return {
    ...remainingState,
    pendingCascadeClose: cascadeCloseAfterClosing(state.pendingCascadeClose, closingTabId),
  }
}

function normalizedActiveTabId(
  state: ActiveTabs,
  { connectionId, normalized, preferredActiveTabId }: ConnectionNormalization
): string | null {
  if (preferredActiveTabId) return preferredActiveTabId
  return normalizeWorkspaceActiveTab(normalized.tabs, activeTabIdOf(state, connectionId))
}

export function applyConnectionNormalization(
  state: WorkspaceTabsState,
  normalization: ConnectionNormalization
): WorkspaceTabsState {
  return replaceConnectionTabs(state, {
    connectionId: normalization.connectionId,
    tabs: normalization.normalized.tabs,
    activeTabId: normalizedActiveTabId(state, normalization),
    remappedTableTabIds: normalization.normalized.remappedTableTabIds,
  })
}

function isChangedByNormalization(
  state: TabsByConnection,
  { connectionId, normalized }: ConnectionNormalization
): boolean {
  return normalized.tabs !== state.tabsByConnection[connectionId]
}

export function applyAllConnectionNormalizations(
  state: WorkspaceTabsState,
  normalizations: ConnectionNormalization[]
): WorkspaceTabsState {
  const hasChange = normalizations.some((normalization) =>
    isChangedByNormalization(state, normalization)
  )
  if (!hasChange) return state

  const normalizedState = normalizations.reduce(applyConnectionNormalization, state)
  const activeTabEntries = normalizations.map(({ connectionId }) => [
    connectionId,
    activeTabIdOf(normalizedState, connectionId),
  ])
  return { ...normalizedState, activeTabByConnection: Object.fromEntries(activeTabEntries) }
}

function mapTabById(
  state: TabsByConnection,
  tabId: string,
  update: (tab: WorkspaceTab) => WorkspaceTab
): TabsByConnection {
  let changed = false
  const updateMatchingTab = (tab: WorkspaceTab): WorkspaceTab => {
    if (tab.id !== tabId) return tab
    const updatedTab = update(tab)
    changed ||= updatedTab !== tab
    return updatedTab
  }
  const tabEntries = Object.entries(state.tabsByConnection).map(([connectionId, tabs]) => [
    connectionId,
    tabs.map(updateMatchingTab),
  ])
  if (!changed) return state
  return { tabsByConnection: Object.fromEntries(tabEntries) }
}

export function patchTableDesignerTab(
  state: TabsByConnection,
  { tabId, partial }: TableDesignerTabPatch
): TabsByConnection {
  return mapTabById(state, tabId, (tab) => {
    if (tab.type !== 'table-designer') return tab
    const label = partial.objectName ?? partial.label ?? tab.label
    return { ...tab, ...partial, label: label }
  })
}

export function patchObjectEditorTab(
  state: TabsByConnection,
  { tabId, partial }: ObjectEditorTabPatch
): TabsByConnection {
  return mapTabById(state, tabId, (tab) => {
    if (tab.type !== 'object-editor') return tab
    return { ...tab, ...partial, label: partial.label ?? tab.label }
  })
}

export function rememberFocusedSurface(
  state: Pick<WorkspaceState, 'lastFocusedSurfaceByTab'>,
  { tabId, surface }: FocusedSurface
): Pick<WorkspaceState, 'lastFocusedSurfaceByTab'> {
  return { lastFocusedSurfaceByTab: { ...state.lastFocusedSurfaceByTab, [tabId]: surface } }
}

export function setTabNavigationBlock(
  state: Pick<WorkspaceState, 'blockingNavigationByTab'>,
  { tabId, blocking }: TabNavigationBlock
): Pick<WorkspaceState, 'blockingNavigationByTab'> {
  return { blockingNavigationByTab: { ...state.blockingNavigationByTab, [tabId]: blocking } }
}

export function clearStackRecency(
  state: StackRecencies,
  connectionId: string | undefined
): StackRecencies {
  if (!connectionId) return { stackRecencyByConnection: {} }
  return { stackRecencyByConnection: { ...state.stackRecencyByConnection, [connectionId]: {} } }
}

export function removeConnection(
  state: WorkspaceTabsState,
  connectionId: string
): WorkspaceTabsState {
  return {
    tabsByConnection: withoutKey(state.tabsByConnection, connectionId),
    activeTabByConnection: withoutKey(state.activeTabByConnection, connectionId),
    stackRecencyByConnection: withoutKey(state.stackRecencyByConnection, connectionId),
  }
}
