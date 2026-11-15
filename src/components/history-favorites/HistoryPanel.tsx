import { useCallback } from 'react'
import { Trash, ArrowClockwise } from '@phosphor-icons/react'
import { TextInput } from '../common/TextInput'
import { Button } from '../common/Button'
import { useHistoryStore } from '../../stores/history-store'
import { HistoryRow } from './HistoryRow'
import {
  LIST_PANEL_EMPTY_STATE,
  LIST_PANEL_ERROR_MESSAGE,
  LIST_PANEL_ERROR_STATE,
  LIST_PANEL_LIST,
  LIST_PANEL_TOOLBAR,
} from '../../lib/class-names-list-panel'
import type { HistoryEntry } from '../../types/schema'

const EMPTY_ENTRIES: HistoryEntry[] = []

export interface HistoryPanelProps {
  connectionId: string
}

function EmptyHistoryState({ isLoading, search }: { isLoading: boolean; search: string }) {
  if (isLoading) return <div className={LIST_PANEL_EMPTY_STATE}>Loading...</div>
  return (
    <div className={LIST_PANEL_EMPTY_STATE} data-testid="history-empty">
      {search ? 'No matching queries found' : 'No query history yet'}
    </div>
  )
}

interface HistoryListBodyProps {
  connectionId: string
  entries: HistoryEntry[]
  listState: { error: string | null; isLoading: boolean; search: string }
  onRetry: () => void
}

function HistoryListBody({ connectionId, entries, listState, onRetry }: HistoryListBodyProps) {
  if (listState.error) {
    return (
      <div className={LIST_PANEL_ERROR_STATE} data-testid="history-error">
        <span className={LIST_PANEL_ERROR_MESSAGE}>{listState.error}</span>
        <Button variant="subtle" size="sm" onClick={onRetry} data-testid="history-retry">
          <ArrowClockwise size={14} weight="bold" />
          &nbsp;Retry
        </Button>
      </div>
    )
  }
  return (
    <>
      {entries.length === 0 && (
        <EmptyHistoryState isLoading={listState.isLoading} search={listState.search} />
      )}
      {entries.map((entry) => (
        <HistoryRow key={entry.id} entry={entry} connectionId={connectionId} />
      ))}
    </>
  )
}

function HistoryPagination({ connectionId }: HistoryPanelProps) {
  const total = useHistoryStore((state) => state.totalByConnection[connectionId] ?? 0)
  const page = useHistoryStore((state) => state.pageByConnection[connectionId] ?? 1)
  const pageSize = useHistoryStore((state) => state.pageSize)
  const setPage = useHistoryStore((state) => state.setPage)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const handlePreviousPage = useCallback(() => {
    if (page > 1) {
      setPage(connectionId, page - 1)
    }
  }, [page, setPage, connectionId])

  const handleNextPage = useCallback(() => {
    if (page < totalPages) {
      setPage(connectionId, page + 1)
    }
  }, [page, totalPages, setPage, connectionId])

  if (total <= pageSize) return null
  return (
    <div
      className="flex shrink-0 items-center justify-center gap-2 border-t border-light-outline-variant px-3 py-2 text-size-caption text-light-on-surface-variant dark:border-dark-outline-variant dark:text-dark-on-surface-variant"
      data-testid="history-pagination"
    >
      <Button
        variant="subtle"
        size="sm"
        onClick={handlePreviousPage}
        disabled={page <= 1}
        data-testid="history-prev-page"
      >
        Prev
      </Button>
      <span>
        Page {page} of {totalPages}
      </span>
      <Button
        variant="subtle"
        size="sm"
        onClick={handleNextPage}
        disabled={page >= totalPages}
        data-testid="history-next-page"
      >
        Next
      </Button>
    </div>
  )
}

export function HistoryPanel({ connectionId }: HistoryPanelProps) {
  const entries = useHistoryStore(
    (state) => state.entriesByConnection[connectionId] ?? EMPTY_ENTRIES
  )
  const total = useHistoryStore((state) => state.totalByConnection[connectionId] ?? 0)
  const page = useHistoryStore((state) => state.pageByConnection[connectionId] ?? 1)
  const search = useHistoryStore((state) => state.searchByConnection[connectionId] ?? '')
  const isLoading = useHistoryStore((state) => state.isLoadingByConnection[connectionId] ?? false)
  const error = useHistoryStore((state) => state.errorByConnection[connectionId] ?? null)
  const setSearch = useHistoryStore((state) => state.setSearch)
  const clearAll = useHistoryStore((state) => state.clearAll)
  const loadHistory = useHistoryStore((state) => state.loadHistory)

  const handleSearchChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(connectionId, event.target.value)
    },
    [setSearch, connectionId]
  )

  const handleRetry = useCallback(() => {
    loadHistory(connectionId, { page, search })
  }, [loadHistory, connectionId, page, search])

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="history-panel">
      <div className={LIST_PANEL_TOOLBAR}>
        <div className="max-w-90 flex-1">
          <TextInput
            placeholder="Search queries..."
            value={search}
            onChange={handleSearchChange}
            data-testid="history-search"
          />
        </div>
        <div className="flex-1" />
        <Button
          variant="subtle"
          size="sm"
          dangerText
          onClick={() => clearAll(connectionId)}
          disabled={total === 0}
          title="Clear all history"
          data-testid="history-clear"
        >
          <Trash size={14} weight="regular" />
          &nbsp;Clear
        </Button>
      </div>

      <div className={LIST_PANEL_LIST} data-testid="history-list">
        <HistoryListBody
          connectionId={connectionId}
          entries={entries}
          listState={{ error: error, isLoading: isLoading, search: search }}
          onRetry={handleRetry}
        />
      </div>

      <HistoryPagination connectionId={connectionId} />
    </div>
  )
}
