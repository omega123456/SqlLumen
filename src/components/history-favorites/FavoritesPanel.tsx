import { useCallback } from 'react'
import { Plus, ArrowClockwise } from '@phosphor-icons/react'
import { Button } from '../common/Button'
import { useFavoritesStore } from '../../stores/favorites-store'
import { FavoriteCard } from './FavoriteCard'
import { FavoriteDialog } from './FavoriteDialog'
import styles from './FavoritesPanel.module.css'

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
    <div className={styles.container} data-testid="favorites-panel">
      <div className={styles.toolbar}>
        <Button variant="toolbar" onClick={handleAdd} data-testid="favorites-add">
          <Plus size={14} weight="bold" />
          &nbsp;New Favorite
        </Button>
        <div className={styles.spacer} />
      </div>

      <div className={styles.list} data-testid="favorites-list">
        {error && (
          <div className={styles.errorState} data-testid="favorites-error">
            <span className={styles.errorMessage}>{error}</span>
            <Button variant="ghost" onClick={handleRetry} data-testid="favorites-retry">
              <ArrowClockwise size={14} weight="bold" />
              &nbsp;Retry
            </Button>
          </div>
        )}
        {!error && isLoading && entries.length === 0 && (
          <div className={styles.emptyState}>Loading...</div>
        )}
        {!error && !isLoading && entries.length === 0 && (
          <div className={styles.emptyState} data-testid="favorites-empty">
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
