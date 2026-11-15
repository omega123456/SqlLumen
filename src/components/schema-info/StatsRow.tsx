import type { TableMetadata } from '../../types/schema'
import { joinClassNames } from '../../lib/class-names'
import { BYTES_PER_GIGABYTE, BYTES_PER_KILOBYTE, BYTES_PER_MEGABYTE } from '../../lib/units'
import { ElevatedSurface } from '../common/ElevatedSurface'

export interface StatsRowProps {
  metadata: TableMetadata
  columnCount?: number
}

type StatsLayout = 'threeCards' | 'fourCards'

const STATS_LAYOUT_CLASSES: Record<StatsLayout, string> = {
  threeCards: 'grid-cols-3',
  fourCards: 'grid-cols-4',
}

function statsLayoutOf(showColumnCard: boolean): StatsLayout {
  if (showColumnCard) return 'fourCards'
  return 'threeCards'
}

function formatBytes(bytes: number): string {
  if (bytes < BYTES_PER_KILOBYTE) return `${bytes} B`
  if (bytes < BYTES_PER_MEGABYTE) return `${(bytes / BYTES_PER_KILOBYTE).toFixed(1)} KB`
  if (bytes < BYTES_PER_GIGABYTE) return `${(bytes / BYTES_PER_MEGABYTE).toFixed(1)} MB`
  return `${(bytes / BYTES_PER_GIGABYTE).toFixed(1)} GB`
}

interface StatCardProps {
  label: string
  value: string
  'data-testid'?: string
}

function StatCard({ label, value, 'data-testid': testId }: StatCardProps) {
  return (
    <ElevatedSurface
      variant="bordered"
      className="flex flex-col gap-0.5 px-3.5 py-3"
      data-testid={testId}
    >
      <div className="text-size-caption leading-5 text-light-on-surface-variant dark:text-dark-on-surface-variant">
        {label}
      </div>
      <div className="font-headline text-subtitle font-semibold text-light-on-surface tabular-nums dark:text-dark-on-surface">
        {value}
      </div>
    </ElevatedSurface>
  )
}

export function StatsRow({ metadata, columnCount }: StatsRowProps) {
  const showColumnCard = columnCount != null

  return (
    <div
      className={joinClassNames([
        'grid flex-none gap-2 px-5 pt-2.5 pb-3.5 select-text',
        STATS_LAYOUT_CLASSES[statsLayoutOf(showColumnCard)],
      ])}
      data-testid="stats-row"
    >
      <StatCard label="Total rows" value={metadata.tableRows.toLocaleString()} />
      {showColumnCard ? (
        <StatCard
          label="Columns"
          value={columnCount.toLocaleString()}
          data-testid="stats-columns-card"
        />
      ) : null}
      <StatCard label="Storage engine" value={metadata.engine} />
      <StatCard label="Index size" value={formatBytes(metadata.indexLength)} />
    </div>
  )
}
