import type { ReactNode } from 'react'
import { WarningCircle } from '@phosphor-icons/react'
import { useQueryStore } from '../../../stores/query-store'
import { formatRowCountParts } from '../../../lib/format-row-count'
import { hasResultColumns } from '../../../lib/query-result-column-utils'
import { Button } from '../../common/Button'
import { StatusArea } from '../../shared/toolbar/StatusArea'
import type { FilterCondition } from '../../../types/schema'
import {
  resolveAnnouncement,
  resolveStatusAreaStatus,
  rowActionLabel,
  truncateErrorMessage,
  windowLoadingLabel,
  type ActiveResult,
  type RowCountParts,
} from './result-toolbar-model'
import styles from '../ResultToolbar.module.css'

function ResultRowCount({ rowCount }: { rowCount: RowCountParts }) {
  if (rowCount.segmentKind !== 'truncated') {
    return <span data-testid="result-row-count">{rowCount.count}</span>
  }
  return (
    <span className={styles.truncatedCount} data-testid="result-row-count">
      <WarningCircle size={12} weight="fill" className={styles.truncatedIcon} aria-hidden="true" />
      {rowCount.count} · {rowCount.segment}
    </span>
  )
}

interface StatusCounts {
  statusTotalRows: number | undefined
  countLabel: ReactNode
}

function resolveStatusCounts(result: ActiveResult, rowCount: RowCountParts): StatusCounts {
  if (result.resultStatus !== 'success')
    return { statusTotalRows: undefined, countLabel: undefined }
  if (hasResultColumns(result)) {
    return { statusTotalRows: undefined, countLabel: <ResultRowCount rowCount={rowCount} /> }
  }
  if (result.affectedRows > 0)
    return { statusTotalRows: result.affectedRows, countLabel: undefined }
  return { statusTotalRows: undefined, countLabel: undefined }
}

interface StatusDetailsProps {
  rowCount: RowCountParts
  isFiltering: boolean
  windowLabel: string | null
}

function ResultStatusDetails({ rowCount, isFiltering, windowLabel }: StatusDetailsProps) {
  return (
    <>
      {rowCount.segmentKind === 'autoLimit' && (
        <span className={styles.autoLimit}>· {rowCount.segment}</span>
      )}
      {isFiltering && (
        <span className={styles.statusNote} data-testid="result-filtering-status">
          Filtering…
        </span>
      )}
      {windowLabel && (
        <span className={styles.windowLoading} data-testid="result-window-loading">
          <span className={styles.miniSpinner} aria-hidden="true" />
          <span>{windowLabel}</span>
        </span>
      )}
    </>
  )
}

interface CustomContentInputs {
  result: ActiveResult
  showActionProgress: boolean
  details: StatusDetailsProps
  onCancelRowAction: () => void
}

function resolveStatusCustomContent(inputs: CustomContentInputs): ReactNode {
  const { result } = inputs
  if (inputs.showActionProgress) {
    if (!result.rowActionProgress?.cancellable) return undefined
    return (
      <Button
        variant="subtle"
        size="sm"
        onClick={inputs.onCancelRowAction}
        data-testid="row-action-cancel"
      >
        Cancel
      </Button>
    )
  }
  const showsRowDetails = result.resultStatus === 'success' && result.columns.length > 0
  if (!showsRowDetails) return undefined
  return <ResultStatusDetails {...inputs.details} />
}

interface ResultToolbarStatusProps {
  tabId: string
  result: ActiveResult
  filterModel: FilterCondition[]
}

function rowCountPartsOf(result: ActiveResult, filterModel: FilterCondition[]) {
  return formatRowCountParts({
    viewRowCount: result.viewRowCount,
    totalRows: result.totalRows,
    isFiltered: filterModel.length > 0,
    truncated: result.truncated,
    autoLimitApplied: result.autoLimitApplied,
    appliedRowLimit: result.appliedRowLimit,
  })
}

export function ResultToolbarStatus({ tabId, result, filterModel }: ResultToolbarStatusProps) {
  const cancelRowAction = useQueryStore((state) => state.cancelRowAction)
  const { rowActionProgress, totalTimeMs } = result
  const showActionProgress = rowActionProgress?.visible === true
  const rowCount = rowCountPartsOf(result, filterModel)
  const { statusTotalRows, countLabel } = resolveStatusCounts(result, rowCount)
  const windowLabel = windowLoadingLabel(result.pendingWindowRange)
  const announcement = resolveAnnouncement({
    showActionProgress: showActionProgress,
    rowActionProgress: rowActionProgress,
    windowLabel: windowLabel,
    hasResults: result.resultStatus === 'success',
  })
  const customContent = resolveStatusCustomContent({
    result: result,
    showActionProgress: showActionProgress,
    details: { rowCount: rowCount, isFiltering: result.isFiltering, windowLabel: windowLabel },
    onCancelRowAction: () => cancelRowAction(tabId),
  })

  return (
    <div className={styles.statusWrapper}>
      <StatusArea
        status={resolveStatusAreaStatus(showActionProgress, result.resultStatus)}
        totalRows={statusTotalRows}
        countLabel={countLabel}
        loadingLabel={rowActionLabel(rowActionProgress)}
        executionTimeMs={totalTimeMs > 0 ? totalTimeMs : undefined}
        errorMessage={truncateErrorMessage(result.errorMessage)}
        customContent={customContent}
      />
      <span className={styles.srOnly} role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  )
}
