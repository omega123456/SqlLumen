import { create } from 'zustand'
import type {
  WorkspaceTab,
  SchemaInfoTab,
  TableDataTab,
  TableDesignerTab,
  ObjectEditorTab,
  HistoryTab,
  ProcessListTab,
  EditableObjectType,
  DistributiveOmit,
} from '../types/schema'
import { isTableDataInBottomPanel, useQueryStore } from './query-store'
import { useTableDataStore } from './table-data-store'
import { useTableDesignerStore } from './table-designer-store'
import { useObjectEditorStore } from './object-editor-store'
import { useAiStore } from './ai-store'
import { useSettingsStore } from './settings-store'
import {
  getWorkspaceStackKeyForTab,
  isPinnedWorkspaceTab,
  isScopedTableDataTab,
  isScopedTableDataTabOf,
  isTabInStack,
  type WorkspaceTabStackKey,
} from '../lib/workspace-tab-stacks'
import {
  isSameObjectIdentity,
  isTableDataTabOfObject,
  type ObjectTabIdentity,
} from '../lib/workspace-tab-matching'
import {
  activeTabIdAfterRemoval,
  isObjectScopedTab,
  isTableTabsInBottomPanelEnabled,
  normalizeScopedTableDataTabs,
  normalizeWorkspaceActiveTab,
  tabsWithDatabaseRenamed,
  tabsWithObjectRenamed,
  tabsWithQueryTabRenamed,
  tabsWithSubTab,
  type ObjectScopedTab,
} from './workspace-store/workspace-tab-lists'
import { tabsWithTabMoved } from './workspace-store/workspace-tab-order'
import {
  activateTab,
  activeTabIdOf,
  appendRestoredTab,
  appendTab,
  applyAllConnectionNormalizations,
  applyConnectionNormalization,
  clearStackRecency,
  connectionTabs,
  insertProcessListTab,
  markTabPendingClose,
  patchObjectEditorTab,
  patchTableDesignerTab,
  prependHistoryTab,
  rememberFocusedSurface,
  removeClosedTab,
  removeConnection,
  removeMatchingTabs,
  setTabNavigationBlock,
  showTab,
  transformConnectionTabs,
  type ConnectionNormalization,
} from './workspace-store/workspace-reducers'

export type WorkspaceFocusSurface = 'editor' | 'ai-input'

// ---------------------------------------------------------------------------
// Tab ID generation
// ---------------------------------------------------------------------------

let tabIdCounter = 0
let queryTabCounter = 0
let tabUseCounter = 0

/** Reset the counter — for testing only. */
export function _resetTabIdCounter() {
  tabIdCounter = 0
}

export function _resetQueryTabCounter() {
  queryTabCounter = 0
}

function generateTabId(): string {
  return `tab-${++tabIdCounter}`
}

/** The tab types that openTab accepts. */
type OpenableTab = DistributiveOmit<ObjectScopedTab, 'id'>

export interface WorkspaceState {
  /** Tabs per connection ID. */
  tabsByConnection: Record<string, WorkspaceTab[]>

  /** Active tab ID per connection. */
  activeTabByConnection: Record<string, string | null>

  /**
   * Runtime connection-session ID whose workspace is globally visible.
   *
   * Strict semantics: an empty string means no connection workspace is
   * globally visible (welcome state). This field is a neutral foundation for
   * connection-level keep-alive; it does not yet drive any navigation or
   * row-surface lifecycle behavior.
   */
  visibleConnectionSessionId: string
  stackRecencyByConnection: Record<string, Partial<Record<WorkspaceTabStackKey, string>>>
  /** Monotonic activation stamp per tab, used to find the least recently used tab. */
  tabLastUsedAt: Record<string, number>

  lastFocusedSurfaceByTab: Record<string, WorkspaceFocusSurface>
  blockingNavigationByTab: Record<string, boolean>
  pendingCascadeClose: {
    queryTabId: string
    queryResultItems: string[]
    tableDataItems: string[]
    onConfirm: () => void
    onCancel: () => void
  } | null

  // Actions
  openTab: (tab: OpenableTab) => void
  restoreTableDataTab: (tab: Omit<TableDataTab, 'id'>) => string
  openQueryTab: (connectionId: string, label?: string) => string
  openHistoryTab: (connectionId: string, activate?: boolean) => void
  openProcessListTab: (connectionId: string) => void
  closeTab: (connectionId: string, tabId: string) => void
  forceCloseTab: (connectionId: string, tabId: string) => void
  setActiveTab: (connectionId: string, tabId: string) => void
  requestActivateTab: (tabId: string) => void
  setLastFocusedSurface: (tabId: string, surface: WorkspaceFocusSurface) => void
  setBlockingNavigation: (tabId: string, blocking: boolean) => void
  renameQueryTab: (connectionId: string, tabId: string, nextLabel: string) => void
  reorderWorkspaceTab: (connectionId: string, tabId: string, insertIndex: number) => void
  closeTabsByDatabase: (connectionId: string, databaseName: string) => void
  closeTabsByObject: (connectionId: string, target: DroppedObjectTarget) => void
  updateTabDatabase: (connectionId: string, oldDatabase: string, newDatabase: string) => void
  updateTabObject: (connectionId: string, rename: ObjectRename) => void
  updateTableDesignerTab: (
    tabId: string,
    partial: Partial<Omit<TableDesignerTab, 'type' | 'id'>>
  ) => void
  updateObjectEditorTab: (
    tabId: string,
    partial: Partial<Omit<ObjectEditorTab, 'type' | 'id'>>
  ) => void
  setSubTab: (connectionId: string, tabId: string, subTab: WorkspaceTab['subTabId']) => void
  clearConnectionTabs: (connectionId: string) => void
  normalizeTableDataTabScopes: () => void
  setVisibleConnectionSession: (newSessionId: string) => void
  resetStackRecency: (connectionId?: string) => void
}

function getScopedTableDataChildren(tabs: WorkspaceTab[], queryTabId: string): TableDataTab[] {
  return tabs.filter((tab) => isScopedTableDataTabOf(tab, queryTabId))
}

interface StandaloneActivationInputs {
  connectionId: string
  tabs: WorkspaceTab[]
  activeTabId: string | null
  remappedTableTabIds: Map<string, string>
}

function getStandaloneTableActivationTarget({
  connectionId,
  tabs,
  activeTabId,
  remappedTableTabIds,
}: StandaloneActivationInputs): string | null {
  if (!activeTabId) {
    return null
  }

  const remapTableTabId = (tabId: string): string => remappedTableTabIds.get(tabId) ?? tabId
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null

  if (activeTab?.type === 'table-data') {
    return remapTableTabId(activeTab.id)
  }

  if (activeTab?.type !== 'query-editor') {
    return null
  }

  const activeBottomPanelItem = useQueryStore
    .getState()
    .getTabState(activeTab.id).activeBottomPanelItem
  if (activeBottomPanelItem.type !== 'table-data') {
    return null
  }

  const bottomPanelTab = tabs.find((tab) => tab.id === activeBottomPanelItem.tabId)
  if (!isScopedTableDataTabOf(bottomPanelTab, activeTab.id)) {
    return null
  }
  if (bottomPanelTab.connectionId !== connectionId) {
    return null
  }

  return remapTableTabId(bottomPanelTab.id)
}

function cleanupRemovedTableTabs(tabIds: string[]) {
  for (const tabId of tabIds) {
    useTableDataStore.getState().cleanupTab(tabId)
    useAiStore.getState().cleanupTab(tabId)
  }
}

type VisibleWorkspaceSurface =
  | { kind: 'none' }
  | { kind: 'query-result'; tabId: string; resultIndex: number }
  | { kind: 'table-data'; tabId: string }

const NO_VISIBLE_SURFACE: VisibleWorkspaceSurface = { kind: 'none' }

function getVisibleWorkspaceSurface(
  connectionId: string,
  tabId: string | null
): VisibleWorkspaceSurface {
  if (!tabId) {
    return { kind: 'none' }
  }

  const tabs = useWorkspaceStore.getState().tabsByConnection[connectionId] || []
  const tab = tabs.find((candidate) => candidate.id === tabId)
  if (!tab) {
    return { kind: 'none' }
  }

  if (tab.type === 'table-data') {
    return { kind: 'table-data', tabId: tab.id }
  }

  if (tab.type !== 'query-editor') {
    return { kind: 'none' }
  }

  const queryTab = useQueryStore.getState().tabs[tab.id]
  if (!queryTab) {
    return { kind: 'none' }
  }

  const bottomPanelItem = queryTab.activeBottomPanelItem
  if (bottomPanelItem.type === 'table-data') {
    return { kind: 'table-data', tabId: bottomPanelItem.tabId }
  }

  return {
    kind: 'query-result',
    tabId: tab.id,
    resultIndex: Math.min(queryTab.activeResultIndex, Math.max(0, queryTab.results.length - 1)),
  }
}

function markVisibleWorkspaceSurfaceInactive(surface: VisibleWorkspaceSurface): void {
  if (surface.kind === 'query-result') {
    useQueryStore.getState().markResultSurfaceInactive(surface.tabId, surface.resultIndex)
    return
  }

  if (surface.kind === 'table-data') {
    useTableDataStore.getState().markTableDataSurfaceInactive(surface.tabId)
  }
}

function markVisibleWorkspaceSurfaceActive(surface: VisibleWorkspaceSurface): void {
  if (surface.kind === 'query-result') {
    void useQueryStore.getState().markResultSurfaceActive(surface.tabId, surface.resultIndex)
    return
  }

  if (surface.kind === 'table-data') {
    void useTableDataStore.getState().markTableDataSurfaceActive(surface.tabId)
  }
}

function areVisibleWorkspaceSurfacesEqual(
  left: VisibleWorkspaceSurface,
  right: VisibleWorkspaceSurface
): boolean {
  const isSameKind = left.kind === right.kind
  const isSameTab = surfaceTabId(left) === surfaceTabId(right)
  const isSameResult = surfaceResultIndex(left) === surfaceResultIndex(right)
  return isSameKind && isSameTab && isSameResult
}

function surfaceTabId(surface: VisibleWorkspaceSurface): string | null {
  return surface.kind === 'none' ? null : surface.tabId
}

function surfaceResultIndex(surface: VisibleWorkspaceSurface): number | null {
  return surface.kind === 'query-result' ? surface.resultIndex : null
}

function resetRemovedScopedBottomPanelTables(
  tabs: WorkspaceTab[],
  shouldRemove: (tab: WorkspaceTab) => boolean
): void {
  for (const tab of tabs) {
    if (!isScopedTableDataTab(tab)) continue
    if (!shouldRemove(tab)) continue

    const parentQueryTab = useQueryStore.getState().tabs[tab.parentQueryTabId]
    if (isTableDataInBottomPanel(parentQueryTab, tab.id)) {
      useQueryStore.getState().setActiveBottomPanelItem(tab.parentQueryTabId, { type: 'result' })
    }
  }
}

function runPostActivationEffects(connectionId: string, tabId: string): void {
  const tabs = useWorkspaceStore.getState().tabsByConnection[connectionId] || []
  const tab = tabs.find((candidate) => candidate.id === tabId)

  if (tab?.type === 'query-editor') {
    const visibleSurface = getVisibleWorkspaceSurface(connectionId, tabId)
    markVisibleWorkspaceSurfaceActive(visibleSurface)

    if (visibleSurface.kind === 'query-result') {
      const activeResult = useQueryStore.getState().tabs[tabId]?.results[visibleSurface.resultIndex]
      if (activeResult?.queryId) {
        useQueryStore.getState().validateActiveTabResults(tabId)
      }
    }
    return
  }

  if (tab?.type === 'table-data') {
    void useTableDataStore.getState().markTableDataSurfaceActive(tab.id)
  }
}

function finalizeWorkspaceActivation(
  connectionId: string,
  previousSurface: VisibleWorkspaceSurface,
  nextTabId: string | null
): void {
  const isVisibleConnection =
    useWorkspaceStore.getState().visibleConnectionSessionId === connectionId
  if (!isVisibleConnection) {
    return
  }

  markVisibleWorkspaceSurfaceInactive(previousSurface)

  if (nextTabId) {
    runPostActivationEffects(connectionId, nextTabId)
  }
}

interface VisibleWorkspaceSnapshot {
  activeTabId: string | null
  surface: VisibleWorkspaceSurface
}

function finalizeActivationIfVisibleChanged(
  connectionId: string,
  previous: VisibleWorkspaceSnapshot
): void {
  const nextActiveTabId = useWorkspaceStore.getState().activeTabByConnection[connectionId] ?? null
  const nextSurface = getVisibleWorkspaceSurface(connectionId, nextActiveTabId)
  const isSameActiveTab = previous.activeTabId === nextActiveTabId
  const isSameSurface = areVisibleWorkspaceSurfacesEqual(previous.surface, nextSurface)
  if (isSameActiveTab && isSameSurface) return
  finalizeWorkspaceActivation(connectionId, previous.surface, nextActiveTabId)
}

function activateWorkspaceTab(connectionId: string, tabId: string): void {
  const previousSurface = getVisibleWorkspaceSurface(
    connectionId,
    activeTabIdOf(useWorkspaceStore.getState(), connectionId)
  )
  const activation = { connectionId: connectionId, tabId: tabId, usedAt: ++tabUseCounter }
  useWorkspaceStore.setState((state) => activateTab(state, activation))
  finalizeWorkspaceActivation(connectionId, previousSurface, tabId)
}

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

/**
 * Closes the least recently used clean tabs in the new tab's group until the
 * group fits the `results.maxTabsPerGroup` limit. Query tabs and bottom-panel
 * scoped table-data tabs are never limited; dirty tabs are never closed.
 */
function enforceTabLimit(connectionId: string, newTabId: string): void {
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

const CLOSE_PREPARERS: Partial<Record<WorkspaceTab['type'], ClosePreparer>> = {
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

function cleanupTabStore(connectionId: string, tab: WorkspaceTab): void {
  TAB_STORE_CLEANUPS[tab.type]?.(connectionId, tab.id)
}

function cleanupClosedQueryTab(connectionId: string, closingTab: WorkspaceTab): void {
  if (closingTab.type !== 'query-editor') return
  useQueryStore.getState().cleanupTab(connectionId, closingTab.id)
  useAiStore.getState().cleanupTab(closingTab.id)
}

function removeWorkspaceTab(removal: WorkspaceTabRemoval): void {
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

function removeTabsFromConnection(
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

function shouldRemoveTabForDroppedObject(tab: WorkspaceTab, target: DroppedObjectTarget): boolean {
  if (!isTabForObject(tab, target)) return false
  const { objectType } = target
  if (!objectType) return true
  // Table tabs survive a non-table drop with the same name, except view data tabs when a view drops.
  if (isTableBoundTab(tab)) return objectType === 'view' && isViewTableDataTab(tab)
  if (hasTypedObject(tab)) return tab.objectType === objectType
  return true
}

function connectionNormalization(
  state: WorkspaceState,
  connectionId: string
): ConnectionNormalization {
  const tabs = connectionTabs(state, connectionId)
  const normalized = normalizeScopedTableDataTabs(tabs)
  const preferredActiveTabId = getStandaloneTableActivationTarget({
    connectionId: connectionId,
    tabs: tabs,
    activeTabId: activeTabIdOf(state, connectionId),
    remappedTableTabIds: normalized.remappedTableTabIds,
  })
  return {
    connectionId: connectionId,
    normalized: normalized,
    preferredActiveTabId: preferredActiveTabId,
  }
}

function applyScopedTableNormalization(
  connectionId: string,
  currentTabs: WorkspaceTab[]
): WorkspaceTab[] {
  const normalization = connectionNormalization(useWorkspaceStore.getState(), connectionId)
  const { normalized } = normalization
  const isAlreadyNormalized = normalized.tabs === currentTabs
  if (isAlreadyNormalized) return currentTabs
  useWorkspaceStore.setState((state) => applyConnectionNormalization(state, normalization))
  cleanupRemovedTableTabs(normalized.removedTableTabIds)
  return normalized.tabs
}

function resolveParentQueryTabId(connectionId: string, tabs: WorkspaceTab[]): string {
  const activeTabId = useWorkspaceStore.getState().activeTabByConnection[connectionId] ?? null
  const activeTab = tabs.find((candidate) => candidate.id === activeTabId)
  if (activeTab?.type === 'query-editor') return activeTab.id
  return useWorkspaceStore.getState().openQueryTab(connectionId)
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

function findOpenObjectTab(
  tabs: WorkspaceTab[],
  tab: OpenableTab,
  parentQueryTabId: string | undefined
): ObjectScopedTab | undefined {
  return tabs.find((candidate): candidate is ObjectScopedTab =>
    isMatchingOpenObjectTab(candidate, tab, parentQueryTabId)
  )
}

function workspaceActivationTarget(tab: WorkspaceTab): string {
  if (isScopedTableDataTab(tab)) return tab.parentQueryTabId
  return tab.id
}

function showScopedTableInBottomPanel(tab: WorkspaceTab): void {
  if (!isScopedTableDataTab(tab)) return
  useQueryStore
    .getState()
    .setActiveBottomPanelItem(tab.parentQueryTabId, { type: 'table-data', tabId: tab.id })
}

function findOpenStandaloneTableTab(tab: Omit<TableDataTab, 'id'>): TableDataTab | undefined {
  if (tab.parentQueryTabId !== undefined) return undefined
  return connectionTabs(useWorkspaceStore.getState(), tab.connectionId).find(
    (candidate): candidate is TableDataTab => isStandaloneTableTabOf(candidate, tab)
  )
}

function findConnectionIdOfTab(state: WorkspaceState, tabId: string): string | undefined {
  const connectionEntry = Object.entries(state.tabsByConnection).find(([, tabs]) =>
    tabs.some((tab) => tab.id === tabId)
  )
  return connectionEntry?.[0]
}

function isNavigationBlockedFor(state: WorkspaceState, connectionId: string): boolean {
  const currentActiveTabId = activeTabIdOf(state, connectionId)
  if (currentActiveTabId === null) return false
  return Boolean(state.blockingNavigationByTab[currentActiveTabId])
}

function cleanupRemovedObjectTabs(connectionId: string, removedTabs: WorkspaceTab[]): void {
  removedTabs.forEach((tab) => cleanupTabStore(connectionId, tab))
  removedTabs.forEach((tab) => useAiStore.getState().cleanupTab(tab.id))
}

function cleanupConnectionQueryTabs(connectionId: string, tabs: WorkspaceTab[]): void {
  const queryTabIds = tabs.filter((tab) => tab.type === 'query-editor').map((tab) => tab.id)
  if (queryTabIds.length === 0) return
  useQueryStore.getState().cleanupConnection(connectionId, queryTabIds)
}

function deactivateVisibleSurfaceOf(state: WorkspaceState, connectionId: string): void {
  if (!connectionId) return
  const surface = getVisibleWorkspaceSurface(connectionId, activeTabIdOf(state, connectionId))
  markVisibleWorkspaceSurfaceInactive(surface)
}

function activateVisibleSurfaceOf(connectionId: string): void {
  if (!connectionId) return
  const activeTabId = activeTabIdOf(useWorkspaceStore.getState(), connectionId)
  if (!activeTabId) return
  runPostActivationEffects(connectionId, activeTabId)
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => {
  const transformTabs = (
    connectionId: string,
    transform: (tabs: WorkspaceTab[]) => WorkspaceTab[]
  ) => {
    set((state) =>
      transformConnectionTabs(state, { connectionId: connectionId, transform: transform })
    )
  }

  return {
    tabsByConnection: {},
    activeTabByConnection: {},
    visibleConnectionSessionId: '',
    stackRecencyByConnection: {},
    tabLastUsedAt: {},
    lastFocusedSurfaceByTab: {},
    blockingNavigationByTab: {},
    pendingCascadeClose: null,

    openTab: (tab: OpenableTab) => {
      const { connectionId, type } = tab
      const bottomPanelEnabled = isTableTabsInBottomPanelEnabled()
      const currentTabs = connectionTabs(get(), connectionId)
      const tabs = bottomPanelEnabled
        ? currentTabs
        : applyScopedTableNormalization(connectionId, currentTabs)

      const opensScopedTable = type === 'table-data' && bottomPanelEnabled
      const parentQueryTabId = opensScopedTable
        ? resolveParentQueryTabId(connectionId, tabs)
        : undefined
      const isScopedTableDataType = type === 'table-data' && Boolean(parentQueryTabId)

      const existing = findOpenObjectTab(tabs, tab, parentQueryTabId)
      if (existing) {
        activateWorkspaceTab(connectionId, workspaceActivationTarget(existing))
        showScopedTableInBottomPanel(existing)
        return
      }

      const newTab: WorkspaceTab = {
        ...tab,
        ...(isScopedTableDataType ? { parentQueryTabId } : {}),
        id: generateTabId(),
      }
      set((state) => appendTab(state, newTab))
      activateWorkspaceTab(connectionId, workspaceActivationTarget(newTab))
      enforceTabLimit(connectionId, newTab.id)
      showScopedTableInBottomPanel(newTab)
    },

    restoreTableDataTab: (tab: Omit<TableDataTab, 'id'>) => {
      const existingStandaloneTab = findOpenStandaloneTableTab(tab)
      if (existingStandaloneTab) {
        return existingStandaloneTab.id
      }

      const newTab: TableDataTab = { ...tab, id: generateTabId() }
      set((state) => appendRestoredTab(state, newTab))
      return newTab.id
    },

    normalizeTableDataTabScopes: () => {
      const state = get()
      const normalizations = Object.keys(state.tabsByConnection).map((connectionId) =>
        connectionNormalization(state, connectionId)
      )
      normalizations.forEach(({ normalized }) =>
        cleanupRemovedTableTabs(normalized.removedTableTabIds)
      )
      set((current) => applyAllConnectionNormalizations(current, normalizations))
    },

    openQueryTab: (connectionId: string, label?: string) => {
      const tabNumber = ++queryTabCounter
      const newTab: WorkspaceTab = {
        id: generateTabId(),
        type: 'query-editor',
        label: label ?? `Query ${tabNumber}`,
        connectionId: connectionId,
      }
      set((state) => appendTab(state, newTab))
      activateWorkspaceTab(connectionId, newTab.id)
      return newTab.id
    },

    openHistoryTab: (connectionId: string, activate: boolean = true) => {
      const existing = connectionTabs(get(), connectionId).find((tab) => tab.type === 'history')
      if (existing) {
        if (!activate) return
        set((state) => showTab(state, { connectionId: connectionId, tabId: existing.id }))
        return
      }

      const newTab: HistoryTab = {
        id: generateTabId(),
        type: 'history',
        label: 'History',
        connectionId: connectionId,
      }
      set((state) => prependHistoryTab(state, { tab: newTab, activate: activate }))
    },

    openProcessListTab: (connectionId: string) => {
      const existing = connectionTabs(get(), connectionId).find((tab) => tab.type === 'processlist')
      if (existing) return

      const newTab: ProcessListTab = {
        id: `processlist-${connectionId}`,
        type: 'processlist',
        label: 'Process list',
        connectionId: connectionId,
      }
      set((state) => insertProcessListTab(state, newTab))
    },

    closeTab: (connectionId: string, tabId: string) => {
      const tabs = connectionTabs(get(), connectionId)
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
    },

    forceCloseTab: (connectionId: string, tabId: string) => {
      const closingTab = connectionTabs(get(), connectionId).find((tab) => tab.id === tabId)
      if (!closingTab) return
      if (isPinnedWorkspaceTab(closingTab)) return

      cleanupTabStore(connectionId, closingTab)
      useAiStore.getState().cleanupTab(tabId)
      removeWorkspaceTab({ connectionId: connectionId, closingTab: closingTab })
    },

    setActiveTab: (connectionId: string, tabId: string) => {
      activateWorkspaceTab(connectionId, tabId)
    },

    requestActivateTab: (tabId: string) => {
      const state = get()
      const connectionId = findConnectionIdOfTab(state, tabId)
      if (connectionId === undefined) return
      if (isNavigationBlockedFor(state, connectionId)) return
      activateWorkspaceTab(connectionId, tabId)
    },

    setLastFocusedSurface: (tabId: string, surface: WorkspaceFocusSurface) => {
      set((state) => rememberFocusedSurface(state, { tabId: tabId, surface: surface }))
    },

    setBlockingNavigation: (tabId: string, blocking: boolean) => {
      set((state) => setTabNavigationBlock(state, { tabId: tabId, blocking: blocking }))
    },

    renameQueryTab: (connectionId: string, tabId: string, nextLabel: string) => {
      const normalizedLabel = nextLabel.trim()
      if (!normalizedLabel) return
      transformTabs(connectionId, (tabs) =>
        tabsWithQueryTabRenamed(tabs, { tabId: tabId, label: normalizedLabel })
      )
    },

    reorderWorkspaceTab: (connectionId: string, tabId: string, insertIndex: number) => {
      transformTabs(connectionId, (tabs) =>
        tabsWithTabMoved(tabs, { tabId: tabId, insertIndex: insertIndex })
      )
    },

    closeTabsByDatabase: (connectionId: string, databaseName: string) => {
      const shouldRemove = (tab: WorkspaceTab): boolean =>
        isObjectScopedTab(tab) && tab.databaseName === databaseName
      const removedTabs = connectionTabs(get(), connectionId).filter(shouldRemove)
      cleanupRemovedObjectTabs(connectionId, removedTabs)
      removeTabsFromConnection(connectionId, shouldRemove)
    },

    closeTabsByObject: (connectionId: string, target: DroppedObjectTarget) => {
      const shouldRemove = (tab: WorkspaceTab): boolean =>
        shouldRemoveTabForDroppedObject(tab, target)
      const removedTabs = connectionTabs(get(), connectionId).filter(shouldRemove)
      cleanupRemovedObjectTabs(connectionId, removedTabs)
      removeTabsFromConnection(connectionId, shouldRemove)
    },

    updateTabDatabase: (connectionId: string, oldDatabase: string, newDatabase: string) => {
      transformTabs(connectionId, (tabs) =>
        tabsWithDatabaseRenamed(tabs, { oldDatabase: oldDatabase, newDatabase: newDatabase })
      )
    },

    updateTabObject: (connectionId: string, rename: ObjectRename) => {
      transformTabs(connectionId, (tabs) => tabsWithObjectRenamed(tabs, rename))
    },

    updateTableDesignerTab: (tabId, partial) => {
      set((state) => patchTableDesignerTab(state, { tabId: tabId, partial: partial }))
    },

    updateObjectEditorTab: (tabId, partial) => {
      set((state) => patchObjectEditorTab(state, { tabId: tabId, partial: partial }))
    },

    setSubTab: (connectionId: string, tabId: string, subTab: WorkspaceTab['subTabId']) => {
      transformTabs(connectionId, (tabs) => tabsWithSubTab(tabs, { tabId: tabId, subTab: subTab }))
    },

    setVisibleConnectionSession: (newSessionId: string) => {
      const state = get()
      const previousSessionId = state.visibleConnectionSessionId
      if (previousSessionId === newSessionId) return

      deactivateVisibleSurfaceOf(state, previousSessionId)
      set({ visibleConnectionSessionId: newSessionId })
      activateVisibleSurfaceOf(newSessionId)
    },

    resetStackRecency: (connectionId?: string) => {
      set((state) => clearStackRecency(state, connectionId))
    },

    clearConnectionTabs: (connectionId: string) => {
      const tabs = connectionTabs(get(), connectionId)
      cleanupConnectionQueryTabs(connectionId, tabs)
      tabs.filter(isObjectScopedTab).forEach((tab) => cleanupTabStore(connectionId, tab))
      tabs.forEach((tab) => useAiStore.getState().cleanupTab(tab.id))
      set((state) => removeConnection(state, connectionId))
    },
  }
})

let previousTableTabsInBottomPanelSetting = useSettingsStore
  .getState()
  .getSetting('results.tableTabsInBottomPanel')

useSettingsStore.subscribe((state) => {
  const nextSetting = state.getSetting('results.tableTabsInBottomPanel')
  const isTurningBottomPanelTablesOff =
    previousTableTabsInBottomPanelSetting === 'true' && nextSetting === 'false'
  if (isTurningBottomPanelTablesOff) {
    useWorkspaceStore.getState().normalizeTableDataTabScopes()
  }
  previousTableTabsInBottomPanelSetting = nextSetting
})
