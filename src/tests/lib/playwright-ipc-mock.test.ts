import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  playwrightIpcMockHandler,
  resetPlaywrightSessionAllocator,
} from '../../lib/playwright-ipc-mock'
import { overrideFixture, resetFixtureOverrides } from '../playwright-fixtures'
import type {
  MultiQueryResult,
  MultiQueryResultItem,
  SchemaMetadataFull,
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
    resetFixtureOverrides()
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

  it('returns available status for touch_results', () => {
    expect(
      playwrightIpcMockHandler('touch_results', { connectionId: 'conn-1', tabId: 'tab-1' })
    ).toEqual({ status: 'available' })
  })

  it('returns available status for touch_table_data', () => {
    expect(
      playwrightIpcMockHandler('touch_table_data', { connectionId: 'conn-1', tabId: 'tab-1' })
    ).toEqual({ status: 'available' })
  })

  it('returns null for evict_table_data', () => {
    expect(
      playwrightIpcMockHandler('evict_table_data', { connectionId: 'conn-1', tabId: 'tab-1' })
    ).toBeNull()
  })

  it('returns fetch_table_data results without removed total fields', () => {
    const result = playwrightIpcMockHandler('fetch_table_data', {
      connectionId: 'conn-1',
      tabId: 'tab-1',
      database: 'ecommerce_db',
      table: 'users',
      page: 1,
      pageSize: 100,
    }) as Record<string, unknown>

    expect(result.currentPage).toBe(1)
    expect(result.pageSize).toBe(100)
    // Table data stays array-based (not windowed).
    expect(result.rows).toEqual([
      [1, 'Alice', 'alice@example.com'],
      [2, 'Bob', 'bob@example.com'],
      [3, 'Charlie', 'charlie@example.com'],
    ])
    expect(result).not.toHaveProperty('totalRows')
    expect(result).not.toHaveProperty('totalPages')
  })

  it('serves fetch_blob_value from the blob fixture', () => {
    const result = playwrightIpcMockHandler('fetch_blob_value', {
      connectionId: 'conn-1',
      database: 'db',
      table: 'photos',
      column: 'photo',
      pkPairs: [['id', 1]],
    }) as Record<string, unknown>

    expect(result.tooLarge).toBe(false)
    expect(typeof result.base64).toBe('string')
    expect(result.byteLength).toBe(70)
  })

  it('serves an overridden fetch_blob_value fixture keyed by column', () => {
    overrideFixture('blobValue', 'photo', { base64: null, byteLength: 0, tooLarge: false })
    const result = playwrightIpcMockHandler('fetch_blob_value', {
      column: 'photo',
    }) as Record<string, unknown>

    expect(result.base64).toBeNull()
  })

  it('serves list_schema_objects from the fixture registry by object type', () => {
    expect(playwrightIpcMockHandler('list_schema_objects', { objectType: 'table' })).toEqual([
      'users',
      'orders',
      'products',
      'bit_test',
    ])
    expect(playwrightIpcMockHandler('list_schema_objects', { objectType: 'event' })).toEqual([])
    expect(playwrightIpcMockHandler('list_schema_objects', { objectType: 'unknown' })).toEqual([])
    expect(playwrightIpcMockHandler('list_schema_objects', {})).toEqual([])

    overrideFixture('schemaObjects', 'table', ['t1', 't2'])
    expect(playwrightIpcMockHandler('list_schema_objects', { objectType: 'table' })).toEqual([
      't1',
      't2',
    ])
  })

  it('serves read_file_bytes as base64 and write_file_bytes as null', () => {
    expect(typeof playwrightIpcMockHandler('read_file_bytes', { path: '/tmp/x' })).toBe('string')
    expect(
      playwrightIpcMockHandler('write_file_bytes', { path: '/tmp/x', base64: 'aGk=' })
    ).toBeNull()
  })

  it('returns copy-to-host object fixtures for list_copyable_objects', () => {
    const result = playwrightIpcMockHandler('list_copyable_objects', {
      connectionId: 'conn-1',
      database: 'ecommerce_db',
    }) as Record<string, unknown>

    expect(result.tables).toEqual([
      { name: 'users', estimatedRows: 1240 },
      { name: 'orders', estimatedRows: 5820 },
      { name: 'audit_log', estimatedRows: 18422 },
    ])
    expect(result.procedures).toEqual(['sp_refresh_user_rollups'])
  })

  it('returns target database fixtures for database listing', () => {
    const result = playwrightIpcMockHandler('list_databases', { connectionId: 'session-target' })

    expect(result).toEqual(['ecommerce_db', 'analytics_db', 'staging_db'])
  })

  it('returns registry-backed copy progress fixtures', () => {
    overrideFixture('copyToHostStart', 'default', 'copy-job-custom')
    overrideFixture('copyProgress', 'copy-job-custom', {
      jobId: 'copy-job-custom',
      status: 'completed',
      objectsTotal: 2,
      objectsDone: 2,
      currentObject: null,
      currentObjectType: null,
      rowsTotal: null,
      rowsDone: null,
      errorMessage: null,
      cancelRequested: false,
    })

    expect(playwrightIpcMockHandler('start_copy_to_host', { params: {} })).toBe('copy-job-custom')
    expect(
      playwrightIpcMockHandler('get_copy_progress', { jobId: 'copy-job-custom' })
    ).toMatchObject({
      jobId: 'copy-job-custom',
      status: 'completed',
      objectsDone: 2,
      objectsTotal: 2,
    })
    expect(playwrightIpcMockHandler('cancel_copy', { jobId: 'copy-job-custom' })).toBeNull()
  })

  it('serves the result export job from the fixture registry', () => {
    expect(playwrightIpcMockHandler('start_result_export', {})).toBe('result-export-job-1')
    expect(
      playwrightIpcMockHandler('get_result_export_progress', { jobId: 'result-export-job-1' })
    ).toMatchObject({ status: 'completed', rowsWritten: 250_000, error: null })
    expect(playwrightIpcMockHandler('cancel_result_export', { jobId: 'result-export-job-1' })).toBe(
      null
    )
  })

  it('serves overridden result export fixtures', () => {
    overrideFixture('resultExportStart', 'default', 'job-custom')
    overrideFixture('resultExportProgress', 'job-custom', {
      status: 'running',
      rowsWritten: 7,
      bytesWritten: 70,
      elapsedMs: 700,
      stoppedAtSheetLimit: false,
      error: null,
    })
    overrideFixture('resultExportProgress', 'default', {
      status: 'failed',
      rowsWritten: 0,
      bytesWritten: 0,
      elapsedMs: 0,
      stoppedAtSheetLimit: false,
      error: 'boom',
    })
    overrideFixture('resultExportCancel', 'default', null)

    expect(playwrightIpcMockHandler('start_result_export', {})).toBe('job-custom')
    expect(
      playwrightIpcMockHandler('get_result_export_progress', { jobId: 'job-custom' })
    ).toMatchObject({ status: 'running', rowsWritten: 7 })
    expect(
      playwrightIpcMockHandler('get_result_export_progress', { jobId: 'other-job' })
    ).toMatchObject({ status: 'failed', error: 'boom' })
    expect(playwrightIpcMockHandler('cancel_result_export', { jobId: 'job-custom' })).toBeNull()
  })

  it('returns completed copy progress by default', () => {
    expect(playwrightIpcMockHandler('get_copy_progress', { jobId: 'copy-job-1' })).toMatchObject({
      jobId: 'copy-job-1',
      status: 'completed',
      objectsDone: 4,
      objectsTotal: 4,
    })
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

  it('returns null for updater and process plugin commands by default', () => {
    expect(playwrightIpcMockHandler('plugin:updater|check')).toBeNull()
    expect(playwrightIpcMockHandler('plugin:os|platform')).toBe('linux')
    expect(playwrightIpcMockHandler('plugin:process|relaunch')).toBeNull()
  })

  it('returns update metadata and install command mocks when overridden', () => {
    ;(
      globalThis as typeof globalThis & {
        __PLAYWRIGHT_UPDATE_OVERRIDE__?: { available?: boolean; version?: string }
      }
    ).__PLAYWRIGHT_UPDATE_OVERRIDE__ = {
      available: true,
      version: '9.9.9',
    }

    const result = playwrightIpcMockHandler('plugin:updater|check') as {
      version: string
      rid: number
    }
    expect(result.version).toBe('9.9.9')
    expect(result.rid).toBe(101)

    const events: unknown[] = []
    const installResult = playwrightIpcMockHandler('plugin:updater|download_and_install', {
      onEvent: {
        onmessage: (payload: unknown) => {
          events.push(payload)
        },
      },
      rid: 101,
    })

    expect(installResult).toBeNull()
    expect(events).toEqual([
      { event: 'Started', data: { contentLength: 100 } },
      { event: 'Progress', data: { chunkLength: 50 } },
      { event: 'Progress', data: { chunkLength: 50 } },
      { event: 'Finished' },
    ])

    const downloadResult = playwrightIpcMockHandler('plugin:updater|download', {
      onEvent: {
        onmessage: (payload: unknown) => {
          events.push(payload)
        },
      },
      rid: 101,
    })
    expect(downloadResult).toBe(201)
    expect(
      playwrightIpcMockHandler('plugin:updater|install', { updateRid: 101, bytesRid: 201 })
    ).toBeNull()

    delete (
      globalThis as typeof globalThis & {
        __PLAYWRIGHT_UPDATE_OVERRIDE__?: { available?: boolean; version?: string }
      }
    ).__PLAYWRIGHT_UPDATE_OVERRIDE__
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
      rowLimit: 1000,
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
    expect(r1.firstWindow.rows).toEqual([
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
    expect(r2.firstWindow.rows).toEqual([
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
    expect(r3.firstWindow.rows).toEqual([])
    expect(r3.reExecutable).toBe(true)
  })

  it('returns a MultiQueryResult with 2 results for execute_call_query', () => {
    const result = playwrightIpcMockHandler('execute_call_query', {
      connectionId: 'conn-1',
      tabId: 'tab-1',
      sql: 'CALL sp_get_orders()',
      rowLimit: 1000,
    }) as MultiQueryResult

    expect(result.results).toHaveLength(2)

    // Result 1: SELECT-like, not re-executable
    const r1 = result.results[0]
    expect(r1.queryId).toBe('mock-call-q1')
    expect(r1.sourceSql).toBe('CALL sp_get_orders()')
    expect(r1.columns).toHaveLength(2)
    expect(r1.totalRows).toBe(2)
    expect(r1.firstWindow.rows).toEqual([
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
    expect(r2.firstWindow.rows).toEqual([['total_orders', 42]])
    expect(r2.reExecutable).toBe(false)
  })

  it('returns a single MultiQueryResultItem for reexecute_single_result', () => {
    const result = playwrightIpcMockHandler('reexecute_single_result', {
      connectionId: 'conn-1',
      tabId: 'tab-1',
      resultIndex: 0,
      sql: 'SELECT id, name FROM users',
      rowLimit: 1000,
    }) as MultiQueryResultItem

    expect(result.queryId).toBe('mock-reexec-q1')
    expect(result.sourceSql).toBe('SELECT id, name FROM users')
    expect(result.columns).toHaveLength(2)
    expect(result.totalRows).toBe(2)
    expect(result.firstWindow.rows).toEqual([
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
      rowLimit: 500,
    }) as MultiQueryResultItem

    expect(result.sourceSql).toBe('SELECT product_id FROM products')
  })

  it('execute_query returns a windowed response (first window, never the full result)', () => {
    const result = playwrightIpcMockHandler('execute_query', {
      connectionId: 'conn-1',
      tabId: 'tab-w',
      sql: 'SELECT * FROM large_result',
      rowLimit: 1000,
    }) as Record<string, unknown> & { firstWindow: { rows: unknown[][]; baseIndices: number[] } }

    expect('rows' in result).toBe(false)
    expect(result.totalRows).toBe(12340)
    expect(result.viewRowCount).toBe(12340)
    expect(result.viewVersion).toBe(1)
    expect(result.truncated).toBe(false)
    expect(result.firstWindow.rows).toHaveLength(1000)
    expect(result.firstWindow.baseIndices.slice(0, 3)).toEqual([0, 1, 2])
  })

  it('serves windows, applies view specs with compare-and-swap and refuses stale windows', () => {
    const slot = { connectionId: 'conn-1', tabId: 'tab-v', resultIndex: 0 }
    const executed = playwrightIpcMockHandler('execute_query', {
      ...slot,
      sql: 'SELECT * FROM users',
    }) as { queryId: string }
    const queryId = executed.queryId

    const window = playwrightIpcMockHandler('fetch_result_window', {
      ...slot,
      queryId,
      viewVersion: 1,
      offset: 3,
      limit: 5000,
    }) as { offset: number; rows: unknown[][]; baseIndices: number[] }
    expect(window.offset).toBe(3)
    expect(window.baseIndices).toEqual([3, 4])

    const sorted = playwrightIpcMockHandler('set_result_view', {
      ...slot,
      queryId,
      baseViewVersion: 1,
      viewSpec: { sort: { column: 'name', direction: 'asc' }, filters: [] },
    }) as { viewVersion: number; firstWindow: { rows: unknown[][] } }
    expect(sorted.viewVersion).toBe(2)
    expect(sorted.firstWindow.rows.map((row) => row[1])).toEqual([
      'Alex Chen',
      'Elena Vance',
      'Julian Thorne',
      'Marcus Reed',
      'Sarah Kim',
    ])

    expect(() =>
      playwrightIpcMockHandler('set_result_view', {
        ...slot,
        queryId,
        baseViewVersion: 1,
        viewSpec: { sort: null, filters: [] },
      })
    ).toThrow('view_superseded: current=2')
    expect(() =>
      playwrightIpcMockHandler('fetch_result_window', {
        ...slot,
        queryId,
        viewVersion: 1,
        offset: 0,
        limit: 10,
      })
    ).toThrow(/^view_stale:/)
    expect(() =>
      playwrightIpcMockHandler('set_result_view', {
        ...slot,
        queryId,
        baseViewVersion: 2,
        viewSpec: { sort: { column: 'missing', direction: 'asc' }, filters: [] },
      })
    ).toThrow(/missing/)

    const filtered = playwrightIpcMockHandler('set_result_view', {
      ...slot,
      queryId,
      baseViewVersion: 2,
      viewSpec: {
        sort: null,
        filters: [
          { column: 'status', operator: '==', value: 'active' },
          { column: 'gone', operator: '==', value: 'x' },
        ],
      },
    }) as { viewRowCount: number; totalRows: number }
    expect(filtered).toMatchObject({ viewRowCount: 3, totalRows: 5 })
  })

  it('tombstones removed rows and serves rows by base index', () => {
    const slot = { connectionId: 'conn-1', tabId: 'tab-d', resultIndex: 0 }
    const { queryId } = playwrightIpcMockHandler('execute_query', {
      ...slot,
      sql: 'SELECT * FROM users',
    }) as { queryId: string }

    const removed = playwrightIpcMockHandler('remove_result_rows', {
      ...slot,
      queryId,
      baseViewVersion: 1,
      baseIndices: [1, 3],
    })
    expect(removed).toEqual({ viewVersion: 2, viewRowCount: 3, totalRows: 3 })

    expect(() =>
      playwrightIpcMockHandler('fetch_result_window', {
        ...slot,
        queryId: 'other-query',
        viewVersion: 2,
        offset: 0,
        limit: 10,
      })
    ).toThrow(/Results were refreshed/)
    expect(() =>
      playwrightIpcMockHandler('fetch_result_window', {
        ...slot,
        tabId: 'no-such-tab',
        queryId,
        viewVersion: 1,
        offset: 0,
        limit: 1,
      })
    ).toThrow(/^results_expired/)
  })

  it('serves a truncated CALL fixture with the call blocked reason', () => {
    const result = playwrightIpcMockHandler('execute_call_query', {
      connectionId: 'conn-1',
      tabId: 'tab-c',
      sql: 'CALL sp_truncated_call()',
    }) as { results: Array<Record<string, unknown>> }
    expect(result.results[0]).toMatchObject({
      truncated: true,
      rowCeiling: 100000,
      fullExportBlockedReason: 'call',
      reExecutable: false,
    })
  })

  // --- AI mock handler tests ---

  it('returns null for ai_chat (async streaming happens via events)', () => {
    const result = playwrightIpcMockHandler('ai_chat', {
      request: {
        messages: [{ role: 'user', content: 'Show me all users' }],
        endpoint: 'http://localhost:11434/v1/chat/completions',
        model: 'llama3',
        temperature: 0.3,
        maxTokens: 2048,
        streamId: 'mock-stream-1',
      },
    })
    expect(result).toBeNull()
  })

  it('returns null for ai_cancel', () => {
    const result = playwrightIpcMockHandler('ai_cancel', {
      streamId: 'mock-stream-1',
    })
    expect(result).toBeNull()
  })

  it('returns null for invalidate_metadata_cache', () => {
    const result = playwrightIpcMockHandler('invalidate_metadata_cache', {
      connectionId: 'session-playwright-1',
    })
    expect(result).toBeNull()
  })

  it('serves fetch_schema_metadata_full from the fixture registry with views and triggers', async () => {
    overrideFixture('schemaMetadataFull', 'default', {
      databases: ['fixture_db'],
      tables: {
        fixture_db: [
          {
            name: 'fixture_table',
            engine: 'InnoDB',
            charset: 'utf8mb4',
            rowCount: 10,
            dataSize: 2048,
          },
        ],
      },
      views: {
        fixture_db: [{ name: 'fixture_view' }],
      },
      columns: {
        'fixture_db.fixture_table': [{ name: 'id', dataType: 'BIGINT' }],
      },
      routines: {
        fixture_db: [{ name: 'fixture_proc', routineType: 'PROCEDURE' }],
      },
      triggers: {
        fixture_db: [{ name: 'fixture_trigger' }],
      },
      foreignKeys: {},
      indexes: {},
    } satisfies SchemaMetadataFull)

    const result = (await playwrightIpcMockHandler('fetch_schema_metadata_full', {
      connectionId: 'conn-1',
    })) as SchemaMetadataFull

    expect(result.tables.fixture_db[0]?.name).toBe('fixture_table')
    expect(result.views.fixture_db).toEqual([{ name: 'fixture_view' }])
    expect(result.triggers.fixture_db).toEqual([{ name: 'fixture_trigger' }])
  })

  it('captures event listener callback IDs via plugin:event|listen', () => {
    // Simulate what Tauri listen() does internally
    const result = playwrightIpcMockHandler('plugin:event|listen', {
      event: 'ai-stream-chunk',
      handler: 42,
      target: { kind: 'Any' },
    })
    // Should return the handler ID as the event ID
    expect(result).toBe(42)
  })

  it('returns null for plugin:event|unlisten', () => {
    const result = playwrightIpcMockHandler('plugin:event|unlisten', {
      event: 'ai-stream-chunk',
      eventId: 42,
    })
    expect(result).toBeNull()
  })

  // --- Deterministic multi-session allocation ---

  describe('open_connection session allocation', () => {
    beforeEach(() => {
      resetPlaywrightSessionAllocator()
    })

    afterEach(() => {
      resetPlaywrightSessionAllocator()
    })

    it('returns session-playwright-1 for the first open_connection call', () => {
      const result = playwrightIpcMockHandler('open_connection', {
        connectionId: 'conn-playwright-1',
      }) as { sessionId: string; serverVersion: string }

      expect(result.sessionId).toBe('session-playwright-1')
      expect(result.serverVersion).toBe('8.0.33-mock')
    })

    it('allocates distinct sequential session IDs for repeated open_connection calls', () => {
      const first = playwrightIpcMockHandler('open_connection', {}) as { sessionId: string }
      const second = playwrightIpcMockHandler('open_connection', {}) as { sessionId: string }
      const third = playwrightIpcMockHandler('open_connection', {}) as { sessionId: string }

      expect(first.sessionId).toBe('session-playwright-1')
      expect(second.sessionId).toBe('session-playwright-2')
      expect(third.sessionId).toBe('session-playwright-3')
    })

    it('preserves the unchanged response shape across allocations', () => {
      const result = playwrightIpcMockHandler('open_connection', {}) as Record<string, unknown>
      expect(Object.keys(result).sort()).toEqual(['serverVersion', 'sessionId'])
    })

    it('resets the allocator so a fresh page load starts at session-playwright-1', () => {
      playwrightIpcMockHandler('open_connection', {})
      playwrightIpcMockHandler('open_connection', {})

      resetPlaywrightSessionAllocator()

      const afterReset = playwrightIpcMockHandler('open_connection', {}) as { sessionId: string }
      expect(afterReset.sessionId).toBe('session-playwright-1')
    })
  })
})
