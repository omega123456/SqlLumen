import { describe, expect, it } from 'vitest'
import { movedToInsertIndex } from '../../lib/list-reorder'

const ITEMS = ['a', 'b', 'c', 'd']

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
})
