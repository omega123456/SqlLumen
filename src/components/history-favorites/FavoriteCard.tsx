import { useCallback } from 'react'
import { Copy, GlobeSimple, PencilSimple, Trash } from '@phosphor-icons/react'
import { useFavoritesStore } from '../../stores/favorites-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useQueryStore } from '../../stores/query-store'
import { formatShortDate } from '../../lib/format-utils'
import type { FavoriteEntry } from '../../types/schema'
import { Button } from '../common/Button'
import { joinClassNames } from '../../lib/class-names'
import {
  LIST_ROW,
  LIST_ROW_ACTIONS,
  listRowActionButtonClassName,
} from '../../lib/class-names-list-row'

export interface FavoriteCardProps {
  entry: FavoriteEntry
  connectionId: string
}

interface FavoriteCardActionsProps {
  entry: FavoriteEntry
  onCopyToEditor: () => void
}

function FavoriteCardActions({ entry, onCopyToEditor }: FavoriteCardActionsProps) {
  const deleteFavorite = useFavoritesStore((state) => state.deleteFavorite)
  const openDialog = useFavoritesStore((state) => state.openDialog)

  const handleEdit = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      openDialog(entry)
    },
    [entry, openDialog]
  )

  const handleDelete = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      deleteFavorite(entry.id)
    },
    [deleteFavorite, entry.id]
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
        data-testid="favorite-card-copy"
      >
        <Copy size={14} weight="regular" />
      </Button>
      <Button
        variant="bare"
        className={listRowActionButtonClassName('neutral')}
        title="Edit"
        onClick={handleEdit}
        data-testid="favorite-card-edit"
      >
        <PencilSimple size={14} weight="regular" />
      </Button>
      <Button
        variant="bare"
        className={listRowActionButtonClassName('danger')}
        title="Delete"
        onClick={handleDelete}
        data-testid="favorite-card-delete"
      >
        <Trash size={14} weight="regular" />
      </Button>
    </div>
  )
}

export function FavoriteCard({ entry, connectionId }: FavoriteCardProps) {
  const openQueryTab = useWorkspaceStore((state) => state.openQueryTab)

  const handleCopyToEditor = useCallback(() => {
    const tabId = openQueryTab(connectionId, entry.name || 'Favorite query')
    if (tabId) {
      useQueryStore.getState().setContent(tabId, entry.sqlText)
    }
  }, [connectionId, entry.name, entry.sqlText, openQueryTab])

  return (
    <div
      className={joinClassNames([LIST_ROW, 'flex-col gap-1 px-3 py-2'])}
      onClick={handleCopyToEditor}
      data-testid={`favorite-card-${entry.id}`}
    >
      <div className="flex items-center gap-2">
        <span
          className="min-w-0 flex-1 truncate text-size-body font-semibold text-light-on-surface dark:text-dark-on-surface"
          title={entry.name}
        >
          {entry.name}
        </span>
        <FavoriteCardActions entry={entry} onCopyToEditor={handleCopyToEditor} />
      </div>
      <div
        className="truncate font-mono text-size-caption leading-body text-light-on-surface-variant dark:text-dark-on-surface-variant"
        title={entry.sqlText}
      >
        {entry.sqlText}
      </div>
      <div className="flex items-center gap-2 text-size-caption text-light-on-surface-variant dark:text-dark-on-surface-variant">
        {entry.connectionId === null && (
          <span
            className="inline-flex items-center gap-0.5 text-size-caption font-semibold text-light-primary dark:text-dark-primary"
            title="Global (all connections)"
          >
            <GlobeSimple size={12} weight="bold" />
            Global
          </span>
        )}
        {entry.category && <span>{entry.category}</span>}
        <span>{formatShortDate(entry.updatedAt)}</span>
      </div>
      {entry.description && (
        <div
          className="truncate text-size-caption text-light-on-surface-variant italic dark:text-dark-on-surface-variant"
          title={entry.description}
        >
          {entry.description}
        </div>
      )}
    </div>
  )
}
