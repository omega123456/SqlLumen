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

const EMPTY_DATABASE_PLACEHOLDER = '—'

function entryCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'entry' : 'entries'}`
}

function emptyHistoryMessage(search: string): string {
  if (search) return `No queries match "${search}"`
  return 'History is empty. Queries you run appear here.'
}

function StatusDot({ success }: { success: boolean }) {
  const statusClassName = success ? dotStyles.statusDotOk : dotStyles.statusDotError
  return (
    <span
      className={`${dotStyles.statusDot} ${statusClassName}`}
      title={success ? 'Succeeded' : 'Failed'}
    >
      {success ? '✓' : '✕'}
    </span>
  )
}

interface HistoryRowActions {
  selectedEntryId: number | null
  onSelectEntry: (id: number) => void
  onOpenInEditor: (entry: HistoryEntry) => void
}

function HistoryTableRow({
  entry,
  rowActions,
}: {
  entry: HistoryEntry
  rowActions: HistoryRowActions
}) {
  const isSelected = entry.id === rowActions.selectedEntryId
  return (
    <tr
      className={isSelected ? styles.rowSelected : undefined}
      onClick={() => rowActions.onSelectEntry(entry.id)}
      onDoubleClick={() => rowActions.onOpenInEditor(entry)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          rowActions.onSelectEntry(entry.id)
        }
      }}
      tabIndex={0}
      role="row"
      data-testid={`history-table-row-${entry.id}`}
      aria-selected={isSelected}
    >
      <td className={styles.ui}>{formatTableTimestamp(entry.timestamp)}</td>
      <td className={styles.ui}>{entry.databaseName ?? EMPTY_DATABASE_PLACEHOLDER}</td>
      <td className={styles.sql}>{entry.sqlText}</td>
      <td className={styles.ui}>
        <StatusDot success={entry.success} />
      </td>
      <td className={styles.ui}>
        <Button
          variant="subtle"
          size="sm"
          iconOnly
          className={styles.openButton}
          onClick={(event) => {
            event.stopPropagation()
            rowActions.onOpenInEditor(entry)
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
}

interface HistoryListContentProps {
  entries: HistoryEntry[]
  listState: { error: string | null; isLoading: boolean; search: string }
  rowActions: HistoryRowActions
  onRetry: (() => void) | undefined
}

function HistoryListContent({ entries, listState, rowActions, onRetry }: HistoryListContentProps) {
  if (listState.error) {
    return (
      <div className={styles.message} data-testid="history-error">
        <p className={styles.errorMessage}>{listState.error}</p>
        <Button variant="subtle" size="sm" onClick={onRetry} data-testid="history-retry">
          Retry
        </Button>
      </div>
    )
  }
  if (listState.isLoading && entries.length === 0) {
    return (
      <div className={styles.message} data-testid="history-loading">
        Loading history...
      </div>
    )
  }
  if (entries.length === 0) {
    return (
      <div className={styles.message} data-testid="history-table-empty">
        {emptyHistoryMessage(listState.search)}
      </div>
    )
  }
  return (
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
        {entries.map((entry) => (
          <HistoryTableRow key={entry.id} entry={entry} rowActions={rowActions} />
        ))}
      </tbody>
    </table>
  )
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
            onChange={(event) => setSearch(connectionId, event.target.value)}
            data-testid="history-search"
          />
        </div>
        <span className={styles.badge} data-testid="history-count-badge">
          {entryCountLabel(entries.length)}
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

      <div className={styles.tableWrapper}>
        <HistoryListContent
          entries={entries}
          listState={{ error: error, isLoading: isLoading, search: search }}
          rowActions={{
            selectedEntryId: selectedEntryId,
            onSelectEntry: onSelectEntry,
            onOpenInEditor: onOpenInEditor,
          }}
          onRetry={onRetry}
        />
      </div>

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
