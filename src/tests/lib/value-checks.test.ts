import { describe, expect, it } from 'vitest'
import {
  isBlank,
  isIndexInBounds,
  isNonEmptyString,
  isNullish,
  isObjectRecord,
  isPositiveFiniteNumber,
  isPresentIndex,
} from '../../lib/value-checks'

describe('isPositiveFiniteNumber', () => {
  it('accepts positive finite numbers', () => {
    expect(isPositiveFiniteNumber(1)).toBe(true)
    expect(isPositiveFiniteNumber(0.5)).toBe(true)
  })

  it('rejects zero, negative and non-finite numbers', () => {
    expect(isPositiveFiniteNumber(0)).toBe(false)
    expect(isPositiveFiniteNumber(-3)).toBe(false)
    expect(isPositiveFiniteNumber(Number.NaN)).toBe(false)
    expect(isPositiveFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false)
  })
})

describe('isObjectRecord', () => {
  it('is true for objects and arrays', () => {
    expect(isObjectRecord({ key: 'value' })).toBe(true)
    expect(isObjectRecord([])).toBe(true)
  })

  it('is false for null and primitives', () => {
    expect(isObjectRecord(null)).toBe(false)
    expect(isObjectRecord(undefined)).toBe(false)
    expect(isObjectRecord('text')).toBe(false)
    expect(isObjectRecord(0)).toBe(false)
  })
})

describe('isNullish', () => {
  it('is true for null and undefined', () => {
    expect(isNullish(null)).toBe(true)
    expect(isNullish(undefined)).toBe(true)
  })

  it('is false for falsy values that are present', () => {
    expect(isNullish(0)).toBe(false)
    expect(isNullish('')).toBe(false)
    expect(isNullish(false)).toBe(false)
  })
})

describe('isIndexInBounds', () => {
  it('accepts indexes from zero up to the length', () => {
    expect(isIndexInBounds(0, 3)).toBe(true)
    expect(isIndexInBounds(2, 3)).toBe(true)
  })

  it('rejects negative and too large indexes', () => {
    expect(isIndexInBounds(-1, 3)).toBe(false)
    expect(isIndexInBounds(3, 3)).toBe(false)
    expect(isIndexInBounds(0, 0)).toBe(false)
  })
})

describe('isBlank', () => {
  it('is true for empty and whitespace-only text', () => {
    expect(isBlank('')).toBe(true)
    expect(isBlank('  \t\n')).toBe(true)
  })

  it('is false once any visible character is present', () => {
    expect(isBlank(' a ')).toBe(false)
  })
})

describe('isNonEmptyString', () => {
  it('is true only for strings with at least one character', () => {
    expect(isNonEmptyString('a')).toBe(true)
    expect(isNonEmptyString(' ')).toBe(true)
  })

  it('is false for empty strings and non-strings', () => {
    expect(isNonEmptyString('')).toBe(false)
    expect(isNonEmptyString(null)).toBe(false)
    expect(isNonEmptyString(7)).toBe(false)
  })
})

describe('isPresentIndex', () => {
  it('accepts zero and positive indexes', () => {
    expect(isPresentIndex(0)).toBe(true)
    expect(isPresentIndex(4)).toBe(true)
  })

  it('rejects missing and negative indexes', () => {
    expect(isPresentIndex(null)).toBe(false)
    expect(isPresentIndex(undefined)).toBe(false)
    expect(isPresentIndex(-1)).toBe(false)
  })
})
