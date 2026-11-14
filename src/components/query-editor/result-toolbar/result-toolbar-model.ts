import {
  BULK_DELETE_WARNING_ROWS,
  MAX_BULK_DELETE_ROWS,
  type SingleResultState,
} from '../../../stores/query-store'
import { formatCount, formatRowCountParts, formatRowRange } from '../../../lib/format-row-count'
import type { StatusType } from '../../../types/shared-data-view'

const ERROR_PREVIEW_MAX_LENGTH = 200

export interface DeleteDialogCopy {
  title: string
  message: string
  confirmLabel: string
  warningText: string | null | undefined
  isDestructive: boolean
  blocked: boolean
}

export function getDeleteDialogCopy(count: number, tableName: string): DeleteDialogCopy {
  const formattedCount = formatCount(count)
  if (count > MAX_BULK_DELETE_ROWS) {
    return {
      title: 'Too many rows to delete at once',
      message: `You have ${formattedCount} rows checked. You can delete up to ${formatCount(
        MAX_BULK_DELETE_ROWS
      )} rows at a time. Uncheck some rows, then try again.`,
      confirmLabel: 'OK',
      warningText: null,
      isDestructive: false,
      blocked: true,
    }
  }
  if (count === 1) {
    return {
      title: 'Delete row',
      message: `Delete this row from ${tableName}?`,
      confirmLabel: 'Delete row',
      warningText: undefined,
      isDestructive: true,
      blocked: false,
    }
  }
  return {
    title: 'Delete rows',
    message: `Delete ${formattedCount} rows from ${tableName}?`,
    confirmLabel: `Delete ${formattedCount} rows`,
    warningText:
      count > BULK_DELETE_WARNING_ROWS
        ? "This can't be undone. Deleting more than 1,000 rows can take a while. If a row fails, rows already deleted stay deleted."
        : undefined,
    isDestructive: true,
    blocked: false,
  }
}

export type ActiveResult = SingleResultState
export type RowCountParts = ReturnType<typeof formatRowCountParts>
export type RowActionProgress = NonNullable<ActiveResult['rowActionProgress']>

const STATUS_AREA_BY_RESULT_STATUS: Record<ActiveResult['resultStatus'], StatusType> = {
  idle: 'idle',
  running: 'idle',
  success: 'success',
  error: 'error',
}

export function resolveStatusAreaStatus(
  showActionProgress: boolean,
  status: ActiveResult['resultStatus']
): StatusType {
  return showActionProgress ? 'loading' : STATUS_AREA_BY_RESULT_STATUS[status]
}

export function truncateErrorMessage(errorMessage: string | null): string | undefined {
  if (!errorMessage) return undefined
  if (errorMessage.length <= ERROR_PREVIEW_MAX_LENGTH) return errorMessage
  return errorMessage.slice(0, ERROR_PREVIEW_MAX_LENGTH) + '…'
}

export function editTableNameOf(result: ActiveResult): string {
  if (!result.editMode) return ''
  return result.editTableMetadata[result.editMode]?.table ?? result.editMode
}

export function sortedCheckedRanges(result: ActiveResult): ActiveResult['checkedRanges'] {
  if (result.checkedViewVersion !== result.viewVersion) return []
  return [...result.checkedRanges].sort((left, right) => left[0] - right[0])
}

export function rowActionLabel(progress: RowActionProgress | null): string | undefined {
  if (!progress) return undefined
  return `${progress.verb}… ${formatCount(progress.done)} of ${formatCount(progress.total)}`
}

export function windowLoadingLabel(range: ActiveResult['pendingWindowRange']): string | null {
  if (!range) return null
  return `Loading rows ${formatRowRange(range[0] + 1, range[1])}…`
}

interface AnnouncementInputs {
  showActionProgress: boolean
  rowActionProgress: RowActionProgress | null
  windowLabel: string | null
  hasResults: boolean
}

export function resolveAnnouncement(inputs: AnnouncementInputs): string {
  const { rowActionProgress, windowLabel } = inputs
  if (inputs.showActionProgress) {
    return `${rowActionProgress?.verb}… ${formatCount(rowActionProgress?.total ?? 0)} rows`
  }
  if (windowLabel && inputs.hasResults) return windowLabel
  return ''
}

export function copiedRowsToast(
  wasVisible: boolean,
  rowCount: number
): { title: string; message: string } {
  if (wasVisible) {
    return { title: 'Copied', message: `${formatCount(rowCount)} rows copied to clipboard.` }
  }
  return { title: 'Selected rows copied', message: `${rowCount} row(s) copied to clipboard.` }
}

export function pluralSuffix(count: number): string {
  return count === 1 ? '' : 's'
}

interface CopySelectedAvailability {
  hasResults: boolean
  checkedCount: number
  isRowActionPending: boolean
}

export function isCopySelectedDisabled(availability: CopySelectedAvailability): boolean {
  if (!availability.hasResults) return true
  return availability.checkedCount === 0 || availability.isRowActionPending
}
