import styles from './StatusBar.module.css'

export function StatusBar() {
  return (
    <div className={styles.statusBar}>
      <span className={styles.statusText}>Ready</span>
    </div>
  )
}
