import { describe, it, expect } from 'vitest'
import type { ColumnMeta, TableDataColumnMeta, RowEditState } from '../../types/schema'
import {
  findAmbiguousColumns,
  buildEditableColumnMap,
  buildQueryEditColumnBindings,
  validateKeyColumnsPresent,
  buildRowEditState,
  buildUpdatePayload,
  buildInsertPayload,
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

function queryTable(
  table: string,
  columns: TableDataColumnMeta[],
  database = 'testdb'
): {
  database: string
  table: string
  columns: TableDataColumnMeta[]
  primaryKey: { keyColumns: string[]; hasAutoIncrement: boolean; isUniqueKeyFallback: boolean }
  foreignKeys: []
} {
  return {
    database,
    table,
    columns,
    primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
    foreignKeys: [],
  }
}

const userTableColumns = [tableCol('id'), tableCol('name'), tableCol('email')]

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
})

// ---------------------------------------------------------------------------
// buildEditableColumnMap
// ---------------------------------------------------------------------------

describe('buildEditableColumnMap', () => {
  it('marks non-matching columns as not editable', () => {
    const resultCols = [col('id'), col('computed_field')]
    const tableCols = [tableCol('id')]
    const ambiguous = new Set<string>()

    const map = buildEditableColumnMap({
      resultColumns: resultCols,
      tableColumns: tableCols,
      ambiguousNames: ambiguous,
    })
    expect(map.get(0)).toBe(true)
    expect(map.get(1)).toBe(false)
  })

  it('excludes ambiguous columns', () => {
    const resultCols = [col('id'), col('name'), col('id')]
    const tableCols = [tableCol('id'), tableCol('name')]
    const ambiguous = new Set(['id'])

    const map = buildEditableColumnMap({
      resultColumns: resultCols,
      tableColumns: tableCols,
      ambiguousNames: ambiguous,
    })
    expect(map.get(0)).toBe(false) // ambiguous
    expect(map.get(1)).toBe(true) // not ambiguous, matches
    expect(map.get(2)).toBe(false) // ambiguous
  })
})

// ---------------------------------------------------------------------------
// validateKeyColumnsPresent
// ---------------------------------------------------------------------------

describe('validateKeyColumnsPresent', () => {
  it('returns valid when all keys are present', () => {
    const resultCols = [col('id'), col('name')]
    const result = validateKeyColumnsPresent({
      primaryKeyColumns: ['id'],
      resultColumns: resultCols,
      ambiguousNames: new Set(),
    })
    expect(result.valid).toBe(true)
    expect(result.missingColumns).toEqual([])
  })

  it('handles compound key where some columns are missing', () => {
    const resultCols = [col('id'), col('name')]
    const result = validateKeyColumnsPresent({
      primaryKeyColumns: ['id', 'tenant_id'],
      resultColumns: resultCols,
      ambiguousNames: new Set(),
    })
    expect(result.valid).toBe(false)
    expect(result.missingColumns).toEqual(['tenant_id'])
  })
})

describe('buildQueryEditColumnBindings', () => {
  it('supports leading SQL comments before the SELECT list', () => {
    const resultCols = [col('id'), col('name')]
    const usersTable = queryTable('users', userTableColumns)

    const bindings = buildQueryEditColumnBindings({
      sql: '/* lead */\n-- second\n# third\nSELECT id, name FROM users',
      resultColumns: resultCols,
      targetTable: usersTable,
      queryTablesInOrder: [usersTable],
    })

    expect(bindings).toEqual(
      new Map([
        [0, 'id'],
        [1, 'name'],
      ])
    )
  })

  it('falls back to direct name matching when sql is unavailable', () => {
    const resultCols = [col('id'), col('name')]
    const usersTable = queryTable('users', userTableColumns)

    const bindings = buildQueryEditColumnBindings({
      sql: null,
      resultColumns: resultCols,
      targetTable: usersTable,
      queryTablesInOrder: [usersTable],
    })

    expect(bindings).toEqual(
      new Map([
        [0, 'id'],
        [1, 'name'],
      ])
    )
  })

  it('does not bind aliases when the query has no FROM clause', () => {
    const resultCols = [col('id')]
    const usersTable = queryTable('users', userTableColumns)

    const bindings = buildQueryEditColumnBindings({
      sql: 'SELECT 1 AS id',
      resultColumns: resultCols,
      targetTable: usersTable,
      queryTablesInOrder: [usersTable],
    })

    expect(bindings).toEqual(new Map())
  })

  it('returns no bindings when leading comments are unterminated', () => {
    const resultCols = [col('id')]
    const usersTable = queryTable('users', userTableColumns)

    const bindings = buildQueryEditColumnBindings({
      sql: '/* unfinished comment',
      resultColumns: resultCols,
      targetTable: usersTable,
      queryTablesInOrder: [usersTable],
    })

    expect(bindings).toEqual(new Map())
  })

  it('returns no bindings when a leading line comment has no newline', () => {
    const resultCols = [col('id')]
    const usersTable = queryTable('users', userTableColumns)

    const bindings = buildQueryEditColumnBindings({
      sql: '-- comment only',
      resultColumns: resultCols,
      targetTable: usersTable,
      queryTablesInOrder: [usersTable],
    })

    expect(bindings).toEqual(new Map())
  })

  it('handles inline comments, strings, and schema-qualified identifiers in the select list', () => {
    const resultCols = [col('literal_text'), col('user_id')]
    const usersTable = queryTable('users', userTableColumns)

    const bindings = buildQueryEditColumnBindings({
      sql: "SELECT /* inline */ 'FROM, literal' AS literal_text, `testdb`.`users`.`id` AS user_id FROM `testdb`.`users`",
      resultColumns: resultCols,
      targetTable: usersTable,
      queryTablesInOrder: [usersTable],
    })

    expect(bindings).toEqual(new Map([[1, 'id']]))
  })

  it('handles escaped quotes, nested expressions, and double-quoted literals', () => {
    const resultCols = [col('label'), col('user_id')]
    const usersTable = queryTable('users', userTableColumns)

    const bindings = buildQueryEditColumnBindings({
      sql: `SELECT CONCAT("a, b", 'O\\'Brien', users.name) AS label, users.id AS user_id FROM users`,
      resultColumns: resultCols,
      targetTable: usersTable,
      queryTablesInOrder: [usersTable],
    })

    expect(bindings).toEqual(new Map([[1, 'id']]))
  })

  it('handles line comments inside the select list', () => {
    const resultCols = [col('user_id')]
    const usersTable = queryTable('users', userTableColumns)

    const bindings = buildQueryEditColumnBindings({
      sql: 'SELECT -- comment\n users.id AS user_id FROM users',
      resultColumns: resultCols,
      targetTable: usersTable,
      queryTablesInOrder: [usersTable],
    })

    expect(bindings).toEqual(new Map([[0, 'id']]))
  })

  it('handles hash comments inside the select list', () => {
    const resultCols = [col('user_id')]
    const usersTable = queryTable('users', userTableColumns)

    const bindings = buildQueryEditColumnBindings({
      sql: 'SELECT # comment\n users.id AS user_id FROM users',
      resultColumns: resultCols,
      targetTable: usersTable,
      queryTablesInOrder: [usersTable],
    })

    expect(bindings).toEqual(new Map([[0, 'id']]))
  })

  it('returns no projection bindings when result column count does not match the parsed select list', () => {
    const resultCols = [col('id'), col('extra')]
    const usersTable = queryTable('users', userTableColumns)

    const bindings = buildQueryEditColumnBindings({
      sql: 'SELECT users.id FROM users',
      resultColumns: resultCols,
      targetTable: usersTable,
      queryTablesInOrder: [usersTable],
    })

    expect(bindings).toEqual(new Map([[0, 'id']]))
  })

  it('resolves schema-qualified wildcard bindings', () => {
    const resultCols = [col('id'), col('name'), col('email')]
    const usersTable = queryTable('users', userTableColumns)

    const bindings = buildQueryEditColumnBindings({
      sql: 'SELECT testdb.users.* FROM testdb.users',
      resultColumns: resultCols,
      targetTable: usersTable,
      queryTablesInOrder: [usersTable],
    })

    expect(bindings).toEqual(
      new Map([
        [0, 'id'],
        [1, 'name'],
        [2, 'email'],
      ])
    )
  })

  it('resolves schema-qualified aliases back to the target table', () => {
    const resultCols = [col('user_id')]
    const usersTable = queryTable('users', userTableColumns)

    const bindings = buildQueryEditColumnBindings({
      sql: 'SELECT u.id AS user_id FROM testdb.users AS u',
      resultColumns: resultCols,
      targetTable: usersTable,
      queryTablesInOrder: [usersTable],
    })

    expect(bindings).toEqual(new Map([[0, 'id']]))
  })

  it('drops duplicate bindings that point to the same target column', () => {
    const resultCols = [col('id'), col('id_alias')]
    const usersTable = queryTable('users', userTableColumns)

    const bindings = buildQueryEditColumnBindings({
      sql: 'SELECT users.id, users.id AS id_alias FROM users',
      resultColumns: resultCols,
      targetTable: usersTable,
      queryTablesInOrder: [usersTable],
    })

    expect(bindings).toEqual(new Map())
  })

  it('does not bind DISTINCT-wrapped aliased key columns until projection parsing supports them', () => {
    const resultCols = [col('user_id')]
    const usersTable = queryTable('users', userTableColumns)

    const bindings = buildQueryEditColumnBindings({
      sql: 'SELECT DISTINCT users.id AS user_id FROM users',
      resultColumns: resultCols,
      targetTable: usersTable,
      queryTablesInOrder: [usersTable],
    })

    expect(bindings).toEqual(new Map())
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

    const state = buildRowEditState({
      row: row,
      resultColumns: resultCols,
      editableMap: editableMap,
      primaryKeyColumnNames: ['id'],
    })

    expect(state.originalValues).toEqual({ id: 42, name: 'Alice' })
    expect(state.currentValues).toEqual({ id: 42, name: 'Alice' })
    expect(state.modifiedColumns.size).toBe(0)
    expect(state.isNewRow).toBe(false)
  })

  it('populates rowKey for compound PK', () => {
    const resultCols = [col('tenant_id'), col('user_id'), col('name')]
    const editableMap = new Map([
      [0, true],
      [1, true],
      [2, true],
    ])
    const row = [1, 42, 'Charlie']

    const state = buildRowEditState({
      row: row,
      resultColumns: resultCols,
      editableMap: editableMap,
      primaryKeyColumnNames: ['tenant_id', 'user_id'],
    })
    expect(state.rowKey).toEqual({ tenant_id: 1, user_id: 42 })
  })
})

// ---------------------------------------------------------------------------
// buildUpdatePayload
// ---------------------------------------------------------------------------

describe('buildUpdatePayload', () => {
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

  it('keeps BIT string as-is when value exceeds MAX_SAFE_INTEGER', () => {
    const columns = [
      tableCol('id', { dataType: 'INT' }),
      tableCol('big_flags', { dataType: 'BIT' }),
    ]
    const editState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { id: 1, big_flags: 0 },
      currentValues: { id: 1, big_flags: '18446744073709551615' },
      modifiedColumns: new Set(['big_flags']),
      isNewRow: false,
    }

    const payload = buildUpdatePayload(editState, ['id'], columns)
    expect(payload.updatedValues).toEqual({ big_flags: '18446744073709551615' })
  })
})

// ---------------------------------------------------------------------------
// buildInsertPayload
// ---------------------------------------------------------------------------

describe('buildInsertPayload', () => {
  it('includes only modified columns in values', () => {
    const columns = [tableCol('id', { isAutoIncrement: true }), tableCol('name'), tableCol('email')]
    const editState: RowEditState = {
      rowKey: {},
      originalValues: { name: undefined, email: undefined },
      currentValues: { name: 'Alice', email: 'alice@test.com' },
      modifiedColumns: new Set(['name', 'email']),
      isNewRow: true,
    }

    const values = buildInsertPayload(editState, columns)
    expect(values).toEqual({ name: 'Alice', email: 'alice@test.com' })
    expect(values).not.toHaveProperty('id')
  })

  it('coerces BIT string values to numbers', () => {
    const columns = [
      tableCol('id', { isAutoIncrement: true }),
      tableCol('flags', { dataType: 'BIT' }),
    ]
    const editState: RowEditState = {
      rowKey: {},
      originalValues: {},
      currentValues: { flags: '42' },
      modifiedColumns: new Set(['flags']),
      isNewRow: true,
    }

    const values = buildInsertPayload(editState, columns)
    expect(values).toEqual({ flags: 42 })
  })
})
