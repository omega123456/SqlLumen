import { useMemo, useState } from 'react'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { groupWorkspaceTabsByStack, isPinnedWorkspaceTab } from '../../../lib/workspace-tab-stacks'
import {
  EMPTY_TABS,
  isVisibleNonPinnedTab,
  pinnedTabIdOf,
  resolveShownStackKey,
  stackTabsFor,
  unpinnedStackKeyOf,
} from './workspace-tabs-model'

function useLastStackKey(activeStackKey: ReturnType<typeof unpinnedStackKeyOf>) {
  const [lastStackKey, setLastStackKey] = useState(activeStackKey)
  const hasActiveStackChanged = activeStackKey !== lastStackKey
  if (activeStackKey && hasActiveStackChanged) {
    setLastStackKey(activeStackKey)
  }
  return lastStackKey
}

export function useWorkspaceStacks(connectionId: string, hideTableDataTabs: boolean) {
  const tabs = useWorkspaceStore((state) => state.tabsByConnection[connectionId] ?? EMPTY_TABS)
  const activeTabId = useWorkspaceStore(
    (state) => state.activeTabByConnection[connectionId] ?? null
  )
  const visibleNonPinnedTabs = tabs.filter((tab) => isVisibleNonPinnedTab(tab, hideTableDataTabs))
  const stackGroups = useMemo(
    () =>
      groupWorkspaceTabsByStack(visibleNonPinnedTabs, {
        hideScopedTableDataTabs: hideTableDataTabs,
      }),
    [hideTableDataTabs, visibleNonPinnedTabs]
  )
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null
  const activeStackKey = unpinnedStackKeyOf(activeTab, {
    hideScopedTableDataTabs: hideTableDataTabs,
  })
  const lastStackKey = useLastStackKey(activeStackKey)
  const shownStackKey = resolveShownStackKey({
    activeStackKey: activeStackKey,
    lastStackKey: lastStackKey,
    stackGroups: stackGroups,
  })
  const allMovableTabIds = useMemo(
    () => tabs.filter((tab) => !isPinnedWorkspaceTab(tab)).map((tab) => tab.id),
    [tabs]
  )
  return {
    activeTabId: activeTabId,
    visibleNonPinnedTabs: visibleNonPinnedTabs,
    pinnedTabs: tabs.filter(isPinnedWorkspaceTab),
    stackGroups: stackGroups,
    activePinnedTabId: pinnedTabIdOf(activeTab),
    shownStackKey: shownStackKey,
    shownStackTabs: stackTabsFor(stackGroups, shownStackKey),
    allMovableTabIds: allMovableTabIds,
  }
}

export type WorkspaceStacks = ReturnType<typeof useWorkspaceStacks>
