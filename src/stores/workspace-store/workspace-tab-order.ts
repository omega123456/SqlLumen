import type { TableDataTab, WorkspaceTab } from '../../types/schema'
import { isPinnedWorkspaceTab, isScopedTableDataTab } from '../../lib/workspace-tab-stacks'
import { clampedInsertIndex, movedToInsertIndex } from '../../lib/list-reorder'
import { isTableTabsInBottomPanelEnabled } from './workspace-tab-lists'

export interface TabMove {
  tabId: string
  insertIndex: number
}

interface MovableTabsMove {
  movableTabs: WorkspaceTab[]
  sourceTab: WorkspaceTab
  sourceIndex: number
  clampedInsertIndex: number
}

function getMovableTabGroupId(tab: WorkspaceTab): string {
  if (isScopedTableDataTab(tab)) return tab.parentQueryTabId
  return tab.id
}

function scopedChildrenByQueryId(movableTabs: WorkspaceTab[]): Record<string, TableDataTab[]> {
  const childrenByQueryId: Record<string, TableDataTab[]> = {}
  for (const tab of movableTabs) {
    if (!isScopedTableDataTab(tab)) continue
    childrenByQueryId[tab.parentQueryTabId] ??= []
    childrenByQueryId[tab.parentQueryTabId].push(tab)
  }
  return childrenByQueryId
}

function groupQueryTabsWithScopedChildren(movableTabs: WorkspaceTab[]): WorkspaceTab[][] {
  const childrenByQueryId = scopedChildrenByQueryId(movableTabs)
  return movableTabs.flatMap<WorkspaceTab[]>((tab) => {
    if (isScopedTableDataTab(tab)) return []
    if (tab.type === 'query-editor') return [[tab, ...(childrenByQueryId[tab.id] ?? [])]]
    return [[tab]]
  })
}

function groupCountBefore(movableTabs: WorkspaceTab[], insertIndex: number): number {
  const seenGroupIds = new Set<string>()
  for (const tab of movableTabs.slice(0, insertIndex)) {
    seenGroupIds.add(getMovableTabGroupId(tab))
  }
  return seenGroupIds.size
}

function movedQueryGroup(move: MovableTabsMove): WorkspaceTab[] | null {
  const groups = groupQueryTabsWithScopedChildren(move.movableTabs)
  const sourceGroupIndex = groups.findIndex((group) => group[0]?.id === move.sourceTab.id)
  if (sourceGroupIndex < 0) return null
  const insertGroupIndex = groupCountBefore(move.movableTabs, move.clampedInsertIndex)
  const groupMove = { sourceIndex: sourceGroupIndex, insertIndex: insertGroupIndex }
  return movedToInsertIndex(groups, groupMove).flat()
}

function isQueryGroupMove(sourceTab: WorkspaceTab): boolean {
  return isTableTabsInBottomPanelEnabled() && sourceTab.type === 'query-editor'
}

function reorderedMovableTabs(move: MovableTabsMove): WorkspaceTab[] | null {
  if (isQueryGroupMove(move.sourceTab)) return movedQueryGroup(move)
  return movedToInsertIndex(move.movableTabs, {
    sourceIndex: move.sourceIndex,
    insertIndex: move.clampedInsertIndex,
  })
}

export function tabsWithTabMoved(tabs: WorkspaceTab[], { tabId, insertIndex }: TabMove) {
  const sourceTab = tabs.find((tab) => tab.id === tabId)
  if (!sourceTab) return tabs
  if (isPinnedWorkspaceTab(sourceTab)) return tabs

  const pinnedTabs = tabs.filter(isPinnedWorkspaceTab)
  const movableTabs = tabs.filter((tab) => !isPinnedWorkspaceTab(tab))
  const sourceIndex = movableTabs.findIndex((tab) => tab.id === tabId)
  if (sourceIndex < 0) return tabs

  const reordered = reorderedMovableTabs({
    movableTabs: movableTabs,
    sourceTab: sourceTab,
    sourceIndex: sourceIndex,
    clampedInsertIndex: clampedInsertIndex(insertIndex, movableTabs.length),
  })
  if (!reordered) return tabs
  return [...pinnedTabs, ...reordered]
}
