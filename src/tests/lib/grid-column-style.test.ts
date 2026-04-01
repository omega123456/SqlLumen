/**
 * Tests for the consolidated getGridCellClass utility function.
 */

import { describe, it, expect } from 'vitest'
import {
  getGridCellClass,
  isNumericSqlType,
  isStringishPrimarySqlType,
} from '../../lib/grid-column-style'

// ---------------------------------------------------------------------------
// getGridCellClass — core function
// ---------------------------------------------------------------------------

describe('getGridCellClass', () => {
  describe('numeric types → td-cell-mono-muted', () => {
    const numericTypes = [
      'INT',
      'INTEGER',
      'TINYINT',
      'SMALLINT',
      'MEDIUMINT',
      'BIGINT',
      'FLOAT',
      'DOUBLE',
      'DECIMAL',
      'NUMERIC',
      'REAL',
      'int(11)',
      'DECIMAL(10,2)',
      'BIGINT UNSIGNED',
    ]

    for (const type of numericTypes) {
      it(`returns td-cell-mono-muted for ${type}`, () => {
        expect(getGridCellClass('col', type)).toBe('td-cell-mono-muted')
      })
    }
  })

  describe('PK columns → td-cell-mono-muted', () => {
    it('returns td-cell-mono-muted when column is in pkColumnNames', () => {
      expect(getGridCellClass('id', 'VARCHAR(255)', ['id'])).toBe('td-cell-mono-muted')
    })

    it('returns td-cell-mono-muted even for string PK columns', () => {
      expect(getGridCellClass('slug', 'TEXT', ['slug'])).toBe('td-cell-mono-muted')
    })

    it('does not treat as PK when pkColumnNames is undefined', () => {
      expect(getGridCellClass('id', 'VARCHAR(255)')).toBe('td-cell-body td-cell-primary')
    })

    it('does not treat as PK when pkColumnNames is empty', () => {
      expect(getGridCellClass('id', 'VARCHAR(255)', [])).toBe('td-cell-body td-cell-primary')
    })

    it('does not treat as PK when column is not in pkColumnNames', () => {
      expect(getGridCellClass('name', 'VARCHAR(255)', ['id'])).toBe('td-cell-body td-cell-primary')
    })
  })

  describe('temporal types → td-cell-mono', () => {
    const temporalTypes = ['DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'datetime(6)', 'timestamp']

    for (const type of temporalTypes) {
      it(`returns td-cell-mono for ${type}`, () => {
        expect(getGridCellClass('col', type)).toBe('td-cell-mono')
      })
    }
  })

  describe('string types → td-cell-body td-cell-primary', () => {
    const stringTypes = ['VARCHAR(255)', 'CHAR(10)', 'TEXT', 'TINYTEXT', 'MEDIUMTEXT', 'LONGTEXT']

    for (const type of stringTypes) {
      it(`returns td-cell-body td-cell-primary for ${type}`, () => {
        expect(getGridCellClass('col', type)).toBe('td-cell-body td-cell-primary')
      })
    }
  })

  describe('other types → td-cell-body', () => {
    const otherTypes = ['BLOB', 'BINARY', 'ENUM', 'SET', 'JSON', 'BIT', 'GEOMETRY']

    for (const type of otherTypes) {
      it(`returns td-cell-body for ${type}`, () => {
        expect(getGridCellClass('col', type)).toBe('td-cell-body')
      })
    }
  })

  it('handles empty dataType gracefully', () => {
    expect(getGridCellClass('col', '')).toBe('td-cell-body')
  })

  it('handles case-insensitive data types', () => {
    expect(getGridCellClass('col', 'varchar(100)')).toBe('td-cell-body td-cell-primary')
    expect(getGridCellClass('col', 'Datetime')).toBe('td-cell-mono')
    expect(getGridCellClass('col', 'bigint')).toBe('td-cell-mono-muted')
  })
})

// ---------------------------------------------------------------------------
// Helper exports
// ---------------------------------------------------------------------------

describe('isNumericSqlType', () => {
  it('returns true for integer types', () => {
    expect(isNumericSqlType('INT')).toBe(true)
    expect(isNumericSqlType('BIGINT')).toBe(true)
    expect(isNumericSqlType('TINYINT')).toBe(true)
  })

  it('returns true for decimal types', () => {
    expect(isNumericSqlType('DECIMAL(10,2)')).toBe(true)
    expect(isNumericSqlType('NUMERIC')).toBe(true)
    expect(isNumericSqlType('FLOAT')).toBe(true)
    expect(isNumericSqlType('DOUBLE')).toBe(true)
  })

  it('returns false for non-numeric types', () => {
    expect(isNumericSqlType('VARCHAR(255)')).toBe(false)
    expect(isNumericSqlType('TEXT')).toBe(false)
    expect(isNumericSqlType('DATETIME')).toBe(false)
    expect(isNumericSqlType('BLOB')).toBe(false)
  })
})

describe('isStringishPrimarySqlType', () => {
  it('returns true for VARCHAR', () => {
    expect(isStringishPrimarySqlType('VARCHAR(255)')).toBe(true)
  })

  it('returns true for CHAR', () => {
    expect(isStringishPrimarySqlType('CHAR(10)')).toBe(true)
  })

  it('returns true for TEXT variants', () => {
    expect(isStringishPrimarySqlType('TEXT')).toBe(true)
    expect(isStringishPrimarySqlType('TINYTEXT')).toBe(true)
    expect(isStringishPrimarySqlType('MEDIUMTEXT')).toBe(true)
    expect(isStringishPrimarySqlType('LONGTEXT')).toBe(true)
  })

  it('returns false for non-string types', () => {
    expect(isStringishPrimarySqlType('INT')).toBe(false)
    expect(isStringishPrimarySqlType('BLOB')).toBe(false)
    expect(isStringishPrimarySqlType('DATETIME')).toBe(false)
  })
})
