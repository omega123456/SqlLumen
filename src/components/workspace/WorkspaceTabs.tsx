import type { WorkspaceTab } from '../../types/schema'
import { useWorkspaceStore } from '../../stores/workspace-store'
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

  if (tabs.length === 0) return null

  return (
    <div className={styles.tabBar} data-testid="workspace-tabs">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId
        return (
          <div
            key={tab.id}
            className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
            data-testid={`workspace-tab-${tab.id}`}
          >
            <button
              type="button"
              className={styles.tabButton}
              onClick={() => setActiveTab(connectionId, tab.id)}
            >
              <span className={styles.tabLabel}>{tab.label}</span>
            </button>
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
          </div>
        )
      })}
    </div>
  )
}
