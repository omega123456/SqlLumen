import { useCallback } from 'react'
import { Copy, GlobeSimple, PencilSimple, Trash } from '@phosphor-icons/react'
import { useFavoritesStore } from '../../stores/favorites-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useQueryStore } from '../../stores/query-store'
import type { FavoriteEntry } from '../../types/schema'
import styles from './FavoriteCard.module.css'

export interface FavoriteCardProps {
  entry: FavoriteEntry
  connectionId: string
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

export function FavoriteCard({ entry, connectionId }: FavoriteCardProps) {
  const deleteFavorite = useFavoritesStore((state) => state.deleteFavorite)
  const openDialog = useFavoritesStore((state) => state.openDialog)
  const openQueryTab = useWorkspaceStore((state) => state.openQueryTab)

  const handleCopyToEditor = useCallback(() => {
    const tabId = openQueryTab(connectionId, entry.name || 'Favorite Query')
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
          <button
            type="button"
            className={styles.actionButton}
            title="Copy to editor"
            onClick={(e) => {
              e.stopPropagation()
              handleCopyToEditor()
            }}
            data-testid="favorite-card-copy"
          >
            <Copy size={14} weight="regular" />
          </button>
          <button
            type="button"
            className={styles.actionButton}
            title="Edit"
            onClick={handleEdit}
            data-testid="favorite-card-edit"
          >
            <PencilSimple size={14} weight="regular" />
          </button>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.actionButtonDanger}`}
            title="Delete"
            onClick={handleDelete}
            data-testid="favorite-card-delete"
          >
            <Trash size={14} weight="regular" />
          </button>
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
        <span>{formatDate(entry.updatedAt)}</span>
      </div>
      {entry.description && (
        <div className={styles.notes} title={entry.description}>
          {entry.description}
        </div>
      )}
    </div>
  )
}
