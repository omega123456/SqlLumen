import { describe, expect, it } from 'vitest'
import { createRowObjectCache } from '../../lib/result-row-materializer'

describe('createRowObjectCache', () => {
  it('materializes rows into __rowIdx + col_N objects with null for missing cells', () => {
    const cache = createRowObjectCache()

    expect(cache.build([['a', 1], ['b']], 2)).toEqual([
      { __rowIdx: 0, col_0: 'a', col_1: 1 },
      { __rowIdx: 1, col_0: 'b', col_1: null },
    ])
  })

  it('returns the same array when called again with the same rows', () => {
    const cache = createRowObjectCache()
    const rows = [['a'], ['b']]

    const first = cache.build(rows, 1)
    expect(cache.build(rows, 1)).toBe(first)
  })

  it('reuses objects for unchanged row arrays and rebuilds only the replaced one', () => {
    const cache = createRowObjectCache()
    const rows = [['a'], ['b'], ['c']]
    const first = cache.build(rows, 1)

    const edited = [rows[0], ['B'], rows[2]]
    const second = cache.build(edited, 1)

    expect(second).not.toBe(first)
    expect(second[0]).toBe(first[0])
    expect(second[2]).toBe(first[2])
    expect(second[1]).not.toBe(first[1])
    expect(second[1]).toEqual({ __rowIdx: 1, col_0: 'B' })
  })

  it('rebuilds every row when the column count changes', () => {
    const cache = createRowObjectCache()
    const rows = [
      ['a', 'x'],
      ['b', 'y'],
    ]
    const first = cache.build(rows, 1)

    const second = cache.build(rows, 2)

    expect(second[0]).not.toBe(first[0])
    expect(second[1]).not.toBe(first[1])
    expect(second).toEqual([
      { __rowIdx: 0, col_0: 'a', col_1: 'x' },
      { __rowIdx: 1, col_0: 'b', col_1: 'y' },
    ])
  })

  it('rebuilds shifted rows with the correct __rowIdx after an insert', () => {
    const cache = createRowObjectCache()
    const rowA = ['a']
    const rowB = ['b']
    const first = cache.build([rowA, rowB], 1)

    const inserted = ['new']
    const second = cache.build([inserted, rowA, rowB], 1)

    expect(second).toEqual([
      { __rowIdx: 0, col_0: 'new' },
      { __rowIdx: 1, col_0: 'a' },
      { __rowIdx: 2, col_0: 'b' },
    ])
    expect(second[1]).not.toBe(first[0])
  })

  it('rebuilds shifted rows with the correct __rowIdx after a removal', () => {
    const cache = createRowObjectCache()
    const rowA = ['a']
    const rowB = ['b']
    const rowC = ['c']
    const first = cache.build([rowA, rowB, rowC], 1)

    const second = cache.build([rowA, rowC], 1)

    expect(second[0]).toBe(first[0])
    expect(second[1]).toEqual({ __rowIdx: 1, col_0: 'c' })
    expect(second).toHaveLength(2)
  })
})
