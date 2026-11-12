import { useCallback } from 'react'
import { Copy, Star, Trash } from '@phosphor-icons/react'
import { useHistoryStore } from '../../stores/history-store'
import { useFavoritesStore } from '../../stores/favorites-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useQueryStore } from '../../stores/query-store'
import { formatTableTimestamp } from '../../lib/format-utils'
import type { HistoryEntry } from '../../types/schema'
import { Button } from '../common/Button'
import styles from './HistoryRow.module.css'
import { MILLISECONDS_PER_SECOND } from '../../lib/units'

export interface HistoryRowProps {
  entry: HistoryEntry
  connectionId: string
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < MILLISECONDS_PER_SECOND) return `${ms}ms`
  return `${(ms / MILLISECONDS_PER_SECOND).toFixed(1)}s`
}

export function HistoryRow({ entry, connectionId }: HistoryRowProps) {
  const deleteEntry = useHistoryStore((state) => state.deleteEntry)
  const openDialog = useFavoritesStore((state) => state.openDialog)
  const openQueryTab = useWorkspaceStore((state) => state.openQueryTab)

  const handleCopyToEditor = useCallback(() => {
    const tabId = openQueryTab(connectionId, 'History query')
    if (tabId) {
      useQueryStore.getState().setContent(tabId, entry.sqlText)
    }
  }, [connectionId, entry.sqlText, openQueryTab])

  const handleSaveAsFavorite = useCallback(() => {
    // Pre-populate dialog by opening with a fake favorite structure
    openDialog({
      id: 0,
      name: '',
      sqlText: entry.sqlText,
      description: null,
      category: null,
      connectionId: entry.connectionId,
      createdAt: '',
      updatedAt: '',
    })
  }, [entry.sqlText, entry.connectionId, openDialog])

  const handleDelete = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      deleteEntry(connectionId, entry.id)
    },
    [deleteEntry, connectionId, entry.id]
  )

  const isError = !entry.success

  return (
    <div
      className={styles.row}
      onClick={handleCopyToEditor}
      data-testid={`history-row-${entry.id}`}
    >
      <div className={styles.sqlPreview} title={entry.sqlText}>
        {entry.sqlText}
      </div>
      <div className={styles.meta}>
        <span
          className={`${styles.statusBadge} ${isError ? styles.statusError : styles.statusSuccess}`}
        >
          {entry.success ? 'success' : 'error'}
        </span>
        {!isError && <span>{entry.rowCount ?? 0} rows</span>}
        <span>{formatDuration(entry.durationMs)}</span>
        <span>{formatTableTimestamp(entry.timestamp)}</span>
      </div>
      <div className={styles.actions}>
        <Button
          variant="bare"
          className={styles.actionButton}
          title="Copy to editor"
          onClick={(event) => {
            event.stopPropagation()
            handleCopyToEditor()
          }}
          data-testid="history-row-copy"
        >
          <Copy size={14} weight="regular" />
        </Button>
        <Button
          variant="bare"
          className={styles.actionButton}
          title="Save as favorite"
          onClick={(event) => {
            event.stopPropagation()
            handleSaveAsFavorite()
          }}
          data-testid="history-row-favorite"
        >
          <Star size={14} weight="regular" />
        </Button>
        <Button
          variant="bare"
          className={`${styles.actionButton} ${styles.actionButtonDanger}`}
          title="Delete"
          onClick={handleDelete}
          data-testid="history-row-delete"
        >
          <Trash size={14} weight="regular" />
        </Button>
      </div>
    </div>
  )
}
