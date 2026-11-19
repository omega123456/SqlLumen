import { hasModifiedColumns } from '../../lib/row-edit-state'
import { getTemporalValidationResult } from '../../lib/table-data-save-utils'
import { showErrorToast } from '../toast-store'
import type { DataViewState, DataViewSurfaceRef } from './data-view-types'
import { editTableOf } from './data-view-selectors'
import { discardCurrentRow } from './edit-actions'
import { saveCurrentRow } from './row-save'
import { readView, updateView } from './route-registry'

function setPendingNavigation(ref: DataViewSurfaceRef, action: (() => void) | null) {
  updateView(ref, { prompts: { pendingNavigation: action } })
}

export function requestNavigationAction(ref: DataViewSurfaceRef, action: () => void) {
  const editState = readView(ref)?.edit.state

  if (!editState) {
    action()
    return
  }
  if (!hasModifiedColumns(editState)) {
    discardCurrentRow(ref)
    action()
    return
  }
  setPendingNavigation(ref, action)
}

function isEditValid(view: DataViewState): boolean {
  const tableColumns = editTableOf(view)?.columns ?? []
  const validationError = getTemporalValidationResult(view.edit.state, tableColumns)
  if (!validationError) return true
  showErrorToast('Invalid date value', `${validationError.columnName}: ${validationError.error}`)
  return false
}

function discardAndNavigate(ref: DataViewSurfaceRef, view: DataViewState) {
  const action = view.prompts.pendingNavigation
  discardCurrentRow(ref)
  setPendingNavigation(ref, null)
  action?.()
}

async function saveAndNavigate(ref: DataViewSurfaceRef, view: DataViewState) {
  if (!isEditValid(view)) return
  await saveCurrentRow(ref)
  const viewAfterSave = readView(ref)
  if (!viewAfterSave) return
  if (viewAfterSave.edit.saveError) return
  const action = viewAfterSave.prompts.pendingNavigation
  setPendingNavigation(ref, null)
  action?.()
}

export async function confirmNavigation(ref: DataViewSurfaceRef, shouldSave: boolean) {
  const view = readView(ref)
  if (!view) return
  if (!shouldSave) {
    discardAndNavigate(ref, view)
    return
  }
  await saveAndNavigate(ref, view)
}

export function cancelNavigation(ref: DataViewSurfaceRef) {
  setPendingNavigation(ref, null)
}
