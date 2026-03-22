import type { WorkspaceTab } from '../../types/schema'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { UnderlineTabBar, UnderlineTab } from '../common/UnderlineTabs'
import styles from './WorkspaceTabs.module.css'

const EMPTY_TABS: WorkspaceTab[] = []

export interface WorkspaceTabsProps {
  connectionId: string
}

export function WorkspaceTabs({ connectionId }: WorkspaceTabsProps) {
  const tabs = useWorkspaceStore((state) => state.tabsByConnection[connectionId] ?? EMPTY_TABS)
  const activeTabId = useWorkspaceStore(
    (state) => state.activeTabByConnection[connectionId] ?? null
  )
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab)
  const closeTab = useWorkspaceStore((state) => state.closeTab)

  if (tabs.length === 0) {
    return null
  }

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
            <span className={styles.tabLabel}>{tab.label}</span>
          </UnderlineTab>
        )
      })}
    </UnderlineTabBar>
  )
}
