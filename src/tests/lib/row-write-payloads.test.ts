import { describe, it, expect } from 'vitest'
import type { RowEditState, TableDataColumnMeta } from '../../types/schema'
import {
  buildInsertPayload,
  buildUpdatePayload,
  coerceValueForColumn,
  projectSavedCellValue,
} from '../../lib/row-write-payloads'
import { bytesEnvelope, emptyEnvelope, nullEnvelope } from '../../lib/blob-utils'

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

    const payload = buildUpdatePayload({
      editState: editState,
      keyColumns: ['id'],
      tableColumns: [],
      projection: 'full',
    })
    expect(payload).toEqual({
      ok: true,
      payload: {
        primaryKeyColumns: ['id'],
        originalPrimaryKeyValues: { id: 1 },
        updatedValues: { id: 99 },
      },
    })
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

    const payload = buildUpdatePayload({
      editState: editState,
      keyColumns: ['id'],
      tableColumns: columns,
      projection: 'full',
    })
    expect(payload.ok && payload.payload.updatedValues).toEqual({
      big_flags: '18446744073709551615',
    })
  })

  it('converts hex binary key values to byte envelopes for placeholder projections', () => {
    const editState: RowEditState = {
      rowKey: { uuid: '0x0A0B' },
      originalValues: {},
      currentValues: { name: 'Renamed' },
      modifiedColumns: new Set(['name']),
      isNewRow: false,
    }
    const columns = [tableCol('uuid', { isBinary: true }), tableCol('name')]

    const converted = buildUpdatePayload({
      editState: editState,
      keyColumns: ['uuid'],
      tableColumns: columns,
      projection: 'blobPlaceholders',
    })
    const rejected = buildUpdatePayload({
      editState: { ...editState, rowKey: { uuid: 'not hex' } },
      keyColumns: ['uuid'],
      tableColumns: columns,
      projection: 'blobPlaceholders',
    })

    expect(converted.ok && converted.payload.originalPrimaryKeyValues).toEqual({
      uuid: bytesEnvelope('Cgs='),
    })
    expect(rejected.ok).toBe(false)
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

describe('projectSavedCellValue', () => {
  it('shows saved BLOB envelopes as base64 in full projections and as placeholders otherwise', () => {
    const bytes = bytesEnvelope('U1FM')

    expect(projectSavedCellValue(bytes, 'full')).toBe('U1FM')
    expect(projectSavedCellValue(emptyEnvelope(), 'full')).toBe('')
    expect(projectSavedCellValue(nullEnvelope(), 'full')).toBeNull()
    expect(projectSavedCellValue(bytes, 'blobPlaceholders')).toBe('[BLOB - 3 B]')
    expect(projectSavedCellValue(emptyEnvelope(), 'blobPlaceholders')).toBe('[BLOB - 0 B]')
    expect(projectSavedCellValue('plain', 'blobPlaceholders')).toBe('plain')
  })
})

describe('coerceValueForColumn', () => {
  it('turns numeric BIT strings into numbers and leaves every other value unchanged', () => {
    expect(coerceValueForColumn('128', 'BIT')).toBe(128)
    expect(coerceValueForColumn('0', 'bit')).toBe(0)
    expect(coerceValueForColumn(null, 'BIT')).toBeNull()
    expect(coerceValueForColumn(128, 'BIT')).toBe(128)
    expect(coerceValueForColumn('128', 'VARCHAR')).toBe('128')
    expect(coerceValueForColumn(bytesEnvelope('AA=='), 'BIT')).toEqual(bytesEnvelope('AA=='))
  })
})
