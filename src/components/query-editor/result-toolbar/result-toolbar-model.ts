import type { SingleResultState } from '../../../stores/query-store'
import { formatCount } from '../../../lib/format-row-count'

export type ActiveResult = SingleResultState

export function canMutateResultRows(result: ActiveResult, isConnectionReadOnly: boolean): boolean {
  if (isConnectionReadOnly) return false
  return result.view.editTarget.tableName !== null
}

export function editTableNameOf(result: ActiveResult): string {
  if (!result.view.editTarget.tableName) return ''
  return (
    result.view.editTarget.tables[result.view.editTarget.tableName]?.table ??
    result.view.editTarget.tableName
  )
}

export function sortedCheckedRanges(
  result: ActiveResult
): ActiveResult['view']['checked']['ranges'] {
  const { checked, slot } = result.view
  if (checked.viewVersion !== slot.viewVersion) return []
  return [...result.view.checked.ranges].sort((left, right) => left[0] - right[0])
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

interface CopySelectedAvailability {
  hasResults: boolean
  checkedCount: number
  isRowActionPending: boolean
}

export function isCopySelectedDisabled(availability: CopySelectedAvailability): boolean {
  if (!availability.hasResults) return true
  return availability.checkedCount === 0 || availability.isRowActionPending
}
