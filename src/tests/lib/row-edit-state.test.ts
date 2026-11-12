import { describe, expect, it } from 'vitest'
import { hasModifiedColumns, hasPendingRowChanges } from '../../lib/row-edit-state'

describe('hasPendingRowChanges', () => {
  it('is false without an edit state', () => {
    expect(hasPendingRowChanges(null)).toBe(false)
  })

  it('is true for a new row even without modified columns', () => {
    expect(hasPendingRowChanges({ modifiedColumns: new Set(), isNewRow: true })).toBe(true)
  })

  it('is true for an existing row with modified columns', () => {
    expect(hasPendingRowChanges({ modifiedColumns: new Set(['name']), isNewRow: false })).toBe(true)
  })

  it('is false for an untouched existing row', () => {
    expect(hasPendingRowChanges({ modifiedColumns: new Set(), isNewRow: false })).toBe(false)
  })
})

describe('hasModifiedColumns', () => {
  it('is false without an edit state', () => {
    expect(hasModifiedColumns(null)).toBe(false)
    expect(hasModifiedColumns(undefined)).toBe(false)
  })

  it('is false when no column was modified', () => {
    expect(hasModifiedColumns({ modifiedColumns: new Set() })).toBe(false)
  })

  it('is true when a column was modified', () => {
    expect(hasModifiedColumns({ modifiedColumns: new Set(['name']) })).toBe(true)
  })
})
