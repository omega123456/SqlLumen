import { hasModifiedColumns } from '../../lib/row-edit-state'
import type { DataViewSurfaceRef } from '../data-view/data-view-types'
import { patchTab, getQueryState, resultOf } from './query-store-access'
import { activeQuerySurfaceRef } from './query-surface'

export function requestNavigationAction(ref: DataViewSurfaceRef, action: () => void) {
  const result = resultOf(ref)

  if (!result?.editState) {
    action()
    return
  }
  if (!hasModifiedColumns(result.editState)) {
    getQueryState().discardCurrentRow(ref)
    action()
    return
  }
  patchTab(ref.tabId, { pendingNavigationAction: action })
}

export function requestTabNavigation(tabId: string, action: () => void) {
  requestNavigationAction(activeQuerySurfaceRef(tabId), action)
}

export async function confirmNavigation(ref: DataViewSurfaceRef, shouldSave: boolean) {
  const tab = getQueryState().tabs[ref.tabId]
  if (!tab) return

  if (!shouldSave) {
    const action = tab.pendingNavigationAction
    getQueryState().discardCurrentRow(ref)
    patchTab(ref.tabId, { pendingNavigationAction: null })
    action?.()
    return
  }

  await getQueryState().saveCurrentRow(ref)
  const afterResult = resultOf(ref)
  const isSavedCleanly = afterResult !== undefined && !afterResult.saveError
  if (!isSavedCleanly) return
  const action = getQueryState().tabs[ref.tabId]?.pendingNavigationAction
  patchTab(ref.tabId, { pendingNavigationAction: null })
  action?.()
}

export function cancelNavigation(ref: DataViewSurfaceRef) {
  patchTab(ref.tabId, { pendingNavigationAction: null })
}

export function navigationGuardActions() {
  return { requestNavigationAction, requestTabNavigation, confirmNavigation, cancelNavigation }
}
