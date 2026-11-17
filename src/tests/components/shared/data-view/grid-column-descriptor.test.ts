import { describe, expect, it } from 'vitest'
import {
  buildGridColumnDescriptor,
  resolveGridEditorType,
} from '../../../../components/shared/data-view/grid-column-descriptor'
import { makeTableColumnMeta } from '../../../helpers/column-meta-fixtures'

describe('resolveGridEditorType', () => {
  it('returns none when no table column is bound', () => {
    expect(resolveGridEditorType(undefined, undefined)).toBe('none')
  })

  it.each(['date', 'datetime', 'timestamp', 'time', 'DATETIME(6)'])(
    'returns datetime for %s columns',
    (dataType) => {
      expect(resolveGridEditorType(makeTableColumnMeta({ dataType: dataType }), undefined)).toBe(
        'datetime'
      )
    }
  )

  it('returns set for set columns', () => {
    const setColumn = makeTableColumnMeta({ dataType: 'set', setValues: ['a', 'b'] })
    expect(resolveGridEditorType(setColumn, undefined)).toBe('set')
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
})
