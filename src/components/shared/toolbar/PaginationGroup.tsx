import { useCallback, useEffect, useState } from 'react'
import { CaretLeftIcon, CaretRightIcon, SkipBackIcon, SkipForwardIcon } from '@phosphor-icons/react'
import { IconButton } from '../../common/IconButton'
import { Dropdown, type DropdownOption } from '../../common/Dropdown'
import { TextInput } from '../../common/TextInput'
import type {
  KnownTotalPaginationGroupProps,
  PaginationGroupProps,
} from '../../../types/shared-data-view'

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
  const isValidPage = Number.isFinite(parsedPage) && parsedPage >= FIRST_PAGE
  if (!isValidPage) return FIRST_PAGE
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
      <span
        className="min-w-23 text-center text-size-row whitespace-nowrap text-light-on-surface-variant select-none dark:text-dark-on-surface-variant"
        data-testid="page-indicator"
      >
        Page {currentPage} of {totalPages}
      </span>
    )
  }
  return (
    <>
      {pageInput}
      <span className="text-size-row whitespace-nowrap text-light-on-surface-variant select-none dark:text-dark-on-surface-variant">
        of {totalPages}
      </span>
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

const STEP_PAGE_BUTTONS = {
  previous: { label: 'Previous page', testId: 'pagination-prev', icon: CaretLeftIcon },
  next: { label: 'Next page', testId: 'pagination-next', icon: CaretRightIcon },
}

interface StepPageButtonProps {
  direction: 'previous' | 'next'
  disabled: boolean | undefined
  onClick: () => void
}

function StepPageButton({ direction, disabled, onClick }: StepPageButtonProps) {
  const { label, testId, icon: StepIcon } = STEP_PAGE_BUTTONS[direction]
  return (
    <IconButton disabled={disabled} onClick={onClick} aria-label={label} data-testid={testId}>
      <StepIcon size={16} weight="bold" />
    </IconButton>
  )
}

const PAGE_SIZE_DROPDOWN_OPTIONS: DropdownOption[] = PAGE_SIZE_OPTIONS.map((size) => ({
  value: String(size),
  label: String(size),
}))

interface PageInputFieldProps {
  currentPage: number
  disabled: boolean | undefined
  onSubmit: (page: number) => void
}

function PageInputField({ currentPage, disabled, onSubmit }: PageInputFieldProps) {
  const [pageInputValue, setPageInputValue] = useState(String(currentPage))

  useEffect(() => {
    setPageInputValue(String(currentPage))
  }, [currentPage])

  return (
    <TextInput
      type="text"
      inputMode="numeric"
      aria-label="Current page"
      variant="bare"
      value={pageInputValue}
      onChange={(event) => setPageInputValue(event.target.value)}
      onBlur={() => setPageInputValue(String(currentPage))}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        onSubmit(parsePageInput(pageInputValue))
      }}
      disabled={disabled}
      className="h-control-sm w-11 rounded-control border border-x-light-stroke-control border-t-light-stroke-control border-b-light-stroke-text-field bg-light-fill-control px-1.5 text-center font-body text-size-row text-light-on-surface outline-none focus:border-b-light-primary focus:bg-light-surface-container-high focus:shadow-light-field-focus disabled:cursor-not-allowed disabled:border-b-light-stroke-control disabled:bg-light-fill-subtle-pressed disabled:text-light-text-disabled dark:border-x-dark-stroke-control dark:border-t-dark-stroke-control dark:border-b-dark-stroke-text-field dark:bg-dark-fill-control dark:text-dark-on-surface dark:focus:border-b-dark-primary dark:focus:bg-dark-surface-container-high dark:focus:shadow-dark-field-focus dark:disabled:border-b-dark-stroke-control dark:disabled:bg-dark-fill-subtle-pressed dark:disabled:text-dark-text-disabled"
      data-testid="pagination-page-input"
    />
  )
}

interface PageSizeSelectProps {
  pageSize: number
  disabled: boolean
  onPageSizeChange: (pageSize: number) => void
}

function PageSizeSelect({ pageSize, disabled, onPageSizeChange }: PageSizeSelectProps) {
  const handlePageSizeChange = useCallback(
    (value: string) => {
      onPageSizeChange(parseInt(value, 10))
    },
    [onPageSizeChange]
  )
  return (
    <Dropdown
      id="page-size-dropdown"
      ariaLabel="Page size"
      options={PAGE_SIZE_DROPDOWN_OPTIONS}
      value={String(pageSize)}
      onChange={handlePageSizeChange}
      disabled={disabled}
      data-testid="page-size-select"
      triggerSize="sm"
      triggerWidth="combo"
    />
  )
}

function submitPage(props: PaginationGroupProps, rawPage: number): void {
  if (props.paginationMode === 'unknown') {
    props.onPageSubmit(rawPage)
    return
  }
  props.onPageSubmit?.(Math.min(rawPage, props.totalPages))
}

export function PaginationGroup(props: PaginationGroupProps) {
  const { currentPage, disabled, showFirstLastButtons = false, onPrevPage, onNextPage } = props
  const knownTotalProps = props as KnownTotalPaginationGroupProps
  const isKnownTotal = (props.paginationMode ?? 'known') === 'known'
  const isOnLastKnownPage = isKnownTotal && currentPage >= knownTotalProps.totalPages
  const isPreviousDisabled = disabled || currentPage <= 1
  const isNextDisabled = disabled || isOnLastKnownPage
  const showEdgeButtons = isKnownTotal && showFirstLastButtons
  const pageSizeDisabled = disabled || props.pageSizeDisabled

  return (
    <div className="flex shrink-0 items-center gap-2" data-testid="pagination-group">
      {(props.showPageSize ?? true) ? (
        <PageSizeSelect
          pageSize={props.pageSize}
          disabled={pageSizeDisabled === true}
          onPageSizeChange={props.onPageSizeChange}
        />
      ) : null}

      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <EdgePageButton
          edge="first"
          visible={showEdgeButtons}
          disabled={isPreviousDisabled}
          onClick={() => knownTotalProps.onPageSubmit?.(FIRST_PAGE)}
        />
        <StepPageButton direction="previous" disabled={isPreviousDisabled} onClick={onPrevPage} />
        <PageIndicator
          isKnownTotal={isKnownTotal}
          canSubmitPage={knownTotalProps.onPageSubmit != null}
          currentPage={currentPage}
          totalPages={knownTotalProps.totalPages}
          pageInput={
            <PageInputField
              currentPage={currentPage}
              disabled={disabled}
              onSubmit={(rawPage) => submitPage(props, rawPage)}
            />
          }
        />
        <StepPageButton direction="next" disabled={isNextDisabled} onClick={onNextPage} />
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
