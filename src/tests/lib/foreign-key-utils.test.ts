import { describe, expect, it } from 'vitest'
import {
  buildForeignKeyLookup,
  isUnchangedForeignKeySelection,
  mapSingleColumnForeignKeys,
} from '../../lib/foreign-key-utils'

describe('mapSingleColumnForeignKeys', () => {
  it('returns an empty array for missing input', () => {
    expect(mapSingleColumnForeignKeys(undefined)).toEqual([])
    expect(mapSingleColumnForeignKeys(null)).toEqual([])
    expect(mapSingleColumnForeignKeys([])).toEqual([])
  })
})

describe('buildForeignKeyLookup', () => {
  it('returns an empty map for missing input', () => {
    expect(buildForeignKeyLookup(undefined)).toEqual(new Map())
    expect(buildForeignKeyLookup(null)).toEqual(new Map())
  })
})

describe('isUnchangedForeignKeySelection', () => {
  it('is false when a different value was picked', () => {
    expect(
      isUnchangedForeignKeySelection({ selectedValue: 2, currentValue: 1, rowEditState: null })
    ).toBe(false)
  })
})
