import { hasPendingRowChanges } from '../../lib/row-edit-state'
import type { FrontendRowResidencyState, TableDataTabState } from '../../types/schema'

export function createResidentRowState(isActive = false): FrontendRowResidencyState {
  return {
    status: 'resident',
    isActive: isActive,
    inactiveSince: null,
  }
}

function isDirtyTableDataTab(tab: TableDataTabState): boolean {
  return hasPendingRowChanges(tab.editState)
}

export function tabRowResidency(tab: TableDataTabState): FrontendRowResidencyState {
  return tab.rowResidency ?? createResidentRowState(false)
}

function isEvictableTableDataTab(tab: TableDataTabState): boolean {
  const isResident = tabRowResidency(tab).status === 'resident'
  if (!isResident) return false
  return !isDirtyTableDataTab(tab)
}

export function shouldScheduleTableDataEviction(tab: TableDataTabState): boolean {
  return isEvictableTableDataTab(tab) && tab.rows.length > 0
}

export function canEvictInactiveTableDataTab(tab: TableDataTabState): boolean {
  return !tabRowResidency(tab).isActive && isEvictableTableDataTab(tab)
}
