import { describe, expect, it } from 'vitest'
import {
  mergeColumnAndIndexValidationErrors,
  mergeIndexValidationErrors,
  mergeTableNameValidationError,
} from '../../../stores/table-designer-store/designer-validation'
import type { TableDesignerColumnDef, TableDesignerIndexDef } from '../../../types/schema'

function column(name: string): TableDesignerColumnDef {
  return {
    name: name,
    type: 'INT',
    length: '',
    nullable: true,
    isPrimaryKey: false,
    isAutoIncrement: false,
    defaultValue: { tag: 'NO_DEFAULT' },
    comment: '',
    originalName: '',
  }
}

function index(overrides: Partial<TableDesignerIndexDef>): TableDesignerIndexDef {
  return { name: 'idx', indexType: 'INDEX', columns: ['id'], ...overrides }
}

describe('mergeColumnAndIndexValidationErrors', () => {
  it('replaces column and index errors and keeps unrelated ones', () => {
    const existingErrors = { 'columns.9.name': 'stale', tableName: 'Table name is required' }
    const errors = mergeColumnAndIndexValidationErrors(existingErrors, {
      columns: [column(''), column('id'), column('ID'), column('x'.repeat(65))],
      indexes: [],
    })
    expect(errors).toEqual({
      tableName: 'Table name is required',
      'columns.0.name': 'Column name is required',
      'columns.2.name': 'Duplicate column name',
      'columns.3.name': 'Column name must not exceed 64 characters',
    })
  })
})

describe('mergeIndexValidationErrors', () => {
  it('flags duplicate names and indexes without columns, ignoring PRIMARY', () => {
    const errors = mergeIndexValidationErrors({ 'indexes.5.name': 'stale' }, [
      index({ name: 'by_name' }),
      index({ name: ' BY_NAME ', columns: [] }),
      index({ name: 'PRIMARY', indexType: 'PRIMARY', columns: [] }),
      index({ name: '' }),
    ])
    expect(errors).toEqual({
      'indexes.0.name': 'Duplicate index name',
      'indexes.1.name': 'Duplicate index name',
      'indexes.1.columns': 'At least one column required',
    })
  })
})

describe('mergeTableNameValidationError', () => {
  it('sets and clears the table name error', () => {
    expect(mergeTableNameValidationError({ other: 'x' }, '')).toEqual({
      other: 'x',
      tableName: 'Table name is required',
    })
    expect(mergeTableNameValidationError({ tableName: 'old' }, 'users')).toEqual({})
  })
})
