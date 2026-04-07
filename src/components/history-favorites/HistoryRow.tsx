import { useCallback } from 'react'
import { Copy, Star, Trash } from '@phosphor-icons/react'
import { useHistoryStore } from '../../stores/history-store'
import { useFavoritesStore } from '../../stores/favorites-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useQueryStore } from '../../stores/query-store'
import type { HistoryEntry } from '../../types/schema'
import styles from './HistoryRow.module.css'

export interface HistoryRowProps {
  entry: HistoryEntry
  connectionId: string
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function HistoryRow({ entry, connectionId }: HistoryRowProps) {
  const deleteEntry = useHistoryStore((state) => state.deleteEntry)
  const openDialog = useFavoritesStore((state) => state.openDialog)
  const openQueryTab = useWorkspaceStore((state) => state.openQueryTab)

  const handleCopyToEditor = useCallback(() => {
    const tabId = openQueryTab(connectionId, 'History Query')
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
    (e: React.MouseEvent) => {
      e.stopPropagation()
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
        <span>{formatTimestamp(entry.timestamp)}</span>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.actionButton}
          title="Copy to editor"
          onClick={(e) => {
            e.stopPropagation()
            handleCopyToEditor()
          }}
          data-testid="history-row-copy"
        >
          <Copy size={14} weight="regular" />
        </button>
        <button
          type="button"
          className={styles.actionButton}
          title="Save as favorite"
          onClick={(e) => {
            e.stopPropagation()
            handleSaveAsFavorite()
          }}
          data-testid="history-row-favorite"
        >
          <Star size={14} weight="regular" />
        </button>
        <button
          type="button"
          className={`${styles.actionButton} ${styles.actionButtonDanger}`}
          title="Delete"
          onClick={handleDelete}
          data-testid="history-row-delete"
        >
          <Trash size={14} weight="regular" />
        </button>
      </div>
    </div>
  )
}
