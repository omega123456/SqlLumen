import { useCallback } from 'react'
import { ArrowSquareOut } from '@phosphor-icons/react'
import { useHistoryStore } from '../../stores/history-store'
import { formatTableTimestamp } from '../../lib/format-utils'
import type { HistoryEntry } from '../../types/schema'
import styles from './HistoryTable.module.css'

export interface HistoryTableProps {
  entries: HistoryEntry[]
  selectedEntryId: number | null
  onSelectEntry: (id: number) => void
  onOpenInEditor: (entry: HistoryEntry) => void
  connectionId: string
}

export function HistoryTable({
  entries,
  selectedEntryId,
  onSelectEntry,
  onOpenInEditor,
  connectionId,
}: HistoryTableProps) {
  const total = useHistoryStore((state) => state.totalByConnection[connectionId] ?? 0)
  const page = useHistoryStore((state) => state.pageByConnection[connectionId] ?? 1)
  const pageSize = useHistoryStore((state) => state.pageSize)
  const setPage = useHistoryStore((state) => state.setPage)

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const hasMore = page < totalPages

  const handleLoadMore = useCallback(() => {
    if (hasMore) {
      setPage(connectionId, page + 1)
    }
  }, [hasMore, setPage, connectionId, page])

  return (
    <div className={styles.container} data-testid="history-table">
      <div className={styles.toolbar}>
        <span className={styles.badge} data-testid="history-count-badge">
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>

      {entries.length === 0 ? (
        <div className={styles.emptyState} data-testid="history-table-empty">
          No query history yet
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead className={styles.thead}>
              <tr className={styles.headerRow}>
                <th className={`${styles.th} ${styles.thTimestamp}`}>Timestamp</th>
                <th className={`${styles.th} ${styles.thDatabase}`}>Database</th>
                <th className={`${styles.th} ${styles.thSql}`}>SQL Statement</th>
                <th className={`${styles.th} ${styles.thAction}`}>Action</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => {
                const isSelected = entry.id === selectedEntryId
                const rowClasses = [
                  styles.row,
                  index % 2 === 0 ? styles.rowEven : styles.rowOdd,
                  isSelected ? styles.rowSelected : '',
                ]
                  .filter(Boolean)
                  .join(' ')

                return (
                  <tr
                    key={entry.id}
                    className={rowClasses}
                    onClick={() => onSelectEntry(entry.id)}
                    onDoubleClick={() => onOpenInEditor(entry)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSelectEntry(entry.id)
                      }
                    }}
                    tabIndex={0}
                    role="row"
                    data-testid={`history-table-row-${entry.id}`}
                    aria-selected={isSelected}
                  >
                    <td className={`${styles.td} ${styles.tdTimestamp}`}>
                      {formatTableTimestamp(entry.timestamp)}
                    </td>
                    <td className={`${styles.td} ${styles.tdDatabase}`}>
                      {entry.databaseName ?? '—'}
                    </td>
                    <td
                      className={`${styles.td} ${styles.tdSql} ${isSelected ? styles.tdSqlSelected : ''}`}
                    >
                      {entry.sqlText}
                    </td>
                    <td className={`${styles.td} ${styles.tdAction}`}>
                      <button
                        type="button"
                        className={styles.actionButton}
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpenInEditor(entry)
                        }}
                        aria-label="Open in editor"
                        title="Open in editor"
                        data-testid={`history-action-open-${entry.id}`}
                      >
                        <ArrowSquareOut size={14} weight="regular" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {hasMore && (
        <div className={styles.footer}>
          <button
            type="button"
            className={styles.loadMoreButton}
            onClick={handleLoadMore}
            data-testid="history-load-more"
          >
            Load older history
          </button>
        </div>
      )}
    </div>
  )
}
