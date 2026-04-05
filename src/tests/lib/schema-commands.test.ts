import { describe, it, expect, vi, beforeEach } from 'vitest'
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

// Mock the @tauri-apps/api/core module
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
const mockInvoke = vi.mocked(invoke)

beforeEach(() => {
  mockInvoke.mockReset()
})

// ---------------------------------------------------------------------------
// Read-only query commands
// ---------------------------------------------------------------------------

describe('listDatabases', () => {
  it('calls invoke with correct command and args', async () => {
    mockInvoke.mockResolvedValue(['db1', 'db2'])
    const result = await listDatabases('conn-1')
    expect(mockInvoke).toHaveBeenCalledWith('list_databases', { connectionId: 'conn-1' })
    expect(result).toEqual(['db1', 'db2'])
  })

  it('propagates errors from invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('Not connected'))
    await expect(listDatabases('conn-1')).rejects.toThrow('Not connected')
  })
})

describe('listSchemaObjects', () => {
  it('calls invoke with correct command and args', async () => {
    mockInvoke.mockResolvedValue(['users', 'orders'])
    const result = await listSchemaObjects('conn-1', 'mydb', 'table')
    expect(mockInvoke).toHaveBeenCalledWith('list_schema_objects', {
      connectionId: 'conn-1',
      database: 'mydb',
      objectType: 'table',
    })
    expect(result).toEqual(['users', 'orders'])
  })

  it('propagates errors from invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('Unknown type'))
    await expect(listSchemaObjects('conn-1', 'mydb', 'bad')).rejects.toThrow('Unknown type')
  })
})

describe('listColumns', () => {
  it('calls invoke with correct command and args', async () => {
    const mockCols = [
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
    mockInvoke.mockResolvedValue(mockCols)
    const result = await listColumns('conn-1', 'mydb', 'users')
    expect(mockInvoke).toHaveBeenCalledWith('list_columns', {
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'users',
    })
    expect(result).toEqual(mockCols)
  })

  it('propagates errors from invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('Table not found'))
    await expect(listColumns('conn-1', 'mydb', 'missing')).rejects.toThrow('Table not found')
  })
})

describe('getSchemaInfo', () => {
  it('calls invoke with correct command and args', async () => {
    const mockResponse = { columns: [], indexes: [], foreignKeys: [], ddl: '', metadata: null }
    mockInvoke.mockResolvedValue(mockResponse)
    const result = await getSchemaInfo('conn-1', 'mydb', 'users', 'table')
    expect(mockInvoke).toHaveBeenCalledWith('get_schema_info', {
      connectionId: 'conn-1',
      database: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })
    expect(result).toEqual(mockResponse)
  })

  it('propagates errors from invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('Schema error'))
    await expect(getSchemaInfo('conn-1', 'mydb', 'users', 'table')).rejects.toThrow('Schema error')
  })
})

describe('getDatabaseDetails', () => {
  it('calls invoke with correct command and args', async () => {
    const mockDetails = {
      name: 'mydb',
      defaultCharacterSet: 'utf8mb4',
      defaultCollation: 'utf8mb4_general_ci',
    }
    mockInvoke.mockResolvedValue(mockDetails)
    const result = await getDatabaseDetails('conn-1', 'mydb')
    expect(mockInvoke).toHaveBeenCalledWith('get_database_details', {
      connectionId: 'conn-1',
      database: 'mydb',
    })
    expect(result).toEqual(mockDetails)
  })

  it('propagates errors from invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('DB not found'))
    await expect(getDatabaseDetails('conn-1', 'missing')).rejects.toThrow('DB not found')
  })
})

describe('listCharsets', () => {
  it('calls invoke with correct command and args', async () => {
    const mockCharsets = [
      {
        charset: 'utf8mb4',
        description: 'UTF-8',
        defaultCollation: 'utf8mb4_general_ci',
        maxLength: 4,
      },
    ]
    mockInvoke.mockResolvedValue(mockCharsets)
    const result = await listCharsets('conn-1')
    expect(mockInvoke).toHaveBeenCalledWith('list_charsets', { connectionId: 'conn-1' })
    expect(result).toEqual(mockCharsets)
  })

  it('propagates errors from invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('Charset error'))
    await expect(listCharsets('conn-1')).rejects.toThrow('Charset error')
  })
})

describe('listCollations', () => {
  it('calls invoke with correct command and args', async () => {
    const mockCollations = [{ name: 'utf8mb4_general_ci', charset: 'utf8mb4', isDefault: true }]
    mockInvoke.mockResolvedValue(mockCollations)
    const result = await listCollations('conn-1')
    expect(mockInvoke).toHaveBeenCalledWith('list_collations', { connectionId: 'conn-1' })
    expect(result).toEqual(mockCollations)
  })

  it('propagates errors from invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('Collation error'))
    await expect(listCollations('conn-1')).rejects.toThrow('Collation error')
  })
})

describe('getTableForeignKeys', () => {
  it('calls invoke with correct command and args', async () => {
    const mockFKs = [
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
    mockInvoke.mockResolvedValue(mockFKs)
    const result = await getTableForeignKeys('conn-1', 'mydb', 'orders')
    expect(mockInvoke).toHaveBeenCalledWith('get_table_foreign_keys', {
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'orders',
    })
    expect(result).toEqual(mockFKs)
  })

  it('returns empty array for tables without foreign keys', async () => {
    mockInvoke.mockResolvedValue([])
    const result = await getTableForeignKeys('conn-1', 'mydb', 'standalone')
    expect(mockInvoke).toHaveBeenCalledWith('get_table_foreign_keys', {
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'standalone',
    })
    expect(result).toEqual([])
  })

  it('propagates errors from invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('FK lookup failed'))
    await expect(getTableForeignKeys('conn-1', 'mydb', 'orders')).rejects.toThrow(
      'FK lookup failed'
    )
  })
})

// ---------------------------------------------------------------------------
// Mutating commands
// ---------------------------------------------------------------------------

describe('createDatabase', () => {
  it('calls invoke with correct command and args', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await createDatabase('conn-1', 'newdb', 'utf8mb4', 'utf8mb4_general_ci')
    expect(mockInvoke).toHaveBeenCalledWith('create_database', {
      connectionId: 'conn-1',
      name: 'newdb',
      charset: 'utf8mb4',
      collation: 'utf8mb4_general_ci',
    })
  })

  it('passes null for optional charset and collation when omitted', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await createDatabase('conn-1', 'newdb')
    expect(mockInvoke).toHaveBeenCalledWith('create_database', {
      connectionId: 'conn-1',
      name: 'newdb',
      charset: null,
      collation: null,
    })
  })

  it('propagates errors from invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('Create failed'))
    await expect(createDatabase('conn-1', 'newdb')).rejects.toThrow('Create failed')
  })
})

describe('dropDatabase', () => {
  it('calls invoke with correct command and args', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await dropDatabase('conn-1', 'mydb')
    expect(mockInvoke).toHaveBeenCalledWith('drop_database', {
      connectionId: 'conn-1',
      name: 'mydb',
    })
  })

  it('propagates errors from invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('Drop failed'))
    await expect(dropDatabase('conn-1', 'mydb')).rejects.toThrow('Drop failed')
  })
})

describe('alterDatabase', () => {
  it('calls invoke with correct command and args', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await alterDatabase('conn-1', 'mydb', 'utf8mb4', 'utf8mb4_unicode_ci')
    expect(mockInvoke).toHaveBeenCalledWith('alter_database', {
      connectionId: 'conn-1',
      name: 'mydb',
      charset: 'utf8mb4',
      collation: 'utf8mb4_unicode_ci',
    })
  })

  it('passes null for optional charset and collation when omitted', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await alterDatabase('conn-1', 'mydb')
    expect(mockInvoke).toHaveBeenCalledWith('alter_database', {
      connectionId: 'conn-1',
      name: 'mydb',
      charset: null,
      collation: null,
    })
  })

  it('propagates errors from invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('Alter failed'))
    await expect(alterDatabase('conn-1', 'mydb')).rejects.toThrow('Alter failed')
  })
})

describe('renameDatabase', () => {
  it('calls invoke with correct command and args', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await renameDatabase('conn-1', 'olddb', 'newdb')
    expect(mockInvoke).toHaveBeenCalledWith('rename_database', {
      connectionId: 'conn-1',
      oldName: 'olddb',
      newName: 'newdb',
    })
  })

  it('propagates errors from invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('Rename failed'))
    await expect(renameDatabase('conn-1', 'old', 'new')).rejects.toThrow('Rename failed')
  })
})

describe('dropTable', () => {
  it('calls invoke with correct command and args', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await dropTable('conn-1', 'mydb', 'users')
    expect(mockInvoke).toHaveBeenCalledWith('drop_table', {
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'users',
    })
  })

  it('propagates errors from invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('Drop table failed'))
    await expect(dropTable('conn-1', 'mydb', 'users')).rejects.toThrow('Drop table failed')
  })
})

describe('truncateTable', () => {
  it('calls invoke with correct command and args', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await truncateTable('conn-1', 'mydb', 'users')
    expect(mockInvoke).toHaveBeenCalledWith('truncate_table', {
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'users',
    })
  })

  it('propagates errors from invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('Truncate failed'))
    await expect(truncateTable('conn-1', 'mydb', 'users')).rejects.toThrow('Truncate failed')
  })
})

describe('renameTable', () => {
  it('calls invoke with correct command and args', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await renameTable('conn-1', 'mydb', 'old_table', 'new_table')
    expect(mockInvoke).toHaveBeenCalledWith('rename_table', {
      connectionId: 'conn-1',
      database: 'mydb',
      oldName: 'old_table',
      newName: 'new_table',
    })
  })

  it('propagates errors from invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('Rename table failed'))
    await expect(renameTable('conn-1', 'mydb', 'old', 'new')).rejects.toThrow('Rename table failed')
  })
})
