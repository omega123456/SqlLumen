import { formatShortDate } from '../../lib/format-utils'
import type { TableMetadata } from '../../types/schema'
import { ElevatedSurface } from '../common/ElevatedSurface'

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

function autoIncrementLabel(autoIncrement: number | null): string {
  if (autoIncrement == null) return MISSING_VALUE_LABEL
  return autoIncrement.toLocaleString()
}

function MetadataItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-size-caption leading-5 text-light-on-surface-variant dark:text-dark-on-surface-variant">
        {label}
      </dt>
      <dd className="m-0 font-mono text-size-cell-mono leading-5 text-light-on-surface dark:text-dark-on-surface">
        {value}
      </dd>
    </div>
  )
}

export function MetadataCard({ metadata }: MetadataCardProps) {
  return (
    <ElevatedSurface
      variant="bordered"
      className="px-3.5 py-3 select-text"
      data-testid="metadata-card"
    >
      <h4 className="mb-2 font-body text-size-caption leading-5 font-semibold text-light-on-surface-variant dark:text-dark-on-surface-variant">
        Metadata
      </h4>
      <dl className="flex flex-col gap-2">
        <MetadataItem label="Engine" value={metadata.engine} />
        <MetadataItem label="Collation" value={metadata.collation} />
        <MetadataItem label="Auto increment" value={autoIncrementLabel(metadata.autoIncrement)} />
        <MetadataItem label="Created" value={formatDate(metadata.createTime)} />
      </dl>
    </ElevatedSurface>
  )
}
