import type { TableMetadata } from '../../types/schema'
import { ElevatedSurface } from '../common/ElevatedSurface'
import styles from './StatsRow.module.css'
import { BYTES_PER_GIGABYTE, BYTES_PER_KILOBYTE, BYTES_PER_MEGABYTE } from '../../lib/units'

function joinClasses(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export interface StatsRowProps {
  metadata: TableMetadata
  /** When set, shows a Columns card after Total rows. */
  columnCount?: number
}

function formatBytes(bytes: number): string {
  if (bytes < BYTES_PER_KILOBYTE) return `${bytes} B`
  if (bytes < BYTES_PER_MEGABYTE) return `${(bytes / BYTES_PER_KILOBYTE).toFixed(1)} KB`
  if (bytes < BYTES_PER_GIGABYTE) return `${(bytes / BYTES_PER_MEGABYTE).toFixed(1)} MB`
  return `${(bytes / BYTES_PER_GIGABYTE).toFixed(1)} GB`
}

export function StatsRow({ metadata, columnCount }: StatsRowProps) {
  const showColumnCard = columnCount != null

  return (
    <div
      className={joinClasses(styles.container, showColumnCard ? styles.containerFour : undefined)}
      data-testid="stats-row"
    >
      <ElevatedSurface className={styles.card}>
        <div className={styles.cardLabel}>Total rows</div>
        <div className={styles.cardValue}>{metadata.tableRows.toLocaleString()}</div>
      </ElevatedSurface>
      {showColumnCard ? (
        <ElevatedSurface className={styles.card} data-testid="stats-columns-card">
          <div className={styles.cardLabel}>Columns</div>
          <div className={styles.cardValue}>{columnCount.toLocaleString()}</div>
        </ElevatedSurface>
      ) : null}
      <ElevatedSurface className={styles.card}>
        <div className={styles.cardLabel}>Storage engine</div>
        <div className={styles.cardValue}>{metadata.engine}</div>
      </ElevatedSurface>
      <ElevatedSurface className={styles.card}>
        <div className={styles.cardLabel}>Index size</div>
        <div className={styles.cardValue}>{formatBytes(metadata.indexLength)}</div>
      </ElevatedSurface>
    </div>
  )
}
