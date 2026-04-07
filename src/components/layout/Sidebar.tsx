import { useCallback, useEffect, useState } from 'react'
import { useConnectionStore } from '../../stores/connection-store'
import { ObjectBrowser } from '../object-browser/ObjectBrowser'
import styles from './Sidebar.module.css'

export function Sidebar() {
  const activeConnections = useConnectionStore((state) => state.activeConnections)
  const activeTabId = useConnectionStore((state) => state.activeTabId)

  const activeConnection = activeTabId ? activeConnections[activeTabId] : null

  const [favouritesOpen, setFavouritesOpen] = useState(false)

  const handleToggleFavourites = useCallback(() => {
    setFavouritesOpen((f) => !f)
  }, [])

  // Reset favourites panel when active connection tab changes
  useEffect(() => {
    setFavouritesOpen(false)
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
