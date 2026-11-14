import { useEffect, useMemo, useRef, type PointerEvent } from 'react'
import type { WorkspaceTab } from '../../types/schema'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { TabContextMenu } from '../shared/TabContextMenu'
import { usePointerTabDrag } from '../shared/use-pointer-tab-drag'
import { isPinnedWorkspaceTab } from '../../lib/workspace-tab-stacks'
import styles from './WorkspaceTabs.module.css'
import {
  WORKSPACE_TAB_TEST_ID_PREFIX,
  focusWorkspaceTab,
  translateSubsetInsertIndex,
  type TabIdLists,
} from './workspace-tab-rail/tab-rail-model'
import { useTabContextMenu } from './workspace-tab-rail/use-tab-context-menu'
import { useTabRename } from './workspace-tab-rail/use-tab-rename'
import { WorkspaceRailTab, type RailTabHandlers } from './workspace-tab-rail/WorkspaceRailTab'

export interface WorkspaceTabRailProps {
  connectionId: string
  tabs: WorkspaceTab[]
  allMovableTabIds: string[]
  activeTabId: string | null
  autoScrollOnActive?: boolean
  onRequestRenameTab?: (tabId: string) => void
  onRequestMoveTab?: (tabId: string, direction: 'left' | 'right') => void
  onRequestReorderTab?: (tabId: string, insertIndex: number) => void
  onFocusGroupRail?: () => void
}

function useRailFocusRestore(activeTabId: string | null) {
  const railRef = useRef<HTMLDivElement | null>(null)
  const activeTabIdRef = useRef<string | null>(activeTabId)
  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])
  const restoreFocusAfterAction = (invokerTabId: string | null) => {
    const hasFocusedInvoker = invokerTabId
      ? focusWorkspaceTab(railRef.current, invokerTabId)
      : false
    if (hasFocusedInvoker) return
    if (activeTabIdRef.current) focusWorkspaceTab(railRef.current, activeTabIdRef.current)
  }
  return { railRef, restoreFocusAfterAction }
}

function useTabReorder(props: WorkspaceTabRailProps, tabIdLists: TabIdLists) {
  const reorderWorkspaceTab = useWorkspaceStore((state) => state.reorderWorkspaceTab)
  const { connectionId, onRequestReorderTab } = props
  const commitTabReorder = (tabId: string, visibleInsertIndex: number) => {
    const fullInsertIndex = translateSubsetInsertIndex(tabIdLists, visibleInsertIndex)
    if (onRequestReorderTab) {
      onRequestReorderTab(tabId, fullInsertIndex)
      return
    }
    reorderWorkspaceTab(connectionId, tabId, fullInsertIndex)
  }
  const drag = usePointerTabDrag({
    tabIds: tabIdLists.visibleTabIds,
    tabTestIdPrefix: WORKSPACE_TAB_TEST_ID_PREFIX,
    onReorder: commitTabReorder,
  })
  return { commitTabReorder, drag }
}

function useRailTabHandlers(
  props: WorkspaceTabRailProps,
  drag: ReturnType<typeof useTabReorder>['drag'],
  openTabContextMenu: RailTabHandlers['onOpenContextMenu']
): RailTabHandlers {
  const requestActivateTab = useWorkspaceStore((state) => state.requestActivateTab)
  const closeTab = useWorkspaceStore((state) => state.closeTab)
  return {
    onActivate: (tabId) => {
      if (drag.isSelectSuppressed()) return
      requestActivateTab(tabId)
    },
    onPointerDown: (tab: WorkspaceTab, event: PointerEvent<HTMLElement>) => {
      if (isPinnedWorkspaceTab(tab)) return
      drag.startPointerDrag(tab.id, event)
    },
    onOpenContextMenu: openTabContextMenu,
    onClose: (tabId) => closeTab(props.connectionId, tabId),
    onFocusGroupRail: props.onFocusGroupRail,
  }
}

export function WorkspaceTabRail(props: WorkspaceTabRailProps) {
  const { connectionId, tabs, allMovableTabIds, activeTabId, autoScrollOnActive = true } = props
  const visibleTabIds = useMemo(() => tabs.map((tab: WorkspaceTab) => tab.id), [tabs])
  const tabIdLists: TabIdLists = {
    visibleTabIds: visibleTabIds,
    allMovableTabIds: allMovableTabIds,
  }
  const { railRef, restoreFocusAfterAction } = useRailFocusRestore(activeTabId)
  const { commitTabReorder, drag } = useTabReorder(props, tabIdLists)
  const { rename, renameInputRef } = useTabRename({
    connectionId: connectionId,
    tabs: tabs,
    onRequestRenameTab: props.onRequestRenameTab,
    restoreFocusAfterAction: restoreFocusAfterAction,
  })
  const menu = useTabContextMenu({
    connectionId: connectionId,
    tabs: tabs,
    tabIdLists: tabIdLists,
    startRename: rename.startRename,
    commitTabReorder: commitTabReorder,
    onRequestMoveTab: props.onRequestMoveTab,
  })
  const handlers = useRailTabHandlers(props, drag, menu.openTabContextMenu)
  const { contextMenu } = menu

  return (
    <div ref={railRef} className={styles.workspaceTabRailGroup}>
      {tabs.map((tab) => (
        <WorkspaceRailTab
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          autoScrollOnActive={autoScrollOnActive}
          isDragSource={drag.draggingTabId === tab.id}
          dropIndicator={drag.dropIndicatorFor(tab.id)}
          rename={rename}
          renameInputRef={renameInputRef}
          handlers={handlers}
        />
      ))}
      {contextMenu && (
        <TabContextMenu
          visible
          x={contextMenu.x}
          y={contextMenu.y}
          portalRoot={contextMenu.portalRoot}
          items={menu.buildContextMenuItems(contextMenu)}
          onClose={() => {
            menu.closeContextMenu()
            restoreFocusAfterAction(contextMenu.invokerTabId)
          }}
        />
      )}
    </div>
  )
}
