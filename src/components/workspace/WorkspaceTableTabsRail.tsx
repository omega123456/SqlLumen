/**
 * WorkspaceTableTabsRail
 *
 * Compact bottom rail that shows only table-data workspace tabs for the active
 * connection. Renders null when there are no table-data tabs.
 *
 * Used by WorkspaceArea when the "results.tableTabsInBottomPanel" setting is
 * enabled. Tab activation, close, reorder, and keyboard behavior are delegated
 * to WorkspaceTabRail (from Phase 2).
 */
import { useMemo } from 'react'
import type { WorkspaceTab } from '../../types/schema'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { UnderlineTabBar } from '../common/UnderlineTabs'
import { WorkspaceTabRail } from './WorkspaceTabRail'
import styles from './WorkspaceTableTabsRail.module.css'

const EMPTY_TABS: WorkspaceTab[] = []

export interface WorkspaceTableTabsRailProps {
  connectionId: string
}

export function WorkspaceTableTabsRail({ connectionId }: WorkspaceTableTabsRailProps) {
  const allTabs = useWorkspaceStore((state) => state.tabsByConnection[connectionId] ?? EMPTY_TABS)
  const activeTabId = useWorkspaceStore(
    (state) => state.activeTabByConnection[connectionId] ?? null
  )

  // Only table-data tabs are shown in the bottom rail
  const tableDataTabs = useMemo(() => allTabs.filter((t) => t.type === 'table-data'), [allTabs])

  // Full movable tab ID list (non-pinned) — used for safe subset reorder translation
  const allMovableTabIds = useMemo(
    () => allTabs.filter((t) => t.type !== 'history' && t.type !== 'processlist').map((t) => t.id),
    [allTabs]
  )

  // Hide when there are no table-data tabs
  if (tableDataTabs.length === 0) {
    return null
  }

  return (
    <div
      className={styles.bottomRail}
      data-testid="bottom-table-tabs"
      aria-label="Table data tabs"
    >
      <UnderlineTabBar scrollable className={styles.tabBar}>
        <WorkspaceTabRail
          connectionId={connectionId}
          tabs={tableDataTabs}
          allMovableTabIds={allMovableTabIds}
          activeTabId={activeTabId}
        />
      </UnderlineTabBar>
    </div>
  )
}
