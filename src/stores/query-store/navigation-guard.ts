import { hasModifiedColumns } from '../../lib/row-edit-state'
import { getActiveIndex, patchTab, getQueryState } from './query-store-access'

export function requestNavigationAction(tabId: string, action: () => void) {
  const tab = getQueryState().tabs[tabId]
  const resultIndex = getActiveIndex(tabId)
  const result = tab?.results[resultIndex]

  if (!result?.editState) {
    action()
    return
  }
  if (!hasModifiedColumns(result.editState)) {
    getQueryState().discardCurrentRow(tabId)
    action()
    return
  }
  patchTab(tabId, { pendingNavigationAction: action })
}

export async function confirmNavigation(tabId: string, shouldSave: boolean) {
  const tab = getQueryState().tabs[tabId]
  if (!tab) return

  if (!shouldSave) {
    const action = tab.pendingNavigationAction
    getQueryState().discardCurrentRow(tabId)
    patchTab(tabId, { pendingNavigationAction: null })
    action?.()
    return
  }

  await getQueryState().saveCurrentRow(tabId)
  const afterSave = getQueryState().tabs[tabId]
  const afterResult = afterSave?.results[getActiveIndex(tabId)]
  const isSavedCleanly = afterResult !== undefined && !afterResult.saveError
  if (!isSavedCleanly) return
  const action = afterSave?.pendingNavigationAction
  patchTab(tabId, { pendingNavigationAction: null })
  action?.()
}

export function cancelNavigation(tabId: string) {
  patchTab(tabId, { pendingNavigationAction: null })
}

export function navigationGuardActions() {
  return { requestNavigationAction, confirmNavigation, cancelNavigation }
}
