/**
 * Tests verifying that the table-data store persists scroll cell coordinates per tab,
 * so that switching away and back restores the grid's visible cell region.
 */

import { describe, it, expect } from 'vitest'
import { useTableDataStore } from '../../stores/table-data-store'
import type { TableDataTabState } from '../../types/schema'

describe('TableDataStore scroll cell persistence', () => {
  it('should have scrollRow and scrollCol fields in tab state', () => {
    const store = useTableDataStore.getState()
    store.initTab('tab-1', 'conn-1', 'mydb', 'users')

    const tabState = useTableDataStore.getState().tabs['tab-1'] as TableDataTabState

    expect(tabState).toHaveProperty('scrollRow')
    expect(tabState).toHaveProperty('scrollCol')
  })

  it('should expose a setScrollCell action to save scroll cell coordinates', () => {
    const store = useTableDataStore.getState()

    expect(store).toHaveProperty('setScrollCell')
  })

  it('should retain scroll cell coordinate values after being set', () => {
    const store = useTableDataStore.getState()

    store.initTab('tab-scroll', 'conn-1', 'mydb', 'orders')
    store.setScrollCell('tab-scroll', 25, 10)

    const tabState = useTableDataStore.getState().tabs['tab-scroll'] as TableDataTabState
    expect(tabState.scrollRow).toBe(25)
    expect(tabState.scrollCol).toBe(10)
  })
})
