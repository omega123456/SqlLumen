import { useConnectionStore } from '../../stores/connection-store'
import { ConnectionStatusIndicator } from './ConnectionStatusIndicator'
import styles from './StatusBar.module.css'

const statusLabel: Record<string, string> = {
  connected: 'Connected',
  reconnecting: 'Reconnecting...',
  disconnected: 'Disconnected',
}

export function StatusBar() {
  const activeConnections = useConnectionStore((state) => state.activeConnections)
  const activeTabId = useConnectionStore((state) => state.activeTabId)

  const activeConnection = activeTabId ? activeConnections[activeTabId] : null

  if (!activeConnection) {
    return (
      <div className={styles.statusBar} data-testid="status-bar">
        <span className={styles.statusText}>Ready</span>
      </div>
    )
  }

  return (
    <div className={styles.statusBar} data-testid="status-bar">
      <div className={styles.statusLeft}>
        <ConnectionStatusIndicator status={activeConnection.status} size={10} />
        <span className={styles.statusText}>{statusLabel[activeConnection.status]}</span>
      </div>
      <div className={styles.statusCenter}>
        <span className={styles.statusText}>
          {activeConnection.profile.name} — {activeConnection.profile.host}:
          {activeConnection.profile.port}
        </span>
      </div>
      <div className={styles.statusRight}>
        <span className={styles.statusText}>{activeConnection.serverVersion}</span>
      </div>
    </div>
  )
}
