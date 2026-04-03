import type { WorkspaceTab } from '../../types/schema'
import { useTableDesignerStore } from '../../stores/table-designer-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { UnderlineTabBar, UnderlineTab } from '../common/UnderlineTabs'
import { Plus } from '@phosphor-icons/react'
import styles from './WorkspaceTabs.module.css'

const EMPTY_TABS: WorkspaceTab[] = []

export interface WorkspaceTabsProps {
  connectionId: string
}

function WorkspaceTabLabel({ tab }: { tab: WorkspaceTab }) {
  const isDirty = useTableDesignerStore((state) =>
    tab.type === 'table-designer' ? (state.tabs[tab.id]?.isDirty ?? false) : false
  )

  return (
    <span className={styles.tabLabel}>
      {tab.label}
      {isDirty && <span className={styles.dirtyIndicator}> ●</span>}
    </span>
  )
}

export function WorkspaceTabs({ connectionId }: WorkspaceTabsProps) {
  const tabs = useWorkspaceStore((state) => state.tabsByConnection[connectionId] ?? EMPTY_TABS)
  const activeTabId = useWorkspaceStore(
    (state) => state.activeTabByConnection[connectionId] ?? null
  )
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab)
  const closeTab = useWorkspaceStore((state) => state.closeTab)
  const openQueryTab = useWorkspaceStore((state) => state.openQueryTab)

  return (
    <UnderlineTabBar className={styles.workspaceTabRailBleed} data-testid="workspace-tabs">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId
        return (
          <UnderlineTab
            key={tab.id}
            active={isActive}
            className={styles.workspaceTab}
            data-testid={`workspace-tab-${tab.id}`}
            onSelect={() => setActiveTab(connectionId, tab.id)}
            suffix={
              <button
                type="button"
                className={styles.tabClose}
                aria-label={`Close ${tab.label}`}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(connectionId, tab.id)
                }}
              >
                ×
              </button>
            }
          >
            <WorkspaceTabLabel tab={tab} />
          </UnderlineTab>
        )
      })}
      {/* Always-visible "+" button to create a new query tab */}
      <button
        type="button"
        className={styles.newTabButton}
        title="New Query Tab"
        aria-label="New Query Tab"
        onClick={() => openQueryTab(connectionId)}
        data-testid="new-query-tab-button"
      >
        <Plus size={16} weight="bold" />
      </button>
    </UnderlineTabBar>
  )
}
