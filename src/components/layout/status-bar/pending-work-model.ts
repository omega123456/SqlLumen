import type { SingleResultState } from '../../../stores/query-store'
import { formatCount, formatRowRange } from '../../../lib/format-row-count'
import type { TableDataTabState } from '../../../types/schema'

type RowActionProgress = NonNullable<SingleResultState['view']['rowAction']>

const FILTERING_LABEL = 'Filtering…'
const TABLE_RESTORING_LABEL = 'Restoring cached rows...'
const TABLE_LOADING_LABEL = 'Loading...'

export interface PendingWork {
  label: string
  announcement: string
  isCancellable: boolean
}

export function rowActionLabel(progress: RowActionProgress): string {
  return `${progress.verb}… ${formatCount(progress.done)} of ${formatCount(progress.total)}`
}

export function rowActionAnnouncement(progress: RowActionProgress): string {
  return `${progress.verb}… ${formatCount(progress.total)} rows`
}

export function windowLoadingLabel(
  range: SingleResultState['view']['window']['pendingRange']
): string | null {
  if (!range) return null
  return `Loading rows ${formatRowRange(range[0] + 1, range[1])}…`
}

function silentWork(label: string): PendingWork {
  return { label: label, announcement: '', isCancellable: false }
}

function visibleRowActionProgress(result: SingleResultState): RowActionProgress | null {
  const progress = result.view.rowAction
  if (progress?.visible !== true) return null
  return progress
}

export function resolveResultPendingWork(result: SingleResultState | null): PendingWork | null {
  if (!result) return null
  const progress = visibleRowActionProgress(result)
  if (progress) {
    return {
      label: rowActionLabel(progress),
      announcement: rowActionAnnouncement(progress),
      isCancellable: progress.cancellable,
    }
  }
  const isFiltering = result.view.spec.applying === 'filter'
  if (isFiltering) return silentWork(FILTERING_LABEL)
  const windowLabel = windowLoadingLabel(result.view.window.pendingRange)
  if (!windowLabel) return null
  return { label: windowLabel, announcement: windowLabel, isCancellable: false }
}

function isRestoringRows(tableData: TableDataTabState): boolean {
  return tableData.rowResidency?.status === 'restoring'
}

export function resolveTablePendingWork(tableData: TableDataTabState | null): PendingWork | null {
  if (!tableData) return null
  if (isRestoringRows(tableData)) return silentWork(TABLE_RESTORING_LABEL)
  if (tableData.isLoading) return silentWork(TABLE_LOADING_LABEL)
  return null
}
