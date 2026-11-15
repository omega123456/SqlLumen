import { X } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import { FilterToolbarButton } from '../../shared/FilterToolbarButton'
import { PaginationGroup } from '../../shared/toolbar/PaginationGroup'
import { StatusArea } from '../../shared/toolbar/StatusArea'
import { lookupStatus } from './fk-lookup-model'
import type { FkLookupData } from './use-fk-lookup-data'
import type { useLookupQueryHandlers } from './use-fk-lookup-interactions'
import { FOCUS_RING } from '../../../lib/focus-ring'
import { joinClassNames } from '../../../lib/class-names'

interface LookupHeaderProps {
  sourceTable: string
  sourceColumn: string
  referencedTable: string
  referencedColumn: string
  onClose: () => void
}

export function LookupHeader(props: LookupHeaderProps) {
  const { referencedTable, referencedColumn } = props
  return (
    <div className="flex items-start justify-between border-b border-light-stroke-divider px-4 pt-3 pb-2 dark:border-dark-stroke-divider">
      <div className="flex min-w-0 flex-col">
        <h2
          className="mb-0.5 text-size-body font-semibold wrap-break-word text-light-on-surface dark:text-dark-on-surface"
          data-testid="fk-lookup-title"
        >
          Look Up — {referencedTable}.{referencedColumn}
        </h2>
        <p
          className="text-size-caption wrap-break-word text-light-on-surface-variant dark:text-dark-on-surface-variant"
          data-testid="fk-lookup-subtitle"
        >
          {props.sourceTable}.{props.sourceColumn} → {referencedTable}.{referencedColumn}
        </p>
      </div>
      <Button
        variant="bare"
        className={joinClassNames([
          'flex size-6.5 shrink-0 cursor-pointer items-center justify-center rounded-control bg-transparent text-light-on-surface-variant transition-color-and-background hover:bg-light-fill-subtle-hover hover:text-light-on-surface dark:text-dark-on-surface-variant dark:hover:bg-dark-fill-subtle-hover dark:hover:text-dark-on-surface',
          FOCUS_RING,
        ])}
        onClick={props.onClose}
        aria-label="Close"
        data-testid="fk-lookup-close"
      >
        <X size={18} weight="bold" />
      </Button>
    </div>
  )
}

interface LookupToolbarProps {
  data: FkLookupData
  queryHandlers: ReturnType<typeof useLookupQueryHandlers>
}

export function LookupToolbar({ data, queryHandlers }: LookupToolbarProps) {
  const { isLoading, error, query } = data
  const { executionTimeMs, columns } = data.page
  return (
    <div
      className="flex h-command-bar shrink-0 items-center justify-between gap-1 border-b border-light-stroke-divider bg-light-surface-container px-2 dark:border-dark-stroke-divider dark:bg-dark-surface-container"
      data-testid="fk-lookup-toolbar"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <StatusArea
          status={lookupStatus(isLoading, error)}
          executionTimeMs={executionTimeMs > 0 ? executionTimeMs : undefined}
          errorMessage={error ?? undefined}
        />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <FilterToolbarButton
          isActive={query.filterModel.length > 0}
          activeCount={query.filterModel.length}
          onFilterClick={queryHandlers.openFilterDialog}
          onClearClick={() => queryHandlers.handleFilterApply([])}
          isDisabled={columns.length === 0}
          filterButtonTestId="fk-lookup-btn-filter"
          filterBadgeTestId="fk-lookup-filter-badge"
          clearButtonTestId="fk-lookup-btn-clear-filter"
        />
        <PaginationGroup
          currentPage={query.currentPage}
          paginationMode="unknown"
          pageSize={query.pageSize}
          disabled={isLoading}
          {...queryHandlers.paging}
        />
      </div>
    </div>
  )
}

interface LookupFooterProps {
  canApply: boolean
  onApply: () => void
  onCancel: () => void
}

export function LookupFooter({ canApply, onApply, onCancel }: LookupFooterProps) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-2 border-t border-light-stroke-divider bg-light-surface p-6 dark:border-dark-stroke-divider dark:bg-dark-surface">
      <Button variant="accent" disabled={!canApply} onClick={onApply} data-testid="fk-lookup-apply">
        Apply
      </Button>
      <Button onClick={onCancel} data-testid="fk-lookup-cancel">
        Cancel
      </Button>
    </div>
  )
}
