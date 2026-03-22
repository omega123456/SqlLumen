import type { TableMetadata } from '../../types/schema'
import { ElevatedSurface } from '../common/ElevatedSurface'
import styles from './StatsRow.module.css'

function joinClasses(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export interface StatsRowProps {
  metadata: TableMetadata
  /** When set, shows a Column count card after Total Rows. */
  columnCount?: number
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function StatsRow({ metadata, columnCount }: StatsRowProps) {
  const showColumnCard = columnCount != null

  return (
    <div
      className={joinClasses(styles.container, showColumnCard ? styles.containerFour : undefined)}
      data-testid="stats-row"
    >
      <ElevatedSurface className={styles.card}>
        <div className={styles.cardLabel}>Total Rows</div>
        <div className={styles.cardValue}>{metadata.tableRows.toLocaleString()}</div>
      </ElevatedSurface>
      {showColumnCard ? (
        <ElevatedSurface className={styles.card} data-testid="stats-columns-card">
          <div className={styles.cardLabel}>Column count</div>
          <div className={styles.cardValue}>{columnCount.toLocaleString()}</div>
        </ElevatedSurface>
      ) : null}
      <ElevatedSurface className={styles.card}>
        <div className={styles.cardLabel}>Storage Engine</div>
        <div className={styles.cardValue}>{metadata.engine}</div>
      </ElevatedSurface>
      <ElevatedSurface className={styles.card}>
        <div className={styles.cardLabel}>Index Size</div>
        <div className={styles.cardValue}>{formatBytes(metadata.indexLength)}</div>
      </ElevatedSurface>
    </div>
  )
}
