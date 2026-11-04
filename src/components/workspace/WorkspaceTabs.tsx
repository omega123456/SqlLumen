/**
 * WorkspaceTabs — the group rail at the workspace's left edge, the document strip with the shown
 * group's tabs and the "new query tab" button, and (as children) the workspace body under the strip.
 *
 * Owns:
 *   - Filtering tabs into pinned (history / processlist) vs. scrollable groups
 *   - The group rail beside the strip and the body, with the pinned tabs at its bottom
 *   - The "new query tab" (+) button in the non-scrollable suffix
 *   - Hiding the strip while a pinned tab is selected, so its body gets the full height
 *   - Scroll-into-view when the active tab changes (only while its connection
 *     workspace is the globally visible one)
 *
 * Delegates per-tab rendering, drag-reorder, context menu, rename, and
 * keyboard behavior to WorkspaceTabRail.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PlusIcon } from '@phosphor-icons/react'
import type { WorkspaceTab } from '../../types/schema'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { IconButton } from '../common/IconButton'
import { UnderlineTabBar } from '../common/UnderlineTabs'
import { WorkspaceTabRail } from './WorkspaceTabRail'
import {
  getWorkspaceStackActivationTarget,
  getWorkspaceStackKeyForTab,
  groupWorkspaceTabsByStack,
  isPinnedWorkspaceTab,
  type WorkspaceTabStackKey,
} from '../../lib/workspace-tab-stacks'
import { WorkspaceGroupRail } from './WorkspaceGroupRail'
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
  /** The workspace body, laid out under the strip and beside the rail. */
  children?: ReactNode
}

export function WorkspaceTabs({
  connectionId,
  hideTableDataTabs = false,
  connectionActive = true,
  onRequestRenameTab,
  onRequestMoveTab,
  onRequestReorderTab,
  children,
}: WorkspaceTabsProps) {
  const layoutRef = useRef<HTMLDivElement | null>(null)
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
  const activePinnedTabId = activeTab && isPinnedWorkspaceTab(activeTab) ? activeTab.id : null
  const activeStackKey =
    activeTab && !activePinnedTabId
      ? getWorkspaceStackKeyForTab(activeTab, {
          hideScopedTableDataTabs: hideTableDataTabs,
        })
      : null
  // While a pinned tab is selected, remember the last group so the rail can hand focus back to it.
  const [lastStackKey, setLastStackKey] = useState(activeStackKey)
  if (activeStackKey && activeStackKey !== lastStackKey) {
    setLastStackKey(activeStackKey)
  }
  const shownStackKey =
    activeStackKey ??
    (stackGroups.some((group) => group.key === lastStackKey) ? lastStackKey : null) ??
    stackGroups[0]?.key ??
    null
  const shownStackTabs =
    stackGroups.find((group) => group.key === shownStackKey)?.tabs ?? EMPTY_TABS

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
  }, [activeTabId, connectionActive, shownStackKey])

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

  const focusGroupRail = () => {
    layoutRef.current
      ?.querySelector<HTMLElement>('[data-testid="workspace-group-rail"] [tabindex="0"]')
      ?.focus()
  }

  return (
    <div ref={layoutRef} className={styles.workspaceLayout}>
      <WorkspaceGroupRail
        className={styles.groupRail}
        stackGroups={stackGroups}
        value={shownStackKey}
        onSelect={activateStack}
        onFocusMembers={focusStackMembers}
        pinnedTabs={pinnedTabs}
        activePinnedTabId={activePinnedTabId}
        onSelectPinned={requestActivateTab}
      />
      <div
        ref={workspaceRootRef}
        className={styles.workspaceTabs}
        hidden={activePinnedTabId !== null}
        data-testid="workspace-tabs"
      >
        <UnderlineTabBar
          variant="document"
          className={styles.workspaceTabRailBleed}
          data-testid="workspace-tab-members"
          scrollable
          suffix={
            <div className={styles.rowActions}>
              <IconButton
                size="lg"
                title="New query tab"
                aria-label="New query tab"
                onClick={() => openQueryTab(connectionId)}
                data-testid="new-query-tab-button"
              >
                <PlusIcon size={16} weight="regular" />
              </IconButton>
            </div>
          }
        >
          <div ref={memberRowRef} className={styles.memberRow}>
            <WorkspaceTabRail
              connectionId={connectionId}
              tabs={shownStackTabs}
              allMovableTabIds={allMovableTabIds}
              activeTabId={activeTabId}
              autoScrollOnActive={connectionActive}
              onRequestRenameTab={onRequestRenameTab}
              onRequestMoveTab={onRequestMoveTab}
              onRequestReorderTab={onRequestReorderTab}
              onFocusGroupRail={focusGroupRail}
            />
          </div>
        </UnderlineTabBar>
      </div>
      {children ? <div className={styles.workspaceMain}>{children}</div> : null}
    </div>
  )
}
