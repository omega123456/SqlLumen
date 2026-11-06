import { describe, expect, it } from 'vitest'
import {
  MATERIALIZER_MAX_ENTRIES,
  createWindowRowMaterializer,
  materializeRow,
  toCachedRow,
} from '../../lib/result-row-materializer'

describe('materializeRow', () => {
  it('builds a { __rowIdx, __baseIdx, col_N } object with null for missing cells', () => {
    expect(materializeRow(4, 17, ['a'], 2)).toEqual({
      __rowIdx: 4,
      __baseIdx: 17,
      col_0: 'a',
      col_1: null,
    })
  })
})

describe('toCachedRow', () => {
  it('rebuilds the row array and base index from a row object', () => {
    expect(toCachedRow({ __rowIdx: 1, __baseIdx: 9, col_0: 'x', col_1: 2 }, 2)).toEqual({
      row: ['x', 2],
      baseIndex: 9,
    })
  })

  it('uses -1 when the object has no base index (the clone draft)', () => {
    expect(toCachedRow({ __rowIdx: 3, col_0: 'draft' }, 2)).toEqual({
      row: ['draft', null],
      baseIndex: -1,
    })
  })
})

describe('createWindowRowMaterializer', () => {
  it('reuses the object for the same base index, row array and position', () => {
    const materializer = createWindowRowMaterializer(1)
    const row = ['a']
    const first = materializer.get(0, 5, row)
    expect(materializer.get(0, 5, row)).toBe(first)
    expect(first).toEqual({ __rowIdx: 0, __baseIdx: 5, col_0: 'a' })
  })

  it('rebuilds when the cached row array is replaced (a saved edit)', () => {
    const materializer = createWindowRowMaterializer(1)
    const first = materializer.get(0, 5, ['a'])
    const second = materializer.get(0, 5, ['A'])
    expect(second).not.toBe(first)
    expect(second.col_0).toBe('A')
  })

  it('rebuilds when the same base row moves to another view position (sort)', () => {
    const materializer = createWindowRowMaterializer(1)
    const row = ['a']
    const first = materializer.get(0, 5, row)
    const moved = materializer.get(3, 5, row)
    expect(moved).not.toBe(first)
    expect(moved.__rowIdx).toBe(3)
  })

  it('reset forgets every object and applies the new column count', () => {
    const materializer = createWindowRowMaterializer(1)
    const row = ['a', 'b']
    const first = materializer.get(0, 0, row)
    materializer.reset(2)
    const second = materializer.get(0, 0, row)
    expect(second).not.toBe(first)
    expect(second).toEqual({ __rowIdx: 0, __baseIdx: 0, col_0: 'a', col_1: 'b' })
  })

  it('stays bounded: past the cap it starts over instead of growing', () => {
    const materializer = createWindowRowMaterializer(1)
    const row = ['x']
    const first = materializer.get(0, 0, row)
    for (let index = 1; index <= MATERIALIZER_MAX_ENTRIES; index++) {
      materializer.get(index, index, row)
    }
    // The map was reset when the cap was reached, so the first object is gone.
    expect(materializer.get(0, 0, row)).not.toBe(first)
  })
})
