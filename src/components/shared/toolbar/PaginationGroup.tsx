/**
 * PaginationGroup — shared toolbar component for page navigation.
 *
 * Renders a page-size selector, prev/next buttons, and a page indicator.
 * Purely presentational — no store imports.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { Dropdown, type DropdownOption } from '../../common/Dropdown'
import { TextInput } from '../../common/TextInput'
import type {
  KnownTotalPaginationGroupProps,
  PaginationGroupProps,
  UnknownTotalPaginationGroupProps,
} from '../../../types/shared-data-view'
import styles from './toolbar-items.module.css'

const PAGE_SIZE_OPTIONS = [100, 500, 1000, 5000] as const

export function PaginationGroup({
  currentPage,
  pageSize,
  disabled,
  pageSizeDisabled,
  onPageSizeChange,
  onPrevPage,
  onNextPage,
  ...rest
}: PaginationGroupProps) {
  const paginationMode = rest.paginationMode ?? 'known'
  const knownTotalProps = rest as KnownTotalPaginationGroupProps
  const unknownTotalProps = rest as UnknownTotalPaginationGroupProps
  const pageSizeOptions: DropdownOption[] = useMemo(
    () => PAGE_SIZE_OPTIONS.map((size) => ({ value: String(size), label: String(size) })),
    []
  )
  const [pageInputValue, setPageInputValue] = useState(String(currentPage))

  useEffect(() => {
    setPageInputValue(String(currentPage))
  }, [currentPage])

  const handlePageSizeChange = useCallback(
    (value: string) => {
      onPageSizeChange(parseInt(value, 10))
    },
    [onPageSizeChange]
  )

  const isPrevDisabled = disabled || currentPage <= 1
  const isNextDisabled =
    disabled || (paginationMode === 'known' ? currentPage >= knownTotalProps.totalPages : false)

  const handlePageSubmit = useCallback(() => {
    if (paginationMode !== 'unknown') return
    const trimmedValue = pageInputValue.trim()
    const parsedPage = /^\d+$/.test(trimmedValue) ? Number.parseInt(trimmedValue, 10) : NaN
    const nextPage = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1
    unknownTotalProps.onPageSubmit(nextPage)
  }, [paginationMode, pageInputValue, unknownTotalProps])

  const handlePageInputBlur = useCallback(() => {
    setPageInputValue(String(currentPage))
  }, [currentPage])

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
        {paginationMode === 'known' ? (
          <span className={styles.pageText} data-testid="page-indicator">
            Page {currentPage} of {knownTotalProps.totalPages}
          </span>
        ) : (
          <TextInput
            type="text"
            inputMode="numeric"
            aria-label="Current page"
            variant="bare"
            value={pageInputValue}
            onChange={(event) => setPageInputValue(event.target.value)}
            onBlur={handlePageInputBlur}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                handlePageSubmit()
              }
            }}
            disabled={disabled}
            className={styles.pageInput}
            data-testid="pagination-page-input"
          />
        )}
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
