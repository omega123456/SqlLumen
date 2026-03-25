/**
 * Shared utility for formatting result cell values across all view modes.
 *
 * Centralises the NULL/value rendering logic that was previously duplicated
 * in ResultGridView, ResultFormView, and ResultTextView.
 */

/**
 * Formats a result cell value for display.
 * Returns { displayValue: string, isNull: boolean }
 */
export function formatCellValue(value: unknown): { displayValue: string; isNull: boolean } {
  if (value === null || value === undefined) {
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
