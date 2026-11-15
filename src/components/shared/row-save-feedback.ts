import {
  getTemporalValidationResult,
  type TemporalValidationResult,
} from '../../lib/table-data-save-utils'
import { showErrorToast } from '../../stores/toast-store'
import type { RowEditState, TableDataColumnMeta } from '../../types/schema'

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
