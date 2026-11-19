import { hasPendingRowChanges } from '../../lib/row-edit-state'
import type { SingleResultState } from '../query-store'

function isDirtyResult(result: SingleResultState): boolean {
  return hasPendingRowChanges(result.view.edit.state)
}

function isEvictableResult(result: SingleResultState): boolean {
  const isResident = result.view.residency.rows.status === 'resident'
  if (!isResident) return false
  if (result.view.residency.isExpired) return false
  return !isDirtyResult(result)
}

export function shouldScheduleResultEviction(result: SingleResultState): boolean {
  return isEvictableResult(result) && result.view.slot.viewRowCount !== 0
}

export function canEvictInactiveResult(result: SingleResultState): boolean {
  return !result.view.residency.rows.isActive && isEvictableResult(result)
}
