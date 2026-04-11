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

  it('returns IS NULL condition when cell value is null', () => {
    const selectedCell: SelectedCellInfo = { columnKey: 'name', value: null }

    const result = buildInitialConditionsFromCell(selectedCell, [])
    expect(result).toEqual([{ column: 'name', operator: 'IS NULL', value: '' }])
  })

  it('returns IS NULL condition when cell value is undefined', () => {
    const selectedCell: SelectedCellInfo = { columnKey: 'name', value: undefined }

    const result = buildInitialConditionsFromCell(selectedCell, [])
    expect(result).toEqual([{ column: 'name', operator: 'IS NULL', value: '' }])
  })

  it('returns == condition with stringified value for non-null values', () => {
    const selectedCell: SelectedCellInfo = { columnKey: 'name', value: 'Alice' }

    const result = buildInitialConditionsFromCell(selectedCell, [])
    expect(result).toEqual([{ column: 'name', operator: '==', value: 'Alice' }])
  })

  it('returns == condition with stringified numeric value', () => {
    const selectedCell: SelectedCellInfo = { columnKey: 'age', value: 42 }

    const result = buildInitialConditionsFromCell(selectedCell, [])
    expect(result).toEqual([{ column: 'age', operator: '==', value: '42' }])
  })
})
