import type { CSSProperties, ReactNode } from 'react'
import { Database, ArrowClockwise, Star } from '@phosphor-icons/react'
import { useConnectionStore } from '../../stores/connection-store'
import { useSchemaStore } from '../../stores/schema-store'
import { joinClassNames } from '../../lib/class-names'
import { ACCENT_TILE, TILE } from '../../lib/class-names-tile'
import { IconButton } from '../common/IconButton'

export interface ConnectionHeaderProps {
  connectionId: string
  favouritesOpen: boolean
  onToggleFavourites: () => void
}

const CONNECTION_STATUS_DISPLAY: Record<string, { className: string; label: string }> = {
  connected: { className: 'bg-light-tertiary dark:bg-dark-tertiary', label: 'Connected' },
  reconnecting: { className: 'bg-light-warning dark:bg-dark-warning', label: 'Reconnecting' },
  disconnected: { className: 'bg-light-error dark:bg-dark-error', label: 'Disconnected' },
}

const FALLBACK_SERVER_VERSION = 'MySQL server'
const TILE_TINT_PERCENT = 20
const TILE_ICON_COLOR_PERCENT = 50

function connectionStatusDisplay(status: string) {
  return CONNECTION_STATUS_DISPLAY[status] ?? CONNECTION_STATUS_DISPLAY.disconnected
}

function connectionTileStyle(color: string): CSSProperties {
  return {
    backgroundColor: `color-mix(in srgb, ${color} ${TILE_TINT_PERCENT}%, transparent)`,
    color: `color-mix(in srgb, ${color} ${TILE_ICON_COLOR_PERCENT}%, currentColor)`,
  }
}

function ConnectionTile({ color }: { color: string | null | undefined }) {
  if (!color) {
    return (
      <div className={ACCENT_TILE}>
        <Database size={16} weight="regular" />
      </div>
    )
  }
  return (
    <div className={TILE} style={connectionTileStyle(color)}>
      <Database size={16} weight="regular" />
    </div>
  )
}

type ActiveDatabaseTone = 'selected' | 'empty'

const ACTIVE_DATABASE_TONE_CLASSES: Record<ActiveDatabaseTone, { line: string; icon: string }> = {
  selected: {
    line: 'text-light-on-surface-variant dark:text-dark-on-surface-variant',
    icon: 'text-light-primary dark:text-dark-primary',
  },
  empty: {
    line: 'text-light-text-disabled dark:text-dark-text-disabled',
    icon: 'text-light-text-disabled dark:text-dark-text-disabled',
  },
}

interface ActiveDatabaseLineProps {
  tone: ActiveDatabaseTone
  title: string
  children: ReactNode
}

function ActiveDatabaseLine({ tone, title, children }: ActiveDatabaseLineProps) {
  const toneClasses = ACTIVE_DATABASE_TONE_CLASSES[tone]
  return (
    <span
      className={joinClassNames([
        'flex min-w-0 items-center gap-1.5 text-caption',
        toneClasses.line,
      ])}
      title={title}
      data-testid="connection-active-database"
    >
      <Database
        size={12}
        weight="regular"
        className={joinClassNames(['shrink-0', toneClasses.icon])}
        aria-hidden
      />
      <span className="truncate">{children}</span>
    </span>
  )
}

function ActiveDatabaseBadge({ activeDatabase }: { activeDatabase: string | null }) {
  if (!activeDatabase) {
    return (
      <ActiveDatabaseLine tone="empty" title="No active database">
        No database selected
      </ActiveDatabaseLine>
    )
  }
  return (
    <ActiveDatabaseLine tone="selected" title={`Active database: ${activeDatabase}`}>
      <span className="sr-only">Active database: </span>
      {activeDatabase}
    </ActiveDatabaseLine>
  )
}

function FavouritesToggle({
  favouritesOpen,
  onToggle,
}: {
  favouritesOpen: boolean
  onToggle: () => void
}) {
  const label = favouritesOpen ? 'Show object browser' : 'Show favourites'
  return (
    <IconButton onClick={onToggle} aria-label={label} title={label} data-testid="favourites-toggle">
      {favouritesOpen ? (
        <Database size={16} weight="regular" />
      ) : (
        <Star size={16} weight="regular" />
      )}
    </IconButton>
  )
}

export function ConnectionHeader({
  connectionId,
  favouritesOpen,
  onToggleFavourites,
}: ConnectionHeaderProps) {
  const activeConnection = useConnectionStore(
    (state) => state.activeConnections[connectionId] ?? null
  )
  const refreshAll = useSchemaStore((state) => state.refreshAll)

  if (!activeConnection) return null

  const connectionName = activeConnection.profile.name
  const serverVersion = activeConnection.serverVersion || FALLBACK_SERVER_VERSION
  const statusDisplay = connectionStatusDisplay(activeConnection.status)
  const activeDatabase =
    activeConnection.sessionDatabase ?? activeConnection.profile.defaultDatabase ?? null

  const handleRefresh = () => {
    void refreshAll(connectionId)
  }

  return (
    <div
      className="flex shrink-0 items-center gap-2.5 px-3 pt-3 pb-1"
      data-testid="connection-header"
    >
      <ConnectionTile color={activeConnection.profile.color} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-size-body leading-4.5 font-semibold text-light-on-surface dark:text-dark-on-surface">
          {connectionName}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className={joinClassNames([
              'inline-block size-1.5 shrink-0 rounded-round',
              statusDisplay.className,
            ])}
            title={statusDisplay.label}
            data-testid="connection-status-indicator"
          />
          <span className="truncate text-caption text-light-on-surface-variant dark:text-dark-on-surface-variant">
            {serverVersion}
          </span>
        </span>
        <ActiveDatabaseBadge activeDatabase={activeDatabase} />
      </div>
      <FavouritesToggle favouritesOpen={favouritesOpen} onToggle={onToggleFavourites} />
      <IconButton
        onClick={handleRefresh}
        aria-label="Refresh all databases"
        title="Refresh all databases"
      >
        <ArrowClockwise size={16} weight="regular" />
      </IconButton>
    </div>
  )
}
