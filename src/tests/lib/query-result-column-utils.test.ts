import { describe, expect, it } from 'vitest'
import { resolveQueryResultColumns } from '../../lib/query-result-column-utils'
import type { ColumnMeta, ForeignKeyColumnInfo, TableDataColumnMeta } from '../../types/schema'

const makeTableColumn = (name: string, dataType = 'VARCHAR'): TableDataColumnMeta => ({
  name,
  dataType,
  isNullable: true,
  isPrimaryKey: false,
  isUniqueKey: false,
  hasDefault: false,
  columnDefault: null,
  isBinary: false,
  isBooleanAlias: false,
  isAutoIncrement: false,
})

describe('resolveQueryResultColumns', () => {
  it('uses fallback table metadata and omits FK lookup for unbound result columns', () => {
    const resultColumns: ColumnMeta[] = [{ name: 'email_alias', dataType: 'VARCHAR' }]
    const editForeignKeys: ForeignKeyColumnInfo[] = [
      {
        columnName: 'email',
        referencedDatabase: 'accounts',
        referencedTable: 'users',
        referencedColumn: 'id',
        constraintName: 'fk_users_email',
      },
    ]

    const [resolved] = resolveQueryResultColumns({
      resultColumns,
      editMode: 'db.users',
      editableColumnMap: new Map([[0, true]]),
      editTableColumns: [],
      editForeignKeys,
      editColumnBindings: new Map(),
    })

    expect(resolved.boundName).toBe('email_alias')
    expect(resolved.editable).toBe(true)
    expect(resolved.tableColumnMeta).toBeUndefined()
    expect(resolved.effectiveTableMeta).toMatchObject({
      name: 'email_alias',
      dataType: 'VARCHAR',
      isNullable: true,
    })
    expect(resolved.foreignKey).toBeUndefined()
  })

  it('resolves bound table metadata and FK lookup case-insensitively', () => {
    const resultColumns: ColumnMeta[] = [{ name: 'Email Alias', dataType: 'VARCHAR' }]

    const [resolved] = resolveQueryResultColumns({
      resultColumns,
      editMode: 'db.users',
      editableColumnMap: new Map([[0, true]]),
      editTableColumns: [makeTableColumn('EMAIL', 'TEXT')],
      editForeignKeys: [
        {
          columnName: 'email',
          referencedDatabase: 'accounts',
          referencedTable: 'users',
          referencedColumn: 'id',
          constraintName: 'fk_users_email',
        },
      ],
      editColumnBindings: new Map([[0, 'Email']]),
    })

    expect(resolved.boundName).toBe('Email')
    expect(resolved.tableColumnMeta).toMatchObject({ name: 'EMAIL', dataType: 'TEXT' })
    expect(resolved.effectiveTableMeta).toMatchObject({ name: 'EMAIL', dataType: 'TEXT' })
    expect(resolved.foreignKey).toMatchObject({
      columnName: 'email',
      referencedDatabase: 'accounts',
      referencedTable: 'users',
      referencedColumn: 'id',
    })
  })

  it('marks result columns non-editable when edit mode is not active', () => {
    const [resolved] = resolveQueryResultColumns({
      resultColumns: [{ name: 'id', dataType: 'INT' }],
      editMode: null,
      editableColumnMap: new Map([[0, true]]),
      editTableColumns: [makeTableColumn('id', 'INT')],
      editForeignKeys: [],
      editColumnBindings: new Map([[0, 'id']]),
    })

    expect(resolved.editable).toBe(false)
    expect(resolved.foreignKey).toBeUndefined()
  })
})
