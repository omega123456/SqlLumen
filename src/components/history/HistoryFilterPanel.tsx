import styles from './HistoryFilterPanel.module.css'

export type TimeRange = 'all' | '24h' | '7d' | '30d'

export interface HistoryFilterPanelProps {
  value: TimeRange
  onChange: (range: TimeRange) => void
}

const FILTERS: { label: string; value: TimeRange }[] = [
  { label: 'All history', value: 'all' },
  { label: 'Past 24 hours', value: '24h' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
]

export function HistoryFilterPanel({ value, onChange }: HistoryFilterPanelProps) {
  return (
    <div className={styles.panel} data-testid="history-filter-panel">
      <h3 className={styles.heading}>Time range</h3>
      {FILTERS.map((filter) => (
        <button
          key={filter.value}
          type="button"
          className={`${styles.filterButton} ${value === filter.value ? styles.filterButtonActive : ''}`}
          onClick={() => onChange(filter.value)}
          aria-pressed={value === filter.value}
          data-testid={`filter-${filter.value}`}
        >
          {filter.label}
        </button>
      ))}
    </div>
  )
}
