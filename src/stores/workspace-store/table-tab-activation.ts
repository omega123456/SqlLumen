import type { WorkspaceTab, TableDataTab } from '../../types/schema'
import { useQueryStore } from '../query-store'
import { isScopedTableDataTab, isScopedTableDataTabOf } from '../../lib/workspace-tab-stacks'
import { normalizeScopedTableDataTabs } from './workspace-tab-lists'
import {
  activeTabIdOf,
  applyConnectionNormalization,
  connectionTabs,
  type ConnectionNormalization,
} from './workspace-reducers'
import type { WorkspaceState } from '../workspace-store'
import { cleanupRemovedTableTabs } from './object-tab-matching'
import { useWorkspaceStore } from '../workspace-store'

export function getScopedTableDataChildren(
  tabs: WorkspaceTab[],
  queryTabId: string
): TableDataTab[] {
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

export function connectionNormalization(
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

export function applyScopedTableNormalization(
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

export function resolveParentQueryTabId(connectionId: string, tabs: WorkspaceTab[]): string {
  const activeTabId = useWorkspaceStore.getState().activeTabByConnection[connectionId] ?? null
  const activeTab = tabs.find((candidate) => candidate.id === activeTabId)
  if (activeTab?.type === 'query-editor') return activeTab.id
  return useWorkspaceStore.getState().openQueryTab(connectionId)
}

export function workspaceActivationTarget(tab: WorkspaceTab): string {
  if (isScopedTableDataTab(tab)) return tab.parentQueryTabId
  return tab.id
}

export function showScopedTableInBottomPanel(tab: WorkspaceTab): void {
  if (!isScopedTableDataTab(tab)) return
  useQueryStore
    .getState()
    .setActiveBottomPanelItem(tab.parentQueryTabId, { type: 'table-data', tabId: tab.id })
}
