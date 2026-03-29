import { describe, it, expect } from 'vitest'
import type { ColumnMeta, TableDataColumnMeta, RowEditState } from '../../types/schema'
import {
  findAmbiguousColumns,
  buildEditableColumnMap,
  validateKeyColumnsPresent,
  buildRowEditState,
  buildUpdatePayload,
} from '../../lib/query-edit-utils'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function col(name: string, dataType = 'VARCHAR'): ColumnMeta {
  return { name, dataType }
}

function tableCol(name: string, overrides: Partial<TableDataColumnMeta> = {}): TableDataColumnMeta {
  return {
    name,
    dataType: 'VARCHAR',
    isBooleanAlias: false,
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isAutoIncrement: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// findAmbiguousColumns
// ---------------------------------------------------------------------------

describe('findAmbiguousColumns', () => {
  it('returns empty set for empty input', () => {
    expect(findAmbiguousColumns([])).toEqual(new Set())
  })

  it('returns empty set when no duplicates', () => {
    const columns = [col('id'), col('name'), col('email')]
    expect(findAmbiguousColumns(columns)).toEqual(new Set())
  })

  it('detects a single duplicate pair', () => {
    const columns = [col('id'), col('name'), col('id')]
    const result = findAmbiguousColumns(columns)
    expect(result).toEqual(new Set(['id']))
  })

  it('detects multiple duplicate groups', () => {
    const columns = [col('id'), col('name'), col('id'), col('name'), col('email')]
    const result = findAmbiguousColumns(columns)
    expect(result).toEqual(new Set(['id', 'name']))
  })

  it('is case-insensitive', () => {
    const columns = [col('ID'), col('name'), col('id')]
    const result = findAmbiguousColumns(columns)
    expect(result).toEqual(new Set(['id']))
  })

  it('handles columns with mixed case duplicates', () => {
    const columns = [col('Name'), col('NAME'), col('email')]
    const result = findAmbiguousColumns(columns)
    expect(result).toEqual(new Set(['name']))
  })
})

// ---------------------------------------------------------------------------
// buildEditableColumnMap
// ---------------------------------------------------------------------------

describe('buildEditableColumnMap', () => {
  it('marks matching columns as editable', () => {
    const resultCols = [col('id'), col('name'), col('email')]
    const tableCols = [tableCol('id'), tableCol('name'), tableCol('email')]
    const ambiguous = new Set<string>()

    const map = buildEditableColumnMap(resultCols, tableCols, ambiguous)
    expect(map.get(0)).toBe(true)
    expect(map.get(1)).toBe(true)
    expect(map.get(2)).toBe(true)
  })

  it('marks non-matching columns as not editable', () => {
    const resultCols = [col('id'), col('computed_field')]
    const tableCols = [tableCol('id')]
    const ambiguous = new Set<string>()

    const map = buildEditableColumnMap(resultCols, tableCols, ambiguous)
    expect(map.get(0)).toBe(true)
    expect(map.get(1)).toBe(false)
  })

  it('excludes ambiguous columns', () => {
    const resultCols = [col('id'), col('name'), col('id')]
    const tableCols = [tableCol('id'), tableCol('name')]
    const ambiguous = new Set(['id'])

    const map = buildEditableColumnMap(resultCols, tableCols, ambiguous)
    expect(map.get(0)).toBe(false) // ambiguous
    expect(map.get(1)).toBe(true) // not ambiguous, matches
    expect(map.get(2)).toBe(false) // ambiguous
  })

  it('excludes binary columns', () => {
    const resultCols = [col('id'), col('avatar'), col('name')]
    const tableCols = [tableCol('id'), tableCol('avatar', { isBinary: true }), tableCol('name')]
    const ambiguous = new Set<string>()

    const map = buildEditableColumnMap(resultCols, tableCols, ambiguous)
    expect(map.get(0)).toBe(true)
    expect(map.get(1)).toBe(false) // binary
    expect(map.get(2)).toBe(true)
  })

  it('matches column names case-insensitively', () => {
    const resultCols = [col('ID'), col('Name')]
    const tableCols = [tableCol('id'), tableCol('name')]
    const ambiguous = new Set<string>()

    const map = buildEditableColumnMap(resultCols, tableCols, ambiguous)
    expect(map.get(0)).toBe(true)
    expect(map.get(1)).toBe(true)
  })

  it('returns a map entry for every result column', () => {
    const resultCols = [col('id'), col('computed'), col('name')]
    const tableCols = [tableCol('id'), tableCol('name')]
    const ambiguous = new Set<string>()

    const map = buildEditableColumnMap(resultCols, tableCols, ambiguous)
    expect(map.size).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// validateKeyColumnsPresent
// ---------------------------------------------------------------------------

describe('validateKeyColumnsPresent', () => {
  it('returns valid when all keys are present', () => {
    const resultCols = [col('id'), col('name')]
    const result = validateKeyColumnsPresent(['id'], resultCols, new Set())
    expect(result.valid).toBe(true)
    expect(result.missingColumns).toEqual([])
  })

  it('returns invalid when a key column is missing', () => {
    const resultCols = [col('name'), col('email')]
    const result = validateKeyColumnsPresent(['id'], resultCols, new Set())
    expect(result.valid).toBe(false)
    expect(result.missingColumns).toEqual(['id'])
  })

  it('reports multiple missing key columns', () => {
    const resultCols = [col('email')]
    const result = validateKeyColumnsPresent(['id', 'tenant_id'], resultCols, new Set())
    expect(result.valid).toBe(false)
    expect(result.missingColumns).toEqual(['id', 'tenant_id'])
  })

  it('returns invalid when a key column is present but ambiguous', () => {
    const resultCols = [col('id'), col('name'), col('id')]
    const ambiguous = new Set(['id'])
    const result = validateKeyColumnsPresent(['id'], resultCols, ambiguous)
    expect(result.valid).toBe(false)
    expect(result.missingColumns).toEqual(['id'])
  })

  it('is case-insensitive for column name matching', () => {
    const resultCols = [col('ID'), col('name')]
    const result = validateKeyColumnsPresent(['id'], resultCols, new Set())
    expect(result.valid).toBe(true)
  })

  it('handles compound key where some columns are missing', () => {
    const resultCols = [col('id'), col('name')]
    const result = validateKeyColumnsPresent(['id', 'tenant_id'], resultCols, new Set())
    expect(result.valid).toBe(false)
    expect(result.missingColumns).toEqual(['tenant_id'])
  })
})

// ---------------------------------------------------------------------------
// buildRowEditState
// ---------------------------------------------------------------------------

describe('buildRowEditState', () => {
  it('extracts editable column values by index', () => {
    const resultCols = [col('id'), col('name'), col('email')]
    const editableMap = new Map([
      [0, true],
      [1, true],
      [2, false],
    ])
    const row = [42, 'Alice', 'alice@test.com']

    const state = buildRowEditState(row, resultCols, editableMap, ['id'])

    expect(state.originalValues).toEqual({ id: 42, name: 'Alice' })
    expect(state.currentValues).toEqual({ id: 42, name: 'Alice' })
    expect(state.modifiedColumns.size).toBe(0)
    expect(state.isNewRow).toBe(false)
  })

  it('populates rowKey from PK columns', () => {
    const resultCols = [col('id'), col('name')]
    const editableMap = new Map([
      [0, true],
      [1, true],
    ])
    const row = [99, 'Bob']

    const state = buildRowEditState(row, resultCols, editableMap, ['id'])
    expect(state.rowKey).toEqual({ id: 99 })
  })

  it('populates rowKey for compound PK', () => {
    const resultCols = [col('tenant_id'), col('user_id'), col('name')]
    const editableMap = new Map([
      [0, true],
      [1, true],
      [2, true],
    ])
    const row = [1, 42, 'Charlie']

    const state = buildRowEditState(row, resultCols, editableMap, ['tenant_id', 'user_id'])
    expect(state.rowKey).toEqual({ tenant_id: 1, user_id: 42 })
  })

  it('handles null values correctly', () => {
    const resultCols = [col('id'), col('name')]
    const editableMap = new Map([
      [0, true],
      [1, true],
    ])
    const row = [1, null]

    const state = buildRowEditState(row, resultCols, editableMap, ['id'])
    expect(state.originalValues).toEqual({ id: 1, name: null })
    expect(state.currentValues).toEqual({ id: 1, name: null })
  })

  it('skips non-editable columns from originalValues', () => {
    const resultCols = [col('id'), col('computed'), col('name')]
    const editableMap = new Map([
      [0, true],
      [1, false],
      [2, true],
    ])
    const row = [1, 'calc-value', 'Alice']

    const state = buildRowEditState(row, resultCols, editableMap, ['id'])
    expect(state.originalValues).toEqual({ id: 1, name: 'Alice' })
    expect(state.originalValues).not.toHaveProperty('computed')
  })

  it('matches PK column names case-insensitively', () => {
    const resultCols = [col('ID'), col('name')]
    const editableMap = new Map([
      [0, true],
      [1, true],
    ])
    const row = [7, 'Eve']

    const state = buildRowEditState(row, resultCols, editableMap, ['id'])
    expect(state.rowKey).toEqual({ id: 7 })
  })
})

// ---------------------------------------------------------------------------
// buildUpdatePayload
// ---------------------------------------------------------------------------

describe('buildUpdatePayload', () => {
  it('includes only modified columns in updatedValues', () => {
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { id: 1, name: 'Alice', email: 'a@test.com' },
      currentValues: { id: 1, name: 'Bob', email: 'a@test.com' },
      modifiedColumns: new Set(['name']),
      isNewRow: false,
    }

    const payload = buildUpdatePayload(editState, ['id'])
    expect(payload.updatedValues).toEqual({ name: 'Bob' })
    expect(payload.updatedValues).not.toHaveProperty('email')
    expect(payload.updatedValues).not.toHaveProperty('id')
  })

  it('returns correct PK values from rowKey', () => {
    const editState: RowEditState = {
      rowKey: { id: 42 },
      originalValues: { id: 42, name: 'Alice' },
      currentValues: { id: 42, name: 'Bob' },
      modifiedColumns: new Set(['name']),
      isNewRow: false,
    }

    const payload = buildUpdatePayload(editState, ['id'])
    expect(payload.pkColumns).toEqual(['id'])
    expect(payload.originalPkValues).toEqual({ id: 42 })
  })

  it('handles compound PK', () => {
    const editState: RowEditState = {
      rowKey: { tenant_id: 1, user_id: 42 },
      originalValues: { tenant_id: 1, user_id: 42, name: 'Alice' },
      currentValues: { tenant_id: 1, user_id: 42, name: 'Bob' },
      modifiedColumns: new Set(['name']),
      isNewRow: false,
    }

    const payload = buildUpdatePayload(editState, ['tenant_id', 'user_id'])
    expect(payload.pkColumns).toEqual(['tenant_id', 'user_id'])
    expect(payload.originalPkValues).toEqual({ tenant_id: 1, user_id: 42 })
  })

  it('handles multiple modified columns', () => {
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { id: 1, name: 'Alice', email: 'old@test.com' },
      currentValues: { id: 1, name: 'Bob', email: 'new@test.com' },
      modifiedColumns: new Set(['name', 'email']),
      isNewRow: false,
    }

    const payload = buildUpdatePayload(editState, ['id'])
    expect(payload.updatedValues).toEqual({ name: 'Bob', email: 'new@test.com' })
  })

  it('returns empty updatedValues when nothing is modified', () => {
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { id: 1, name: 'Alice' },
      currentValues: { id: 1, name: 'Alice' },
      modifiedColumns: new Set(),
      isNewRow: false,
    }

    const payload = buildUpdatePayload(editState, ['id'])
    expect(payload.updatedValues).toEqual({})
  })

  it('uses rowKey for PK values even when PK columns are modified', () => {
    // If the user edits a PK column, originalPkValues should reflect the ORIGINAL key
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { id: 1, name: 'Alice' },
      currentValues: { id: 99, name: 'Alice' },
      modifiedColumns: new Set(['id']),
      isNewRow: false,
    }

    const payload = buildUpdatePayload(editState, ['id'])
    expect(payload.originalPkValues).toEqual({ id: 1 }) // original, not current
    expect(payload.updatedValues).toEqual({ id: 99 })
  })
})
