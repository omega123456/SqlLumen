import { Play, Trash } from '@phosphor-icons/react'
import type { FavoriteEntry } from '../../types/schema'
import { ElevatedCodePanel } from '../common/ElevatedCodePanel'
import { Button } from '../common/Button'
import { FOCUS_RING } from '../../lib/focus-ring'
import { joinClassNames, SCROLLBAR } from '../../lib/class-names'

export interface FavouritesDetailPanelProps {
  favourite: FavoriteEntry
  onInsert: () => void
  onDelete: () => void
}

interface DetailActionsProps {
  onInsert: () => void
  onDelete: () => void
}

function DetailActions({ onInsert, onDelete }: DetailActionsProps) {
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="bare"
        className={joinClassNames([
          'flex w-full cursor-pointer items-center justify-center gap-2 rounded-control bg-light-primary px-3 py-2 font-body text-size-caption font-semibold text-light-on-primary transition-background-and-filter duration-150 hover:brightness-110 dark:bg-dark-primary dark:text-dark-on-primary',
          FOCUS_RING,
        ])}
        onClick={onInsert}
        data-testid="favourites-detail-insert"
      >
        <Play size={14} weight="fill" />
        Insert into Editor
      </Button>
      <Button
        variant="bare"
        className={joinClassNames([
          'flex w-full cursor-pointer items-center justify-center gap-2 rounded-control bg-transparent px-3 py-1.5 font-body text-size-caption font-regular text-light-error transition-background duration-150 hover:bg-light-fill-subtle-hover dark:text-dark-error dark:hover:bg-dark-fill-subtle-hover',
          FOCUS_RING,
        ])}
        onClick={onDelete}
        data-testid="favourites-detail-delete"
      >
        <Trash size={14} weight="regular" />
        Delete
      </Button>
    </div>
  )
}

export function FavouritesDetailPanel({
  favourite,
  onInsert,
  onDelete,
}: FavouritesDetailPanelProps) {
  return (
    <div
      className="flex flex-col gap-3 border-t border-light-stroke-divider bg-light-surface-container-low p-3 dark:border-dark-stroke-divider dark:bg-dark-surface-container-low"
      data-testid="favourites-detail-panel"
    >
      <h3 className="font-headline text-size-body font-semibold wrap-break-word text-light-on-surface dark:text-dark-on-surface">
        {favourite.name}
      </h3>

      {favourite.description && (
        <p className="text-size-caption leading-body wrap-break-word text-light-on-surface-variant dark:text-dark-on-surface-variant">
          {favourite.description}
        </p>
      )}

      {favourite.category && (
        <div className="flex items-center gap-2">
          <span className="text-size-caption font-semibold text-light-on-surface-variant dark:text-dark-on-surface-variant">
            Category:
          </span>
          <span className="text-size-caption text-light-on-surface dark:text-dark-on-surface">
            {favourite.category}
          </span>
        </div>
      )}

      <div className={joinClassNames(['max-h-50 overflow-y-auto', SCROLLBAR])}>
        <ElevatedCodePanel label="SQL" data-testid="favourites-sql-preview">
          {favourite.sqlText}
        </ElevatedCodePanel>
      </div>

      <DetailActions onInsert={onInsert} onDelete={onDelete} />
    </div>
  )
}
