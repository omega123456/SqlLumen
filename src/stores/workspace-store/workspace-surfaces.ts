import type { WorkspaceTab } from '../../types/schema'
import { isTableDataInBottomPanel, useQueryStore } from '../query-store'
import { useTableDataStore } from '../table-data-store'
import { isScopedTableDataTab } from '../../lib/workspace-tab-stacks'
import { activateTab, activeTabIdOf } from './workspace-reducers'
import type { WorkspaceState } from '../workspace-store'
import { useWorkspaceStore } from '../workspace-store'

let tabUseCounter = 0

type VisibleWorkspaceSurface =
  | { kind: 'none' }
  | { kind: 'query-result'; tabId: string; resultIndex: number }
  | { kind: 'table-data'; tabId: string }

export const NO_VISIBLE_SURFACE: VisibleWorkspaceSurface = { kind: 'none' }

export function getVisibleWorkspaceSurface(
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

export function resetRemovedScopedBottomPanelTables(
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

function hasVisibleQueryResult(tabId: string, visibleSurface: VisibleWorkspaceSurface): boolean {
  if (visibleSurface.kind !== 'query-result') return false
  const activeResult = useQueryStore.getState().tabs[tabId]?.results[visibleSurface.resultIndex]
  return Boolean(activeResult?.queryId)
}

function activateQueryEditorSurface(connectionId: string, tabId: string): void {
  const visibleSurface = getVisibleWorkspaceSurface(connectionId, tabId)
  markVisibleWorkspaceSurfaceActive(visibleSurface)
  if (hasVisibleQueryResult(tabId, visibleSurface)) {
    useQueryStore.getState().validateActiveTabResults(tabId)
  }
}

function runPostActivationEffects(connectionId: string, tabId: string): void {
  const tabs = useWorkspaceStore.getState().tabsByConnection[connectionId] || []
  const tab = tabs.find((candidate) => candidate.id === tabId)

  if (tab?.type === 'query-editor') {
    activateQueryEditorSurface(connectionId, tabId)
    return
  }

  if (tab?.type === 'table-data') {
    void useTableDataStore.getState().markTableDataSurfaceActive(tab.id)
  }
}

export function finalizeWorkspaceActivation(
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

export function finalizeActivationIfVisibleChanged(
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

export function activateWorkspaceTab(connectionId: string, tabId: string): void {
  const previousSurface = getVisibleWorkspaceSurface(
    connectionId,
    activeTabIdOf(useWorkspaceStore.getState(), connectionId)
  )
  const activation = { connectionId: connectionId, tabId: tabId, usedAt: ++tabUseCounter }
  useWorkspaceStore.setState((state) => activateTab(state, activation))
  finalizeWorkspaceActivation(connectionId, previousSurface, tabId)
}

export function deactivateVisibleSurfaceOf(state: WorkspaceState, connectionId: string): void {
  if (!connectionId) return
  const surface = getVisibleWorkspaceSurface(connectionId, activeTabIdOf(state, connectionId))
  markVisibleWorkspaceSurfaceInactive(surface)
}

export function activateVisibleSurfaceOf(connectionId: string): void {
  if (!connectionId) return
  const activeTabId = activeTabIdOf(useWorkspaceStore.getState(), connectionId)
  if (!activeTabId) return
  runPostActivationEffects(connectionId, activeTabId)
}
