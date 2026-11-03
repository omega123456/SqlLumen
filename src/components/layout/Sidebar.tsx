import { useCallback, useState } from 'react'
import { useConnectionStore } from '../../stores/connection-store'
import { useSchemaStore } from '../../stores/schema-store'
import { ObjectBrowser } from '../object-browser/ObjectBrowser'
import styles from './Sidebar.module.css'

export function Sidebar() {
  const activeConnections = useConnectionStore((state) => state.activeConnections)
  const activeTabId = useConnectionStore((state) => state.activeTabId)
  const revealRequest = useSchemaStore((state) => state.revealRequest)

  const activeConnection = activeTabId ? activeConnections[activeTabId] : null

  const [panelState, setPanelState] = useState<{
    tabId: string | null
    favouritesOpen: boolean
    /** Reveal request seq at the time favourites was toggled. */
    revealSeq: number
  }>({
    tabId: activeTabId,
    favouritesOpen: false,
    revealSeq: 0,
  })

  // A reveal request for this connection made after favourites was opened
  // switches the sidebar back to the tree so the object can be shown.
  const revealedSinceToggle =
    revealRequest !== null &&
    revealRequest.connectionId === activeTabId &&
    revealRequest.seq > panelState.revealSeq

  const favouritesOpen =
    panelState.tabId === activeTabId && panelState.favouritesOpen && !revealedSinceToggle

  const handleToggleFavourites = useCallback(() => {
    setPanelState({
      tabId: activeTabId,
      favouritesOpen: !favouritesOpen,
      revealSeq: useSchemaStore.getState().revealRequest?.seq ?? 0,
    })
  }, [activeTabId, favouritesOpen])

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
