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
})
