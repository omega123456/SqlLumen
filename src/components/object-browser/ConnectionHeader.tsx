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
  const serverVersion = activeConnection.serverVersion || 'MySQL server'
  const connectionStatus = activeConnection.status
  const activeDatabase =
    activeConnection.sessionDatabase ?? activeConnection.profile.defaultDatabase ?? null

  const statusClass =
    connectionStatus === 'connected'
      ? styles.statusConnected
      : connectionStatus === 'reconnecting'
        ? styles.statusReconnecting
        : styles.statusDisconnected

  const statusLabel =
    connectionStatus === 'connected'
      ? 'Connected'
      : connectionStatus === 'reconnecting'
        ? 'Reconnecting'
        : 'Disconnected'

  const handleRefresh = () => {
    void refreshAll(connectionId)
  }

  return (
    <div className={styles.header} data-testid="connection-header">
      <div
        className={styles.iconWrapper}
        style={
          activeConnection.profile.color
            ? ({ '--connection-color': activeConnection.profile.color } as CSSProperties)
            : undefined
        }
      >
        <Database size={16} weight="regular" />
      </div>
      <div className={styles.info}>
        <span className={styles.connectionName}>{connectionName}</span>
        <span className={styles.versionRow}>
          <span
            className={`${styles.statusDot} ${statusClass}`}
            title={statusLabel}
            data-testid="connection-status-indicator"
          />
          <span className={styles.serverVersion}>{serverVersion}</span>
        </span>
        {activeDatabase ? (
          <span
            className={styles.activeDatabase}
            title={`Active database: ${activeDatabase}`}
            data-testid="connection-active-database"
          >
            <Database
              size={12}
              weight="regular"
              className={styles.activeDatabaseIcon}
              aria-hidden
            />
            <span className={styles.activeDatabaseName}>
              <span className={styles.srOnly}>Active database: </span>
              {activeDatabase}
            </span>
          </span>
        ) : (
          <span
            className={`${styles.activeDatabase} ${styles.activeDatabaseEmpty}`}
            title="No active database"
            data-testid="connection-active-database"
          >
            <Database
              size={12}
              weight="regular"
              className={styles.activeDatabaseIcon}
              aria-hidden
            />
            <span className={styles.activeDatabaseName}>No database selected</span>
          </span>
        )}
      </div>
      <IconButton
        onClick={onToggleFavourites}
        aria-label={favouritesOpen ? 'Show object browser' : 'Show favourites'}
        title={favouritesOpen ? 'Show object browser' : 'Show favourites'}
        data-testid="favourites-toggle"
      >
        {favouritesOpen ? (
          <Database size={16} weight="regular" />
        ) : (
          <Star size={16} weight="regular" />
        )}
      </IconButton>
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
