import { Funnel, FunnelX } from '@phosphor-icons/react'
import { Button, type ButtonVariant } from '../common/Button'
import { CountBadgeAnchor } from './toolbar/CountBadgeAnchor'

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

function filterBadgeText(isActive: boolean, activeCount: number): string | null {
  if (!isActive) return null
  return String(activeCount)
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
      <CountBadgeAnchor
        badge={filterBadgeText(isActive, activeCount)}
        badgeTestId={filterBadgeTestId}
      >
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
      </CountBadgeAnchor>

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
