import { useEffect } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useConnectionStore } from '../../stores/connection-store'
import { useHistoryStore } from '../../stores/history-store'
import { useFavoritesStore } from '../../stores/favorites-store'
import { HistoryPanel } from './HistoryPanel'
import { FavoritesPanel } from './FavoritesPanel'
import type { HistoryTab as HistoryFavoritesTabType } from '../../types/schema'
import { FOCUS_RING } from '../../lib/focus-ring'
import { joinClassNames } from '../../lib/class-names'

const TAB_FRAME = 'flex h-full w-full flex-col overflow-hidden'

const PANEL_FRAME = 'flex flex-col overflow-hidden'

const RESIZE_HANDLE = joinClassNames([
  'group/resize-handle relative z-0 flex w-1 shrink-0 cursor-col-resize items-center justify-center bg-transparent transition-bg duration-150 hover:bg-light-fill-subtle-hover resize-dragging:bg-light-fill-subtle-hover dark:hover:bg-dark-fill-subtle-hover dark:resize-dragging:bg-dark-fill-subtle-hover',
  FOCUS_RING,
])

export interface HistoryFavoritesTabProps {
  tab: HistoryFavoritesTabType
}

export function HistoryFavoritesTab({ tab }: HistoryFavoritesTabProps) {
  const activeConnections = useConnectionStore((state) => state.activeConnections)
  const activeConnection = activeConnections[tab.connectionId]
  const connectionId = activeConnection ? tab.connectionId : null

  const loadHistory = useHistoryStore((state) => state.loadHistory)
  const loadFavorites = useFavoritesStore((state) => state.loadFavorites)

  useEffect(() => {
    if (connectionId) {
      loadHistory(connectionId)
      loadFavorites(connectionId)
    }
  }, [connectionId, loadHistory, loadFavorites])

  if (!connectionId) {
    return (
      <div className={TAB_FRAME} data-testid="history-favorites-tab">
        <div className="flex-1 overflow-hidden">
          <p className="wrap-break-word">No active connection</p>
        </div>
      </div>
    )
  }

  return (
    <div className={TAB_FRAME} data-testid="history-favorites-tab">
      <Group orientation="horizontal" className="min-h-0 flex-1">
        <Panel defaultSize="35%" minSize="15%" className={PANEL_FRAME}>
          <FavoritesPanel connectionId={connectionId} />
        </Panel>
        <Separator className={RESIZE_HANDLE}>
          <div className="h-8 w-0.75 rounded-track bg-light-outline-variant transition-bg duration-150 group-hover/resize-handle:bg-light-primary group-resize-dragging/resize-handle:bg-light-primary dark:bg-dark-outline-variant dark:group-hover/resize-handle:bg-dark-primary dark:group-resize-dragging/resize-handle:bg-dark-primary" />
        </Separator>
        <Panel defaultSize="65%" minSize="20%" className={PANEL_FRAME}>
          <HistoryPanel connectionId={connectionId} />
        </Panel>
      </Group>
    </div>
  )
}
