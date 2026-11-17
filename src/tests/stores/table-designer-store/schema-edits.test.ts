import { describe, expect, it } from 'vitest'
import {
  addBlankForeignKey,
  addBlankIndex,
  editColumnField,
  editForeignKeyField,
  editIndexField,
  editProperty,
  moveColumn,
  removeColumn,
  removeForeignKey,
  removeIndex,
  renameTable,
} from '../../../stores/table-designer-store/schema-edits'
import {
  createBlankSchema,
  createDefaultTabState,
} from '../../../stores/table-designer-store/designer-schema'
import type { TableDesignerTabState } from '../../../stores/table-designer-store'
import type { TableDesignerColumnDef, TableDesignerSchema } from '../../../types/schema'

function column(name: string, overrides: Partial<TableDesignerColumnDef> = {}) {
  return {
    name: name,
    type: 'INT',
    length: '11',
    nullable: false,
    isPrimaryKey: false,
    isAutoIncrement: false,
    defaultValue: { tag: 'NO_DEFAULT' as const },
    comment: '',
    originalName: name,
    ...overrides,
  }
}

function tabWithSchema(schema: Partial<TableDesignerSchema>): TableDesignerTabState {
  return {
    ...createDefaultTabState({
      mode: 'alter',
      connectionId: 'conn-1',
      databaseName: 'shop',
      objectName: 'users',
    }),
    currentSchema: { ...createBlankSchema(), ...schema },
  }
}

const populatedTab = tabWithSchema({
  tableName: 'users',
  columns: [column('id', { isPrimaryKey: true, isAutoIncrement: true }), column('email')],
  indexes: [{ name: 'idx_email', indexType: 'INDEX', columns: ['email'] }],
  foreignKeys: [
    {
      name: 'fk_email',
      sourceColumn: 'email',
      referencedDatabase: 'shop',
      referencedTable: 'emails',
      referencedColumn: 'address',
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
      isComposite: false,
    },
  ],
})

describe('schema edits', () => {
  it('drops auto increment when a column type can no longer hold it', () => {
    const edit = editColumnField(populatedTab, { index: 0, field: 'type', value: 'VARCHAR' })
    expect(edit?.schema.columns[0].isAutoIncrement).toBe(false)
  })

  it('ignores out-of-range positions', () => {
    expect(editColumnField(populatedTab, { index: 9, field: 'name', value: 'x' })).toBeNull()
    expect(removeColumn(populatedTab, 9)).toBeNull()
    expect(moveColumn(populatedTab, { fromIndex: 0, toIndex: 0 })).toBeNull()
    expect(editIndexField(populatedTab, { index: 9, field: 'name', value: 'x' })).toBeNull()
    expect(removeIndex(populatedTab, 9)).toBeNull()
    expect(editForeignKeyField(populatedTab, { index: 9, field: 'name', value: 'x' })).toBeNull()
    expect(removeForeignKey(populatedTab, 9)).toBeNull()
  })

  it('edits, adds and removes indexes with index validation', () => {
    const renamed = editIndexField(populatedTab, { index: 0, field: 'name', value: 'by_email' })
    expect(renamed?.schema.indexes[0].name).toBe('by_email')
    const added = addBlankIndex(populatedTab)
    expect(added.validationErrors).toEqual({ 'indexes.1.columns': 'At least one column required' })
    expect(removeIndex(populatedTab, 0)?.schema.indexes).toEqual([])
  })

  it('edits, adds and removes foreign keys', () => {
    const edited = editForeignKeyField(populatedTab, {
      index: 0,
      field: 'onDelete',
      value: 'CASCADE',
    })
    expect(edited?.schema.foreignKeys[0].onDelete).toBe('CASCADE')
    const added = addBlankForeignKey(populatedTab)
    expect(added.schema.foreignKeys[1].referencedDatabase).toBe('shop')
    expect(removeForeignKey(populatedTab, 0)?.schema.foreignKeys).toEqual([])
  })

  it('edits a table property', () => {
    const edit = editProperty(populatedTab, { field: 'engine', value: 'MyISAM' })
    expect(edit.schema.properties.engine).toBe('MyISAM')
  })

  it('renames the table and requires a name', () => {
    expect(renameTable(populatedTab, 'people').schema.tableName).toBe('people')
    expect(renameTable(populatedTab, '').validationErrors).toEqual({
      tableName: 'Table name is required',
    })
  })
})
