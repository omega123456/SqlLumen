/**
 * PaginationGroup — shared toolbar component for page navigation.
 *
 * Renders a page-size selector, prev/next buttons, and a page indicator.
 * Purely presentational — no store imports.
 */

import { useCallback, useMemo } from 'react'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { Dropdown, type DropdownOption } from '../../common/Dropdown'
import type { PaginationGroupProps } from '../../../types/shared-data-view'
import styles from './toolbar-items.module.css'

const PAGE_SIZE_OPTIONS = [100, 500, 1000, 5000] as const

export function PaginationGroup({
  currentPage,
  totalPages,
  pageSize,
  disabled,
  pageSizeDisabled,
  onPageSizeChange,
  onPrevPage,
  onNextPage,
}: PaginationGroupProps) {
  const pageSizeOptions: DropdownOption[] = useMemo(
    () => PAGE_SIZE_OPTIONS.map((size) => ({ value: String(size), label: String(size) })),
    []
  )

  const handlePageSizeChange = useCallback(
    (value: string) => {
      onPageSizeChange(parseInt(value, 10))
    },
    [onPageSizeChange]
  )

  const isPrevDisabled = disabled || currentPage <= 1
  const isNextDisabled = disabled || currentPage >= totalPages

  return (
    <div className={styles.paginationGroup} data-testid="pagination-group">
      <Dropdown
        id="page-size-dropdown"
        ariaLabel="Page size"
        options={pageSizeOptions}
        value={String(pageSize)}
        onChange={handlePageSizeChange}
        disabled={disabled || pageSizeDisabled}
        data-testid="page-size-select"
        triggerClassName={styles.pageSizeSelect}
      />

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
