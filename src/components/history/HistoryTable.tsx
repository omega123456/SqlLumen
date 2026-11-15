import { useCallback } from 'react'
import { ArrowSquareOutIcon, MagnifyingGlassIcon, TrashIcon } from '@phosphor-icons/react'
import { useHistoryStore } from '../../stores/history-store'
import { formatTableTimestamp } from '../../lib/format-utils'
import { Button } from '../common/Button'
import { TextInput } from '../common/TextInput'
import type { HistoryEntry } from '../../types/schema'
import { statusDotClassName } from '../../lib/class-names-status-dot'
import { isActivationKey } from '../../lib/input-events'
import { joinClassNames, SCROLLBAR } from '../../lib/class-names'
import { FOCUS_RING } from '../../lib/focus-ring'

export interface HistoryTableProps {
  entries: HistoryEntry[]
  selectedEntryId: number | null
  onSelectEntry: (id: number) => void
  onOpenInEditor: (entry: HistoryEntry) => void
  connectionId: string
  isLoading?: boolean
  error?: string | null
  onRetry?: () => void
}

const EMPTY_DATABASE_PLACEHOLDER = '—'

type CellKind = 'ui' | 'sql'

const CELL_KIND_CLASSES: Record<CellKind, string> = {
  ui: 'font-body text-size-row',
  sql: 'max-w-0 overflow-hidden font-mono text-size-cell-mono text-ellipsis',
}

type RowState = 'idle' | 'selected'

const ROW_FRAME =
  'cursor-default *:h-7 *:border-r *:border-b *:border-light-stroke-divider *:px-2.5 *:whitespace-nowrap *:text-light-on-surface dark:*:border-dark-stroke-divider dark:*:text-dark-on-surface'

const ROW_STATE_CLASSES: Record<RowState, string> = {
  idle: 'hover:*:bg-light-fill-subtle-hover focus-visible:*:shadow-light-row-focus dark:hover:*:bg-dark-fill-subtle-hover dark:focus-visible:*:shadow-dark-row-focus',
  selected:
    '*:bg-light-fill-accent-tint *:first:shadow-light-row-selected-edge focus-visible:*:not-first:shadow-light-row-focus dark:*:bg-dark-fill-accent-tint dark:*:first:shadow-dark-row-selected-edge dark:focus-visible:*:not-first:shadow-dark-row-focus',
}

function rowState(isSelected: boolean): RowState {
  if (isSelected) return 'selected'
  return 'idle'
}

const HEADER_ROW_CLASS_NAME =
  '*:sticky *:top-0 *:z-1 *:h-8 *:border-r *:border-b *:border-light-stroke-divider *:bg-light-surface-container *:px-2.5 *:text-left *:font-body *:text-size-caption *:font-semibold *:whitespace-nowrap *:text-light-on-surface-variant dark:*:border-dark-stroke-divider dark:*:bg-dark-surface-container dark:*:text-dark-on-surface-variant'

const MESSAGE_CLASS_NAME =
  'flex flex-col items-center gap-3 p-10 text-center font-body text-size-body text-light-on-surface-variant dark:text-dark-on-surface-variant'

function entryCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'entry' : 'entries'}`
}

function emptyHistoryMessage(search: string): string {
  if (search) return `No queries match "${search}"`
  return 'History is empty. Queries you run appear here.'
}

function StatusDot({ success }: { success: boolean }) {
  return (
    <span className={statusDotClassName(success)} title={success ? 'Succeeded' : 'Failed'}>
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
      className={joinClassNames([ROW_FRAME, FOCUS_RING, ROW_STATE_CLASSES[rowState(isSelected)]])}
      onClick={() => rowActions.onSelectEntry(entry.id)}
      onDoubleClick={() => rowActions.onOpenInEditor(entry)}
      onKeyDown={(event) => {
        if (isActivationKey(event.key)) {
          event.preventDefault()
          rowActions.onSelectEntry(entry.id)
        }
      }}
      tabIndex={0}
      role="row"
      data-testid={`history-table-row-${entry.id}`}
      aria-selected={isSelected}
    >
      <td className={CELL_KIND_CLASSES.ui}>{formatTableTimestamp(entry.timestamp)}</td>
      <td className={CELL_KIND_CLASSES.ui}>{entry.databaseName ?? EMPTY_DATABASE_PLACEHOLDER}</td>
      <td className={CELL_KIND_CLASSES.sql}>{entry.sqlText}</td>
      <td className={CELL_KIND_CLASSES.ui}>
        <StatusDot success={entry.success} />
      </td>
      <td className={CELL_KIND_CLASSES.ui}>
        <Button
          variant="subtle"
          size="xs"
          iconOnly
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
      <div className={MESSAGE_CLASS_NAME} data-testid="history-error">
        <p className="wrap-break-word text-light-error dark:text-dark-error">{listState.error}</p>
        <Button variant="subtle" size="sm" onClick={onRetry} data-testid="history-retry">
          Retry
        </Button>
      </div>
    )
  }
  const isLoadingFirstEntries = listState.isLoading && entries.length === 0
  if (isLoadingFirstEntries) {
    return (
      <div className={MESSAGE_CLASS_NAME} data-testid="history-loading">
        Loading history...
      </div>
    )
  }
  if (entries.length === 0) {
    return (
      <div className={MESSAGE_CLASS_NAME} data-testid="history-table-empty">
        {emptyHistoryMessage(listState.search)}
      </div>
    )
  }
  return (
    <table className="w-full border-separate border-spacing-0 text-size-row tabular-nums">
      <thead>
        <tr className={HEADER_ROW_CLASS_NAME}>
          <th>Time</th>
          <th>Database</th>
          <th className="w-full">Statement</th>
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

interface HistoryTableToolbarProps {
  connectionId: string
  entryCount: number
  search: string
}

function HistoryTableToolbar({ connectionId, entryCount, search }: HistoryTableToolbarProps) {
  const setSearch = useHistoryStore((state) => state.setSearch)
  const clearAll = useHistoryStore((state) => state.clearAll)
  return (
    <div className="flex h-13 shrink-0 items-center gap-2.5 px-3">
      <div className="relative flex w-70 min-w-30 shrink items-center">
        <MagnifyingGlassIcon
          size={16}
          weight="regular"
          className="pointer-events-none absolute left-2.5 text-light-outline dark:text-dark-outline"
        />
        <TextInput
          variant="iconLeading"
          placeholder="Search queries"
          aria-label="Search queries"
          value={search}
          onChange={(event) => setSearch(connectionId, event.target.value)}
          data-testid="history-search"
        />
      </div>
      <span
        className="inline-flex h-5 shrink-0 items-center rounded-key-badge bg-light-fill-neutral-selected px-2 font-body text-size-key-hint font-semibold whitespace-nowrap text-light-on-surface-variant dark:bg-dark-fill-neutral-selected dark:text-dark-on-surface-variant"
        data-testid="history-count-badge"
      >
        {entryCountLabel(entryCount)}
      </span>
      <span className="flex-1" />
      <Button
        variant="subtle"
        size="sm"
        dangerText
        disabled={entryCount === 0}
        onClick={() => void clearAll(connectionId)}
        data-testid="history-clear"
      >
        <TrashIcon size={16} weight="regular" />
        Clear history
      </Button>
    </div>
  )
}

interface HistoryLoadMoreProps {
  connectionId: string
  entryCount: number
}

function HistoryLoadMore({ connectionId, entryCount }: HistoryLoadMoreProps) {
  const total = useHistoryStore((state) => state.totalByConnection[connectionId] ?? 0)
  const isLoadingMore = useHistoryStore(
    (state) => state.isLoadingMoreByConnection[connectionId] ?? false
  )
  const loadMore = useHistoryStore((state) => state.loadMore)
  const hasMore = entryCount < total

  const handleLoadMore = useCallback(() => {
    if (!hasMore) return
    if (isLoadingMore) return
    void loadMore(connectionId)
  }, [hasMore, isLoadingMore, loadMore, connectionId])

  if (!hasMore) return null
  return (
    <div className="flex shrink-0 items-center justify-center border-t border-light-stroke-divider bg-light-surface-container-lowest px-3 py-1.5 dark:border-dark-stroke-divider dark:bg-dark-surface-container-lowest">
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
  const search = useHistoryStore((state) => state.searchByConnection[connectionId] ?? '')

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden" data-testid="history-table">
      <HistoryTableToolbar
        connectionId={connectionId}
        entryCount={entries.length}
        search={search}
      />

      <div
        className={joinClassNames([
          'min-h-0 flex-1 overflow-auto border-t border-light-stroke-divider bg-light-surface-container-lowest dark:border-dark-stroke-divider dark:bg-dark-surface-container-lowest',
          SCROLLBAR,
        ])}
      >
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

      <HistoryLoadMore connectionId={connectionId} entryCount={entries.length} />
    </div>
  )
}
