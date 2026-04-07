import { useCallback } from 'react'
import { PencilSimple, Play } from '@phosphor-icons/react'
import { formatShortDate } from '../../lib/format-utils'
import type { FavoriteEntry } from '../../types/schema'
import styles from './FavouritesSnippetCard.module.css'

export interface FavouritesSnippetCardProps {
  favourite: FavoriteEntry
  isSelected: boolean
  onSelect: () => void
  onEdit: () => void
  onInsert: () => void
}

export function FavouritesSnippetCard({
  favourite,
  isSelected,
  onSelect,
  onEdit,
  onInsert,
}: FavouritesSnippetCardProps) {
  const handleEdit = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onEdit()
    },
    [onEdit]
  )

  const handleInsert = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onInsert()
    },
    [onInsert]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect()
      }
    },
    [onSelect]
  )

  return (
    <div
      className={`${styles.card} ${isSelected ? styles.cardSelected : ''}`}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-expanded={isSelected}
      data-testid={`favourites-snippet-card-${favourite.id}`}
    >
      <div className={styles.header}>
        <span className={styles.name} title={favourite.name}>
          {favourite.name}
        </span>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.actionButton}
            title="Edit"
            onClick={handleEdit}
            aria-label="Edit snippet"
            data-testid="snippet-card-edit"
          >
            <PencilSimple size={14} weight="regular" />
          </button>
          <button
            type="button"
            className={styles.insertButton}
            title="Insert into editor"
            onClick={handleInsert}
            aria-label="Insert into editor"
            data-testid="snippet-card-insert"
          >
            <Play size={14} weight="fill" />
          </button>
        </div>
      </div>

      {favourite.description && (
        <div className={styles.description} title={favourite.description}>
          {favourite.description}
        </div>
      )}

      {favourite.category && (
        <div className={styles.tags}>
          <span className={styles.tag}>{favourite.category}</span>
        </div>
      )}

      <div className={styles.meta}>
        <span>{formatShortDate(favourite.updatedAt)}</span>
      </div>
    </div>
  )
}
