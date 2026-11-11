import { useCallback } from 'react'
import { Copy, GlobeSimple, PencilSimple, Trash } from '@phosphor-icons/react'
import { useFavoritesStore } from '../../stores/favorites-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useQueryStore } from '../../stores/query-store'
import { formatShortDate } from '../../lib/format-utils'
import type { FavoriteEntry } from '../../types/schema'
import { Button } from '../common/Button'
import styles from './FavoriteCard.module.css'

export interface FavoriteCardProps {
  entry: FavoriteEntry
  connectionId: string
}

export function FavoriteCard({ entry, connectionId }: FavoriteCardProps) {
  const deleteFavorite = useFavoritesStore((state) => state.deleteFavorite)
  const openDialog = useFavoritesStore((state) => state.openDialog)
  const openQueryTab = useWorkspaceStore((state) => state.openQueryTab)

  const handleCopyToEditor = useCallback(() => {
    const tabId = openQueryTab(connectionId, entry.name || 'Favorite query')
    if (tabId) {
      useQueryStore.getState().setContent(tabId, entry.sqlText)
    }
  }, [connectionId, entry.name, entry.sqlText, openQueryTab])

  const handleEdit = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      openDialog(entry)
    },
    [entry, openDialog]
  )

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      deleteFavorite(entry.id)
    },
    [deleteFavorite, entry.id]
  )

  return (
    <div
      className={styles.card}
      onClick={handleCopyToEditor}
      data-testid={`favorite-card-${entry.id}`}
    >
      <div className={styles.header}>
        <span className={styles.name} title={entry.name}>
          {entry.name}
        </span>
        <div className={styles.actions}>
          <Button
            variant="bare"
            className={styles.actionButton}
            title="Copy to editor"
            onClick={(e) => {
              e.stopPropagation()
              handleCopyToEditor()
            }}
            data-testid="favorite-card-copy"
          >
            <Copy size={14} weight="regular" />
          </Button>
          <Button
            variant="bare"
            className={styles.actionButton}
            title="Edit"
            onClick={handleEdit}
            data-testid="favorite-card-edit"
          >
            <PencilSimple size={14} weight="regular" />
          </Button>
          <Button
            variant="bare"
            className={`${styles.actionButton} ${styles.actionButtonDanger}`}
            title="Delete"
            onClick={handleDelete}
            data-testid="favorite-card-delete"
          >
            <Trash size={14} weight="regular" />
          </Button>
        </div>
      </div>
      <div className={styles.sqlPreview} title={entry.sqlText}>
        {entry.sqlText}
      </div>
      <div className={styles.meta}>
        {entry.connectionId === null && (
          <span className={styles.globalBadge} title="Global (all connections)">
            <GlobeSimple size={12} weight="bold" />
            Global
          </span>
        )}
        {entry.category && <span>{entry.category}</span>}
        <span>{formatShortDate(entry.updatedAt)}</span>
      </div>
      {entry.description && (
        <div className={styles.notes} title={entry.description}>
          {entry.description}
        </div>
      )}
    </div>
  )
}
