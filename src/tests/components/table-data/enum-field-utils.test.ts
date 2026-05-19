import { describe, it, expect } from 'vitest'
import {
  isEnumColumn,
  isSetColumn,
  getEnumFallbackValue,
  parseSetCellValue,
  serializeSetCellValue,
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

  describe('isSetColumn', () => {
    it('returns true when column has non-empty setValues', () => {
      const meta = { setValues: ['read', 'write'] } as TableDataColumnMeta
      expect(isSetColumn(meta)).toBe(true)
    })

    it('returns false when column has empty setValues', () => {
      const meta = { setValues: [] } as unknown as TableDataColumnMeta
      expect(isSetColumn(meta)).toBe(false)
    })

    it('returns false when meta is undefined', () => {
      expect(isSetColumn(undefined)).toBe(false)
    })
  })

  describe('parseSetCellValue', () => {
    it('returns null for nullish values', () => {
      expect(parseSetCellValue(null)).toBeNull()
      expect(parseSetCellValue(undefined)).toBeNull()
    })

    it('stringifies array values', () => {
      expect(parseSetCellValue(['read', 2, true])).toEqual(['read', '2', 'true'])
    })

    it('returns an empty array for an empty string', () => {
      expect(parseSetCellValue('')).toEqual([])
    })

    it('splits comma-delimited strings and trims blanks', () => {
      expect(parseSetCellValue(' read, write , , admin ')).toEqual(['read', 'write', 'admin'])
    })
  })

  describe('serializeSetCellValue', () => {
    it('returns null for nullish arrays', () => {
      expect(serializeSetCellValue(null)).toBeNull()
      expect(serializeSetCellValue(undefined)).toBeNull()
    })

    it('joins values with commas', () => {
      expect(serializeSetCellValue(['read', 'write'])).toBe('read,write')
    })

    it('serializes an empty array to an empty string', () => {
      expect(serializeSetCellValue([])).toBe('')
    })
  })
})
