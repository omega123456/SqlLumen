/**
 * WorkspaceTabs — top-rail placement wrapper.
 *
 * Owns:
 *   - Filtering tabs into pinned (history / processlist) vs. scrollable groups
 *   - Pinned tab rendering in the non-scrollable suffix area
 *   - The "new query tab" (+) button
 *   - Scroll-into-view when the active tab changes (only while its connection
 *     workspace is the globally visible one)
 *
 * Delegates per-tab rendering, drag-reorder, context menu, rename, and
 * keyboard behavior to WorkspaceTabRail.
 */
import { useEffect, useMemo, useRef } from 'react'
import type { WorkspaceTab } from '../../types/schema'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { UnderlineTabBar } from '../common/UnderlineTabs'
import { WorkspaceTabRail } from './WorkspaceTabRail'
import {
  getWorkspaceStackActivationTarget,
  getWorkspaceStackKeyForTab,
  groupWorkspaceTabsByStack,
  isPinnedWorkspaceTab,
  type WorkspaceTabStackKey,
} from '../../lib/workspace-tab-stacks'
import { WorkspaceStackRail } from './WorkspaceStackRail'
import styles from './WorkspaceTabs.module.css'

const EMPTY_TABS: WorkspaceTab[] = []
const EMPTY_STACK_RECENCY = {}

export interface WorkspaceTabsProps {
  connectionId: string
  /**
   * When true, scoped table-data tabs are excluded from the top rail.
   * Standalone table-data tabs remain visible.
   */
  hideTableDataTabs?: boolean
  /**
   * Whether this tab rail's connection workspace is the globally visible one.
   * When false, visible-only side effects (scroll-into-view on the active tab,
   * focus stealing) are suppressed because the rail is rendered inside a hidden,
   * inert connection root.
   */
  connectionActive?: boolean
  onRequestRenameTab?: (tabId: string) => void
  onRequestMoveTab?: (tabId: string, direction: 'left' | 'right') => void
  onRequestReorderTab?: (tabId: string, insertIndex: number) => void
}

export function WorkspaceTabs({
  connectionId,
  hideTableDataTabs = false,
  connectionActive = true,
  onRequestRenameTab,
  onRequestMoveTab,
  onRequestReorderTab,
}: WorkspaceTabsProps) {
  const workspaceRootRef = useRef<HTMLDivElement | null>(null)
  const tabs = useWorkspaceStore((state) => state.tabsByConnection[connectionId] ?? EMPTY_TABS)
  const activeTabId = useWorkspaceStore(
    (state) => state.activeTabByConnection[connectionId] ?? null
  )
  const openQueryTab = useWorkspaceStore((state) => state.openQueryTab)
  const requestActivateTab = useWorkspaceStore((state) => state.requestActivateTab)
  const stackRecency = useWorkspaceStore(
    (state) => state.stackRecencyByConnection[connectionId] ?? EMPTY_STACK_RECENCY
  )

  const visibleNonPinnedTabs = tabs.filter(
    (t) =>
      !isPinnedWorkspaceTab(t) &&
      !(hideTableDataTabs && t.type === 'table-data' && t.parentQueryTabId !== undefined)
  )
  const pinnedTabs = tabs.filter(isPinnedWorkspaceTab)
  const stackGroups = useMemo(
    () =>
      groupWorkspaceTabsByStack(visibleNonPinnedTabs, {
        hideScopedTableDataTabs: hideTableDataTabs,
      }),
    [hideTableDataTabs, visibleNonPinnedTabs]
  )
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null
  const activeStackKey =
    activeTab && !isPinnedWorkspaceTab(activeTab)
      ? getWorkspaceStackKeyForTab(activeTab, {
          hideScopedTableDataTabs: hideTableDataTabs,
        })
      : null
  const activeStackTabs =
    stackGroups.find((group) => group.key === activeStackKey)?.tabs ?? EMPTY_TABS

  const allMovableTabIds = useMemo(
    () => tabs.filter((t) => t.type !== 'history' && t.type !== 'processlist').map((t) => t.id),
    [tabs]
  )

  const memberRowRef = useRef<HTMLDivElement | null>(null)
  const activeTabIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (activeTabId === activeTabIdRef.current) {
      return
    }
    if (!activeTabId) {
      activeTabIdRef.current = activeTabId
      return
    }
    // Suppress visible-only scroll-into-view while this connection workspace is
    // hidden and inert. Defer advancing the ref so the scroll fires when the
    // connection becomes visible again.
    if (!connectionActive) {
      return
    }
    activeTabIdRef.current = activeTabId
    const tabEl = memberRowRef.current?.querySelector<HTMLElement>(
      `[data-testid="workspace-tab-${activeTabId}"]`
    )
    tabEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTabId, connectionActive, activeStackKey])

  const activateStack = (stackKey: ReturnType<typeof getWorkspaceStackKeyForTab>) => {
    if (!stackKey) {
      return
    }

    const target = getWorkspaceStackActivationTarget(
      stackKey,
      visibleNonPinnedTabs,
      stackRecency[stackKey] ?? null,
      {
        hideScopedTableDataTabs: hideTableDataTabs,
      }
    )
    if (!target) {
      return
    }
    requestActivateTab(target.id)
  }

  const focusStackMembers = (stackKey: WorkspaceTabStackKey) => {
    const targetStackTabs = stackGroups.find((group) => group.key === stackKey)?.tabs ?? EMPTY_TABS
    const targetTabId =
      getWorkspaceStackActivationTarget(
        stackKey,
        visibleNonPinnedTabs,
        stackRecency[stackKey] ?? null,
        {
          hideScopedTableDataTabs: hideTableDataTabs,
        }
      )?.id ?? targetStackTabs[0]?.id

    if (!targetTabId) {
      return
    }

    if (activeTabId !== targetTabId) {
      requestActivateTab(targetTabId)
    }

    requestAnimationFrame(() => {
      const tabEl = workspaceRootRef.current?.querySelector<HTMLElement>(
        `[data-testid="workspace-tab-${targetTabId}"]`
      )
      const labelButton = tabEl?.querySelector<HTMLElement>('[role="button"],button')
      ;(labelButton ?? tabEl)?.focus()
    })
  }

  const focusOwningStackChip = () => {
    if (!activeStackKey) {
      return
    }

    const stackChip = workspaceRootRef.current?.querySelector<HTMLElement>(
      `[data-testid="workspace-stack-chip-${activeStackKey}"]`
    )
    const labelButton = stackChip?.querySelector<HTMLElement>('[role="button"],button')
    ;(labelButton ?? stackChip)?.focus()
  }

  return (
    <div ref={workspaceRootRef} className={styles.workspaceTabs} data-testid="workspace-tabs-root">
      <WorkspaceStackRail
        stackGroups={stackGroups}
        activeStackKey={activeStackKey}
        pinnedTabs={pinnedTabs}
        activeTabId={activeTabId}
        connectionActive={connectionActive}
        onActivateStack={activateStack}
        onActivatePinnedTab={requestActivateTab}
        onOpenQueryTab={() => openQueryTab(connectionId)}
        onFocusStackMembers={focusStackMembers}
      />
      {activeStackKey ? (
        <UnderlineTabBar
          className={styles.workspaceTabRailBleed}
          data-testid="workspace-tab-members"
          scrollable
        >
          <div ref={memberRowRef} className={styles.memberRow}>
            <WorkspaceTabRail
              connectionId={connectionId}
              tabs={activeStackTabs}
              allMovableTabIds={allMovableTabIds}
              activeTabId={activeTabId}
              autoScrollOnActive={connectionActive}
              onRequestRenameTab={onRequestRenameTab}
              onRequestMoveTab={onRequestMoveTab}
              onRequestReorderTab={onRequestReorderTab}
              onFocusOwningStackChip={focusOwningStackChip}
            />
          </div>
        </UnderlineTabBar>
      ) : null}
    </div>
  )
}
