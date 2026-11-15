import { describe, expect, it } from 'vitest'
import {
  buildGridColumnDescriptor,
  resolveGridEditorType,
} from '../../../../components/shared/data-view/grid-column-descriptor'
import { makeForeignKeyColumn, makeTableColumnMeta } from '../../../helpers/column-meta-fixtures'

describe('resolveGridEditorType', () => {
  it('returns none when no table column is bound', () => {
    expect(resolveGridEditorType(undefined, undefined)).toBe('none')
  })

  it('returns none for binary columns', () => {
    const blobColumn = makeTableColumnMeta({ dataType: 'blob', isBinary: true })
    expect(resolveGridEditorType(blobColumn, undefined)).toBe('none')
  })

  it('returns json for JSON columns', () => {
    expect(resolveGridEditorType(makeTableColumnMeta({ dataType: 'json' }), undefined)).toBe('json')
  })

  it.each(['date', 'datetime', 'timestamp', 'time', 'DATETIME(6)'])(
    'returns datetime for %s columns',
    (dataType) => {
      expect(resolveGridEditorType(makeTableColumnMeta({ dataType: dataType }), undefined)).toBe(
        'datetime'
      )
    }
  )

  it('returns enum for enum columns, even when they are foreign keys', () => {
    const enumColumn = makeTableColumnMeta({ dataType: 'enum', enumValues: ['a', 'b'] })
    expect(resolveGridEditorType(enumColumn, makeForeignKeyColumn())).toBe('enum')
  })

  it('returns set for set columns', () => {
    const setColumn = makeTableColumnMeta({ dataType: 'set', setValues: ['a', 'b'] })
    expect(resolveGridEditorType(setColumn, undefined)).toBe('set')
  })

  it('returns fk for plain foreign-key columns', () => {
    const foreignKeyColumn = makeTableColumnMeta({ name: 'owner_id', dataType: 'int' })
    expect(resolveGridEditorType(foreignKeyColumn, makeForeignKeyColumn())).toBe('fk')
  })

  it('returns text for everything else', () => {
    expect(resolveGridEditorType(makeTableColumnMeta(), undefined)).toBe('text')
  })
})

describe('buildGridColumnDescriptor', () => {
  it('copies key flags and list values from the bound table column', () => {
    const tableColumn = makeTableColumnMeta({
      name: 'status',
      dataType: 'enum',
      isNullable: false,
      isPrimaryKey: true,
      isUniqueKey: true,
      enumValues: ['on', 'off'],
    })

    const descriptor = buildGridColumnDescriptor({
      key: 'status',
      displayName: 'Status',
      dataType: 'ENUM',
      tableColumn: tableColumn,
      foreignKey: undefined,
      editable: true,
      blobViewerEditable: true,
      width: 120,
    })

    expect(descriptor).toMatchObject({
      key: 'status',
      displayName: 'Status',
      dataType: 'ENUM',
      editable: true,
      isBinary: false,
      isNullable: false,
      isPrimaryKey: true,
      isUniqueKey: true,
      enumValues: ['on', 'off'],
      tableColumnMeta: tableColumn,
      editorType: 'enum',
      blobViewer: false,
      blobViewerEditable: false,
      width: 120,
    })
  })

  it('treats unbound columns as nullable, non-key and read-only', () => {
    const descriptor = buildGridColumnDescriptor({
      key: 'col_0',
      displayName: 'total',
      dataType: 'DECIMAL',
      tableColumn: undefined,
      foreignKey: undefined,
      editable: false,
      blobViewerEditable: false,
    })

    expect(descriptor).toMatchObject({
      isNullable: true,
      isPrimaryKey: false,
      isUniqueKey: false,
      editorType: 'none',
      tableColumnMeta: undefined,
    })
  })

  it('detects binary columns from the data type when no table column is bound', () => {
    const descriptor = buildGridColumnDescriptor({
      key: 'col_0',
      displayName: 'avatar',
      dataType: 'BLOB',
      tableColumn: undefined,
      foreignKey: undefined,
      editable: false,
      blobViewerEditable: true,
    })

    expect(descriptor.isBinary).toBe(true)
    expect(descriptor.blobViewer).toBe(true)
    expect(descriptor.blobViewerEditable).toBe(true)
  })

  it('carries the foreign key through to the descriptor', () => {
    const foreignKey = makeForeignKeyColumn()
    const descriptor = buildGridColumnDescriptor({
      key: 'owner_id',
      displayName: 'owner_id',
      dataType: 'int',
      tableColumn: makeTableColumnMeta({ name: 'owner_id', dataType: 'int' }),
      foreignKey: foreignKey,
      editable: true,
      blobViewerEditable: false,
    })

    expect(descriptor.foreignKey).toBe(foreignKey)
    expect(descriptor.editorType).toBe('fk')
  })
})
