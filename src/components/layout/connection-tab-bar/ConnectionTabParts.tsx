import {
  SunIcon,
  MoonIcon,
  GearSixIcon,
  ClockCounterClockwiseIcon,
  LockIcon,
  MagnifyingGlassIcon,
} from '@phosphor-icons/react'
import { useCommandPaletteStore } from '../../../stores/command-palette-store'
import { useShortcutStore } from '../../../stores/shortcut-store'
import { shortcutLabelParts } from '../../../lib/shortcut-labels'
import { Button } from '../../common/Button'
import { FOCUS_RING } from '../../../lib/focus-ring'
import { joinClassNames } from '../../../lib/class-names'
import { IconButton } from '../../common/IconButton'
import type { Theme } from '../../../stores/theme-store'
import type { ActiveConnection } from '../../../types/connection'
import { ConnectionStatusIndicator } from '../ConnectionStatusIndicator'
import type { PendingConnectionClose } from './connection-tab-model'

export function ConnectionTabPrefix({ connection }: { connection: ActiveConnection }) {
  return (
    <>
      {connection.profile.color ? (
        <span
          className="absolute top-1/2 left-1 -mt-2 h-4 w-0.75 rounded-track"
          style={{ backgroundColor: connection.profile.color }}
          data-testid={`connection-color-marker-${connection.id}`}
          aria-hidden
        />
      ) : null}
      <ConnectionStatusIndicator status={connection.status} size={8} />
      {connection.profile.readOnly ? (
        <LockIcon
          className="shrink-0 text-light-on-surface-variant dark:text-dark-on-surface-variant"
          size={12}
          weight="fill"
          aria-label="Read-only connection"
        />
      ) : null}
    </>
  )
}

export function ThemeToggleButton({
  resolvedTheme,
  onToggle,
}: {
  resolvedTheme: Theme
  onToggle: () => void
}) {
  const isLight = resolvedTheme === 'light'
  const label = isLight ? 'Switch to dark mode' : 'Switch to light mode'
  return (
    <IconButton
      size="lg"
      aria-label={label}
      title={label}
      onClick={onToggle}
      data-testid="theme-toggle"
    >
      {isLight ? <SunIcon size={16} weight="regular" /> : <MoonIcon size={16} weight="regular" />}
    </IconButton>
  )
}

export function CloseConnectionMessage({ pending }: { pending: PendingConnectionClose | null }) {
  if (!pending) return null
  return (
    <>
      Disconnect <strong>{pending.displayName}</strong> ({pending.hostPort})? Open workspace tabs
      for this connection will be closed.
    </>
  )
}

interface ConnectionStripToolsProps {
  resolvedTheme: Theme
  onToggleTheme: () => void
  onOpenSettings?: () => void
  onOpenSnapshots?: () => void
}

function PaletteSearchButton() {
  const togglePalette = useCommandPaletteStore((state) => state.toggle)
  const paletteBinding = useShortcutStore((state) => state.shortcuts['command-palette'])
  return (
    <Button
      variant="bare"
      className={joinClassNames([
        'flex h-7.5 w-70 flex-none cursor-default items-center justify-start gap-2 self-center rounded-control border border-light-stroke-control border-b-light-stroke-control-bottom bg-light-fill-control pr-1.5 pl-2.5 font-body text-body whitespace-nowrap text-light-on-surface dark:border-dark-stroke-control dark:border-b-dark-stroke-control-bottom dark:bg-dark-fill-control dark:text-dark-on-surface',
        FOCUS_RING,
        'not-disabled:hover:bg-light-fill-control-hover dark:not-disabled:hover:bg-dark-fill-control-hover not-disabled:active:bg-light-fill-control-hover dark:not-disabled:active:bg-dark-fill-control-hover',
      ])}
      onClick={() => togglePalette()}
      data-testid="connection-strip-search"
    >
      <MagnifyingGlassIcon size={16} weight="regular" aria-hidden />
      <span className="min-w-0 truncate">Search tables, views, routines</span>
      {paletteBinding ? (
        <span className="ml-auto rounded-bar border border-light-stroke-card px-1.25 text-key-hint text-light-outline dark:border-dark-stroke-card dark:text-dark-outline">
          {shortcutLabelParts(paletteBinding).join(' ')}
        </span>
      ) : null}
    </Button>
  )
}

export function ConnectionStripTools(tools: ConnectionStripToolsProps) {
  return (
    <>
      <PaletteSearchButton />
      <div className="flex shrink-0 items-center gap-0.5 pr-2 pl-3">
        <ThemeToggleButton resolvedTheme={tools.resolvedTheme} onToggle={tools.onToggleTheme} />
        <IconButton
          size="lg"
          aria-label="Session snapshots"
          title="Session snapshots"
          onClick={tools.onOpenSnapshots}
          data-testid="snapshots-button"
        >
          <ClockCounterClockwiseIcon size={16} weight="regular" />
        </IconButton>
        <IconButton
          size="lg"
          aria-label="Settings"
          title="Settings"
          onClick={tools.onOpenSettings}
          data-testid="settings-button"
        >
          <GearSixIcon size={16} weight="regular" />
        </IconButton>
      </div>
    </>
  )
}
