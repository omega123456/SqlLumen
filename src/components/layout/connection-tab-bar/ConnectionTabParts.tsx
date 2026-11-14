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
import { IconButton } from '../../common/IconButton'
import type { Theme } from '../../../stores/theme-store'
import type { ActiveConnection } from '../../../types/connection'
import { ConnectionStatusIndicator } from '../ConnectionStatusIndicator'
import type { PendingConnectionClose } from './connection-tab-model'
import styles from '../ConnectionTabBar.module.css'

export function ConnectionTabPrefix({ connection }: { connection: ActiveConnection }) {
  return (
    <>
      {connection.profile.color ? (
        <span
          className={styles.colorMarker}
          style={{ backgroundColor: connection.profile.color }}
          data-testid={`connection-color-marker-${connection.id}`}
          aria-hidden
        />
      ) : null}
      <ConnectionStatusIndicator status={connection.status} size={8} />
      {connection.profile.readOnly ? (
        <LockIcon
          className={styles.readOnlyIcon}
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
      variant="subtle"
      className={styles.searchBox}
      onClick={() => togglePalette()}
      data-testid="connection-strip-search"
    >
      <MagnifyingGlassIcon size={16} weight="regular" aria-hidden />
      <span className={styles.searchLabel}>Search tables, views, routines</span>
      {paletteBinding ? (
        <span className={styles.searchShortcut}>
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
      <div className={styles.tools}>
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
