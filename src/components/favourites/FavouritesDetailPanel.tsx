import { Play, Trash } from '@phosphor-icons/react'
import type { FavoriteEntry } from '../../types/schema'
import { ElevatedCodePanel } from '../common/ElevatedCodePanel'
import styles from './FavouritesDetailPanel.module.css'

export interface FavouritesDetailPanelProps {
  favourite: FavoriteEntry
  onInsert: () => void
  onDelete: () => void
}

export function FavouritesDetailPanel({
  favourite,
  onInsert,
  onDelete,
}: FavouritesDetailPanelProps) {
  return (
    <div className={styles.panel} data-testid="favourites-detail-panel">
      <h3 className={styles.title}>{favourite.name}</h3>

      {favourite.description && <p className={styles.description}>{favourite.description}</p>}

      {favourite.category && (
        <div className={styles.categoryRow}>
          <span className={styles.categoryLabel}>Category:</span>
          <span className={styles.categoryValue}>{favourite.category}</span>
        </div>
      )}

      <div className={styles.codePanel}>
        <ElevatedCodePanel label="SQL" data-testid="favourites-sql-preview">
          {favourite.sqlText}
        </ElevatedCodePanel>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.insertCta}
          onClick={onInsert}
          data-testid="favourites-detail-insert"
        >
          <Play size={14} weight="fill" />
          Insert into Editor
        </button>
        <button
          type="button"
          className={styles.deleteButton}
          onClick={onDelete}
          data-testid="favourites-detail-delete"
        >
          <Trash size={14} weight="regular" />
          Delete
        </button>
      </div>
    </div>
  )
}
