import { describe, expect, it } from 'vitest'
import { clampedInsertIndex, movedToInsertIndex } from '../../lib/list-reorder'

const ITEMS = ['a', 'b', 'c', 'd']
const BEYOND_THE_END = 99
const BEFORE_THE_START = -3

describe('list reorder', () => {
  it('moves an item forward to the slot before the insert index', () => {
    expect(movedToInsertIndex(ITEMS, { sourceIndex: 0, insertIndex: 3 })).toEqual([
      'b',
      'c',
      'a',
      'd',
    ])
  })

  it('moves an item backward to the insert index', () => {
    expect(movedToInsertIndex(ITEMS, { sourceIndex: 3, insertIndex: 1 })).toEqual([
      'a',
      'd',
      'b',
      'c',
    ])
  })

  it('leaves the source list untouched', () => {
    movedToInsertIndex(ITEMS, { sourceIndex: 0, insertIndex: 4 })
    expect(ITEMS).toEqual(['a', 'b', 'c', 'd'])
  })

  it('clamps an insert index into the list', () => {
    expect(clampedInsertIndex(BEYOND_THE_END, ITEMS.length)).toBe(ITEMS.length)
    expect(clampedInsertIndex(BEFORE_THE_START, ITEMS.length)).toBe(0)
    expect(clampedInsertIndex(2, ITEMS.length)).toBe(2)
  })
})
