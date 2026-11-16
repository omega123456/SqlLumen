import { useCallback } from 'react'
import { Copy, Star, Trash } from '@phosphor-icons/react'
import { useHistoryStore } from '../../stores/history-store'
import { useFavoritesStore } from '../../stores/favorites-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useQueryStore } from '../../stores/query-store'
import { formatTableTimestamp } from '../../lib/format-utils'
import type { HistoryEntry } from '../../types/schema'
import { Button } from '../common/Button'
import { joinClassNames } from '../../lib/class-names'
import {
  LIST_ROW,
  LIST_ROW_ACTIONS,
  listRowActionButtonClassName,
} from '../../lib/class-names-list-row'
import { formatCompactDuration } from '../../lib/elapsed-time'

export interface HistoryRowProps {
  entry: HistoryEntry
  connectionId: string
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  return formatCompactDuration(ms)
}

type StatusBadgeOutcome = 'success' | 'error'

const STATUS_BADGE_FRAME =
  'inline-block rounded-control px-1.5 py-px text-size-caption font-semibold'

const STATUS_BADGE_CLASSES: Record<StatusBadgeOutcome, string> = {
  success: joinClassNames([
    STATUS_BADGE_FRAME,
    'bg-light-tertiary-container text-light-tertiary dark:bg-dark-tertiary-container dark:text-dark-tertiary',
  ]),
  error: joinClassNames([
    STATUS_BADGE_FRAME,
    'bg-light-error-container text-light-error dark:bg-dark-error-container dark:text-dark-error',
  ]),
}

function statusBadgeOutcome(isError: boolean): StatusBadgeOutcome {
  if (isError) return 'error'
  return 'success'
}

interface HistoryRowActionsProps extends HistoryRowProps {
  onCopyToEditor: () => void
}

function HistoryRowActions({ entry, connectionId, onCopyToEditor }: HistoryRowActionsProps) {
  const deleteEntry = useHistoryStore((state) => state.deleteEntry)
  const openDialog = useFavoritesStore((state) => state.openDialog)

  const handleSaveAsFavorite = useCallback(() => {
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

  return (
    <div className={LIST_ROW_ACTIONS}>
      <Button
        variant="bare"
        className={listRowActionButtonClassName('neutral')}
        title="Copy to editor"
        onClick={(event) => {
          event.stopPropagation()
          onCopyToEditor()
        }}
        data-testid="history-row-copy"
      >
        <Copy size={14} weight="regular" />
      </Button>
      <Button
        variant="bare"
        className={listRowActionButtonClassName('neutral')}
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
        className={listRowActionButtonClassName('danger')}
        title="Delete"
        onClick={handleDelete}
        data-testid="history-row-delete"
      >
        <Trash size={14} weight="regular" />
      </Button>
    </div>
  )
}

export function HistoryRow({ entry, connectionId }: HistoryRowProps) {
  const openQueryTab = useWorkspaceStore((state) => state.openQueryTab)

  const handleCopyToEditor = useCallback(() => {
    const tabId = openQueryTab(connectionId, 'History query')
    if (tabId) {
      useQueryStore.getState().setContent(tabId, entry.sqlText)
    }
  }, [connectionId, entry.sqlText, openQueryTab])

  const isError = !entry.success

  return (
    <div
      className={joinClassNames([LIST_ROW, 'items-start gap-2 px-3 py-1'])}
      onClick={handleCopyToEditor}
      data-testid={`history-row-${entry.id}`}
    >
      <div
        className="min-w-0 flex-1 truncate font-mono text-size-caption leading-body text-light-on-surface dark:text-dark-on-surface"
        title={entry.sqlText}
      >
        {entry.sqlText}
      </div>
      <div className="flex shrink-0 items-center gap-2 text-size-caption whitespace-nowrap text-light-on-surface-variant dark:text-dark-on-surface-variant">
        <span className={STATUS_BADGE_CLASSES[statusBadgeOutcome(isError)]}>
          {entry.success ? 'success' : 'error'}
        </span>
        {!isError && <span>{entry.rowCount ?? 0} rows</span>}
        <span>{formatDuration(entry.durationMs)}</span>
        <span>{formatTableTimestamp(entry.timestamp)}</span>
      </div>
      <HistoryRowActions
        entry={entry}
        connectionId={connectionId}
        onCopyToEditor={handleCopyToEditor}
      />
    </div>
  )
}
