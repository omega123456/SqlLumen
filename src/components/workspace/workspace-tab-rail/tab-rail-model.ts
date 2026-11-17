import type { WorkspaceTab } from '../../../types/schema'

export const MOVE_ONE_SLOT_RIGHT_INSERT_OFFSET = 2
export const WORKSPACE_TAB_TEST_ID_PREFIX = 'workspace-tab-'
const NOT_FOUND = -1

export interface TabIdLists {
  visibleTabIds: string[]
  allMovableTabIds: string[]
}

function fullIndexOr(allMovableTabIds: string[], tabId: string | undefined, fallback: number) {
  if (!tabId) return fallback
  const fullIndex = allMovableTabIds.indexOf(tabId)
  return fullIndex === NOT_FOUND ? fallback : fullIndex
}

export function translateSubsetInsertIndex(
  tabIdLists: TabIdLists,
  subsetInsertIndex: number
): number {
  const { visibleTabIds, allMovableTabIds } = tabIdLists
  if (visibleTabIds.length === allMovableTabIds.length) return subsetInsertIndex
  if (subsetInsertIndex <= 0) return fullIndexOr(allMovableTabIds, visibleTabIds[0], 0)
  if (subsetInsertIndex >= visibleTabIds.length) {
    const lastVisibleId = visibleTabIds[visibleTabIds.length - 1]
    const lastFullIndex = fullIndexOr(allMovableTabIds, lastVisibleId, NOT_FOUND)
    return lastFullIndex === NOT_FOUND ? allMovableTabIds.length : lastFullIndex + 1
  }
  return fullIndexOr(allMovableTabIds, visibleTabIds[subsetInsertIndex], subsetInsertIndex)
}

export function findTabById(tabs: WorkspaceTab[], tabId: string): WorkspaceTab | null {
  return tabs.find((tab) => tab.id === tabId) ?? null
}

export const VISIBLE_SLOT_OFFSET_FOR_DIRECTION: Record<'left' | 'right', number> = {
  left: -1,
  right: MOVE_ONE_SLOT_RIGHT_INSERT_OFFSET,
}

export function focusWorkspaceTab(rail: HTMLElement | null, tabId: string): boolean {
  const tabElement = rail?.querySelector<HTMLElement>(
    `[data-testid="${WORKSPACE_TAB_TEST_ID_PREFIX}${tabId}"]`
  )
  if (!tabElement) return false
  const labelButton = tabElement.querySelector<HTMLElement>('[role="button"],button')
  const focusTarget = labelButton ?? tabElement
  focusTarget.focus()
  return true
}
