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

interface FavoriteCardActionsProps {
  entry: FavoriteEntry
  onCopyToEditor: () => void
}

function FavoriteCardActions({ entry, onCopyToEditor }: FavoriteCardActionsProps) {
  const deleteFavorite = useFavoritesStore((state) => state.deleteFavorite)
  const openDialog = useFavoritesStore((state) => state.openDialog)

  const handleEdit = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      openDialog(entry)
    },
    [entry, openDialog]
  )

  const handleDelete = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      deleteFavorite(entry.id)
    },
    [deleteFavorite, entry.id]
  )

  return (
    <div className={styles.actions}>
      <Button
        variant="bare"
        className={styles.actionButton}
        title="Copy to editor"
        onClick={(event) => {
          event.stopPropagation()
          onCopyToEditor()
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
  )
}

export function FavoriteCard({ entry, connectionId }: FavoriteCardProps) {
  const openQueryTab = useWorkspaceStore((state) => state.openQueryTab)

  const handleCopyToEditor = useCallback(() => {
    const tabId = openQueryTab(connectionId, entry.name || 'Favorite query')
    if (tabId) {
      useQueryStore.getState().setContent(tabId, entry.sqlText)
    }
  }, [connectionId, entry.name, entry.sqlText, openQueryTab])

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
        <FavoriteCardActions entry={entry} onCopyToEditor={handleCopyToEditor} />
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
