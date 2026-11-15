import { Funnel, FunnelX } from '@phosphor-icons/react'
import { Button, type ButtonVariant } from '../common/Button'

export interface FilterToolbarButtonProps {
  isActive: boolean
  activeCount: number
  onFilterClick: () => void
  onClearClick: () => void
  isDisabled?: boolean
  filterButtonTestId?: string
  filterBadgeTestId?: string
  clearButtonTestId?: string
}

function filterButtonVariant(isActive: boolean): ButtonVariant {
  if (isActive) return 'subtleAccent'
  return 'subtle'
}

export function FilterToolbarButton({
  isActive,
  activeCount,
  onFilterClick,
  onClearClick,
  isDisabled = false,
  filterButtonTestId = 'btn-filter',
  filterBadgeTestId = 'filter-badge',
  clearButtonTestId = 'btn-clear-filter',
}: FilterToolbarButtonProps) {
  return (
    <>
      <div className="relative -mt-1 flex items-center overflow-visible pt-1">
        <Button
          variant={filterButtonVariant(isActive)}
          size="sm"
          className="shrink-0"
          onClick={onFilterClick}
          disabled={isDisabled}
          title="Filter"
          data-testid={filterButtonTestId}
        >
          <Funnel size={16} weight={isActive ? 'fill' : 'regular'} />
          <span>Filter</span>
        </Button>
        {isActive && (
          <span
            className="pointer-events-none absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-badge bg-light-primary px-0.5 font-mono text-size-caption font-semibold text-light-on-primary dark:bg-dark-primary dark:text-dark-on-primary"
            data-testid={filterBadgeTestId}
          >
            {activeCount}
          </span>
        )}
      </div>

      {isActive && (
        <Button
          variant="subtle"
          size="sm"
          iconOnly
          onClick={onClearClick}
          disabled={isDisabled}
          title="Clear filters"
          aria-label="Clear filters"
          data-testid={clearButtonTestId}
        >
          <FunnelX size={16} weight="regular" />
        </Button>
      )}
    </>
  )
}
