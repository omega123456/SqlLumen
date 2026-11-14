import { useRef, type ReactNode, type RefObject } from 'react'
import { PlusIcon } from '@phosphor-icons/react'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { IconButton } from '../common/IconButton'
import { UnderlineTabBar } from '../common/UnderlineTabs'
import { WorkspaceTabRail } from './WorkspaceTabRail'
import { WorkspaceGroupRail } from './WorkspaceGroupRail'
import styles from './WorkspaceTabs.module.css'
import { useRevealActiveWorkspaceTab } from './workspace-tabs/use-reveal-active-workspace-tab'
import { useStackActivation } from './workspace-tabs/use-stack-activation'
import { useWorkspaceStacks, type WorkspaceStacks } from './workspace-tabs/use-workspace-stacks'

const GROUP_RAIL_TAB_STOP_SELECTOR = '[data-testid="workspace-group-rail"] [tabindex="0"]'

export interface WorkspaceTabsProps {
  connectionId: string
  hideTableDataTabs?: boolean
  connectionActive?: boolean
  onRequestRenameTab?: (tabId: string) => void
  onRequestMoveTab?: (tabId: string, direction: 'left' | 'right') => void
  onRequestReorderTab?: (tabId: string, insertIndex: number) => void
  children?: ReactNode
}

function NewQueryTabButton({ connectionId }: { connectionId: string }) {
  const openQueryTab = useWorkspaceStore((state) => state.openQueryTab)
  return (
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
  )
}

interface WorkspaceTabStripProps {
  props: WorkspaceTabsProps
  stacks: WorkspaceStacks
  workspaceRootRef: RefObject<HTMLDivElement | null>
  onFocusGroupRail: () => void
}

function WorkspaceTabStrip({
  props,
  stacks,
  workspaceRootRef,
  onFocusGroupRail,
}: WorkspaceTabStripProps) {
  const { connectionId, connectionActive = true } = props
  const memberRowRef = useRevealActiveWorkspaceTab({
    activeTabId: stacks.activeTabId,
    connectionActive: connectionActive,
    shownStackKey: stacks.shownStackKey,
  })
  return (
    <div
      ref={workspaceRootRef}
      className={styles.workspaceTabs}
      hidden={stacks.activePinnedTabId !== null}
      data-testid="workspace-tabs"
    >
      <UnderlineTabBar
        variant="document"
        className={styles.workspaceTabRailBleed}
        data-testid="workspace-tab-members"
        scrollable
        suffix={<NewQueryTabButton connectionId={connectionId} />}
      >
        <div ref={memberRowRef} className={styles.memberRow}>
          <WorkspaceTabRail
            connectionId={connectionId}
            tabs={stacks.shownStackTabs}
            allMovableTabIds={stacks.allMovableTabIds}
            activeTabId={stacks.activeTabId}
            autoScrollOnActive={connectionActive}
            onRequestRenameTab={props.onRequestRenameTab}
            onRequestMoveTab={props.onRequestMoveTab}
            onRequestReorderTab={props.onRequestReorderTab}
            onFocusGroupRail={onFocusGroupRail}
          />
        </div>
      </UnderlineTabBar>
    </div>
  )
}

export function WorkspaceTabs(props: WorkspaceTabsProps) {
  const { connectionId, hideTableDataTabs = false, children } = props
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const workspaceRootRef = useRef<HTMLDivElement | null>(null)
  const stacks = useWorkspaceStacks(connectionId, hideTableDataTabs)
  const { activateStack, focusStackMembers, requestActivateTab } = useStackActivation({
    connectionId: connectionId,
    hideTableDataTabs: hideTableDataTabs,
    stacks: stacks,
    workspaceRootRef: workspaceRootRef,
  })
  const focusGroupRail = () => {
    layoutRef.current?.querySelector<HTMLElement>(GROUP_RAIL_TAB_STOP_SELECTOR)?.focus()
  }

  return (
    <div ref={layoutRef} className={styles.workspaceLayout}>
      <WorkspaceGroupRail
        className={styles.groupRail}
        stackGroups={stacks.stackGroups}
        value={stacks.shownStackKey}
        onSelect={activateStack}
        onFocusMembers={focusStackMembers}
        pinnedTabs={stacks.pinnedTabs}
        activePinnedTabId={stacks.activePinnedTabId}
        onSelectPinned={requestActivateTab}
      />
      <WorkspaceTabStrip
        props={props}
        stacks={stacks}
        workspaceRootRef={workspaceRootRef}
        onFocusGroupRail={focusGroupRail}
      />
      {children ? <div className={styles.workspaceMain}>{children}</div> : null}
    </div>
  )
}
