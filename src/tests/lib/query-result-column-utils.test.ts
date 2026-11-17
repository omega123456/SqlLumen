import { describe, expect, it } from 'vitest'
import { hasResultColumns, resolveQueryResultColumns } from '../../lib/query-result-column-utils'
import type { ColumnMeta, ForeignKeyColumnInfo } from '../../types/schema'

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
})

describe('hasResultColumns', () => {
  it('is false for a result without columns', () => {
    expect(hasResultColumns({ columns: [] })).toBe(false)
  })
})
