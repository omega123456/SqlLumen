import { formatShortDate } from '../../lib/format-utils'
import type { TableMetadata } from '../../types/schema'
import { ElevatedSurface } from '../common/ElevatedSurface'
import styles from './MetadataCard.module.css'

export interface MetadataCardProps {
  metadata: TableMetadata
}

const MISSING_VALUE_LABEL = '—'

function isInvalidDate(dateText: string): boolean {
  return Number.isNaN(new Date(dateText).getTime())
}

function formatDate(dateText: string | null): string {
  if (!dateText) return MISSING_VALUE_LABEL
  if (isInvalidDate(dateText)) return dateText
  return formatShortDate(dateText)
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
          <dt className={styles.label}>Auto increment</dt>
          <dd className={styles.value}>
            {metadata.autoIncrement != null
              ? metadata.autoIncrement.toLocaleString()
              : MISSING_VALUE_LABEL}
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
