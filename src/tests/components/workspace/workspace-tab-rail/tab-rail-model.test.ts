import { describe, expect, it } from 'vitest'
import {
  revealShortcutLabel,
  translateSubsetInsertIndex,
} from '../../../../components/workspace/workspace-tab-rail/tab-rail-model'

describe('translateSubsetInsertIndex', () => {
  const lists = { visibleTabIds: ['a', 'c'], allMovableTabIds: ['a', 'b', 'c', 'd'] }

  it('returns the index unchanged when the visible set is the full set', () => {
    expect(translateSubsetInsertIndex({ visibleTabIds: ['a'], allMovableTabIds: ['a'] }, 1)).toBe(1)
  })

  it('inserts before the first visible tab', () => {
    expect(translateSubsetInsertIndex(lists, 0)).toBe(0)
  })

  it('inserts before the next visible tab in the full list', () => {
    expect(translateSubsetInsertIndex(lists, 1)).toBe(2)
  })

  it('inserts after the last visible tab', () => {
    expect(translateSubsetInsertIndex(lists, 2)).toBe(3)
  })

  it('falls back to the full length when the last visible tab is unknown', () => {
    expect(
      translateSubsetInsertIndex(
        { visibleTabIds: ['x', 'y'], allMovableTabIds: ['a', 'b', 'c'] },
        2
      )
    ).toBe(3)
  })

  it('falls back to zero when the first visible tab is unknown', () => {
    expect(
      translateSubsetInsertIndex({ visibleTabIds: ['x'], allMovableTabIds: ['a', 'b'] }, 0)
    ).toBe(0)
  })
})

describe('revealShortcutLabel', () => {
  it('returns undefined for an unassigned binding', () => {
    expect(revealShortcutLabel(null)).toBeUndefined()
  })
})
