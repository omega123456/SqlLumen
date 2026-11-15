import { useCallback } from 'react'
import { PencilSimple, Play } from '@phosphor-icons/react'
import { ElevatedSurface } from '../common/ElevatedSurface'
import { formatShortDate } from '../../lib/format-utils'
import type { FavoriteEntry } from '../../types/schema'
import { Button } from '../common/Button'
import { joinClassNames } from '../../lib/class-names'
import { FOCUS_RING } from '../../lib/focus-ring'
import { isActivationKey } from '../../lib/input-events'

export interface FavouritesSnippetCardProps {
  favourite: FavoriteEntry
  isSelected: boolean
  onSelect: () => void
  onEdit: () => void
  onInsert: () => void
}

type SnippetActionTone = 'neutral' | 'accent'

const SNIPPET_ACTION_BUTTON_FRAME =
  'inline-flex size-6 cursor-pointer items-center justify-center rounded-control bg-transparent p-0 transition-background-and-color duration-150 hover:bg-light-fill-subtle-hover dark:hover:bg-dark-fill-subtle-hover'

const SNIPPET_ACTION_TONE_CLASSES: Record<SnippetActionTone, string> = {
  neutral:
    'text-light-on-surface-variant hover:text-light-on-surface dark:text-dark-on-surface-variant dark:hover:text-dark-on-surface',
  accent:
    'text-light-primary hover:text-light-primary dark:text-dark-primary dark:hover:text-dark-primary',
}

function snippetActionButtonClassName(tone: SnippetActionTone): string {
  return joinClassNames([
    SNIPPET_ACTION_BUTTON_FRAME,
    FOCUS_RING,
    SNIPPET_ACTION_TONE_CLASSES[tone],
  ])
}

type SnippetCardState = 'idle' | 'selected'

const SNIPPET_CARD_FRAME =
  'flex flex-col gap-1 border-l-2 px-3 py-2 cursor-pointer transition-border-color-background-shadow duration-150'

const SNIPPET_CARD_STATE_CLASSES: Record<SnippetCardState, string> = {
  idle: 'border-l-transparent',
  selected: 'border-l-light-primary dark:border-l-dark-primary',
}

function snippetCardState(isSelected: boolean): SnippetCardState {
  if (isSelected) return 'selected'
  return 'idle'
}

interface SnippetCardActionsProps {
  onEdit: () => void
  onInsert: () => void
}

function SnippetCardActions({ onEdit, onInsert }: SnippetCardActionsProps) {
  const handleEdit = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      onEdit()
    },
    [onEdit]
  )

  const handleInsert = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      onInsert()
    },
    [onInsert]
  )

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button
        variant="bare"
        className={snippetActionButtonClassName('neutral')}
        title="Edit"
        onClick={handleEdit}
        aria-label="Edit snippet"
        data-testid="snippet-card-edit"
      >
        <PencilSimple size={14} weight="regular" />
      </Button>
      <Button
        variant="bare"
        className={snippetActionButtonClassName('accent')}
        title="Insert into editor"
        onClick={handleInsert}
        aria-label="Insert into editor"
        data-testid="snippet-card-insert"
      >
        <Play size={14} weight="fill" />
      </Button>
    </div>
  )
}

function SnippetCardDetails({ favourite }: { favourite: FavoriteEntry }) {
  return (
    <>
      {favourite.description && (
        <div
          className="line-clamp-2 text-size-caption leading-compact text-light-on-surface-variant dark:text-dark-on-surface-variant"
          title={favourite.description}
        >
          {favourite.description}
        </div>
      )}

      {favourite.category && (
        <div className="flex flex-wrap gap-1">
          <span className="inline-flex items-center rounded-pill border border-light-stroke-card bg-light-fill-neutral-selected px-2 py-px text-size-caption leading-loose font-semibold text-light-primary dark:border-dark-stroke-card dark:bg-dark-fill-neutral-selected dark:text-dark-primary">
            {favourite.category}
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 text-size-caption text-light-on-surface-variant dark:text-dark-on-surface-variant">
        <span>{formatShortDate(favourite.updatedAt)}</span>
      </div>
    </>
  )
}

export function FavouritesSnippetCard({
  favourite,
  isSelected,
  onSelect,
  onEdit,
  onInsert,
}: FavouritesSnippetCardProps) {
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (isActivationKey(event.key)) {
        event.preventDefault()
        onSelect()
      }
    },
    [onSelect]
  )

  return (
    <ElevatedSurface
      variant={isSelected ? 'ringSelected' : 'ringHoverable'}
      className={joinClassNames([
        SNIPPET_CARD_FRAME,
        FOCUS_RING,
        SNIPPET_CARD_STATE_CLASSES[snippetCardState(isSelected)],
      ])}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-expanded={isSelected}
      data-testid={`favourites-snippet-card-${favourite.id}`}
    >
      <div className="flex items-center gap-2">
        <span
          className="min-w-0 flex-1 truncate text-size-body font-semibold text-light-on-surface dark:text-dark-on-surface"
          title={favourite.name}
        >
          {favourite.name}
        </span>
        <SnippetCardActions onEdit={onEdit} onInsert={onInsert} />
      </div>

      <SnippetCardDetails favourite={favourite} />
    </ElevatedSurface>
  )
}
