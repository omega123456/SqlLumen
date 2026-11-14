import { Funnel, FunnelX } from '@phosphor-icons/react'
import { Button } from '../common/Button'
import styles from './FilterToolbarButton.module.css'

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
      <div className={`${styles.filterButtonWrapper} ${isActive ? styles.filterButtonActive : ''}`}>
        <Button
          variant="subtle"
          size="sm"
          className={styles.filterButton}
          onClick={onFilterClick}
          disabled={isDisabled}
          title="Filter"
          data-testid={filterButtonTestId}
        >
          <Funnel size={16} weight={isActive ? 'fill' : 'regular'} />
          <span>Filter</span>
        </Button>
        {isActive && (
          <span className={styles.filterBadge} data-testid={filterBadgeTestId}>
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
