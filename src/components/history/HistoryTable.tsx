import { useCallback } from 'react'
import { ArrowSquareOutIcon, MagnifyingGlassIcon, TrashIcon } from '@phosphor-icons/react'
import { useHistoryStore } from '../../stores/history-store'
import { formatTableTimestamp } from '../../lib/format-utils'
import { Button } from '../common/Button'
import { TextInput } from '../common/TextInput'
import type { HistoryEntry } from '../../types/schema'
import dotStyles from '../shared/toolbar/toolbar-items.module.css'
import styles from './HistoryTable.module.css'

export interface HistoryTableProps {
  entries: HistoryEntry[]
  selectedEntryId: number | null
  onSelectEntry: (id: number) => void
  onOpenInEditor: (entry: HistoryEntry) => void
  connectionId: string
  /** Initial load in flight with nothing to show yet. */
  isLoading?: boolean
  /** Load error; replaces the list with a retry prompt. */
  error?: string | null
  onRetry?: () => void
}

export function HistoryTable({
  entries,
  selectedEntryId,
  onSelectEntry,
  onOpenInEditor,
  connectionId,
  isLoading = false,
  error = null,
  onRetry,
}: HistoryTableProps) {
  const total = useHistoryStore((state) => state.totalByConnection[connectionId] ?? 0)
  const isLoadingMore = useHistoryStore(
    (state) => state.isLoadingMoreByConnection[connectionId] ?? false
  )
  const search = useHistoryStore((state) => state.searchByConnection[connectionId] ?? '')
  const loadMore = useHistoryStore((state) => state.loadMore)
  const setSearch = useHistoryStore((state) => state.setSearch)
  const clearAll = useHistoryStore((state) => state.clearAll)

  // Time-range aware: only offer "load more" while fewer rows are loaded than
  // exist within the active time window (`total` is already scoped to it).
  const hasMore = entries.length < total

  const handleLoadMore = useCallback(() => {
    if (hasMore && !isLoadingMore) {
      void loadMore(connectionId)
    }
  }, [hasMore, isLoadingMore, loadMore, connectionId])

  let list
  if (error) {
    list = (
      <div className={styles.message} data-testid="history-error">
        <p className={styles.errorMessage}>{error}</p>
        <Button variant="subtle" size="sm" onClick={onRetry} data-testid="history-retry">
          Retry
        </Button>
      </div>
    )
  } else if (isLoading && entries.length === 0) {
    list = (
      <div className={styles.message} data-testid="history-loading">
        Loading history...
      </div>
    )
  } else if (entries.length === 0) {
    list = (
      <div className={styles.message} data-testid="history-table-empty">
        {search ? `No queries match "${search}"` : 'History is empty. Queries you run appear here.'}
      </div>
    )
  } else {
    list = (
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Time</th>
            <th>Database</th>
            <th className={styles.thSql}>Statement</th>
            <th>Status</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const isSelected = entry.id === selectedEntryId
            return (
              <tr
                key={entry.id}
                className={isSelected ? styles.rowSelected : undefined}
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
                <td className={styles.ui}>{formatTableTimestamp(entry.timestamp)}</td>
                <td className={styles.ui}>{entry.databaseName ?? '—'}</td>
                <td className={styles.sql}>{entry.sqlText}</td>
                <td className={styles.ui}>
                  <span
                    className={`${dotStyles.statusDot} ${entry.success ? dotStyles.statusDotOk : dotStyles.statusDotError}`}
                    title={entry.success ? 'Succeeded' : 'Failed'}
                  >
                    {entry.success ? '✓' : '✕'}
                  </span>
                </td>
                <td className={styles.ui}>
                  <Button
                    variant="subtle"
                    size="sm"
                    iconOnly
                    className={styles.openButton}
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenInEditor(entry)
                    }}
                    aria-label="Open in editor"
                    title="Open in editor"
                    data-testid={`history-action-open-${entry.id}`}
                  >
                    <ArrowSquareOutIcon size={16} weight="regular" />
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }

  return (
    <div className={styles.container} data-testid="history-table">
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <MagnifyingGlassIcon size={16} weight="regular" className={styles.searchIcon} />
          <TextInput
            className={styles.searchInput}
            placeholder="Search queries"
            aria-label="Search queries"
            value={search}
            onChange={(e) => setSearch(connectionId, e.target.value)}
            data-testid="history-search"
          />
        </div>
        <span className={styles.badge} data-testid="history-count-badge">
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
        </span>
        <span className={styles.spacer} />
        <Button
          variant="subtle"
          size="sm"
          dangerText
          disabled={entries.length === 0}
          onClick={() => void clearAll(connectionId)}
          data-testid="history-clear"
        >
          <TrashIcon size={16} weight="regular" />
          Clear history
        </Button>
      </div>

      <div className={styles.tableWrapper}>{list}</div>

      {hasMore && (
        <div className={styles.footer}>
          <Button
            variant="subtle"
            size="sm"
            onClick={handleLoadMore}
            disabled={isLoadingMore}
            data-testid="history-load-more"
          >
            {isLoadingMore ? 'Loading…' : 'Load more results'}
          </Button>
        </div>
      )}
    </div>
  )
}
