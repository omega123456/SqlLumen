import { describe, it, expect } from 'vitest'
import { buildInitialConditionsFromCell } from '../../lib/filter-utils'
import type { FilterCondition, SelectedCellInfo } from '../../types/schema'

describe('buildInitialConditionsFromCell', () => {
  it('returns existing filters when activeFilters is non-empty (does not override)', () => {
    const activeFilters: FilterCondition[] = [{ column: 'id', operator: '>', value: '10' }]
    const selectedCell: SelectedCellInfo = { columnKey: 'name', value: 'Alice' }

    const result = buildInitialConditionsFromCell(selectedCell, activeFilters)
    expect(result).toEqual(activeFilters)
  })

  it('returns empty array when selectedCell is null', () => {
    const result = buildInitialConditionsFromCell(null, [])
    expect(result).toEqual([])
  })
})
