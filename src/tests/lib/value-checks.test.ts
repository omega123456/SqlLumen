import { describe, expect, it } from 'vitest'
import {
  isBlank,
  isIndexInBounds,
  isNonEmptyString,
  isNullish,
  isObjectRecord,
  isNonEmptyList,
  isPositiveFiniteNumber,
  isPositiveNumber,
  isPresentIndex,
  isSameTextIgnoringCase,
} from '../../lib/value-checks'

describe('isPositiveFiniteNumber', () => {
  it('accepts positive finite numbers', () => {
    expect(isPositiveFiniteNumber(1)).toBe(true)
    expect(isPositiveFiniteNumber(0.5)).toBe(true)
  })
})

describe('isObjectRecord', () => {
  it('is true for objects and arrays', () => {
    expect(isObjectRecord({ key: 'value' })).toBe(true)
    expect(isObjectRecord([])).toBe(true)
  })
})

describe('isNullish', () => {
  it('is true for null and undefined', () => {
    expect(isNullish(null)).toBe(true)
    expect(isNullish(undefined)).toBe(true)
  })
})

describe('isIndexInBounds', () => {
  it('accepts indexes from zero up to the length', () => {
    expect(isIndexInBounds(0, 3)).toBe(true)
    expect(isIndexInBounds(2, 3)).toBe(true)
  })
})

describe('isBlank', () => {
  it('is true for empty and whitespace-only text', () => {
    expect(isBlank('')).toBe(true)
    expect(isBlank('  \t\n')).toBe(true)
  })
})

describe('isNonEmptyString', () => {
  it('is true only for strings with at least one character', () => {
    expect(isNonEmptyString('a')).toBe(true)
    expect(isNonEmptyString(' ')).toBe(true)
  })
})

describe('isPresentIndex', () => {
  it('accepts zero and positive indexes', () => {
    expect(isPresentIndex(0)).toBe(true)
    expect(isPresentIndex(4)).toBe(true)
  })
})

describe('isPositiveNumber', () => {
  it('accepts numbers above zero', () => {
    expect(isPositiveNumber(3)).toBe(true)
    expect(isPositiveNumber(0.25)).toBe(true)
  })
})

describe('isNonEmptyList', () => {
  it('is true only when the list has items', () => {
    expect(isNonEmptyList([0])).toBe(true)
    expect(isNonEmptyList([])).toBe(false)
  })
})

describe('isSameTextIgnoringCase', () => {
  it('compares text without regard to letter case', () => {
    expect(isSameTextIgnoringCase('Users', 'users')).toBe(true)
    expect(isSameTextIgnoringCase('USERS', 'Users')).toBe(true)
    expect(isSameTextIgnoringCase('users', 'orders')).toBe(false)
  })
})
