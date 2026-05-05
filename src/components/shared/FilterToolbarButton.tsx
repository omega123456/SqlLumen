/**
 * FilterToolbarButton — shared filter button with active badge and clear action.
 *
 * Used by both TableDataToolbar and ResultToolbar to provide consistent
 * filter UI: a filter button with an active-count badge and a clear button.
 */

import { Funnel, FunnelX } from '@phosphor-icons/react'
import styles from './FilterToolbarButton.module.css'

export interface FilterToolbarButtonProps {
  /** Whether any filters are currently active (controls badge visibility and active styling). */
  isActive: boolean
  /** Number of active filter conditions (displayed in the badge). */
  activeCount: number
  /** Called when the main filter button is clicked. */
  onFilterClick: () => void
  /** Called when the clear-filter button is clicked. */
  onClearClick: () => void
  /** Disables both buttons when true. */
  isDisabled?: boolean
  /** Optional test id override for the filter button. */
  filterButtonTestId?: string
  /** Optional test id override for the active filter badge. */
  filterBadgeTestId?: string
  /** Optional test id override for the clear button. */
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
        <button
          type="button"
          className={styles.filterButton}
          onClick={onFilterClick}
          disabled={isDisabled}
          title="Filter"
          data-testid={filterButtonTestId}
        >
          <Funnel size={16} weight={isActive ? 'fill' : 'regular'} />
          <span>Filter</span>
        </button>
        {isActive && (
          <span className={styles.filterBadge} data-testid={filterBadgeTestId}>
            {activeCount}
          </span>
        )}
      </div>

      {isActive && (
        <button
          type="button"
          className={styles.clearFilterButton}
          onClick={onClearClick}
          disabled={isDisabled}
          title="Clear filters"
          aria-label="Clear filters"
          data-testid={clearButtonTestId}
        >
          <FunnelX size={16} weight="regular" />
        </button>
      )}
    </>
  )
}
