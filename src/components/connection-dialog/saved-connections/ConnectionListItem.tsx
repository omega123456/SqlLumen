import { Copy } from '@phosphor-icons/react'
import { IconButton } from '../../common/IconButton'
import { isActivationKey } from '../../../lib/input-events'
import type { SavedConnection } from '../../../types/connection'
import { joinClassNames } from '../../../lib/class-names'
import { dataFlag } from '../../../lib/data-attributes'
import { FOCUS_RING } from '../../../lib/focus-ring'

const ITEM_ICON_SIZE = 16

type ItemSelection = 'idle' | 'selected'

const ITEM_SELECTION_CLASSES: Record<ItemSelection, string> = {
  idle: 'hover:bg-light-fill-subtle-hover dark:hover:bg-dark-fill-subtle-hover',
  selected:
    'bg-light-fill-neutral-selected before:absolute before:top-1/2 before:left-0 before:-mt-2 before:h-4 before:w-0.75 before:rounded-track before:bg-light-primary dark:bg-dark-fill-neutral-selected dark:before:bg-dark-primary',
}

type DotFill = 'chosen' | 'unset'

const DOT_FILL_CLASSES: Record<DotFill, string> = {
  chosen: '',
  unset: 'bg-light-outline dark:bg-dark-outline',
}

function itemClassName(isSelected: boolean): string {
  const selection: ItemSelection = isSelected ? 'selected' : 'idle'
  return joinClassNames([
    'group relative flex cursor-default select-none flex-col rounded-control py-1.5 pr-2.5 pl-3.5',
    ITEM_SELECTION_CLASSES[selection],
    FOCUS_RING,
  ])
}

function dotClassName(color: string | null): string {
  const fill: DotFill = color === null ? 'unset' : 'chosen'
  return joinClassNames(['size-2 shrink-0 rounded-round', DOT_FILL_CLASSES[fill]])
}

function dotStyle(color: string | null): React.CSSProperties | undefined {
  if (color === null) return undefined
  return { backgroundColor: color }
}

export interface ConnectionItemHandlers {
  onSelect: (connection: SavedConnection) => void
  onContextMenu: (event: React.MouseEvent, connection: SavedConnection) => void
  onDuplicate: (connection: SavedConnection) => void
}

interface ConnectionListItemProps {
  connection: SavedConnection
  isSelected: boolean
  handlers: ConnectionItemHandlers
}

export function ConnectionListItem({ connection, isSelected, handlers }: ConnectionListItemProps) {
  const hasName = Boolean(connection.name.trim())
  const titleText = hasName ? connection.name : connection.host
  return (
    <div
      className={itemClassName(isSelected)}
      onClick={() => handlers.onSelect(connection)}
      onContextMenu={(event) => handlers.onContextMenu(event, connection)}
      role="button"
      data-testid="connection-list-item"
      data-selected={dataFlag(isSelected)}
      tabIndex={0}
      onKeyDown={(event) => {
        if (isActivationKey(event.key)) {
          event.preventDefault()
          handlers.onSelect(connection)
        }
      }}
    >
      <span className="flex min-w-0 items-center gap-2 text-body text-light-on-surface dark:text-dark-on-surface">
        <span
          className={dotClassName(connection.color)}
          style={dotStyle(connection.color)}
          data-testid="connection-color-dot"
        />
        <span className="min-w-0 truncate" data-testid="connection-list-item-name">
          {titleText}
        </span>
      </span>
      {hasName && (
        <span className="truncate pl-4 font-mono text-caption text-light-on-surface-variant dark:text-dark-on-surface-variant">
          {connection.host}
        </span>
      )}
      <div className="invisible absolute top-1/2 right-1.5 -mt-3 group-focus-within:visible group-hover:visible">
        <IconButton
          size="sm"
          title="Duplicate connection"
          aria-label={`Duplicate ${titleText}`}
          onClick={(event) => {
            event.stopPropagation()
            handlers.onDuplicate(connection)
          }}
        >
          <Copy size={ITEM_ICON_SIZE} weight="regular" />
        </IconButton>
      </div>
    </div>
  )
}
