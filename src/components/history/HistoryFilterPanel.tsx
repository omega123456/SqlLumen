import { Button } from '../common/Button'
import { FOCUS_RING } from '../../lib/focus-ring'
import { joinClassNames, SCROLLBAR } from '../../lib/class-names'

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

type FilterButtonState = 'idle' | 'active'

const FILTER_BUTTON_STATE_CLASSES: Record<FilterButtonState, string> = {
  idle: 'hover:bg-light-fill-subtle-hover dark:hover:bg-dark-fill-subtle-hover',
  active:
    'bg-light-fill-neutral-selected before:absolute before:top-1/2 before:left-0 before:-mt-2 before:h-4 before:w-0.75 before:rounded-track before:bg-light-primary dark:bg-dark-fill-neutral-selected dark:before:bg-dark-primary',
}

function filterButtonState(isActive: boolean): FilterButtonState {
  if (isActive) return 'active'
  return 'idle'
}

export function HistoryFilterPanel({ value, onChange }: HistoryFilterPanelProps) {
  return (
    <div
      className={joinClassNames([
        'flex h-full flex-col gap-0.5 overflow-y-auto px-2 py-3',
        SCROLLBAR,
      ])}
      data-testid="history-filter-panel"
    >
      <h3 className="px-2 pt-1 pb-1.5 font-body text-caption font-semibold wrap-break-word text-light-on-surface-variant dark:text-dark-on-surface-variant">
        Time range
      </h3>
      {FILTERS.map((filter) => (
        <Button
          variant="bare"
          key={filter.value}
          className={joinClassNames([
            'relative flex h-9 w-full cursor-default items-center rounded-control px-3 text-left font-body text-body text-light-on-surface dark:text-dark-on-surface',
            FOCUS_RING,
            FILTER_BUTTON_STATE_CLASSES[filterButtonState(value === filter.value)],
          ])}
          onClick={() => onChange(filter.value)}
          aria-pressed={value === filter.value}
          data-testid={`filter-${filter.value}`}
        >
          {filter.label}
        </Button>
      ))}
    </div>
  )
}
