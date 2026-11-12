import type { CSSProperties } from 'react'
import { Database, ArrowClockwise, Star } from '@phosphor-icons/react'
import { useConnectionStore } from '../../stores/connection-store'
import { useSchemaStore } from '../../stores/schema-store'
import { IconButton } from '../common/IconButton'
import styles from './ConnectionHeader.module.css'

export interface ConnectionHeaderProps {
  connectionId: string
  favouritesOpen: boolean
  onToggleFavourites: () => void
}

const CONNECTION_STATUS_DISPLAY: Record<string, { className: string; label: string }> = {
  connected: { className: styles.statusConnected, label: 'Connected' },
  reconnecting: { className: styles.statusReconnecting, label: 'Reconnecting' },
  disconnected: { className: styles.statusDisconnected, label: 'Disconnected' },
}

const FALLBACK_SERVER_VERSION = 'MySQL server'

function connectionStatusDisplay(status: string) {
  return CONNECTION_STATUS_DISPLAY[status] ?? CONNECTION_STATUS_DISPLAY.disconnected
}

function connectionColorStyle(color: string | null | undefined): CSSProperties | undefined {
  if (!color) return undefined
  return { '--connection-color': color } as CSSProperties
}

function ActiveDatabaseBadge({ activeDatabase }: { activeDatabase: string | null }) {
  if (!activeDatabase) {
    return (
      <span
        className={`${styles.activeDatabase} ${styles.activeDatabaseEmpty}`}
        title="No active database"
        data-testid="connection-active-database"
      >
        <Database size={12} weight="regular" className={styles.activeDatabaseIcon} aria-hidden />
        <span className={styles.activeDatabaseName}>No database selected</span>
      </span>
    )
  }
  return (
    <span
      className={styles.activeDatabase}
      title={`Active database: ${activeDatabase}`}
      data-testid="connection-active-database"
    >
      <Database size={12} weight="regular" className={styles.activeDatabaseIcon} aria-hidden />
      <span className={styles.activeDatabaseName}>
        <span className={styles.srOnly}>Active database: </span>
        {activeDatabase}
      </span>
    </span>
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
    <div className={styles.header} data-testid="connection-header">
      <div
        className={styles.iconWrapper}
        style={connectionColorStyle(activeConnection.profile.color)}
      >
        <Database size={16} weight="regular" />
      </div>
      <div className={styles.info}>
        <span className={styles.connectionName}>{connectionName}</span>
        <span className={styles.versionRow}>
          <span
            className={`${styles.statusDot} ${statusDisplay.className}`}
            title={statusDisplay.label}
            data-testid="connection-status-indicator"
          />
          <span className={styles.serverVersion}>{serverVersion}</span>
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
