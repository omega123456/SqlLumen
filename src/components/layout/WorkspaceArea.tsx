import { useConnectionStore } from '../../stores/connection-store'
import styles from './WorkspaceArea.module.css'

export function WorkspaceArea() {
  const activeConnections = useConnectionStore((state) => state.activeConnections)
  const activeTabId = useConnectionStore((state) => state.activeTabId)
  const openDialog = useConnectionStore((state) => state.openDialog)

  const activeConnection = activeTabId ? activeConnections[activeTabId] : null

  if (activeConnection) {
    return (
      <div className={styles.workspace} data-testid="workspace-area">
        <div className={styles.connectedPlaceholder}>
          <p className={styles.connectedText}>
            Connected to {activeConnection.profile.name} ({activeConnection.profile.host}:
            {activeConnection.profile.port})
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.workspace} data-testid="workspace-area">
      <div className={styles.welcomeCard}>
        <h2 className={styles.welcomeTitle}>Welcome!</h2>
        <p className={styles.welcomeMessage}>Connect to a MySQL server to get started</p>
        <button className="ui-button-primary" type="button" onClick={openDialog}>
          + New Connection
        </button>
      </div>
    </div>
  )
}
