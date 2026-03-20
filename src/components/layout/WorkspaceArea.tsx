import styles from './WorkspaceArea.module.css'

export function WorkspaceArea() {
  return (
    <div className={styles.workspace}>
      <div className={styles.welcomeCard}>
        <h2 className={styles.welcomeTitle}>Welcome!</h2>
        <p className={styles.welcomeMessage}>Connect to a MySQL server to get started</p>
        <button className={styles.newConnectionButton} type="button">
          + New Connection
        </button>
      </div>
    </div>
  )
}
