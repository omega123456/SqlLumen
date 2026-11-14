import type { WorkspaceTab, TableDataTab, HistoryTab, ProcessListTab } from '../../types/schema'
import { isTableTabsInBottomPanelEnabled } from './workspace-tab-lists'
import {
  appendRestoredTab,
  appendTab,
  applyAllConnectionNormalizations,
  connectionTabs,
  insertProcessListTab,
  prependHistoryTab,
  showTab,
} from './workspace-reducers'
import { generateTabId, useWorkspaceStore } from '../workspace-store'
import type { OpenableTab } from '../workspace-store'
import {
  cleanupRemovedTableTabs,
  findOpenObjectTab,
  findOpenStandaloneTableTab,
} from './object-tab-matching'
import { enforceTabLimit } from './tab-close-guards'
import {
  applyScopedTableNormalization,
  connectionNormalization,
  resolveParentQueryTabId,
  showScopedTableInBottomPanel,
  workspaceActivationTarget,
} from './table-tab-activation'
import { activateWorkspaceTab } from './workspace-surfaces'

let queryTabCounter = 0

export function _resetQueryTabCounter() {
  queryTabCounter = 0
}

export function openTab(tab: OpenableTab): void {
  const { connectionId, type } = tab
  const bottomPanelEnabled = isTableTabsInBottomPanelEnabled()
  const currentTabs = connectionTabs(useWorkspaceStore.getState(), connectionId)
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
  useWorkspaceStore.setState((state) => appendTab(state, newTab))
  activateWorkspaceTab(connectionId, workspaceActivationTarget(newTab))
  enforceTabLimit(connectionId, newTab.id)
  showScopedTableInBottomPanel(newTab)
}

export function restoreTableDataTab(tab: Omit<TableDataTab, 'id'>): string {
  const existingStandaloneTab = findOpenStandaloneTableTab(tab)
  if (existingStandaloneTab) {
    return existingStandaloneTab.id
  }

  const newTab: TableDataTab = { ...tab, id: generateTabId() }
  useWorkspaceStore.setState((state) => appendRestoredTab(state, newTab))
  return newTab.id
}

export function normalizeTableDataTabScopes(): void {
  const state = useWorkspaceStore.getState()
  const normalizations = Object.keys(state.tabsByConnection).map((connectionId) =>
    connectionNormalization(state, connectionId)
  )
  normalizations.forEach(({ normalized }) => cleanupRemovedTableTabs(normalized.removedTableTabIds))
  useWorkspaceStore.setState((current) => applyAllConnectionNormalizations(current, normalizations))
}

export function openQueryTab(connectionId: string, label?: string): string {
  const tabNumber = ++queryTabCounter
  const newTab: WorkspaceTab = {
    id: generateTabId(),
    type: 'query-editor',
    label: label ?? `Query ${tabNumber}`,
    connectionId: connectionId,
  }
  useWorkspaceStore.setState((state) => appendTab(state, newTab))
  activateWorkspaceTab(connectionId, newTab.id)
  return newTab.id
}

export function openHistoryTab(connectionId: string, activate: boolean = true): void {
  const existing = connectionTabs(useWorkspaceStore.getState(), connectionId).find(
    (tab) => tab.type === 'history'
  )
  if (existing) {
    if (!activate) return
    useWorkspaceStore.setState((state) =>
      showTab(state, { connectionId: connectionId, tabId: existing.id })
    )
    return
  }

  const newTab: HistoryTab = {
    id: generateTabId(),
    type: 'history',
    label: 'History',
    connectionId: connectionId,
  }
  useWorkspaceStore.setState((state) =>
    prependHistoryTab(state, { tab: newTab, activate: activate })
  )
}

export function openProcessListTab(connectionId: string): void {
  const existing = connectionTabs(useWorkspaceStore.getState(), connectionId).find(
    (tab) => tab.type === 'processlist'
  )
  if (existing) return

  const newTab: ProcessListTab = {
    id: `processlist-${connectionId}`,
    type: 'processlist',
    label: 'Process list',
    connectionId: connectionId,
  }
  useWorkspaceStore.setState((state) => insertProcessListTab(state, newTab))
}

export function tabOpenActions() {
  return {
    openTab,
    restoreTableDataTab,
    normalizeTableDataTabScopes,
    openQueryTab,
    openHistoryTab,
    openProcessListTab,
  }
}
