import { describe, it, expect } from 'vitest'
import {
  isEnumColumn,
  getEnumFallbackValue,
  ENUM_NULL_SENTINEL,
} from '../../../components/table-data/enum-field-utils'
import type { TableDataColumnMeta } from '../../../types/schema'

describe('enum-field-utils', () => {
  describe('ENUM_NULL_SENTINEL', () => {
    it('is a defined string constant', () => {
      expect(typeof ENUM_NULL_SENTINEL).toBe('string')
      expect(ENUM_NULL_SENTINEL.length).toBeGreaterThan(0)
    })
  })

  describe('isEnumColumn', () => {
    it('returns true when column has non-empty enumValues', () => {
      const meta = { enumValues: ['a', 'b', 'c'] } as TableDataColumnMeta
      expect(isEnumColumn(meta)).toBe(true)
    })

    it('returns false when column has empty enumValues', () => {
      const meta = { enumValues: [] } as unknown as TableDataColumnMeta
      expect(isEnumColumn(meta)).toBe(false)
    })

    it('returns false when column has no enumValues', () => {
      const meta = {} as TableDataColumnMeta
      expect(isEnumColumn(meta)).toBe(false)
    })

    it('returns false when meta is undefined', () => {
      expect(isEnumColumn(undefined)).toBe(false)
    })
  })

  describe('getEnumFallbackValue', () => {
    it('returns first enum value for enum column', () => {
      const meta = { enumValues: ['active', 'inactive'] } as TableDataColumnMeta
      expect(getEnumFallbackValue(meta)).toBe('active')
    })

    it('returns empty string for non-enum column', () => {
      const meta = {} as TableDataColumnMeta
      expect(getEnumFallbackValue(meta)).toBe('')
    })

    it('returns empty string when meta is undefined', () => {
      expect(getEnumFallbackValue(undefined)).toBe('')
    })
  })
})
