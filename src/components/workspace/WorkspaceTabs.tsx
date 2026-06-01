/**
 * WorkspaceTabs — top-rail placement wrapper.
 *
 * Owns:
 *   - Filtering tabs into pinned (history / processlist) vs. scrollable groups
 *   - Pinned tab rendering in the non-scrollable suffix area
 *   - The "new query tab" (+) button
 *   - Scroll-into-view when the active tab changes
 *
 * Delegates per-tab rendering, drag-reorder, context menu, rename, and
 * keyboard behavior to WorkspaceTabRail.
 */
import { useEffect, useMemo, useRef } from 'react'
import type { WorkspaceTab } from '../../types/schema'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { UnderlineTabBar } from '../common/UnderlineTabs'
import { WorkspaceTabRail } from './WorkspaceTabRail'
import { PlusIcon } from '@phosphor-icons/react'
import styles from './WorkspaceTabs.module.css'

const EMPTY_TABS: WorkspaceTab[] = []

export interface WorkspaceTabsProps {
  connectionId: string
  /**
   * When true, scoped table-data tabs are excluded from the top rail.
   * Standalone table-data tabs remain visible.
   */
  hideTableDataTabs?: boolean
  onRequestRenameTab?: (tabId: string) => void
  onRequestMoveTab?: (tabId: string, direction: 'left' | 'right') => void
  onRequestReorderTab?: (tabId: string, insertIndex: number) => void
}

export function WorkspaceTabs({
  connectionId,
  hideTableDataTabs = false,
  onRequestRenameTab,
  onRequestMoveTab,
  onRequestReorderTab,
}: WorkspaceTabsProps) {
  const tabs = useWorkspaceStore((state) => state.tabsByConnection[connectionId] ?? EMPTY_TABS)
  const activeTabId = useWorkspaceStore(
    (state) => state.activeTabByConnection[connectionId] ?? null
  )
  const openQueryTab = useWorkspaceStore((state) => state.openQueryTab)

  // Split into pinned (fixed suffix) and scrollable (delegated to rail).
  const scrollableTabs = tabs.filter(
    (t) =>
      t.type !== 'history' &&
      t.type !== 'processlist' &&
      !(hideTableDataTabs && t.type === 'table-data' && t.parentQueryTabId !== undefined)
  )
  const pinnedTabs = tabs.filter((t) => t.type === 'history' || t.type === 'processlist')

  // Full movable tab ID list — ALL non-pinned tabs regardless of hideTableDataTabs.
  // This must reflect the true full movable list in the workspace store so that
  // WorkspaceTabRail.translateSubsetInsertIndex can correctly map visible-group
  // reorder indices to full-list indices even when table-data tabs are hidden here.
  const allMovableTabIds = useMemo(
    () => tabs.filter((t) => t.type !== 'history' && t.type !== 'processlist').map((t) => t.id),
    [tabs]
  )

  // Scroll the active tab into view whenever it changes
  const activeTabIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (activeTabId === activeTabIdRef.current) {
      return
    }
    activeTabIdRef.current = activeTabId
    if (!activeTabId) {
      return
    }
    const tabEl = document.querySelector<HTMLElement>(
      `[data-testid="workspace-tab-${activeTabId}"]`
    )
    tabEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTabId])

  return (
    <UnderlineTabBar
      className={styles.workspaceTabRailBleed}
      data-testid="workspace-tabs"
      scrollable
      suffix={
        <>
          {/* Visual separator between the auto-scrolling rail and the fixed tab group */}
          <span className={styles.suffixDivider} aria-hidden="true" />
          {/* Pinned tabs rendered in the WorkspaceTabRail for event handling */}
          {/* pinned tabs are never reordered */}
          <WorkspaceTabRail
            connectionId={connectionId}
            tabs={pinnedTabs}
            allMovableTabIds={[]}
            activeTabId={activeTabId}
            onRequestRenameTab={onRequestRenameTab}
            onRequestMoveTab={onRequestMoveTab}
            onRequestReorderTab={onRequestReorderTab}
          />
          {/* Always-visible "+" button to create a new query tab */}
          <button
            type="button"
            className={styles.newTabButton}
            title="New Query Tab"
            aria-label="New Query Tab"
            onClick={() => openQueryTab(connectionId)}
            data-testid="new-query-tab-button"
          >
            <PlusIcon size={16} weight="bold" />
          </button>
        </>
      }
    >
      {/* Scrollable tabs — the main visible group */}
      <WorkspaceTabRail
        connectionId={connectionId}
        tabs={scrollableTabs}
        allMovableTabIds={allMovableTabIds}
        activeTabId={activeTabId}
        onRequestRenameTab={onRequestRenameTab}
        onRequestMoveTab={onRequestMoveTab}
        onRequestReorderTab={onRequestReorderTab}
      />
    </UnderlineTabBar>
  )
}
