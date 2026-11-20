import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDataColumnDescriptors } from '../../../../components/shared/data-view/data-column-descriptors'
import { DEFAULT_EDIT_TARGET } from '../../../../stores/data-view/data-view-defaults'
import type { ColumnMeta } from '../../../../types/schema'
import type { DataColumnMetadata } from '../../../../components/shared/data-view/data-view-source'
import { makeForeignKeyColumn, makeTableColumnMeta } from '../../../helpers/column-meta-fixtures'

const resultColumns: ColumnMeta[] = [
  { name: 'id', dataType: 'INT' },
  { name: 'created_at', dataType: 'DATETIME' },
  { name: 'owner_id', dataType: 'INT' },
  { name: 'total', dataType: 'DECIMAL' },
]

const tableColumns = [
  makeTableColumnMeta({ name: 'id', dataType: 'int', isPrimaryKey: true, isNullable: false }),
  makeTableColumnMeta({ name: 'created_at', dataType: 'datetime' }),
  makeTableColumnMeta({ name: 'owner_id', dataType: 'int' }),
]

const bindings = new Map([
  [0, 'id'],
  [1, 'created_at'],
  [2, 'owner_id'],
])

function renderDescriptors(editMode: string | null, metadata: DataColumnMetadata | null = null) {
  return renderHook(() =>
    useDataColumnDescriptors({
      columns: resultColumns,
      editTarget: {
        ...DEFAULT_EDIT_TARGET,
        tableName: editMode,
        tables: editMode
          ? {
              [editMode]: {
                database: 'db',
                table: editMode,
                columns: tableColumns,
                primaryKey: null,
                foreignKeys: [],
              },
            }
          : {},
        editableColumns: new Map([
          [0, false],
          [1, true],
          [2, true],
          [3, false],
        ]),
        foreignKeys: [makeForeignKeyColumn({ columnName: 'owner_id' })],
        bindings: editMode ? bindings : new Map(),
      },
      metadata: metadata,
      columnWidths: { col_1: 180 },
    })
  ).result.current.descriptors
}

describe('useDataColumnDescriptors', () => {
  it('uses the same editor types as table data for bound columns in edit mode', () => {
    const descriptors = renderDescriptors('orders')

    expect(descriptors.map((descriptor) => descriptor.editorType)).toEqual([
      'text',
      'datetime',
      'fk',
      'none',
    ])
  })

  it('marks only bound, editable columns as editable', () => {
    const descriptors = renderDescriptors('orders')

    expect(descriptors.map((descriptor) => descriptor.editable)).toEqual([false, true, true, false])
  })

  it('keeps the result data type and applies persisted column widths', () => {
    const descriptors = renderDescriptors('orders')

    expect(descriptors[1].dataType).toBe('DATETIME')
    expect(descriptors[1].width).toBe(180)
    expect(descriptors[0].width).toBeUndefined()
  })

  it('attaches foreign keys only to bound columns', () => {
    const descriptors = renderDescriptors('orders')

    expect(descriptors[2].foreignKey?.referencedTable).toBe('users')
    expect(descriptors[3].foreignKey).toBeUndefined()
  })

  it('resolves key and foreign-key metadata from the source when nothing is editable', () => {
    const withoutMetadata = renderDescriptors(null)
    expect(withoutMetadata[0].isPrimaryKey).toBe(false)
    expect(withoutMetadata[2].foreignKey).toBeUndefined()

    const descriptors = renderDescriptors(null, {
      tableColumns: tableColumns,
      foreignKeys: [makeForeignKeyColumn({ columnName: 'owner_id' })],
    })
    expect(descriptors[0].isPrimaryKey).toBe(true)
    expect(descriptors[2].foreignKey?.referencedTable).toBe('users')
    expect(descriptors.map((descriptor) => descriptor.editable)).toEqual([
      false,
      false,
      false,
      false,
    ])
  })
})
