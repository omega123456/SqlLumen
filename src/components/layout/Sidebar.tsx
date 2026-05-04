import { useCallback, useState } from 'react'
import { useConnectionStore } from '../../stores/connection-store'
import { ObjectBrowser } from '../object-browser/ObjectBrowser'
import styles from './Sidebar.module.css'

export function Sidebar() {
  const activeConnections = useConnectionStore((state) => state.activeConnections)
  const activeTabId = useConnectionStore((state) => state.activeTabId)

  const activeConnection = activeTabId ? activeConnections[activeTabId] : null

  const [panelState, setPanelState] = useState<{ tabId: string | null; favouritesOpen: boolean }>({
    tabId: activeTabId,
    favouritesOpen: false,
  })

  const favouritesOpen = panelState.tabId === activeTabId ? panelState.favouritesOpen : false

  const handleToggleFavourites = useCallback(() => {
    setPanelState((current) => ({
      tabId: activeTabId,
      favouritesOpen: current.tabId === activeTabId ? !current.favouritesOpen : true,
    }))
  }, [activeTabId])

  if (activeConnection && activeTabId) {
    return (
      <div className={styles.sidebar} data-testid="sidebar-inner">
        <ObjectBrowser
          connectionId={activeTabId}
          favouritesOpen={favouritesOpen}
          onToggleFavourites={handleToggleFavourites}
        />
      </div>
    )
  }

  return (
    <div className={styles.sidebar} data-testid="sidebar-inner">
      <span className={styles.emptyState}>No active connection</span>
    </div>
  )
}
