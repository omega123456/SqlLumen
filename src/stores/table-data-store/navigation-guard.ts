import { getTemporalValidationResult } from '../../lib/table-data-save-utils'
import { hasModifiedColumns } from '../../lib/row-edit-state'
import { showErrorToast, showSuccessToast } from '../toast-store'
import { patchTab } from './table-data-access'
import { useTableDataStore } from '../table-data-store'

export function requestNavigationAction(tabId: string, action: () => void): void {
  const tab = useTableDataStore.getState().tabs[tabId]
  if (!hasModifiedColumns(tab?.editState)) {
    action()
    return
  }
  patchTab(tabId, { pendingNavigationAction: action })
}

export async function confirmNavigationSave(tabId: string): Promise<void> {
  const tab = useTableDataStore.getState().tabs[tabId]
  if (!tab) return

  if (tab.editState) {
    const validationError = getTemporalValidationResult(tab.editState, tab.columns)
    if (validationError) {
      showErrorToast(
        'Invalid date value',
        `${validationError.columnName}: ${validationError.error}`
      )
      return
    }
  }

  await useTableDataStore.getState().saveCurrentRow(tabId)

  const afterSave = useTableDataStore.getState().tabs[tabId]
  const isSavedCleanly = afterSave !== undefined && !afterSave.saveError
  if (isSavedCleanly) {
    if (!afterSave.editState) {
      showSuccessToast('Row saved', 'Changes saved successfully.')
    }
    const action = afterSave.pendingNavigationAction
    patchTab(tabId, { pendingNavigationAction: null })
    action?.()
  }
}

export function confirmNavigationDiscard(tabId: string): void {
  const tab = useTableDataStore.getState().tabs[tabId]
  if (!tab) return

  const action = tab.pendingNavigationAction
  useTableDataStore.getState().discardCurrentRow(tabId)
  patchTab(tabId, { pendingNavigationAction: null })
  action?.()
}

export function cancelNavigation(tabId: string): void {
  patchTab(tabId, { pendingNavigationAction: null })
}

export function navigationGuardActions() {
  return {
    requestNavigationAction,
    confirmNavigationSave,
    confirmNavigationDiscard,
    cancelNavigation,
  }
}
