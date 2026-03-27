import type { RowEditState, TableDataColumnMeta } from '../types/schema'
import { TEMPORAL_CONFIGS, getTemporalColumnType, validateTemporalValue } from './date-utils'

export interface TemporalValidationResult {
  columnName: string
  error: string
}

export function getTemporalValidationResult(
  editState: RowEditState | null,
  columns: TableDataColumnMeta[]
): TemporalValidationResult | null {
  if (!editState) return null

  for (const colName of editState.modifiedColumns) {
    const col = columns.find((candidate) => candidate.name === colName)
    if (!col) continue

    const temporalType = getTemporalColumnType(col.dataType)
    if (!temporalType) continue

    const value = editState.currentValues[colName]
    if (value === null || value === undefined) continue
    if (typeof value === 'string' && value.trim() === '') {
      return {
        columnName: colName,
        error: `Invalid ${temporalType} value. Expected format: ${TEMPORAL_CONFIGS[temporalType].format}`,
      }
    }

    const error = validateTemporalValue(String(value), temporalType)
    if (error) {
      return { columnName: colName, error }
    }
  }

  return null
}
