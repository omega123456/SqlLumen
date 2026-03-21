import styles from './Sidebar.module.css'

export function Sidebar() {
  return (
    <div className={styles.sidebar} data-testid="sidebar-inner">
      <span className={styles.emptyState}>No active connection</span>
    </div>
  )
}
