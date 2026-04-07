import { useEffect } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useConnectionStore } from '../../stores/connection-store'
import { useHistoryStore } from '../../stores/history-store'
import { useFavoritesStore } from '../../stores/favorites-store'
import { HistoryPanel } from './HistoryPanel'
import { FavoritesPanel } from './FavoritesPanel'
import type { HistoryFavoritesTab as HistoryFavoritesTabType } from '../../types/schema'
import styles from './HistoryFavoritesTab.module.css'

export interface HistoryFavoritesTabProps {
  tab: HistoryFavoritesTabType
}

export function HistoryFavoritesTab({ tab }: HistoryFavoritesTabProps) {
  const activeConnections = useConnectionStore((state) => state.activeConnections)
  const activeConnection = activeConnections[tab.connectionId]
  const connectionId = activeConnection ? tab.connectionId : null

  const loadHistory = useHistoryStore((state) => state.loadHistory)
  const loadFavorites = useFavoritesStore((state) => state.loadFavorites)

  // Load data when the tab mounts or connectionId changes
  useEffect(() => {
    if (connectionId) {
      loadHistory(connectionId)
      loadFavorites(connectionId)
    }
  }, [connectionId, loadHistory, loadFavorites])

  if (!connectionId) {
    return (
      <div className={styles.container} data-testid="history-favorites-tab">
        <div className={styles.content}>
          <p>No active connection</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container} data-testid="history-favorites-tab">
      <Group orientation="horizontal" className={styles.panelGroup}>
        <Panel defaultSize="35%" minSize="15%" className={styles.favoritesPanel}>
          <FavoritesPanel connectionId={connectionId} />
        </Panel>
        <Separator className={styles.resizeHandle}>
          <div className={styles.resizePill} />
        </Separator>
        <Panel defaultSize="65%" minSize="20%" className={styles.historyPanel}>
          <HistoryPanel connectionId={connectionId} />
        </Panel>
      </Group>
    </div>
  )
}
