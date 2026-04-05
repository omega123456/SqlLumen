import { afterEach, describe, expect, it } from 'vitest'
import { playwrightIpcMockHandler } from '../../lib/playwright-ipc-mock'
import type {
  MultiQueryResult,
  MultiQueryResultItem,
  SchemaMetadataResponse,
} from '../../types/schema'

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

  // --- Multi-query / CALL / re-execute mock handler tests ---

  it('returns a MultiQueryResult with 3 results for execute_multi_query', () => {
    const result = playwrightIpcMockHandler('execute_multi_query', {
      connectionId: 'conn-1',
      tabId: 'tab-1',
      statements: [
        'SELECT id, name FROM users',
        'SELECT product_id, price FROM products',
        "UPDATE users SET status = 'active' WHERE id = 1",
      ],
      pageSize: 1000,
    }) as MultiQueryResult

    expect(result.results).toHaveLength(3)

    // Result 1: SELECT-like
    const r1 = result.results[0]
    expect(r1.queryId).toBe('mock-multi-q1')
    expect(r1.sourceSql).toBe('SELECT id, name FROM users')
    expect(r1.columns).toHaveLength(2)
    expect(r1.columns[0]).toEqual({ name: 'id', dataType: 'BIGINT' })
    expect(r1.columns[1]).toEqual({ name: 'name', dataType: 'VARCHAR' })
    expect(r1.totalRows).toBe(2)
    expect(r1.firstPage).toEqual([
      [1, 'Alice'],
      [2, 'Bob'],
    ])
    expect(r1.error).toBeNull()
    expect(r1.reExecutable).toBe(true)
    expect(r1.affectedRows).toBe(0)

    // Result 2: SELECT-like with different data
    const r2 = result.results[1]
    expect(r2.queryId).toBe('mock-multi-q2')
    expect(r2.sourceSql).toBe('SELECT product_id, price FROM products')
    expect(r2.columns).toHaveLength(2)
    expect(r2.totalRows).toBe(2)
    expect(r2.firstPage).toEqual([
      [101, '29.99'],
      [102, '49.99'],
    ])
    expect(r2.reExecutable).toBe(true)

    // Result 3: DML
    const r3 = result.results[2]
    expect(r3.queryId).toBe('mock-multi-q3')
    expect(r3.columns).toHaveLength(0)
    expect(r3.totalRows).toBe(0)
    expect(r3.affectedRows).toBe(1)
    expect(r3.firstPage).toEqual([])
    expect(r3.reExecutable).toBe(true)
  })

  it('returns a MultiQueryResult with 2 results for execute_call_query', () => {
    const result = playwrightIpcMockHandler('execute_call_query', {
      connectionId: 'conn-1',
      tabId: 'tab-1',
      sql: 'CALL sp_get_orders()',
      pageSize: 1000,
    }) as MultiQueryResult

    expect(result.results).toHaveLength(2)

    // Result 1: SELECT-like, not re-executable
    const r1 = result.results[0]
    expect(r1.queryId).toBe('mock-call-q1')
    expect(r1.sourceSql).toBe('CALL sp_get_orders()')
    expect(r1.columns).toHaveLength(2)
    expect(r1.totalRows).toBe(2)
    expect(r1.firstPage).toEqual([
      [1, '150.00'],
      [2, '230.50'],
    ])
    expect(r1.reExecutable).toBe(false)

    // Result 2: SELECT-like with 1 row, not re-executable
    const r2 = result.results[1]
    expect(r2.queryId).toBe('mock-call-q2')
    expect(r2.sourceSql).toBe('CALL sp_get_orders()')
    expect(r2.columns).toHaveLength(2)
    expect(r2.totalRows).toBe(1)
    expect(r2.firstPage).toEqual([['total_orders', 42]])
    expect(r2.reExecutable).toBe(false)
  })

  it('returns a single MultiQueryResultItem for reexecute_single_result', () => {
    const result = playwrightIpcMockHandler('reexecute_single_result', {
      connectionId: 'conn-1',
      tabId: 'tab-1',
      resultIndex: 0,
      sql: 'SELECT id, name FROM users',
      pageSize: 1000,
    }) as MultiQueryResultItem

    expect(result.queryId).toBe('mock-reexec-q1')
    expect(result.sourceSql).toBe('SELECT id, name FROM users')
    expect(result.columns).toHaveLength(2)
    expect(result.totalRows).toBe(2)
    expect(result.firstPage).toEqual([
      [1, 'Alice'],
      [2, 'Bob'],
    ])
    expect(result.reExecutable).toBe(true)
    expect(result.error).toBeNull()
  })

  it('reexecute_single_result uses the provided sql in sourceSql', () => {
    const result = playwrightIpcMockHandler('reexecute_single_result', {
      connectionId: 'conn-1',
      tabId: 'tab-1',
      resultIndex: 1,
      sql: 'SELECT product_id FROM products',
      pageSize: 500,
    }) as MultiQueryResultItem

    expect(result.sourceSql).toBe('SELECT product_id FROM products')
  })
})
