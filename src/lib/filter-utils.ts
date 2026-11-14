import type { FilterCondition, SelectedCellInfo } from '../types/schema'

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
