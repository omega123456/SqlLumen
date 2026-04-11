/**
 * filter-utils — shared utility for building initial filter conditions
 * from a selected cell.
 *
 * Used by both TableDataToolbar and ResultPanel to auto-populate
 * the filter dialog based on the currently selected cell.
 */

import type { FilterCondition, SelectedCellInfo } from '../types/schema'

/**
 * Build initial filter conditions from the selected cell for the filter dialog.
 *
 * - Returns `[]` if `activeFilters.length > 0` (filters already active — don't override)
 * - Returns `[]` if `selectedCell` is null
 * - Returns `[{ column, operator: 'IS NULL', value: '' }]` when value is `null` or `undefined`
 * - Otherwise returns `[{ column, operator: '==', value: String(value) }]`
 */
export function buildInitialConditionsFromCell(
  selectedCell: SelectedCellInfo | null,
  activeFilters: FilterCondition[]
): FilterCondition[] {
  if (activeFilters.length > 0) return activeFilters
  if (selectedCell === null) return []

  const isNullValue = selectedCell.value === null || selectedCell.value === undefined
  return [
    {
      column: selectedCell.columnKey,
      operator: isNullValue ? ('IS NULL' as const) : ('==' as const),
      value: isNullValue ? '' : String(selectedCell.value),
    },
  ]
}
