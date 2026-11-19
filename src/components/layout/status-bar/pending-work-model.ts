import type { SingleResultState } from '../../../stores/query-store'
import type { TableDataTabState } from '../../../stores/table-data-store'
import type { DataViewState } from '../../../stores/data-view/data-view-types'
import { formatCount, formatRowRange } from '../../../lib/format-row-count'

type RowActionProgress = NonNullable<DataViewState['rowAction']>

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

export function windowLoadingLabel(range: DataViewState['window']['pendingRange']): string | null {
  if (!range) return null
  return `Loading rows ${formatRowRange(range[0] + 1, range[1])}…`
}

function silentWork(label: string): PendingWork {
  return { label: label, announcement: '', isCancellable: false }
}

function visibleRowActionProgress(view: DataViewState): RowActionProgress | null {
  const progress = view.rowAction
  if (progress?.visible !== true) return null
  return progress
}

function resolveViewPendingWork(view: DataViewState): PendingWork | null {
  const progress = visibleRowActionProgress(view)
  if (progress) {
    return {
      label: rowActionLabel(progress),
      announcement: rowActionAnnouncement(progress),
      isCancellable: progress.cancellable,
    }
  }
  const isFiltering = view.spec.applying === 'filter'
  if (isFiltering) return silentWork(FILTERING_LABEL)
  const windowLabel = windowLoadingLabel(view.window.pendingRange)
  if (!windowLabel) return null
  return { label: windowLabel, announcement: windowLabel, isCancellable: false }
}

export function resolveResultPendingWork(result: SingleResultState | null): PendingWork | null {
  if (!result) return null
  return resolveViewPendingWork(result.view)
}

function isRestoringRows(tableData: TableDataTabState): boolean {
  return tableData.view.residency.rows.status === 'restoring'
}

export function resolveTablePendingWork(tableData: TableDataTabState | null): PendingWork | null {
  if (!tableData) return null
  if (isRestoringRows(tableData)) return silentWork(TABLE_RESTORING_LABEL)
  if (tableData.page.isLoading) return silentWork(TABLE_LOADING_LABEL)
  return resolveViewPendingWork(tableData.view)
}
