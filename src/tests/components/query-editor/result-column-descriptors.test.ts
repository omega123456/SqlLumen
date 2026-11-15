import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useResultColumnDescriptors } from '../../../components/query-editor/result-column-descriptors'
import type { ColumnMeta } from '../../../types/schema'
import { makeForeignKeyColumn, makeTableColumnMeta } from '../../helpers/column-meta-fixtures'

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

function renderDescriptors(editMode: string | null) {
  return renderHook(() =>
    useResultColumnDescriptors({
      columns: resultColumns,
      editMode: editMode,
      editableColumnMap: new Map([
        [0, false],
        [1, true],
        [2, true],
        [3, false],
      ]),
      editTableColumns: tableColumns,
      editForeignKeys: [makeForeignKeyColumn({ columnName: 'owner_id' })],
      editColumnBindings: bindings,
      columnWidths: { col_1: 180 },
    })
  ).result.current.descriptors
}

describe('useResultColumnDescriptors', () => {
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
})
