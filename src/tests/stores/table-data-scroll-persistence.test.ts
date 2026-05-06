/**
 * Tests verifying that the table-data store persists scroll position per tab,
 * so that switching away and back restores the grid's scroll offset.
 */

import { describe, it, expect } from 'vitest'
import { useTableDataStore } from '../../stores/table-data-store'
import type { TableDataTabState } from '../../types/schema'

describe('TableDataStore scroll position persistence', () => {
  it('should have scrollTop and scrollLeft fields in tab state', () => {
    const store = useTableDataStore.getState()
    store.initTab('tab-1', 'conn-1', 'mydb', 'users')

    const tabState = useTableDataStore.getState().tabs['tab-1'] as TableDataTabState & {
      scrollTop?: number
      scrollLeft?: number
    }

    // The store should persist scroll position so it can be restored after remount
    expect(tabState).toHaveProperty('scrollTop')
    expect(tabState).toHaveProperty('scrollLeft')
  })

  it('should expose a setScrollPosition action to save scroll offsets', () => {
    const store = useTableDataStore.getState()

    // The store should have a method to persist scroll position
    expect(store).toHaveProperty('setScrollPosition')
  })

  it('should retain scroll position values after being set', () => {
    const store = useTableDataStore.getState() as ReturnType<typeof useTableDataStore.getState> & {
      setScrollPosition?: (tabId: string, scrollTop: number, scrollLeft: number) => void
    }

    store.initTab('tab-scroll', 'conn-1', 'mydb', 'orders')

    if (store.setScrollPosition) {
      store.setScrollPosition('tab-scroll', 250, 100)

      const tabState = useTableDataStore.getState().tabs['tab-scroll'] as TableDataTabState & {
        scrollTop?: number
        scrollLeft?: number
      }

      expect(tabState.scrollTop).toBe(250)
      expect(tabState.scrollLeft).toBe(100)
    } else {
      // If setScrollPosition doesn't exist, the bug is confirmed
      expect(store.setScrollPosition).toBeDefined()
    }
  })
})
