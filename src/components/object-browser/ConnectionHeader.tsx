import { Database, ArrowClockwise } from '@phosphor-icons/react'
import { useConnectionStore } from '../../stores/connection-store'
import { useSchemaStore } from '../../stores/schema-store'
import styles from './ConnectionHeader.module.css'

export interface ConnectionHeaderProps {
  connectionId: string
}

export function ConnectionHeader({ connectionId }: ConnectionHeaderProps) {
  const activeConnection = useConnectionStore(
    (state) => state.activeConnections[connectionId] ?? null
  )
  const refreshAll = useSchemaStore((state) => state.refreshAll)

  if (!activeConnection) return null

  const connectionName = activeConnection.profile.name
  const serverVersion = activeConnection.serverVersion || 'MySQL Server'
  const connectionStatus = activeConnection.status

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
      <div className={styles.iconWrapper}>
        <Database size={18} weight="regular" />
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
      </div>
      <button
        type="button"
        className={styles.refreshButton}
        onClick={handleRefresh}
        aria-label="Refresh all databases"
        title="Refresh all databases"
      >
        <ArrowClockwise size={16} weight="regular" />
      </button>
    </div>
  )
}
