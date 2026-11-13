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
  getWorkspaceStackMemberIds,
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

type ObjectScopedTab = SchemaInfoTab | TableDataTab | TableDesignerTab | ObjectEditorTab

/** The tab types that openTab accepts. */
type OpenableTab = DistributiveOmit<ObjectScopedTab, 'id'>

interface WorkspaceState {
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
  closeTabsByObject: (
    connectionId: string,
    databaseName: string,
    objectName: string,
    objectType?: EditableObjectType
  ) => void
  updateTabDatabase: (connectionId: string, oldDatabase: string, newDatabase: string) => void
  updateTabObject: (
    connectionId: string,
    databaseName: string,
    oldObjectName: string,
    newObjectName: string
  ) => void
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isObjectScopedTab(tab: WorkspaceTab): tab is ObjectScopedTab {
  return (
    tab.type === 'schema-info' ||
    tab.type === 'table-data' ||
    tab.type === 'table-designer' ||
    tab.type === 'object-editor'
  )
}

/** Maps EditableObjectType to the display label for object-editor tabs. */
const OBJECT_EDITOR_TYPE_LABELS: Record<EditableObjectType, string> = {
  procedure: 'Stored procedure',
  function: 'Function',
  trigger: 'Trigger',
  event: 'Event',
  view: 'View',
}

function getObjectEditorLabel(objectType: EditableObjectType, objectName: string): string {
  return `${OBJECT_EDITOR_TYPE_LABELS[objectType]}: ${objectName}`
}

function getUpdatedObjectTabLabel(
  tab: ObjectScopedTab,
  objectName: string = tab.objectName
): string {
  if (tab.type === 'table-designer') {
    return objectName
  }

  if (tab.type === 'object-editor') {
    return getObjectEditorLabel(tab.objectType, objectName)
  }

  return objectName
}

/**
 * Get the best active tab after a change.
 * Keeps the current active if still present, else picks the first remaining tab.
 */
function selectActiveTabAfterChange(
  currentActiveId: string | null,
  newTabs: WorkspaceTab[]
): string | null {
  const isActiveTabStillOpen = newTabs.some((tab) => tab.id === currentActiveId)
  if (currentActiveId && isActiveTabStillOpen) {
    return currentActiveId
  }
  return newTabs.length > 0 ? newTabs[0].id : null
}

function getAdjacentTabIdAfterClose(
  remainingTabs: WorkspaceTab[],
  closingIndex: number
): string | null {
  if (remainingTabs.length === 0) {
    return null
  }

  if (closingIndex < remainingTabs.length) {
    return remainingTabs[closingIndex].id
  }

  return remainingTabs[remainingTabs.length - 1].id
}

function getNextActiveTabIdAfterClose(
  remainingTabs: WorkspaceTab[],
  closingTab: WorkspaceTab,
  closingIndex: number
): string | null {
  const stackKey = getWorkspaceStackKeyForTab(closingTab, {
    hideScopedTableDataTabs: isTableTabsInBottomPanelEnabled(),
  })

  if (stackKey) {
    const isInClosingStack = (tab: WorkspaceTab): boolean =>
      isTabInStack(tab, stackKey, {
        hideScopedTableDataTabs: isTableTabsInBottomPanelEnabled(),
      })

    const sameStackAfterClose = remainingTabs.slice(closingIndex).find(isInClosingStack)

    if (sameStackAfterClose) {
      return sameStackAfterClose.id
    }

    const sameStackBeforeClose = remainingTabs
      .slice(0, closingIndex)
      .reverse()
      .find(isInClosingStack)

    if (sameStackBeforeClose) {
      return sameStackBeforeClose.id
    }
  }

  return getAdjacentTabIdAfterClose(remainingTabs, closingIndex)
}

/**
 * Update tabs for a connection by applying a transform function,
 * then recompute the active tab.
 */
function updateConnectionTabs(
  state: WorkspaceState,
  connectionId: string,
  transform: (tabs: WorkspaceTab[]) => WorkspaceTab[]
): Partial<WorkspaceState> {
  const tabs = state.tabsByConnection[connectionId] || []
  const newTabs = transform(tabs)
  const currentActive = state.activeTabByConnection[connectionId] ?? null
  const newActive = selectActiveTabAfterChange(currentActive, newTabs)

  return {
    tabsByConnection: {
      ...state.tabsByConnection,
      [connectionId]: newTabs,
    },
    activeTabByConnection: {
      ...state.activeTabByConnection,
      [connectionId]: newActive,
    },
    stackRecencyByConnection: {
      ...state.stackRecencyByConnection,
      [connectionId]: getNextStackRecency(
        newTabs,
        state.stackRecencyByConnection[connectionId],
        newActive
      ),
    },
  }
}

function removeConnectionTabs(
  state: WorkspaceState,
  connectionId: string,
  shouldRemove: (tab: WorkspaceTab) => boolean
): Partial<WorkspaceState> {
  const tabs = state.tabsByConnection[connectionId] || []
  const currentActiveId = state.activeTabByConnection[connectionId] ?? null
  const activeTab = currentActiveId
    ? (tabs.find((tab) => tab.id === currentActiveId) ?? null)
    : null
  const activeTabIndex = activeTab ? tabs.findIndex((tab) => tab.id === activeTab.id) : -1
  const wasActiveRemoved = activeTab ? shouldRemove(activeTab) : false
  const remainingTabs = tabs.filter((tab) => !shouldRemove(tab))
  const nextActive = wasActiveRemoved
    ? getNextActiveTabIdAfterClose(remainingTabs, activeTab!, activeTabIndex)
    : currentActiveId
  const normalizedActive = normalizeWorkspaceActiveTab(remainingTabs, nextActive)

  return {
    tabsByConnection: {
      ...state.tabsByConnection,
      [connectionId]: remainingTabs,
    },
    activeTabByConnection: {
      ...state.activeTabByConnection,
      [connectionId]: normalizedActive,
    },
    stackRecencyByConnection: {
      ...state.stackRecencyByConnection,
      [connectionId]: getNextStackRecency(
        remainingTabs,
        state.stackRecencyByConnection[connectionId],
        normalizedActive
      ),
    },
  }
}

function getNextStackRecency(
  tabs: WorkspaceTab[],
  currentRecency: Partial<Record<WorkspaceTabStackKey, string>> | undefined,
  activeTabId: string | null,
  remappedTableTabIds?: Map<string, string>
): Partial<Record<WorkspaceTabStackKey, string>> {
  const nextRecency: Partial<Record<WorkspaceTabStackKey, string>> = {
    ...(currentRecency ?? {}),
  }
  const memberIds = getWorkspaceStackMemberIds(tabs, {
    hideScopedTableDataTabs: isTableTabsInBottomPanelEnabled(),
  })

  for (const [stackKey, tabId] of Object.entries(nextRecency) as Array<
    [WorkspaceTabStackKey, string]
  >) {
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

function isTableTabsInBottomPanelEnabled(): boolean {
  return useSettingsStore.getState().getSetting('results.tableTabsInBottomPanel') === 'true'
}

function getTableDataIdentityKey(
  tab: Pick<TableDataTab, 'connectionId' | 'databaseName' | 'objectName'>
) {
  return `${tab.connectionId}::${tab.databaseName}::${tab.objectName}`
}

function getMovableTabGroupId(tab: WorkspaceTab): string {
  if (isScopedTableDataTab(tab)) {
    return tab.parentQueryTabId
  }
  return tab.id
}

function normalizeScopedTableDataTabs(tabs: WorkspaceTab[]): {
  tabs: WorkspaceTab[]
  removedTableTabIds: string[]
  remappedTableTabIds: Map<string, string>
} {
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

function getScopedTableDataChildren(tabs: WorkspaceTab[], queryTabId: string): TableDataTab[] {
  return tabs.filter((tab) => isScopedTableDataTabOf(tab, queryTabId))
}

function normalizeWorkspaceActiveTab(
  tabs: WorkspaceTab[],
  activeTabId: string | null
): string | null {
  if (!activeTabId) {
    return tabs.length > 0 ? tabs[0].id : null
  }

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null
  if (isScopedTableDataTab(activeTab)) {
    return tabs.some((tab) => tab.id === activeTab.parentQueryTabId)
      ? activeTab.parentQueryTabId
      : activeTabId
  }

  return activeTabId
}

function getStandaloneTableActivationTarget(
  connectionId: string,
  tabs: WorkspaceTab[],
  activeTabId: string | null,
  remappedTableTabIds: Map<string, string>
): string | null {
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

function cascadeCloseAfterClosing(
  pendingCascadeClose: WorkspaceState['pendingCascadeClose'],
  closingTabId: string
): WorkspaceState['pendingCascadeClose'] {
  if (pendingCascadeClose?.queryTabId === closingTabId) return null
  return pendingCascadeClose
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
    useWorkspaceStore.getState().activeTabByConnection[connectionId] ?? null
  )

  useWorkspaceStore.setState((state) => ({
    activeTabByConnection: {
      ...state.activeTabByConnection,
      [connectionId]: tabId,
    },
    tabLastUsedAt: { ...state.tabLastUsedAt, [tabId]: ++tabUseCounter },
    stackRecencyByConnection: {
      ...state.stackRecencyByConnection,
      [connectionId]: getNextStackRecency(
        state.tabsByConnection[connectionId] || [],
        state.stackRecencyByConnection[connectionId],
        tabId
      ),
    },
  }))

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

interface DroppedObjectTarget {
  databaseName: string
  objectName: string
  objectType?: EditableObjectType
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

function markTabPendingClose(connectionId: string, tabId: string): void {
  useWorkspaceStore.setState((state) => ({
    tabsByConnection: {
      ...state.tabsByConnection,
      [connectionId]: (state.tabsByConnection[connectionId] || []).map((tab) =>
        tab.id === tabId ? { ...tab, pendingClose: true } : tab
      ),
    },
  }))
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
    markTabPendingClose(connectionId, tabId)
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
    markTabPendingClose(connectionId, closingTab.id)
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

function activeTabIdAfterRemoval(
  activeTabId: string | null,
  closingTab: WorkspaceTab,
  tabs: WorkspaceTab[]
): string | null {
  if (activeTabId !== closingTab.id) return activeTabId
  const remaining = tabs.filter((tab) => tab.id !== closingTab.id)
  const closingIndex = tabs.findIndex((tab) => tab.id === closingTab.id)
  return getNextActiveTabIdAfterClose(remaining, closingTab, closingIndex)
}

function removeWorkspaceTab(removal: WorkspaceTabRemoval): void {
  const { connectionId, closingTab } = removal
  const state = useWorkspaceStore.getState()
  const tabs = state.tabsByConnection[connectionId] || []
  const remaining = tabs.filter((tab) => tab.id !== closingTab.id)
  const currentActiveTabId = state.activeTabByConnection[connectionId]
  const wasActive = currentActiveTabId === closingTab.id
  const previousSurface = wasActive
    ? getVisibleWorkspaceSurface(connectionId, closingTab.id)
    : { kind: 'none' as const }
  const newActive = activeTabIdAfterRemoval(currentActiveTabId, closingTab, tabs)
  removal.afterSurfaceCaptured?.()
  const nextActiveTabId = normalizeWorkspaceActiveTab(remaining, newActive)

  useWorkspaceStore.setState((current) => ({
    stackRecencyByConnection: {
      ...current.stackRecencyByConnection,
      [connectionId]: getNextStackRecency(
        remaining,
        current.stackRecencyByConnection[connectionId],
        nextActiveTabId
      ),
    },
    pendingCascadeClose: cascadeCloseAfterClosing(current.pendingCascadeClose, closingTab.id),
    tabsByConnection: {
      ...current.tabsByConnection,
      [connectionId]: remaining,
    },
    activeTabByConnection: {
      ...current.activeTabByConnection,
      [connectionId]: nextActiveTabId,
    },
  }))

  if (wasActive) {
    finalizeWorkspaceActivation(connectionId, previousSurface, nextActiveTabId)
  }
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

function isGroupLedBy(group: WorkspaceTab[], tabId: string): boolean {
  return group[0]?.id === tabId
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

function applyScopedTableNormalization(
  connectionId: string,
  currentTabs: WorkspaceTab[]
): WorkspaceTab[] {
  const normalized = normalizeScopedTableDataTabs(currentTabs)
  if (normalized.tabs === currentTabs) return currentTabs
  useWorkspaceStore.setState((state) => {
    const previousActiveTabId = state.activeTabByConnection[connectionId] ?? null
    const standaloneTarget = getStandaloneTableActivationTarget(
      connectionId,
      currentTabs,
      previousActiveTabId,
      normalized.remappedTableTabIds
    )
    const nextActiveTabId =
      standaloneTarget ?? normalizeWorkspaceActiveTab(normalized.tabs, previousActiveTabId)
    return {
      stackRecencyByConnection: {
        ...state.stackRecencyByConnection,
        [connectionId]: getNextStackRecency(
          normalized.tabs,
          state.stackRecencyByConnection[connectionId],
          nextActiveTabId,
          normalized.remappedTableTabIds
        ),
      },
      tabsByConnection: {
        ...state.tabsByConnection,
        [connectionId]: normalized.tabs,
      },
      activeTabByConnection: {
        ...state.activeTabByConnection,
        [connectionId]: nextActiveTabId,
      },
    }
  })
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
  return getWorkspaceStackKeyForTab(tab, {
    hideScopedTableDataTabs: isTableTabsInBottomPanelEnabled(),
  })
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  tabsByConnection: {},
  activeTabByConnection: {},
  visibleConnectionSessionId: '',
  stackRecencyByConnection: {},
  tabLastUsedAt: {},
  lastFocusedSurfaceByTab: {},
  blockingNavigationByTab: {},
  pendingCascadeClose: null,

  // ------ openTab (with dedup for object-scoped tabs) ------

  openTab: (tab: OpenableTab) => {
    const { connectionId, type } = tab
    const bottomPanelEnabled = isTableTabsInBottomPanelEnabled()
    const currentTabs = get().tabsByConnection[connectionId] || []
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
    } as WorkspaceTab
    set((state) => ({
      tabsByConnection: {
        ...state.tabsByConnection,
        [connectionId]: [...(state.tabsByConnection[connectionId] || []), newTab],
      },
    }))
    activateWorkspaceTab(connectionId, workspaceActivationTarget(newTab))
    enforceTabLimit(connectionId, newTab.id)
    showScopedTableInBottomPanel(newTab)
  },

  restoreTableDataTab: (tab: Omit<TableDataTab, 'id'>) => {
    const existingStandaloneTab =
      tab.parentQueryTabId === undefined
        ? (get().tabsByConnection[tab.connectionId] ?? []).find(
            (candidate): candidate is TableDataTab => isStandaloneTableTabOf(candidate, tab)
          )
        : undefined

    if (existingStandaloneTab) {
      return existingStandaloneTab.id
    }

    const newTab: TableDataTab = { ...tab, id: generateTabId() }
    set((state) => {
      const nextTabs = [...(state.tabsByConnection[tab.connectionId] || []), newTab]
      const nextActiveTab = normalizeWorkspaceActiveTab(
        nextTabs,
        state.activeTabByConnection[tab.connectionId] ?? null
      )
      return {
        tabsByConnection: {
          ...state.tabsByConnection,
          [tab.connectionId]: nextTabs,
        },
        activeTabByConnection: {
          ...state.activeTabByConnection,
          [tab.connectionId]: nextActiveTab,
        },
        stackRecencyByConnection: {
          ...state.stackRecencyByConnection,
          [tab.connectionId]: getNextStackRecency(
            nextTabs,
            state.stackRecencyByConnection[tab.connectionId],
            nextActiveTab
          ),
        },
      }
    })
    return newTab.id
  },

  normalizeTableDataTabScopes: () => {
    set((state) => {
      let changed = false
      const nextTabsByConnection = Object.fromEntries(
        Object.entries(state.tabsByConnection).map(([connectionId, tabs]) => {
          const normalized = normalizeScopedTableDataTabs(tabs)
          if (normalized.tabs !== tabs) {
            changed = true
          }
          return [connectionId, normalized]
        })
      )

      if (!changed) {
        return state
      }

      const nextActiveTabByConnection = Object.fromEntries(
        Object.entries(nextTabsByConnection).map(([connectionId, normalized]) => {
          const currentTabs = state.tabsByConnection[connectionId] ?? []
          const preferredTableTabId = getStandaloneTableActivationTarget(
            connectionId,
            currentTabs,
            state.activeTabByConnection[connectionId] ?? null,
            normalized.remappedTableTabIds
          )

          return [
            connectionId,
            preferredTableTabId ??
              normalizeWorkspaceActiveTab(
                normalized.tabs,
                state.activeTabByConnection[connectionId] ?? null
              ),
          ]
        })
      )
      const nextStackRecencyByConnection = Object.fromEntries(
        Object.entries(nextTabsByConnection).map(([connectionId, normalized]) => [
          connectionId,
          getNextStackRecency(
            normalized.tabs,
            state.stackRecencyByConnection[connectionId],
            nextActiveTabByConnection[connectionId] ?? null,
            normalized.remappedTableTabIds
          ),
        ])
      )

      Object.values(nextTabsByConnection).forEach((normalized) => {
        cleanupRemovedTableTabs(normalized.removedTableTabIds)
      })

      return {
        tabsByConnection: Object.fromEntries(
          Object.entries(nextTabsByConnection).map(([connectionId, normalized]) => [
            connectionId,
            normalized.tabs,
          ])
        ),
        activeTabByConnection: nextActiveTabByConnection,
        stackRecencyByConnection: {
          ...state.stackRecencyByConnection,
          ...nextStackRecencyByConnection,
        },
      }
    })
  },

  // ------ openQueryTab (always creates new tab, no dedup) ------

  openQueryTab: (connectionId: string, label?: string) => {
    const tabNumber = ++queryTabCounter
    const newTab: WorkspaceTab = {
      id: generateTabId(),
      type: 'query-editor',
      label: label ?? `Query ${tabNumber}`,
      connectionId: connectionId,
    }
    set((state) => ({
      tabsByConnection: {
        ...state.tabsByConnection,
        [connectionId]: [...(state.tabsByConnection[connectionId] || []), newTab],
      },
    }))
    activateWorkspaceTab(connectionId, newTab.id)
    return newTab.id
  },

  // ------ openHistoryTab (singleton per connection) ------

  openHistoryTab: (connectionId: string, activate: boolean = true) => {
    const tabs = get().tabsByConnection[connectionId] || []

    // Reuse existing history tab if one exists
    const existing = tabs.find((tab) => tab.type === 'history')
    if (existing) {
      if (activate) {
        set((state) => ({
          activeTabByConnection: {
            ...state.activeTabByConnection,
            [connectionId]: existing.id,
          },
        }))
      }
      return
    }

    const newTab: HistoryTab = {
      id: generateTabId(),
      type: 'history',
      label: 'History',
      connectionId: connectionId,
    }
    set((state) => ({
      tabsByConnection: {
        ...state.tabsByConnection,
        [connectionId]: [newTab, ...(state.tabsByConnection[connectionId] || [])],
      },
      ...(activate
        ? {
            activeTabByConnection: {
              ...state.activeTabByConnection,
              [connectionId]: newTab.id,
            },
          }
        : {}),
    }))
  },

  // ------ openProcessListTab (singleton per connection) ------

  openProcessListTab: (connectionId: string) => {
    const tabs = get().tabsByConnection[connectionId] || []

    // Reuse existing processlist tab if one exists
    const existing = tabs.find((tab) => tab.type === 'processlist')
    if (existing) return

    const newTab: ProcessListTab = {
      id: `processlist-${connectionId}`,
      type: 'processlist',
      label: 'Process list',
      connectionId: connectionId,
    }

    // Insert after the history tab if present, otherwise at position 0
    const historyIndex = tabs.findIndex((tab) => tab.type === 'history')
    const insertIndex = historyIndex >= 0 ? historyIndex + 1 : 0
    const newTabs = [...tabs]
    newTabs.splice(insertIndex, 0, newTab)

    set((state) => ({
      tabsByConnection: {
        ...state.tabsByConnection,
        [connectionId]: newTabs,
      },
    }))
  },

  // ------ closeTab ------

  closeTab: (connectionId: string, tabId: string) => {
    const tabs = get().tabsByConnection[connectionId] || []
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

  // ------ forceCloseTab (removes tab without unsaved-edit checks) ------

  forceCloseTab: (connectionId: string, tabId: string) => {
    const tabs = get().tabsByConnection[connectionId] || []
    const closingTab = tabs.find((tab) => tab.id === tabId)
    if (!closingTab) return
    if (isPinnedWorkspaceTab(closingTab)) return

    cleanupTabStore(connectionId, closingTab)
    useAiStore.getState().cleanupTab(tabId)
    removeWorkspaceTab({ connectionId: connectionId, closingTab: closingTab })
  },

  // ------ setActiveTab ------

  setActiveTab: (connectionId: string, tabId: string) => {
    activateWorkspaceTab(connectionId, tabId)
  },

  requestActivateTab: (tabId: string) => {
    const state = get()
    const connectionEntry = Object.entries(state.tabsByConnection).find(([, tabs]) =>
      tabs.some((tab) => tab.id === tabId)
    )
    if (!connectionEntry) return

    const [connectionId] = connectionEntry
    const currentActiveTabId = state.activeTabByConnection[connectionId] ?? null
    const isNavigationBlocked =
      currentActiveTabId !== null && Boolean(state.blockingNavigationByTab[currentActiveTabId])
    if (isNavigationBlocked) {
      return
    }
    activateWorkspaceTab(connectionId, tabId)
  },

  setLastFocusedSurface: (tabId: string, surface: WorkspaceFocusSurface) => {
    set((state) => ({
      lastFocusedSurfaceByTab: {
        ...state.lastFocusedSurfaceByTab,
        [tabId]: surface,
      },
    }))
  },

  setBlockingNavigation: (tabId: string, blocking: boolean) => {
    set((state) => ({
      blockingNavigationByTab: {
        ...state.blockingNavigationByTab,
        [tabId]: blocking,
      },
    }))
  },

  renameQueryTab: (connectionId: string, tabId: string, nextLabel: string) => {
    const normalizedLabel = nextLabel.trim()
    if (!normalizedLabel) {
      return
    }

    set((state) =>
      updateConnectionTabs(state, connectionId, (tabs) =>
        tabs.map((tab) => {
          if (tab.id !== tabId) return tab
          if (tab.type !== 'query-editor') return tab

          if (tab.label === normalizedLabel) {
            return tab
          }

          return {
            ...tab,
            label: normalizedLabel,
          }
        })
      )
    )
  },

  reorderWorkspaceTab: (connectionId: string, tabId: string, insertIndex: number) => {
    set((state) =>
      updateConnectionTabs(state, connectionId, (tabs) => {
        const sourceTab = tabs.find((tab) => tab.id === tabId)
        if (!sourceTab) return tabs
        if (isPinnedWorkspaceTab(sourceTab)) return tabs

        const pinnedTabs = tabs.filter(isPinnedWorkspaceTab)
        const movableTabs = tabs.filter((tab) => !isPinnedWorkspaceTab(tab))
        const sourceIndex = movableTabs.findIndex((tab) => tab.id === tabId)
        if (sourceIndex < 0) {
          return tabs
        }

        const maxInsertIndex = movableTabs.length
        const clampedInsertIndex = Math.max(0, Math.min(insertIndex, maxInsertIndex))

        const isMovingQueryGroup =
          isTableTabsInBottomPanelEnabled() && sourceTab.type === 'query-editor'
        if (isMovingQueryGroup) {
          const scopedChildrenByQueryId = movableTabs.reduce<Record<string, TableDataTab[]>>(
            (accumulator, tab) => {
              if (isScopedTableDataTab(tab)) {
                ;(accumulator[tab.parentQueryTabId] ??= []).push(tab)
              }
              return accumulator
            },
            {}
          )

          const groupedMovableTabs = movableTabs.flatMap<WorkspaceTab[]>((tab) => {
            if (isScopedTableDataTab(tab)) {
              return []
            }

            if (tab.type === 'query-editor') {
              return [[tab, ...(scopedChildrenByQueryId[tab.id] ?? [])]]
            }

            return [[tab]]
          })

          const sourceGroupIndex = groupedMovableTabs.findIndex((group) =>
            isGroupLedBy(group, tabId)
          )
          if (sourceGroupIndex < 0) {
            return tabs
          }

          const insertGroupIndex = (() => {
            const seenGroupIds = new Set<string>()
            for (const tab of movableTabs.slice(0, clampedInsertIndex)) {
              seenGroupIds.add(getMovableTabGroupId(tab))
            }
            return seenGroupIds.size
          })()

          const nextGroups = [...groupedMovableTabs]
          const [movedGroup] = nextGroups.splice(sourceGroupIndex, 1)
          const targetGroupIndex =
            insertGroupIndex > sourceGroupIndex ? insertGroupIndex - 1 : insertGroupIndex

          nextGroups.splice(targetGroupIndex, 0, movedGroup)
          return [...pinnedTabs, ...nextGroups.flat()]
        }

        const nextMovableTabs = [...movableTabs]
        const [movedTab] = nextMovableTabs.splice(sourceIndex, 1)
        const targetIndex =
          clampedInsertIndex > sourceIndex ? clampedInsertIndex - 1 : clampedInsertIndex

        nextMovableTabs.splice(targetIndex, 0, movedTab)
        return [...pinnedTabs, ...nextMovableTabs]
      })
    )
  },

  // ------ closeTabsByDatabase ------

  closeTabsByDatabase: (connectionId: string, databaseName: string) => {
    const state = get()
    const tabs = get().tabsByConnection[connectionId] || []
    const shouldRemove = (tab: WorkspaceTab): boolean =>
      isObjectScopedTab(tab) && tab.databaseName === databaseName

    const removedTabs = tabs.filter(shouldRemove)

    removedTabs
      .filter((tab) => tab.type === 'table-data')
      .forEach((tab) => useTableDataStore.getState().cleanupTab(tab.id))

    removedTabs
      .filter((tab) => tab.type === 'table-designer')
      .forEach((tab) => useTableDesignerStore.getState().cleanupTab(tab.id))

    removedTabs
      .filter((tab) => tab.type === 'object-editor')
      .forEach((tab) => useObjectEditorStore.getState().cleanupTab(tab.id))

    removedTabs.forEach((tab) => useAiStore.getState().cleanupTab(tab.id))

    const previousActiveTabId = state.activeTabByConnection[connectionId] ?? null
    const previousSurface = previousActiveTabId
      ? getVisibleWorkspaceSurface(connectionId, previousActiveTabId)
      : { kind: 'none' as const }

    resetRemovedScopedBottomPanelTables(tabs, shouldRemove)

    set((currentState) => removeConnectionTabs(currentState, connectionId, shouldRemove))

    finalizeActivationIfVisibleChanged(connectionId, {
      activeTabId: previousActiveTabId,
      surface: previousSurface,
    })
  },

  // ------ closeTabsByObject ------

  closeTabsByObject: (
    connectionId: string,
    databaseName: string,
    objectName: string,
    objectType?: EditableObjectType
  ) => {
    const state = get()
    const tabs = state.tabsByConnection[connectionId] || []
    const target: DroppedObjectTarget = {
      databaseName: databaseName,
      objectName: objectName,
      objectType: objectType,
    }
    const shouldRemove = (tab: WorkspaceTab): boolean =>
      shouldRemoveTabForDroppedObject(tab, target)
    const removedTabs = tabs.filter(shouldRemove)
    removedTabs.forEach((tab) => cleanupTabStore(connectionId, tab))
    removedTabs.forEach((tab) => useAiStore.getState().cleanupTab(tab.id))

    const previousActiveTabId = state.activeTabByConnection[connectionId] ?? null
    const previousSurface = previousActiveTabId
      ? getVisibleWorkspaceSurface(connectionId, previousActiveTabId)
      : { kind: 'none' as const }

    resetRemovedScopedBottomPanelTables(tabs, shouldRemove)
    set((currentState) => removeConnectionTabs(currentState, connectionId, shouldRemove))

    finalizeActivationIfVisibleChanged(connectionId, {
      activeTabId: previousActiveTabId,
      surface: previousSurface,
    })
  },

  // ------ updateTabDatabase ------

  updateTabDatabase: (connectionId: string, oldDatabase: string, newDatabase: string) => {
    set((state) =>
      updateConnectionTabs(state, connectionId, (tabs) =>
        tabs.map((tab) => {
          if (!isObjectScopedTab(tab)) return tab
          if (tab.databaseName !== oldDatabase) return tab

          return {
            ...tab,
            databaseName: newDatabase,
            label: getUpdatedObjectTabLabel(tab, tab.objectName),
          } as WorkspaceTab
        })
      )
    )
  },

  // ------ updateTabObject ------

  updateTabObject: (
    connectionId: string,
    databaseName: string,
    oldObjectName: string,
    newObjectName: string
  ) => {
    set((state) =>
      updateConnectionTabs(state, connectionId, (tabs) =>
        tabs.map((tab) => {
          if (!isObjectScopedTab(tab)) return tab
          const isRenamedObject =
            tab.databaseName === databaseName && tab.objectName === oldObjectName
          if (!isRenamedObject) return tab

          return {
            ...tab,
            objectName: newObjectName,
            label: getUpdatedObjectTabLabel(tab, newObjectName),
          } as WorkspaceTab
        })
      )
    )
  },

  updateTableDesignerTab: (tabId, partial) => {
    set((state) => {
      let changed = false

      const nextTabsByConnection = Object.fromEntries(
        Object.entries(state.tabsByConnection).map(([connectionId, tabs]) => [
          connectionId,
          tabs.map((tab) => {
            if (tab.id !== tabId) return tab
            if (tab.type !== 'table-designer') return tab

            changed = true
            return {
              ...tab,
              ...partial,
              label:
                partial.objectName !== undefined
                  ? partial.objectName
                  : (partial.label ?? tab.label),
            }
          }),
        ])
      )

      if (!changed) {
        return state
      }

      return {
        tabsByConnection: nextTabsByConnection,
      }
    })
  },

  // ------ updateObjectEditorTab ------

  updateObjectEditorTab: (tabId, partial) => {
    set((state) => {
      let changed = false

      const nextTabsByConnection = Object.fromEntries(
        Object.entries(state.tabsByConnection).map(([connectionId, tabs]) => [
          connectionId,
          tabs.map((tab) => {
            if (tab.id !== tabId) return tab
            if (tab.type !== 'object-editor') return tab

            changed = true
            return {
              ...tab,
              ...partial,
              label: partial.label ?? tab.label,
            }
          }),
        ])
      )

      if (!changed) {
        return state
      }

      return {
        tabsByConnection: nextTabsByConnection,
      }
    })
  },

  // ------ setSubTab ------

  setSubTab: (connectionId: string, tabId: string, subTab: WorkspaceTab['subTabId']) => {
    set((state) =>
      updateConnectionTabs(state, connectionId, (tabs) =>
        tabs.map((tab) => (tab.id === tabId ? { ...tab, subTabId: subTab } : tab))
      )
    )
  },

  // ------ setVisibleConnectionSession ------

  setVisibleConnectionSession: (newSessionId: string) => {
    const state = get()
    const previousSessionId = state.visibleConnectionSessionId

    if (previousSessionId === newSessionId) {
      return
    }

    // Resolve and deactivate the row surface of the currently visible
    // connection before the visibility coordinator moves to the new session.
    if (previousSessionId) {
      const previousSurface = getVisibleWorkspaceSurface(
        previousSessionId,
        state.activeTabByConnection[previousSessionId] ?? null
      )
      markVisibleWorkspaceSurfaceInactive(previousSurface)
    }

    set({ visibleConnectionSessionId: newSessionId })

    // Activate the selected visible surface of the new connection. An empty
    // session ID clears visibility (welcome state) without activating anything.
    if (newSessionId) {
      const nextTabId = get().activeTabByConnection[newSessionId] ?? null
      if (nextTabId) {
        runPostActivationEffects(newSessionId, nextTabId)
      }
    }
  },

  resetStackRecency: (connectionId?: string) => {
    set((state) => {
      if (!connectionId) {
        return { stackRecencyByConnection: {} }
      }

      return {
        stackRecencyByConnection: {
          ...state.stackRecencyByConnection,
          [connectionId]: {},
        },
      }
    })
  },

  // ------ clearConnectionTabs ------

  clearConnectionTabs: (connectionId: string) => {
    const state = get()
    const tabs = state.tabsByConnection[connectionId] || []

    const queryTabIds = tabs.filter((tab) => tab.type === 'query-editor').map((tab) => tab.id)
    if (queryTabIds.length > 0) {
      useQueryStore.getState().cleanupConnection(connectionId, queryTabIds)
    }

    tabs
      .filter((tab) => tab.type === 'table-data')
      .forEach((tab) => useTableDataStore.getState().cleanupTab(tab.id))

    tabs
      .filter((tab) => tab.type === 'table-designer')
      .forEach((tab) => useTableDesignerStore.getState().cleanupTab(tab.id))

    tabs
      .filter((tab) => tab.type === 'object-editor')
      .forEach((tab) => useObjectEditorStore.getState().cleanupTab(tab.id))

    // Clean up AI state for all tabs being removed
    tabs.forEach((tab) => useAiStore.getState().cleanupTab(tab.id))

    set((state) => {
      const newTabs = { ...state.tabsByConnection }
      const newActive = { ...state.activeTabByConnection }
      const newStackRecency = { ...state.stackRecencyByConnection }
      delete newTabs[connectionId]
      delete newActive[connectionId]
      delete newStackRecency[connectionId]
      return {
        tabsByConnection: newTabs,
        activeTabByConnection: newActive,
        stackRecencyByConnection: newStackRecency,
      }
    })
  },
}))

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
