/**
 * PaginationGroup — shared toolbar component for page navigation.
 *
 * Renders a page-size selector, prev/next buttons, and a page indicator.
 * Purely presentational — no store imports.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CaretLeftIcon, CaretRightIcon, SkipBackIcon, SkipForwardIcon } from '@phosphor-icons/react'
import { IconButton } from '../../common/IconButton'
import { Dropdown, type DropdownOption } from '../../common/Dropdown'
import { TextInput } from '../../common/TextInput'
import type {
  KnownTotalPaginationGroupProps,
  PaginationGroupProps,
  UnknownTotalPaginationGroupProps,
} from '../../../types/shared-data-view'
import styles from './toolbar-items.module.css'

const SMALL_PAGE_SIZE = 100
const MEDIUM_PAGE_SIZE = 500
const LARGE_PAGE_SIZE = 1000
const HUGE_PAGE_SIZE = 5000
const PAGE_SIZE_OPTIONS = [
  SMALL_PAGE_SIZE,
  MEDIUM_PAGE_SIZE,
  LARGE_PAGE_SIZE,
  HUGE_PAGE_SIZE,
] as const

const PAGE_NUMBER_PATTERN = /^\d+$/
const FIRST_PAGE = 1

function parsePageInput(pageInputValue: string): number {
  const trimmedValue = pageInputValue.trim()
  if (!PAGE_NUMBER_PATTERN.test(trimmedValue)) return FIRST_PAGE
  const parsedPage = Number.parseInt(trimmedValue, 10)
  if (!Number.isFinite(parsedPage) || parsedPage < FIRST_PAGE) return FIRST_PAGE
  return parsedPage
}

interface PageIndicatorProps {
  isKnownTotal: boolean
  canSubmitPage: boolean
  currentPage: number
  totalPages: number
  pageInput: React.ReactNode
}

function PageIndicator({
  isKnownTotal,
  canSubmitPage,
  currentPage,
  totalPages,
  pageInput,
}: PageIndicatorProps) {
  if (!isKnownTotal) return <>{pageInput}</>
  if (!canSubmitPage) {
    return (
      <span className={styles.pageText} data-testid="page-indicator">
        Page {currentPage} of {totalPages}
      </span>
    )
  }
  return (
    <>
      {pageInput}
      <span className={styles.pageOfText}>of {totalPages}</span>
    </>
  )
}

interface EdgePageButtonProps {
  visible: boolean
  disabled: boolean
  onClick: () => void
  edge: 'first' | 'last'
}

const EDGE_PAGE_BUTTONS = {
  first: { label: 'First page', testId: 'pagination-first', icon: SkipBackIcon },
  last: { label: 'Last page', testId: 'pagination-last', icon: SkipForwardIcon },
}

function EdgePageButton({ visible, disabled, onClick, edge }: EdgePageButtonProps) {
  if (!visible) return null
  const { label, testId, icon: EdgeIcon } = EDGE_PAGE_BUTTONS[edge]
  return (
    <IconButton disabled={disabled} onClick={onClick} aria-label={label} data-testid={testId}>
      <EdgeIcon size={16} weight="bold" />
    </IconButton>
  )
}

export function PaginationGroup({
  currentPage,
  pageSize,
  disabled,
  showPageSize = true,
  showFirstLastButtons = false,
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

  const isKnownTotal = paginationMode === 'known'
  const isOnLastKnownPage = isKnownTotal && currentPage >= knownTotalProps.totalPages
  const isPreviousDisabled = disabled || currentPage <= 1
  const isNextDisabled = disabled || isOnLastKnownPage
  const showEdgeButtons = isKnownTotal && showFirstLastButtons

  const handlePageSubmit = useCallback(() => {
    const rawPage = parsePageInput(pageInputValue)
    if (paginationMode === 'unknown') {
      unknownTotalProps.onPageSubmit(rawPage)
      return
    }
    knownTotalProps.onPageSubmit?.(Math.min(rawPage, knownTotalProps.totalPages))
  }, [paginationMode, pageInputValue, unknownTotalProps, knownTotalProps])

  const handlePageInputBlur = useCallback(() => {
    setPageInputValue(String(currentPage))
  }, [currentPage])

  return (
    <div className={styles.paginationGroup} data-testid="pagination-group">
      {showPageSize ? (
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
      ) : null}

      <div className={styles.pagination}>
        <EdgePageButton
          edge="first"
          visible={showEdgeButtons}
          disabled={isPreviousDisabled}
          onClick={() => knownTotalProps.onPageSubmit?.(FIRST_PAGE)}
        />
        <IconButton
          disabled={isPreviousDisabled}
          onClick={onPrevPage}
          aria-label="Previous page"
          data-testid="pagination-prev"
        >
          <CaretLeftIcon size={16} weight="bold" />
        </IconButton>
        <PageIndicator
          isKnownTotal={isKnownTotal}
          canSubmitPage={knownTotalProps.onPageSubmit != null}
          currentPage={currentPage}
          totalPages={knownTotalProps.totalPages}
          pageInput={
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
          }
        />
        <IconButton
          disabled={isNextDisabled}
          onClick={onNextPage}
          aria-label="Next page"
          data-testid="pagination-next"
        >
          <CaretRightIcon size={16} weight="bold" />
        </IconButton>
        <EdgePageButton
          edge="last"
          visible={showEdgeButtons}
          disabled={isNextDisabled}
          onClick={() => knownTotalProps.onPageSubmit?.(knownTotalProps.totalPages)}
        />
      </div>
    </div>
  )
}
