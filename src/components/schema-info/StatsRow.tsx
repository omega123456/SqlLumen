import type { TableMetadata } from '../../types/schema'
import styles from './StatsRow.module.css'

export interface StatsRowProps {
  metadata: TableMetadata
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function StatsRow({ metadata }: StatsRowProps) {
  return (
    <div className={styles.container} data-testid="stats-row">
      <div className={styles.card}>
        <div className={styles.cardLabel}>Total Rows</div>
        <div className={styles.cardValue}>{metadata.tableRows.toLocaleString()}</div>
      </div>
      <div className={styles.card}>
        <div className={styles.cardLabel}>Storage Engine</div>
        <div className={styles.cardValue}>{metadata.engine}</div>
      </div>
      <div className={styles.card}>
        <div className={styles.cardLabel}>Index Size</div>
        <div className={styles.cardValue}>{formatBytes(metadata.indexLength)}</div>
      </div>
    </div>
  )
}
