import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fetchSchemaMetadata from query-commands
vi.mock('../../../lib/query-commands', () => ({
  fetchSchemaMetadata: vi.fn(),
}))

import { fetchSchemaMetadata } from '../../../lib/query-commands'
import {
  getCache,
  loadCache,
  invalidateCache,
  filterDatabases,
  filterTables,
  filterColumns,
  filterRoutines,
  _clearAllCaches,
} from '../../../components/query-editor/schema-metadata-cache'

const mockFetchSchema = vi.mocked(fetchSchemaMetadata)

beforeEach(() => {
  _clearAllCaches()
  vi.clearAllMocks()
})

describe('schema-metadata-cache', () => {
  it('getCache returns empty status initially', () => {
    const cache = getCache('conn-1')
    expect(cache.status).toBe('empty')
    expect(cache.databases).toEqual([])
    expect(cache.tables).toEqual({})
    expect(cache.columns).toEqual({})
    expect(cache.routines).toEqual({})
  })

  it('loadCache transitions to loading then ready', async () => {
    mockFetchSchema.mockResolvedValue({
      databases: ['test_db'],
      tables: {
        test_db: [
          { name: 'users', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 100, dataSize: 1024 },
        ],
      },
      columns: { 'test_db.users': [{ name: 'id', dataType: 'int' }] },
      routines: {},
    })

    const promise = loadCache('conn-1')
    expect(getCache('conn-1').status).toBe('loading')

    await promise
    expect(getCache('conn-1').status).toBe('ready')
    expect(getCache('conn-1').databases).toEqual(['test_db'])
    expect(getCache('conn-1').tables).toHaveProperty('test_db')
    expect(getCache('conn-1').lastRefreshAt).toBeGreaterThan(0)
  })

  it('loadCache is a no-op if already loading', async () => {
    let resolvePromise: (() => void) | null = null
    mockFetchSchema.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = () => resolve({ databases: ['db'], tables: {}, columns: {}, routines: {} })
      })
    )

    const p1 = loadCache('conn-1')
    // Second call while first is still loading — should return same promise
    const p2 = loadCache('conn-1')

    // Should only have been called once
    expect(mockFetchSchema).toHaveBeenCalledTimes(1)

    resolvePromise!()
    await p1
    await p2

    // Both callers should see the ready cache
    expect(getCache('conn-1').status).toBe('ready')
  })

  it('concurrent callers await the same in-flight fetch', async () => {
    let resolvePromise: (() => void) | null = null
    mockFetchSchema.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = () =>
          resolve({ databases: ['shared_db'], tables: {}, columns: {}, routines: {} })
      })
    )

    const p1 = loadCache('conn-concurrent')
    const p2 = loadCache('conn-concurrent')
    const p3 = loadCache('conn-concurrent')

    // Should only call fetch once
    expect(mockFetchSchema).toHaveBeenCalledTimes(1)

    resolvePromise!()
    await Promise.all([p1, p2, p3])

    // All callers should see the ready cache
    expect(getCache('conn-concurrent').status).toBe('ready')
    expect(getCache('conn-concurrent').databases).toEqual(['shared_db'])
  })

  it('loadCache is a no-op if already ready', async () => {
    mockFetchSchema.mockResolvedValue({
      databases: [],
      tables: {},
      columns: {},
      routines: {},
    })

    await loadCache('conn-1')
    expect(getCache('conn-1').status).toBe('ready')

    await loadCache('conn-1')
    expect(mockFetchSchema).toHaveBeenCalledTimes(1)
  })

  it('loadCache retries after error status', async () => {
    mockFetchSchema.mockRejectedValueOnce(new Error('Connection failed'))
    await loadCache('conn-1')
    expect(getCache('conn-1').status).toBe('error')

    mockFetchSchema.mockResolvedValueOnce({
      databases: ['db1'],
      tables: {},
      columns: {},
      routines: {},
    })
    await loadCache('conn-1')
    expect(getCache('conn-1').status).toBe('ready')
    expect(mockFetchSchema).toHaveBeenCalledTimes(2)
  })

  it('loadCache sets error status on failure', async () => {
    mockFetchSchema.mockRejectedValue(new Error('Connection failed'))

    await loadCache('conn-1')

    const cache = getCache('conn-1')
    expect(cache.status).toBe('error')
    expect(cache.error).toBe('Connection failed')
  })

  it('loadCache sets error status on non-Error rejection', async () => {
    mockFetchSchema.mockRejectedValue('string error')

    await loadCache('conn-1')

    const cache = getCache('conn-1')
    expect(cache.status).toBe('error')
    expect(cache.error).toBe('string error')
  })

  it('filterDatabases returns prefix matches (case-insensitive)', async () => {
    mockFetchSchema.mockResolvedValue({
      databases: ['app_db', 'analytics_db', 'test_db'],
      tables: {},
      columns: {},
      routines: {},
    })

    await loadCache('conn-1')

    expect(filterDatabases('conn-1', 'a')).toEqual(['app_db', 'analytics_db'])
    expect(filterDatabases('conn-1', 'A')).toEqual(['app_db', 'analytics_db'])
    expect(filterDatabases('conn-1', 'test')).toEqual(['test_db'])
    expect(filterDatabases('conn-1', 'z')).toEqual([])
    expect(filterDatabases('conn-1', '')).toEqual(['app_db', 'analytics_db', 'test_db'])
  })

  it('filterDatabases returns empty when cache is not ready', () => {
    expect(filterDatabases('conn-1', '')).toEqual([])
  })

  it('filterTables returns tables for a given database with prefix', async () => {
    mockFetchSchema.mockResolvedValue({
      databases: ['db1'],
      tables: {
        db1: [
          { name: 'users', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 100, dataSize: 1024 },
          { name: 'orders', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 200, dataSize: 2048 },
        ],
      },
      columns: {},
      routines: {},
    })

    await loadCache('conn-1')

    expect(filterTables('conn-1', 'db1', 'u')).toHaveLength(1)
    expect(filterTables('conn-1', 'db1', 'u')[0].name).toBe('users')
    expect(filterTables('conn-1', 'db1', '')).toHaveLength(2)
    expect(filterTables('conn-1', 'nonexistent', 'u')).toEqual([])
  })

  it('filterTables returns empty when cache is not ready', () => {
    expect(filterTables('conn-1', 'db1', '')).toEqual([])
  })

  it('filterColumns returns columns for database.table', async () => {
    mockFetchSchema.mockResolvedValue({
      databases: ['db1'],
      tables: {
        db1: [
          { name: 'users', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 100, dataSize: 1024 },
        ],
      },
      columns: {
        'db1.users': [
          { name: 'id', dataType: 'int' },
          { name: 'email', dataType: 'varchar' },
          { name: 'name', dataType: 'varchar' },
        ],
      },
      routines: {},
    })

    await loadCache('conn-1')

    expect(filterColumns('conn-1', 'db1', 'users', 'i')).toHaveLength(1)
    expect(filterColumns('conn-1', 'db1', 'users', 'i')[0].name).toBe('id')
    expect(filterColumns('conn-1', 'db1', 'users', '')).toHaveLength(3)
    expect(filterColumns('conn-1', 'db1', 'users', 'E')).toHaveLength(1) // case-insensitive
    expect(filterColumns('conn-1', 'db1', 'nonexistent', '')).toEqual([])
  })

  it('filterRoutines returns routines for a database', async () => {
    mockFetchSchema.mockResolvedValue({
      databases: ['db1'],
      tables: {},
      columns: {},
      routines: {
        db1: [
          { name: 'get_user_count', routineType: 'FUNCTION' },
          { name: 'process_orders', routineType: 'PROCEDURE' },
        ],
      },
    })

    await loadCache('conn-1')

    expect(filterRoutines('conn-1', 'db1', 'get')).toHaveLength(1)
    expect(filterRoutines('conn-1', 'db1', 'get')[0].name).toBe('get_user_count')
    expect(filterRoutines('conn-1', 'db1', '')).toHaveLength(2)
    expect(filterRoutines('conn-1', 'db1', 'z')).toEqual([])
    expect(filterRoutines('conn-1', 'nonexistent', '')).toEqual([])
  })

  it('invalidateCache removes the entry', async () => {
    mockFetchSchema.mockResolvedValue({
      databases: ['db1'],
      tables: {},
      columns: {},
      routines: {},
    })

    await loadCache('conn-1')
    expect(getCache('conn-1').status).toBe('ready')

    invalidateCache('conn-1')
    expect(getCache('conn-1').status).toBe('empty')
  })

  it('invalidateCache during in-flight load discards stale data', async () => {
    let resolveStale: (() => void) | null = null
    mockFetchSchema.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStale = () =>
          resolve({
            databases: ['stale_db'],
            tables: {},
            columns: {},
            routines: { stale_db: [{ name: 'old_routine', routineType: 'FUNCTION' }] },
          })
      })
    )

    // Start loading — fetch is now in-flight
    const stalePromise = loadCache('conn-race')
    expect(getCache('conn-race').status).toBe('loading')

    // Invalidate while the fetch is still pending
    invalidateCache('conn-race')
    expect(getCache('conn-race').status).toBe('empty')

    // Now the stale fetch resolves — it must NOT repopulate the cache
    resolveStale!()
    await stalePromise

    // Cache should still be empty (stale data discarded)
    expect(getCache('conn-race').status).toBe('empty')
    expect(getCache('conn-race').routines).toEqual({})
  })

  it('invalidateCache during in-flight load discards stale error', async () => {
    let rejectStale: ((err: Error) => void) | null = null
    mockFetchSchema.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectStale = reject
      })
    )

    // Start loading — fetch is now in-flight
    const stalePromise = loadCache('conn-err-race')
    expect(getCache('conn-err-race').status).toBe('loading')

    // Invalidate while the fetch is still pending
    invalidateCache('conn-err-race')
    expect(getCache('conn-err-race').status).toBe('empty')

    // Now the stale fetch rejects — it must NOT set error status in the cache
    rejectStale!(new Error('Stale error'))
    await stalePromise

    // Cache should still be empty (stale error discarded)
    expect(getCache('conn-err-race').status).toBe('empty')
  })

  it('fresh load succeeds after invalidation discards stale in-flight', async () => {
    let resolveStale: (() => void) | null = null
    mockFetchSchema.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStale = () =>
          resolve({ databases: ['stale_db'], tables: {}, columns: {}, routines: {} })
      })
    )

    // Start first load
    const stalePromise = loadCache('conn-fresh')
    expect(getCache('conn-fresh').status).toBe('loading')

    // Invalidate
    invalidateCache('conn-fresh')

    // Resolve the stale load
    resolveStale!()
    await stalePromise
    expect(getCache('conn-fresh').status).toBe('empty')

    // Now a fresh load should work normally
    mockFetchSchema.mockResolvedValueOnce({
      databases: ['fresh_db'],
      tables: {},
      columns: {},
      routines: { fresh_db: [{ name: 'new_routine', routineType: 'PROCEDURE' }] },
    })

    await loadCache('conn-fresh')
    expect(getCache('conn-fresh').status).toBe('ready')
    expect(getCache('conn-fresh').databases).toEqual(['fresh_db'])
    expect(getCache('conn-fresh').routines).toEqual({
      fresh_db: [{ name: 'new_routine', routineType: 'PROCEDURE' }],
    })
  })

  it('maintains separate caches per connection', async () => {
    mockFetchSchema
      .mockResolvedValueOnce({ databases: ['db_a'], tables: {}, columns: {}, routines: {} })
      .mockResolvedValueOnce({ databases: ['db_b'], tables: {}, columns: {}, routines: {} })

    await loadCache('conn-1')
    await loadCache('conn-2')

    expect(getCache('conn-1').databases).toEqual(['db_a'])
    expect(getCache('conn-2').databases).toEqual(['db_b'])

    invalidateCache('conn-1')
    expect(getCache('conn-1').status).toBe('empty')
    expect(getCache('conn-2').status).toBe('ready')
  })

  it('filters malformed schema metadata entries before storing cache', async () => {
    mockFetchSchema.mockResolvedValue({
      databases: ['valid_db', '', '   '],
      tables: {
        valid_db: [
          { name: 'users', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 100, dataSize: 1024 },
          {
            name: ' leading_space_table',
            engine: 'InnoDB',
            charset: 'utf8mb4',
            rowCount: 10,
            dataSize: 256,
          },
          { name: '', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 0, dataSize: 0 },
          { name: '   ', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 0, dataSize: 0 },
          null,
        ],
        '': [
          { name: 'ghost_table', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 0, dataSize: 0 },
        ],
        invalid_container: null,
      },
      columns: {
        'valid_db.users': [
          { name: 'id', dataType: 'int' },
          { name: ' leading_space_column', dataType: 'varchar' },
          { name: '', dataType: 'varchar' },
          { name: '   ', dataType: 'varchar' },
          undefined,
        ],
        '.': [{ name: '', dataType: 'varchar' }],
        'valid_db.': [{ name: 'broken', dataType: 'varchar' }],
        'broken.container': null,
      },
      routines: {
        valid_db: [
          { name: 'get_users', routineType: 'FUNCTION' },
          { name: ' leading_space_routine', routineType: 'FUNCTION' },
          { name: '', routineType: 'FUNCTION' },
          { name: '   ', routineType: 'FUNCTION' },
          null,
        ],
        '': [{ name: 'ghost_routine', routineType: 'PROCEDURE' }],
        invalid_container: null,
      },
    } as never)

    await loadCache('conn-malformed')

    const cache = getCache('conn-malformed')
    expect(cache.status).toBe('ready')
    expect(cache.databases).toEqual(['valid_db'])
    expect(cache.tables).toEqual({
      valid_db: [
        { name: 'users', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 100, dataSize: 1024 },
        {
          name: ' leading_space_table',
          engine: 'InnoDB',
          charset: 'utf8mb4',
          rowCount: 10,
          dataSize: 256,
        },
      ],
    })
    expect(cache.columns).toEqual({
      'valid_db.users': [
        { name: 'id', dataType: 'int' },
        { name: ' leading_space_column', dataType: 'varchar' },
      ],
    })
    expect(cache.routines).toEqual({
      valid_db: [
        { name: 'get_users', routineType: 'FUNCTION' },
        { name: ' leading_space_routine', routineType: 'FUNCTION' },
      ],
    })
  })
})
