import type { RowEditState, TableDataColumnMeta } from '../types/schema'
import { TEMPORAL_CONFIGS, getTemporalColumnType, validateTemporalValue } from './date-utils'
import { isNullish } from './value-checks'

export interface TemporalValidationResult {
  columnName: string
  error: string
}

export function getTemporalValidationResult(
  editState: RowEditState | null,
  columns: TableDataColumnMeta[]
): TemporalValidationResult | null {
  if (!editState) return null

  for (const columnName of editState.modifiedColumns) {
    const column = columns.find((candidate) => candidate.name === columnName)
    if (!column) continue

    const temporalType = getTemporalColumnType(column.dataType)
    if (!temporalType) continue

    const value = editState.currentValues[columnName]
    if (isNullish(value)) continue
    const isBlankText = typeof value === 'string' && value.trim() === ''
    if (isBlankText) {
      return {
        columnName: columnName,
        error: `Invalid ${temporalType} value. Expected format: ${TEMPORAL_CONFIGS[temporalType].format}`,
      }
    }

    const error = validateTemporalValue(String(value), temporalType)
    if (error) {
      return { columnName: columnName, error: error }
    }
  }

  return null
}
