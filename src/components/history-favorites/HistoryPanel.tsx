import { useCallback } from 'react'
import { Trash, ArrowClockwise } from '@phosphor-icons/react'
import { TextInput } from '../common/TextInput'
import { Button } from '../common/Button'
import { useHistoryStore } from '../../stores/history-store'
import { HistoryRow } from './HistoryRow'
import styles from './HistoryPanel.module.css'
import type { HistoryEntry } from '../../types/schema'

/** Stable default references to avoid infinite re-render from useSyncExternalStore. */
const EMPTY_ENTRIES: HistoryEntry[] = []

export interface HistoryPanelProps {
  connectionId: string
}

export function HistoryPanel({ connectionId }: HistoryPanelProps) {
  const entries = useHistoryStore(
    (state) => state.entriesByConnection[connectionId] ?? EMPTY_ENTRIES
  )
  const total = useHistoryStore((state) => state.totalByConnection[connectionId] ?? 0)
  const page = useHistoryStore((state) => state.pageByConnection[connectionId] ?? 1)
  const pageSize = useHistoryStore((state) => state.pageSize)
  const search = useHistoryStore((state) => state.searchByConnection[connectionId] ?? '')
  const isLoading = useHistoryStore((state) => state.isLoadingByConnection[connectionId] ?? false)
  const error = useHistoryStore((state) => state.errorByConnection[connectionId] ?? null)
  const setSearch = useHistoryStore((state) => state.setSearch)
  const setPage = useHistoryStore((state) => state.setPage)
  const clearAll = useHistoryStore((state) => state.clearAll)
  const loadHistory = useHistoryStore((state) => state.loadHistory)

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(connectionId, e.target.value)
    },
    [setSearch, connectionId]
  )

  const handleClear = useCallback(() => {
    clearAll(connectionId)
  }, [clearAll, connectionId])

  const handlePrevPage = useCallback(() => {
    if (page > 1) {
      setPage(connectionId, page - 1)
    }
  }, [page, setPage, connectionId])

  const handleNextPage = useCallback(() => {
    if (page < totalPages) {
      setPage(connectionId, page + 1)
    }
  }, [page, totalPages, setPage, connectionId])

  const handleRetry = useCallback(() => {
    loadHistory(connectionId, page, search)
  }, [loadHistory, connectionId, page, search])

  return (
    <div className={styles.container} data-testid="history-panel">
      <div className={styles.toolbar}>
        <div className={styles.searchInput}>
          <TextInput
            placeholder="Search queries..."
            value={search}
            onChange={handleSearchChange}
            data-testid="history-search"
          />
        </div>
        <div className={styles.spacer} />
        <Button
          variant="toolbarDanger"
          onClick={handleClear}
          disabled={total === 0}
          title="Clear all history"
          data-testid="history-clear"
        >
          <Trash size={14} weight="regular" />
          &nbsp;Clear
        </Button>
      </div>

      <div className={styles.list} data-testid="history-list">
        {error && (
          <div className={styles.errorState} data-testid="history-error">
            <span className={styles.errorMessage}>{error}</span>
            <Button variant="ghost" onClick={handleRetry} data-testid="history-retry">
              <ArrowClockwise size={14} weight="bold" />
              &nbsp;Retry
            </Button>
          </div>
        )}
        {!error && isLoading && entries.length === 0 && (
          <div className={styles.emptyState}>Loading...</div>
        )}
        {!error && !isLoading && entries.length === 0 && (
          <div className={styles.emptyState} data-testid="history-empty">
            {search ? 'No matching queries found' : 'No query history yet'}
          </div>
        )}
        {!error &&
          entries.map((entry) => (
            <HistoryRow key={entry.id} entry={entry} connectionId={connectionId} />
          ))}
      </div>

      {total > pageSize && (
        <div className={styles.pagination} data-testid="history-pagination">
          <Button
            variant="ghost"
            onClick={handlePrevPage}
            disabled={page <= 1}
            data-testid="history-prev-page"
          >
            Prev
          </Button>
          <span>
            Page {page} of {totalPages}
          </span>
          <Button
            variant="ghost"
            onClick={handleNextPage}
            disabled={page >= totalPages}
            data-testid="history-next-page"
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
