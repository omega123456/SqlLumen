import { describe, expect, it } from 'vitest'
import { translateSubsetInsertIndex } from '../../../../components/workspace/workspace-tab-rail/tab-rail-model'

describe('translateSubsetInsertIndex', () => {
  const lists = { visibleTabIds: ['a', 'c'], allMovableTabIds: ['a', 'b', 'c', 'd'] }

  it('inserts before the next visible tab in the full list', () => {
    expect(translateSubsetInsertIndex(lists, 1)).toBe(2)
  })

  it('falls back to the full length when the last visible tab is unknown', () => {
    expect(
      translateSubsetInsertIndex(
        { visibleTabIds: ['x', 'y'], allMovableTabIds: ['a', 'b', 'c'] },
        2
      )
    ).toBe(3)
  })
})
