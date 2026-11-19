import { hasModifiedColumns } from '../../lib/row-edit-state'
import type { DataViewSurfaceRef } from '../data-view/data-view-types'
import { getQueryState, patchSurface, resultOf } from './query-store-access'
import { activeQuerySurfaceRef } from './query-surface'

function setPendingNavigation(ref: DataViewSurfaceRef, action: (() => void) | null) {
  patchSurface(ref, { view: { prompts: { pendingNavigation: action } } })
}

export function requestNavigationAction(ref: DataViewSurfaceRef, action: () => void) {
  const editState = resultOf(ref)?.view.edit.state

  if (!editState) {
    action()
    return
  }
  if (!hasModifiedColumns(editState)) {
    getQueryState().discardCurrentRow(ref)
    action()
    return
  }
  setPendingNavigation(ref, action)
}

export function requestTabNavigation(tabId: string, action: () => void) {
  requestNavigationAction(activeQuerySurfaceRef(tabId), action)
}

export async function confirmNavigation(ref: DataViewSurfaceRef, shouldSave: boolean) {
  const result = resultOf(ref)
  if (!result) return

  if (!shouldSave) {
    const action = result.view.prompts.pendingNavigation
    getQueryState().discardCurrentRow(ref)
    setPendingNavigation(ref, null)
    action?.()
    return
  }

  await getQueryState().saveCurrentRow(ref)
  const afterResult = resultOf(ref)
  const isSavedCleanly = afterResult !== undefined && !afterResult.view.edit.saveError
  if (!isSavedCleanly) return
  const action = afterResult.view.prompts.pendingNavigation
  setPendingNavigation(ref, null)
  action?.()
}

export function cancelNavigation(ref: DataViewSurfaceRef) {
  setPendingNavigation(ref, null)
}

export function navigationGuardActions() {
  return { requestNavigationAction, requestTabNavigation, confirmNavigation, cancelNavigation }
}
