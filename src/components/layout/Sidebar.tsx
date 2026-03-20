import styles from './Sidebar.module.css'

export function Sidebar() {
  return (
    <div className={styles.sidebar}>
      <span className={styles.emptyState}>No active connection</span>
    </div>
  )
}
