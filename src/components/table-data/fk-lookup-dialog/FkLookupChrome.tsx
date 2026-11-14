import { X } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import { FilterToolbarButton } from '../../shared/FilterToolbarButton'
import { PaginationGroup } from '../../shared/toolbar/PaginationGroup'
import { StatusArea } from '../../shared/toolbar/StatusArea'
import { lookupStatus } from './fk-lookup-model'
import type { FkLookupData } from './use-fk-lookup-data'
import type { useLookupQueryHandlers } from './use-fk-lookup-interactions'
import styles from '../FkLookupDialog.module.css'

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
    <div className={styles.header}>
      <div className={styles.headerText}>
        <h2 className={styles.title} data-testid="fk-lookup-title">
          Look Up — {referencedTable}.{referencedColumn}
        </h2>
        <p className={styles.subtitle} data-testid="fk-lookup-subtitle">
          {props.sourceTable}.{props.sourceColumn} → {referencedTable}.{referencedColumn}
        </p>
      </div>
      <Button
        variant="bare"
        className={styles.closeButton}
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
    <div className={styles.toolbar} data-testid="fk-lookup-toolbar">
      <div className={styles.toolbarLeft}>
        <StatusArea
          status={lookupStatus(isLoading, error)}
          executionTimeMs={executionTimeMs > 0 ? executionTimeMs : undefined}
          errorMessage={error ?? undefined}
        />
      </div>
      <div className={styles.toolbarRight}>
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
    <div className={styles.footer}>
      <Button variant="accent" disabled={!canApply} onClick={onApply} data-testid="fk-lookup-apply">
        Apply
      </Button>
      <Button onClick={onCancel} data-testid="fk-lookup-cancel">
        Cancel
      </Button>
    </div>
  )
}
