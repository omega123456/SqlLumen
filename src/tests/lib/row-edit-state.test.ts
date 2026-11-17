import { describe, expect, it } from 'vitest'
import { hasModifiedColumns, hasPendingRowChanges } from '../../lib/row-edit-state'

describe('hasPendingRowChanges', () => {
  it('is false without an edit state', () => {
    expect(hasPendingRowChanges(null)).toBe(false)
  })

  it('is true for a new row even without modified columns', () => {
    expect(hasPendingRowChanges({ modifiedColumns: new Set(), isNewRow: true })).toBe(true)
  })
})

describe('hasModifiedColumns', () => {
  it('is false without an edit state', () => {
    expect(hasModifiedColumns(null)).toBe(false)
    expect(hasModifiedColumns(undefined)).toBe(false)
  })
})
