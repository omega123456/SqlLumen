import { afterEach, describe, expect, it } from 'vitest'
import { playwrightIpcMockHandler } from '../../lib/playwright-ipc-mock'
import type { SchemaMetadataResponse } from '../../types/schema'

type PlaywrightWindow = typeof globalThis & {
  __PLAYWRIGHT_SCHEMA_METADATA_OVERRIDE__?: SchemaMetadataResponse
}

function clearSchemaOverride() {
  delete (globalThis as PlaywrightWindow).__PLAYWRIGHT_SCHEMA_METADATA_OVERRIDE__
}

describe('playwrightIpcMockHandler', () => {
  afterEach(() => {
    clearSchemaOverride()
  })

  it('returns the schema metadata override for fetch_schema_metadata when present', () => {
    const override: SchemaMetadataResponse = {
      databases: ['valid_db'],
      tables: {
        valid_db: [
          {
            name: 'users',
            engine: 'InnoDB',
            charset: 'utf8mb4',
            rowCount: 42,
            dataSize: 1024,
          },
        ],
      },
      columns: {
        'valid_db.users': [{ name: 'id', dataType: 'BIGINT' }],
      },
      routines: {
        valid_db: [{ name: 'get_users', routineType: 'FUNCTION' }],
      },
    }

    ;(globalThis as PlaywrightWindow).__PLAYWRIGHT_SCHEMA_METADATA_OVERRIDE__ = override

    expect(playwrightIpcMockHandler('fetch_schema_metadata', { connectionId: 'conn-1' })).toEqual(
      override
    )
  })

  it('returns table edit info for analyze_query_for_edit', () => {
    const result = playwrightIpcMockHandler('analyze_query_for_edit', {
      connectionId: 'conn-1',
      sql: 'SELECT * FROM users',
    })
    expect(Array.isArray(result)).toBe(true)
    const arr = result as Array<Record<string, unknown>>
    expect(arr).toHaveLength(1)
    expect(arr[0].database).toBe('ecommerce_db')
    expect(arr[0].table).toBe('users')
    expect(arr[0].primaryKey).toBeDefined()
    expect(arr[0].columns).toBeDefined()
  })

  it('returns null for update_result_cell', () => {
    const result = playwrightIpcMockHandler('update_result_cell', {
      connectionId: 'conn-1',
      tabId: 'tab-1',
      rowIndex: 0,
      updates: { 1: 'new value' },
    })
    expect(result).toBeNull()
  })

  it('returns a realistic table designer schema mock', () => {
    const result = playwrightIpcMockHandler('load_table_for_designer', {
      connectionId: 'conn-1',
      database: 'mock_db',
      tableName: 'users',
    }) as Record<string, unknown>

    expect(result.tableName).toBe('users')
    expect(result.properties).toMatchObject({
      engine: 'InnoDB',
      charset: 'utf8mb4',
      collation: 'utf8mb4_unicode_ci',
      autoIncrement: 1,
      rowFormat: 'DYNAMIC',
      comment: 'User accounts table',
    })

    const columns = result.columns as Array<Record<string, unknown>>
    expect(columns).toHaveLength(5)
    expect(columns[0]).toMatchObject({
      name: 'id',
      type: 'BIGINT',
      typeModifier: 'UNSIGNED',
      isPrimaryKey: true,
      isAutoIncrement: true,
    })
    expect(columns[3]).toMatchObject({
      name: 'status',
      type: 'VARCHAR',
      defaultValue: { tag: 'LITERAL', value: 'active' },
    })
    expect(columns[4]).toMatchObject({
      name: 'created_at',
      type: 'DATETIME',
      defaultValue: { tag: 'EXPRESSION', value: 'CURRENT_TIMESTAMP' },
    })

    const foreignKeys = result.foreignKeys as Array<Record<string, unknown>>
    expect(foreignKeys[0].isComposite).toBe(false)
    expect(foreignKeys[1].isComposite).toBe(true)
  })

  it('returns create-table DDL in create mode', () => {
    const result = playwrightIpcMockHandler('generate_table_ddl', {
      request: { mode: 'create' },
    }) as Record<string, unknown>

    expect(result.ddl).toContain('CREATE TABLE `mock_db`.`__new_table__`')
    expect(result.warnings).toEqual([])
  })

  it('returns alter-table DDL in alter mode', () => {
    const result = playwrightIpcMockHandler('generate_table_ddl', {
      request: { mode: 'alter' },
    }) as Record<string, unknown>

    expect(result.ddl).toContain('ALTER TABLE `mock_db`.`users`')
    expect(result.warnings).toEqual([])
  })

  it('returns undefined for apply_table_ddl', () => {
    const result = playwrightIpcMockHandler('apply_table_ddl', {
      connectionId: 'conn-1',
      database: 'mock_db',
      ddl: 'ALTER TABLE `users` MODIFY COLUMN `email` VARCHAR(320) NOT NULL;',
    })

    expect(result).toBeUndefined()
  })
})
