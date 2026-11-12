import {
  getTemporalValidationResult,
  type TemporalValidationResult,
} from '../../lib/table-data-save-utils'
import { useTableDataStore } from '../../stores/table-data-store'
import { showErrorToast, showSuccessToast } from '../../stores/toast-store'
import type { RowEditState, TableDataColumnMeta } from '../../types/schema'

export interface RowSaveRequest {
  tabId: string
  editState: RowEditState | null
  columns: TableDataColumnMeta[]
}

export function reportInvalidTemporalValue(
  editState: RowEditState | null,
  columns: TableDataColumnMeta[]
): TemporalValidationResult | null {
  const validationError = getTemporalValidationResult(editState, columns)
  if (validationError) {
    showErrorToast('Invalid date value', `${validationError.columnName}: ${validationError.error}`)
  }
  return validationError
}

export async function saveCurrentRowWithFeedback(
  request: RowSaveRequest
): Promise<TemporalValidationResult | null> {
  const validationError = reportInvalidTemporalValue(request.editState, request.columns)
  if (validationError) {
    return validationError
  }

  await useTableDataStore.getState().saveCurrentRow(request.tabId)
  const savedTab = useTableDataStore.getState().tabs[request.tabId]
  if (savedTab?.saveError) {
    showErrorToast('Save failed', savedTab.saveError)
    return null
  }
  const isEditFinished = savedTab !== undefined && !savedTab.editState
  if (isEditFinished) {
    showSuccessToast('Row saved', 'Changes saved successfully.')
  }
  return null
}
