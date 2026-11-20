import type { DataViewState } from '../../../../stores/data-view/data-view-types'
import { editTableOf } from '../../../../stores/data-view/data-view-selectors'
import { cloneSourceRowIndex, copiedBoundColumnNames } from '../../../../stores/data-view/row-clone'
import type { QueryTableEditInfo } from '../../../../types/schema'
import { formatCount } from '../../../../lib/format-row-count'
import { hasPendingRowChanges } from '../../../../lib/row-edit-state'

export interface DataToolbarReadiness {
  hasData: boolean
  canInsertRows: boolean
}

export interface RowInsertion {
  canAddRow: boolean
  canCloneSelection: boolean
}

const NO_ROW_INSERTION: RowInsertion = { canAddRow: false, canCloneSelection: false }

export function isRestoringRows(view: DataViewState): boolean {
  return view.residency.rows.status === 'restoring'
}

export function canMutateRows(view: DataViewState, isConnectionReadOnly: boolean): boolean {
  if (isConnectionReadOnly) return false
  return view.editTarget.tableName !== null
}

export function editTableNameOf(view: DataViewState): string {
  const tableName = view.editTarget.tableName
  if (!tableName) return ''
  return view.editTarget.tables[tableName]?.table ?? tableName
}

export function sortedCheckedRanges(view: DataViewState): DataViewState['checked']['ranges'] {
  const { checked, slot } = view
  if (checked.viewVersion !== slot.viewVersion) return []
  return [...checked.ranges].sort((left, right) => left[0] - right[0])
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
  hasData: boolean
  checkedCount: number
  isRowActionPending: boolean
}

export function isCopySelectedDisabled(availability: CopySelectedAvailability): boolean {
  if (!availability.hasData) return true
  return availability.checkedCount === 0 || availability.isRowActionPending
}

function isCloneBlockedByEditing(view: DataViewState): boolean {
  const isDraftOpen = view.edit.state?.isNewRow === true
  const selectedRowIsDraft = isDraftOpen && view.edit.rowIndex === view.selection.rowIndex
  return hasPendingRowChanges(view.edit.state) || selectedRowIsDraft
}

function canCloneRow(view: DataViewState, editTable: QueryTableEditInfo): boolean {
  if (isCloneBlockedByEditing(view)) return false
  const hasCloneSource = cloneSourceRowIndex(view) !== null
  if (!hasCloneSource) return false
  return copiedBoundColumnNames(view, editTable).size > 0
}

function insertableEditTable(
  view: DataViewState,
  readiness: DataToolbarReadiness
): QueryTableEditInfo | null {
  if (!readiness.canInsertRows) return null
  if (view.mode === 'text') return null
  const editTable = editTableOf(view)
  const primaryKey = editTable?.primaryKey ?? null
  if (!primaryKey) return null
  return editTable
}

export function rowInsertionOf(view: DataViewState, readiness: DataToolbarReadiness): RowInsertion {
  const editTable = insertableEditTable(view, readiness)
  if (!editTable) return NO_ROW_INSERTION
  return {
    canAddRow: view.edit.draftRow === null,
    canCloneSelection: canCloneRow(view, editTable),
  }
}
