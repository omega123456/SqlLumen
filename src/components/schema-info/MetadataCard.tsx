import type { TableMetadata } from '../../types/schema'
import { ElevatedSurface } from '../common/ElevatedSurface'
import styles from './MetadataCard.module.css'

export interface MetadataCardProps {
  metadata: TableMetadata
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return dateStr
  }
}

export function MetadataCard({ metadata }: MetadataCardProps) {
  return (
    <ElevatedSurface className={styles.card} data-testid="metadata-card">
      <h4 className={styles.title}>Metadata</h4>
      <dl className={styles.list}>
        <div className={styles.item}>
          <dt className={styles.label}>Engine</dt>
          <dd className={styles.value}>{metadata.engine}</dd>
        </div>
        <div className={styles.item}>
          <dt className={styles.label}>Collation</dt>
          <dd className={styles.value}>{metadata.collation}</dd>
        </div>
        <div className={styles.item}>
          <dt className={styles.label}>Auto Increment</dt>
          <dd className={styles.value}>
            {metadata.autoIncrement != null ? metadata.autoIncrement.toLocaleString() : '—'}
          </dd>
        </div>
        <div className={styles.item}>
          <dt className={styles.label}>Created</dt>
          <dd className={styles.value}>{formatDate(metadata.createTime)}</dd>
        </div>
      </dl>
    </ElevatedSurface>
  )
}
