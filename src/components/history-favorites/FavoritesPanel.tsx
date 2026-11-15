import { useCallback } from 'react'
import { Plus, ArrowClockwise } from '@phosphor-icons/react'
import { Button } from '../common/Button'
import { useFavoritesStore } from '../../stores/favorites-store'
import { FavoriteCard } from './FavoriteCard'
import { FavoriteDialog } from './FavoriteDialog'
import {
  LIST_PANEL_EMPTY_STATE,
  LIST_PANEL_ERROR_MESSAGE,
  LIST_PANEL_ERROR_STATE,
  LIST_PANEL_LIST,
  LIST_PANEL_TOOLBAR,
} from '../../lib/class-names-list-panel'

export interface FavoritesPanelProps {
  connectionId: string
}

export function FavoritesPanel({ connectionId }: FavoritesPanelProps) {
  const entries = useFavoritesStore((state) => state.entries)
  const isLoading = useFavoritesStore((state) => state.isLoading)
  const error = useFavoritesStore((state) => state.error)
  const dialogOpen = useFavoritesStore((state) => state.dialogOpen)
  const openDialog = useFavoritesStore((state) => state.openDialog)
  const loadFavorites = useFavoritesStore((state) => state.loadFavorites)

  const handleAdd = useCallback(() => {
    openDialog(null)
  }, [openDialog])

  const handleRetry = useCallback(() => {
    loadFavorites(connectionId)
  }, [loadFavorites, connectionId])

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="favorites-panel">
      <div className={LIST_PANEL_TOOLBAR}>
        <Button variant="subtle" size="sm" onClick={handleAdd} data-testid="favorites-add">
          <Plus size={14} weight="bold" />
          &nbsp;New Favorite
        </Button>
        <div className="flex-1" />
      </div>

      <div className={LIST_PANEL_LIST} data-testid="favorites-list">
        {error && (
          <div className={LIST_PANEL_ERROR_STATE} data-testid="favorites-error">
            <span className={LIST_PANEL_ERROR_MESSAGE}>{error}</span>
            <Button variant="subtle" size="sm" onClick={handleRetry} data-testid="favorites-retry">
              <ArrowClockwise size={14} weight="bold" />
              &nbsp;Retry
            </Button>
          </div>
        )}
        {!error && isLoading && entries.length === 0 && (
          <div className={LIST_PANEL_EMPTY_STATE}>Loading...</div>
        )}
        {!error && !isLoading && entries.length === 0 && (
          <div className={LIST_PANEL_EMPTY_STATE} data-testid="favorites-empty">
            No favorites yet
          </div>
        )}
        {!error &&
          entries.map((entry) => (
            <FavoriteCard key={entry.id} entry={entry} connectionId={connectionId} />
          ))}
      </div>

      {dialogOpen && <FavoriteDialog connectionId={connectionId} />}
    </div>
  )
}
