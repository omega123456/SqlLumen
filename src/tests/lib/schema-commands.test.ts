import { describe, it, expect } from 'vitest'
import { ipc } from '../ipc-mock'
import {
  listDatabases,
  listSchemaObjects,
  listColumns,
  getSchemaInfo,
  getDatabaseDetails,
  listCharsets,
  listCollations,
  getTableForeignKeys,
  createDatabase,
  dropDatabase,
  alterDatabase,
  renameDatabase,
  dropTable,
  truncateTable,
  renameTable,
} from '../../lib/schema-commands'
import type { SchemaObjectRequest } from '../../lib/ipc/requests'

function expectCommandCall(commandName: string, args: Record<string, unknown>) {
  expect(ipc.calls(commandName)).toEqual([args])
}

function expectPayloadCall(commandName: string, payload: object) {
  expect(ipc.calls(commandName)).toEqual([{ payload }])
}

describe('schema commands', () => {
  it('sends the connection id for the connection-wide listings and returns their rows', async () => {
    const charsets = [
      {
        charset: 'utf8mb4',
        description: 'UTF-8',
        defaultCollation: 'utf8mb4_general_ci',
        maxLength: 4,
      },
    ]
    const collations = [{ name: 'utf8mb4_general_ci', charset: 'utf8mb4', isDefault: true }]
    ipc.override('list_databases', () => ['db1', 'db2'])
    ipc.override('list_charsets', () => charsets)
    ipc.override('list_collations', () => collations)

    expect(await listDatabases('conn-1')).toEqual(['db1', 'db2'])
    expect(await listCharsets('conn-1')).toEqual(charsets)
    expect(await listCollations('conn-1')).toEqual(collations)

    expectCommandCall('list_databases', { connectionId: 'conn-1' })
    expectCommandCall('list_charsets', { connectionId: 'conn-1' })
    expectCommandCall('list_collations', { connectionId: 'conn-1' })
  })

  it('maps positional arguments to named payload fields and returns the responses', async () => {
    const columns = [
      {
        name: 'id',
        dataType: 'int',
        nullable: false,
        columnKey: 'PRI',
        defaultValue: null,
        extra: 'auto_increment',
        ordinalPosition: 1,
      },
    ]
    const foreignKeys = [
      {
        name: 'fk_orders_user',
        columnName: 'user_id',
        referencedDatabase: 'mydb',
        referencedTable: 'users',
        referencedColumn: 'id',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
    ]
    const databaseDetails = {
      name: 'mydb',
      defaultCharacterSet: 'utf8mb4',
      defaultCollation: 'utf8mb4_general_ci',
    }
    ipc.override('list_schema_objects', () => ['users', 'orders'])
    ipc.override('list_columns', () => columns)
    ipc.override('get_database_details', () => databaseDetails)
    ipc.override('get_table_foreign_keys', () => foreignKeys)

    expect(await listSchemaObjects('conn-1', 'mydb', 'table')).toEqual(['users', 'orders'])
    expect(await listColumns('conn-1', 'mydb', 'users')).toEqual(columns)
    expect(await getDatabaseDetails('conn-1', 'mydb')).toEqual(databaseDetails)
    expect(await getTableForeignKeys('conn-1', 'mydb', 'orders')).toEqual(foreignKeys)
    await dropDatabase('conn-1', 'mydb')
    await renameDatabase('conn-1', 'olddb', 'newdb')
    await dropTable('conn-1', 'mydb', 'users')
    await truncateTable('conn-1', 'mydb', 'users')

    expectPayloadCall('list_schema_objects', {
      connectionId: 'conn-1',
      database: 'mydb',
      objectType: 'table',
    })
    expectPayloadCall('list_columns', { connectionId: 'conn-1', database: 'mydb', table: 'users' })
    expectPayloadCall('get_database_details', { connectionId: 'conn-1', database: 'mydb' })
    expectPayloadCall('get_table_foreign_keys', {
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'orders',
    })
    expectPayloadCall('drop_database', { connectionId: 'conn-1', name: 'mydb' })
    expectPayloadCall('rename_database', {
      connectionId: 'conn-1',
      oldName: 'olddb',
      newName: 'newdb',
    })
    expectPayloadCall('drop_table', { connectionId: 'conn-1', database: 'mydb', table: 'users' })
    expectPayloadCall('truncate_table', {
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'users',
    })
  })

  it('forwards request objects unchanged, including null charset and collation', async () => {
    const schemaInfo = { columns: [], indexes: [], foreignKeys: [], ddl: '', metadata: null }
    const schemaRequest: SchemaObjectRequest = {
      connectionId: 'conn-1',
      database: 'mydb',
      objectName: 'users',
      objectType: 'table',
    }
    const createRequest = {
      connectionId: 'conn-1',
      name: 'newdb',
      charset: 'utf8mb4',
      collation: 'utf8mb4_general_ci',
    }
    const alterRequest = { connectionId: 'conn-1', name: 'mydb', charset: null, collation: null }
    const renameRequest = {
      connectionId: 'conn-1',
      database: 'mydb',
      oldName: 'old_table',
      newName: 'new_table',
    }
    ipc.override('get_schema_info', () => schemaInfo)

    expect(await getSchemaInfo(schemaRequest)).toEqual(schemaInfo)
    await createDatabase(createRequest)
    await alterDatabase(alterRequest)
    await renameTable(renameRequest)

    expectPayloadCall('get_schema_info', schemaRequest)
    expectPayloadCall('create_database', createRequest)
    expectPayloadCall('alter_database', alterRequest)
    expectPayloadCall('rename_table', renameRequest)
  })
})
