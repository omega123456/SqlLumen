/**
 * PaginationGroup — shared toolbar component for page navigation.
 *
 * Renders a page-size selector, prev/next buttons, and a page indicator.
 * Purely presentational — no store imports.
 */

import { useCallback } from 'react'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import type { PaginationGroupProps } from '../../../types/shared-data-view'
import styles from './toolbar-items.module.css'

const PAGE_SIZE_OPTIONS = [100, 500, 1000, 5000] as const

export function PaginationGroup({
  currentPage,
  totalPages,
  pageSize,
  disabled,
  onPageSizeChange,
  onPrevPage,
  onNextPage,
}: PaginationGroupProps) {
  const handlePageSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onPageSizeChange(parseInt(e.target.value, 10))
    },
    [onPageSizeChange]
  )

  const isPrevDisabled = disabled || currentPage <= 1
  const isNextDisabled = disabled || currentPage >= totalPages

  return (
    <div className={styles.paginationGroup} data-testid="pagination-group">
      <select
        className={styles.pageSizeSelect}
        value={pageSize}
        onChange={handlePageSizeChange}
        disabled={disabled}
        data-testid="page-size-select"
        aria-label="Page size"
      >
        {PAGE_SIZE_OPTIONS.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </select>

      <div className={styles.pagination}>
        <button
          type="button"
          className={styles.pageButton}
          disabled={isPrevDisabled}
          onClick={onPrevPage}
          aria-label="Previous page"
          data-testid="pagination-prev"
        >
          <CaretLeft size={14} weight="bold" />
        </button>
        <span className={styles.pageText} data-testid="page-indicator">
          Page {currentPage} of {totalPages}
        </span>
        <button
          type="button"
          className={styles.pageButton}
          disabled={isNextDisabled}
          onClick={onNextPage}
          aria-label="Next page"
          data-testid="pagination-next"
        >
          <CaretRight size={14} weight="bold" />
        </button>
      </div>
    </div>
  )
}
