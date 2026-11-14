import { useState } from 'react'
import type { WorkspaceTab } from '../../../types/schema'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { useShortcutStore } from '../../../stores/shortcut-store'
import type { TabContextMenuItem } from '../../shared/TabContextMenu'
import { dispatchDismissAll } from '../../../lib/context-menu-events'
import { getContextMenuPortalRoot } from '../../../lib/context-menu-utils'
import type { ContextMenuOpenPoint } from '../../../lib/context-menu-utils'
import { buildTabMenuItems, type TabMenuTarget } from './tab-menu-items'
import {
  VISIBLE_SLOT_OFFSET_FOR_DIRECTION,
  findTabById,
  revealShortcutLabel,
  translateSubsetInsertIndex,
  type TabIdLists,
} from './tab-rail-model'

export interface TabContextMenuState {
  tabId: string
  x: number
  y: number
  portalRoot: HTMLElement
  invokerTabId: string
}

interface TabContextMenuInputs {
  connectionId: string
  tabs: WorkspaceTab[]
  tabIdLists: TabIdLists
  startRename: (tabId: string) => void
  commitTabReorder: (tabId: string, visibleInsertIndex: number) => void
  onRequestMoveTab?: (tabId: string, direction: 'left' | 'right') => void
}

export function useTabContextMenu(inputs: TabContextMenuInputs) {
  const { connectionId, tabs, tabIdLists, startRename, commitTabReorder, onRequestMoveTab } = inputs
  const closeTab = useWorkspaceStore((state) => state.closeTab)
  const reorderWorkspaceTab = useWorkspaceStore((state) => state.reorderWorkspaceTab)
  const revealBinding = useShortcutStore(
    (state) => state.shortcuts['reveal-in-object-browser'] ?? null
  )
  const [contextMenu, setContextMenu] = useState<TabContextMenuState | null>(null)

  const openTabContextMenu = (tabId: string, { x, y, anchor }: ContextMenuOpenPoint) => {
    dispatchDismissAll()
    setContextMenu({
      tabId: tabId,
      x: x,
      y: y,
      portalRoot: getContextMenuPortalRoot(anchor),
      invokerTabId: tabId,
    })
  }

  const moveOneSlot = (tabId: string, visibleIndex: number, direction: 'left' | 'right') => {
    if (onRequestMoveTab) {
      onRequestMoveTab(tabId, direction)
      return
    }
    const visibleInsertIndex = visibleIndex + VISIBLE_SLOT_OFFSET_FOR_DIRECTION[direction]
    const fullInsert = translateSubsetInsertIndex(tabIdLists, visibleInsertIndex)
    reorderWorkspaceTab(connectionId, tabId, fullInsert)
  }

  const buildContextMenuItems = (menu: TabContextMenuState): TabContextMenuItem[] => {
    const { visibleTabIds } = tabIdLists
    const visibleIndex = visibleTabIds.indexOf(menu.tabId)
    const target: TabMenuTarget = {
      tab: findTabById(tabs, menu.tabId),
      visibleIndex: visibleIndex,
      visibleTabIds: visibleTabIds,
      revealShortcut: revealShortcutLabel(revealBinding),
    }
    return buildTabMenuItems(target, {
      rename: () => startRename(menu.tabId),
      moveToVisibleSlot: (visibleInsertIndex) => commitTabReorder(menu.tabId, visibleInsertIndex),
      moveOneSlot: (direction) => moveOneSlot(menu.tabId, visibleIndex, direction),
      closeTabs: (tabIds) => tabIds.forEach((id) => closeTab(connectionId, id)),
    })
  }

  return {
    contextMenu: contextMenu,
    closeContextMenu: () => setContextMenu(null),
    openTabContextMenu: openTabContextMenu,
    buildContextMenuItems: buildContextMenuItems,
  }
}
