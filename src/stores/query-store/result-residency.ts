import { hasPendingRowChanges } from '../../lib/row-edit-state'
import type { SingleResultState } from '../query-store'

function isDirtyResult(result: SingleResultState): boolean {
  return hasPendingRowChanges(result.editState)
}

function isEvictableResult(result: SingleResultState): boolean {
  const isResident = result.rowResidency.status === 'resident'
  if (!isResident) return false
  if (result.isExpired) return false
  return !isDirtyResult(result)
}

export function shouldScheduleResultEviction(result: SingleResultState): boolean {
  return isEvictableResult(result) && result.viewRowCount !== 0
}

export function canEvictInactiveResult(result: SingleResultState): boolean {
  return !result.rowResidency.isActive && isEvictableResult(result)
}
