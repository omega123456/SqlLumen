import type { WorkspaceTab } from '../../../types/schema'
import {
  getWorkspaceStackKeyForTab,
  isPinnedWorkspaceTab,
  type WorkspaceTabStackGroup,
  type WorkspaceTabStackKey,
  type WorkspaceTabStackResolutionOptions,
} from '../../../lib/workspace-tab-stacks'

export const EMPTY_TABS: WorkspaceTab[] = []

function isBottomPanelTableTab(tab: WorkspaceTab): boolean {
  return tab.type === 'table-data' && tab.parentQueryTabId !== undefined
}

export function isVisibleNonPinnedTab(tab: WorkspaceTab, hideTableDataTabs: boolean): boolean {
  if (isPinnedWorkspaceTab(tab)) return false
  if (!hideTableDataTabs) return true
  return !isBottomPanelTableTab(tab)
}

export function pinnedTabIdOf(activeTab: WorkspaceTab | null): string | null {
  if (!activeTab) return null
  if (!isPinnedWorkspaceTab(activeTab)) return null
  return activeTab.id
}

export function unpinnedStackKeyOf(
  activeTab: WorkspaceTab | null,
  options: WorkspaceTabStackResolutionOptions
): WorkspaceTabStackKey | null {
  if (!activeTab) return null
  if (isPinnedWorkspaceTab(activeTab)) return null
  return getWorkspaceStackKeyForTab(activeTab, options)
}

interface ShownStackInputs {
  activeStackKey: WorkspaceTabStackKey | null
  lastStackKey: WorkspaceTabStackKey | null
  stackGroups: WorkspaceTabStackGroup[]
}

export function resolveShownStackKey(inputs: ShownStackInputs): WorkspaceTabStackKey | null {
  const { activeStackKey, lastStackKey, stackGroups } = inputs
  if (activeStackKey) return activeStackKey
  const isLastStackStillShown = stackGroups.some((group) => group.key === lastStackKey)
  if (isLastStackStillShown && lastStackKey) return lastStackKey
  return stackGroups[0]?.key ?? null
}

export function stackTabsFor(
  stackGroups: WorkspaceTabStackGroup[],
  stackKey: WorkspaceTabStackKey | null
): WorkspaceTab[] {
  return stackGroups.find((group) => group.key === stackKey)?.tabs ?? EMPTY_TABS
}
