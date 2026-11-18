import { useCallback, useState } from 'react'
import { useConnectionStore } from '../../stores/connection-store'
import { useSchemaStore } from '../../stores/schema-store'
import { ObjectBrowser } from '../object-browser/ObjectBrowser'

const SIDEBAR_CLASS_NAME =
  'flex h-full flex-col overflow-hidden border-r border-r-light-stroke-divider bg-light-surface-container dark:border-r-dark-stroke-divider dark:bg-dark-surface-container'

export function Sidebar() {
  const activeConnections = useConnectionStore((state) => state.activeConnections)
  const activeTabId = useConnectionStore((state) => state.activeTabId)
  const revealRequest = useSchemaStore((state) => state.revealRequest)

  const activeConnection = activeTabId ? activeConnections[activeTabId] : null

  const [panelState, setPanelState] = useState<{
    tabId: string | null
    favouritesOpen: boolean
    revealSeq: number
  }>({
    tabId: activeTabId,
    favouritesOpen: false,
    revealSeq: 0,
  })

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

  if (!activeConnection) return null

  return (
    <div className={SIDEBAR_CLASS_NAME} data-testid="sidebar-inner">
      <ObjectBrowser
        connectionId={activeConnection.id}
        favouritesOpen={favouritesOpen}
        onToggleFavourites={handleToggleFavourites}
      />
    </div>
  )
}
