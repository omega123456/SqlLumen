import { isNullish } from './value-checks'

export function formatCellValue(value: unknown): { displayValue: string; isNull: boolean } {
  if (isNullish(value)) {
    return { displayValue: 'NULL', isNull: true }
  }
  if (typeof value === 'string') {
    return { displayValue: value, isNull: false }
  }
  if (typeof value === 'object') {
    return { displayValue: JSON.stringify(value), isNull: false }
  }
  return { displayValue: String(value), isNull: false }
}
