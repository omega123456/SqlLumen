import { describe, it, expect, beforeEach } from 'vitest'
import { ipc } from '../ipc-mock'
import {
  fetchTableData,
  touchTableData,
  evictTableData,
  restoreTableDataCache,
  syncTableDataCacheAfterInsert,
  syncTableDataCacheAfterUpdate,
  syncTableDataCacheAfterDelete,
  updateTableRow,
  insertTableRow,
  deleteTableRow,
  exportTableData,
  fetchBlobValue,
  readFileBytes,
  writeFileBytes,
} from '../../lib/table-data-commands'
import type {
  FilterCondition,
  PrimaryKeyInfo,
  TableDataResponse,
  TableDataColumnMeta,
} from '../../types/schema'

const DEFAULT_FETCH_RESPONSE: TableDataResponse = {
  columns: [
    {
      name: 'id',
      dataType: 'INT',
      isBooleanAlias: false,
      isNullable: false,
      isPrimaryKey: true,
      isUniqueKey: false,
      hasDefault: false,
      columnDefault: null,
      isBinary: false,
      isAutoIncrement: true,
    },
  ],
  rows: [[1], [2]],
  currentPage: 1,
  pageSize: 1000,
  primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
  executionTimeMs: 10,
}

const DEFAULT_INSERT_RESPONSE = [
  ['id', 3],
  ['name', 'Charlie'],
]

beforeEach(() => {
  ipc.override('fetch_table_data', () => DEFAULT_FETCH_RESPONSE)
  ipc.override('touch_table_data', () => ({ status: 'available' }))
  ipc.override('evict_table_data', () => null)
  ipc.override('restore_table_data_cache', () => ({
    status: 'available',
    data: DEFAULT_FETCH_RESPONSE,
  }))
  ipc.override('sync_table_data_cache_after_insert', () => ({ status: 'synced' }))
  ipc.override('sync_table_data_cache_after_update', () => ({ status: 'synced' }))
  ipc.override('sync_table_data_cache_after_delete', () => ({ status: 'synced' }))
  ipc.override('update_table_row', () => null)
  ipc.override('insert_table_row', () => DEFAULT_INSERT_RESPONSE)
  ipc.override('delete_table_row', () => null)
  ipc.override('export_table_data', () => null)
})

const DEFAULT_SYNC_COLUMNS: TableDataColumnMeta[] = DEFAULT_FETCH_RESPONSE.columns
const DEFAULT_SYNC_PRIMARY_KEY = DEFAULT_FETCH_RESPONSE.primaryKey

describe('fetchTableData', () => {
  it('invokes fetch_table_data and returns response', async () => {
    const result = await fetchTableData({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      database: 'mydb',
      table: 'users',
      page: 1,
      pageSize: 1000,
    })
    expect(result.columns).toHaveLength(1)
    expect(result.rows).toEqual([[1], [2]])
    expect(result.primaryKey?.keyColumns).toEqual(['id'])
    expect(ipc.calls('fetch_table_data')).toHaveLength(1)
  })

  it('invokes with sort and filter params', async () => {
    const filterModel: FilterCondition[] = [{ column: 'name', operator: 'LIKE', value: '%Alice%' }]

    await fetchTableData({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      database: 'mydb',
      table: 'users',
      page: 1,
      pageSize: 50,
      sortColumn: 'id',
      sortDirection: 'asc',
      filterModel,
    })
    expect(ipc.calls('fetch_table_data')).toHaveLength(1)
  })

  it('maps filter conditions to backend format', async () => {
    const filterModel: FilterCondition[] = [{ column: 'name', operator: '==', value: 'Alice' }]

    await fetchTableData({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      database: 'mydb',
      table: 'users',
      page: 1,
      pageSize: 1000,
      filterModel,
    })

    const calls = ipc.calls('fetch_table_data')
    expect(calls).toHaveLength(1)
    const capturedArgs = calls[0] as Record<string, unknown>
    expect(capturedArgs.tabId).toBe('tab-1')
    const sentFilter = capturedArgs.filterModel as {
      column: string
      operator: string
      value: string
    }[]
    expect(sentFilter).toHaveLength(1)
    expect(sentFilter[0].column).toBe('name')
    expect(sentFilter[0].operator).toBe('==')
    expect(sentFilter[0].value).toBe('Alice')
  })

  it('sends multiple filter conditions including same column', async () => {
    const filterModel: FilterCondition[] = [
      { column: 'price', operator: '>', value: '10' },
      { column: 'price', operator: '<', value: '100' },
    ]

    await fetchTableData({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      database: 'mydb',
      table: 'events',
      page: 1,
      pageSize: 100,
      filterModel,
    })

    const capturedArgs = ipc.calls('fetch_table_data')[0] as Record<string, unknown>
    const sentFilter = capturedArgs.filterModel as {
      column: string
      operator: string
      value: string
    }[]
    expect(sentFilter).toHaveLength(2)
    expect(sentFilter[0].operator).toBe('>')
    expect(sentFilter[1].operator).toBe('<')
  })

  it('preserves enumValues from fetch_table_data responses', async () => {
    ipc.override('fetch_table_data', () => ({
      columns: [
        {
          name: 'status',
          dataType: 'ENUM',
          isBooleanAlias: false,
          enumValues: ['active', 'disabled'],
          isNullable: true,
          isPrimaryKey: false,
          isUniqueKey: false,
          hasDefault: false,
          columnDefault: null,
          isBinary: false,
          isAutoIncrement: false,
        },
      ],
      rows: [['active']],
      currentPage: 1,
      pageSize: 1000,
      primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
      executionTimeMs: 10,
    }))

    const result = await fetchTableData({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      database: 'mydb',
      table: 'users',
      page: 1,
      pageSize: 1000,
    })

    expect(result.columns[0].enumValues).toEqual(['active', 'disabled'])
  })

  it('preserves setValues from fetch_table_data responses', async () => {
    ipc.override('fetch_table_data', () => ({
      columns: [
        {
          name: 'flags',
          dataType: 'SET',
          isBooleanAlias: false,
          setValues: ['alpha', 'beta', 'gamma'],
          isNullable: true,
          isPrimaryKey: false,
          isUniqueKey: false,
          hasDefault: false,
          columnDefault: null,
          isBinary: false,
          isAutoIncrement: false,
        },
      ],
      rows: [['alpha,gamma']],
      currentPage: 1,
      pageSize: 1000,
      primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
      executionTimeMs: 10,
    }))

    const result = await fetchTableData({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      database: 'mydb',
      table: 'users',
      page: 1,
      pageSize: 1000,
    })

    expect(result.columns[0].setValues).toEqual(['alpha', 'beta', 'gamma'])
  })
})

describe('table data cache lifecycle commands', () => {
  it('touchTableData invokes touch_table_data', async () => {
    const result = await touchTableData({
      connectionId: 'conn-1',
      tabId: 'tab-1',
    })

    expect(result).toEqual({ status: 'available' })
    expect(ipc.calls('touch_table_data')).toContainEqual({
      connectionId: 'conn-1',
      tabId: 'tab-1',
    })
  })

  it('evictTableData invokes evict_table_data', async () => {
    await evictTableData({
      connectionId: 'conn-1',
      tabId: 'tab-1',
    })

    expect(ipc.calls('evict_table_data')).toContainEqual({
      connectionId: 'conn-1',
      tabId: 'tab-1',
    })
  })

  it('restoreTableDataCache invokes restore_table_data_cache', async () => {
    const result = await restoreTableDataCache({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      database: 'mydb',
      table: 'users',
    })

    expect(result).toEqual({
      status: 'available',
      data: DEFAULT_FETCH_RESPONSE,
    })
    expect(ipc.calls('restore_table_data_cache')).toContainEqual({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      database: 'mydb',
      table: 'users',
    })
  })

  it('syncTableDataCacheAfterInsert invokes sync_table_data_cache_after_insert', async () => {
    const result = await syncTableDataCacheAfterInsert({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      database: 'mydb',
      table: 'users',
      columns: DEFAULT_SYNC_COLUMNS,
      rows: [[1], [2], [3]],
      currentPage: 1,
      pageSize: 1000,
      primaryKey: DEFAULT_SYNC_PRIMARY_KEY,
      executionTimeMs: 14,
    })

    expect(result).toEqual({ status: 'synced' })
    expect(ipc.calls('sync_table_data_cache_after_insert')).toContainEqual({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      database: 'mydb',
      table: 'users',
      columns: DEFAULT_SYNC_COLUMNS,
      rows: [[1], [2], [3]],
      currentPage: 1,
      pageSize: 1000,
      primaryKey: DEFAULT_SYNC_PRIMARY_KEY,
      executionTimeMs: 14,
    })
  })

  it('syncTableDataCacheAfterUpdate invokes sync_table_data_cache_after_update', async () => {
    const result = await syncTableDataCacheAfterUpdate({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      database: 'mydb',
      table: 'users',
      columns: DEFAULT_SYNC_COLUMNS,
      rows: [[1, 'Updated']],
      currentPage: 2,
      pageSize: 50,
      primaryKey: DEFAULT_SYNC_PRIMARY_KEY,
      executionTimeMs: 22,
    })

    expect(result).toEqual({ status: 'synced' })
    expect(ipc.calls('sync_table_data_cache_after_update')).toContainEqual({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      database: 'mydb',
      table: 'users',
      columns: DEFAULT_SYNC_COLUMNS,
      rows: [[1, 'Updated']],
      currentPage: 2,
      pageSize: 50,
      primaryKey: DEFAULT_SYNC_PRIMARY_KEY,
      executionTimeMs: 22,
    })
  })

  it('syncTableDataCacheAfterDelete invokes sync_table_data_cache_after_delete', async () => {
    const result = await syncTableDataCacheAfterDelete({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      database: 'mydb',
      table: 'users',
      columns: DEFAULT_SYNC_COLUMNS,
      rows: [[2]],
      currentPage: 1,
      pageSize: 1000,
      primaryKey: DEFAULT_SYNC_PRIMARY_KEY,
      executionTimeMs: 8,
    })

    expect(result).toEqual({ status: 'synced' })
    expect(ipc.calls('sync_table_data_cache_after_delete')).toContainEqual({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      database: 'mydb',
      table: 'users',
      columns: DEFAULT_SYNC_COLUMNS,
      rows: [[2]],
      currentPage: 1,
      pageSize: 1000,
      primaryKey: DEFAULT_SYNC_PRIMARY_KEY,
      executionTimeMs: 8,
    })
  })
})

describe('updateTableRow', () => {
  it('invokes update_table_row with correct params', async () => {
    await updateTableRow({
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'users',
      primaryKeyColumns: ['id'],
      originalPkValues: { id: 1 },
      updatedValues: { name: 'Updated' },
    })

    const calls = ipc.calls('update_table_row')
    expect(calls).toHaveLength(1)
    const capturedArgs = calls[0] as Record<string, unknown>
    expect(capturedArgs.connectionId).toBe('conn-1')
    expect(capturedArgs.database).toBe('mydb')
    expect(capturedArgs.table).toBe('users')
    expect(capturedArgs.primaryKeyColumns).toEqual(['id'])
    expect(capturedArgs.originalPkValues).toEqual({ id: 1 })
    expect(capturedArgs.updatedValues).toEqual({ name: 'Updated' })
  })
})

describe('insertTableRow', () => {
  it('invokes insert_table_row and returns result', async () => {
    const pkInfo: PrimaryKeyInfo = {
      keyColumns: ['id'],
      hasAutoIncrement: true,
      isUniqueKeyFallback: false,
    }

    const result = await insertTableRow({
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'users',
      values: { name: 'Charlie' },
      pkInfo,
    })

    expect(result).toEqual([
      ['id', 3],
      ['name', 'Charlie'],
    ])
    expect(ipc.calls('insert_table_row')).toHaveLength(1)
  })
})

describe('deleteTableRow', () => {
  it('invokes delete_table_row with correct params', async () => {
    await deleteTableRow({
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'users',
      pkColumns: ['id'],
      pkValues: { id: 1 },
    })

    const calls = ipc.calls('delete_table_row')
    expect(calls).toHaveLength(1)
    const capturedArgs = calls[0] as Record<string, unknown>
    expect(capturedArgs.connectionId).toBe('conn-1')
    expect(capturedArgs.pkColumns).toEqual(['id'])
    expect(capturedArgs.pkValues).toEqual({ id: 1 })
  })
})

describe('exportTableData', () => {
  it('invokes export_table_data with correct params', async () => {
    await exportTableData({
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'users',
      format: 'csv',
      filePath: '/tmp/export.csv',
      includeHeaders: true,
      tableNameForSql: 'users',
    })

    const calls = ipc.calls('export_table_data')
    expect(calls).toHaveLength(1)
    const capturedArgs = calls[0] as Record<string, unknown>
    expect(capturedArgs.connectionId).toBe('conn-1')
    expect(capturedArgs.format).toBe('csv')
    expect(capturedArgs.filePath).toBe('/tmp/export.csv')
    expect(capturedArgs.includeHeaders).toBe(true)
    expect(capturedArgs.tableNameForSql).toBe('users')
  })

  it('passes filter and sort params for export', async () => {
    const filterModel: FilterCondition[] = [{ column: 'status', operator: '==', value: 'active' }]

    await exportTableData({
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'users',
      format: 'json',
      filePath: '/tmp/export.json',
      includeHeaders: false,
      tableNameForSql: 'users',
      filterModel,
      sortColumn: 'name',
      sortDirection: 'desc',
    })

    const capturedArgs = ipc.calls('export_table_data')[0] as Record<string, unknown>
    expect(capturedArgs.sortColumn).toBe('name')
    expect(capturedArgs.sortDirection).toBe('desc')
    const sentFilter = capturedArgs.filterModel as {
      column: string
      operator: string
      value: string
    }[]
    expect(sentFilter).toHaveLength(1)
    expect(sentFilter[0].column).toBe('status')
    expect(sentFilter[0].operator).toBe('==')
  })

  it('maps sql-insert format to sql for the backend', async () => {
    await exportTableData({
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'users',
      format: 'sql-insert',
      filePath: '/tmp/export.sql',
      includeHeaders: true,
      tableNameForSql: 'users',
    })

    const capturedArgs = ipc.calls('export_table_data')[0] as Record<string, unknown>
    expect(capturedArgs.format).toBe('sql')
  })

  it('passes through non-sql-insert formats unchanged', async () => {
    await exportTableData({
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'users',
      format: 'csv',
      filePath: '/tmp/export.csv',
      includeHeaders: true,
      tableNameForSql: 'users',
    })

    const capturedArgs = ipc.calls('export_table_data')[0] as Record<string, unknown>
    expect(capturedArgs.format).toBe('csv')
  })
})

describe('error propagation', () => {
  it('propagates errors from invoke', async () => {
    ipc.override('fetch_table_data', () => {
      throw new Error('Connection lost')
    })

    await expect(
      fetchTableData({
        connectionId: 'conn-1',
        tabId: 'tab-1',
        database: 'mydb',
        table: 'users',
        page: 1,
        pageSize: 1000,
      })
    ).rejects.toThrow('Connection lost')
  })
})

describe('fetchBlobValue', () => {
  it('invokes fetch_blob_value with ordered pkPairs and returns the typed response', async () => {
    ipc.override('fetch_blob_value', () => ({
      base64: 'aGk=',
      byteLength: 2,
      tooLarge: false,
    }))

    const result = await fetchBlobValue('conn-1', 'db', 'photos', 'photo', [
      ['id', 1],
      ['version', 'v2'],
    ])

    expect(result).toEqual({ base64: 'aGk=', byteLength: 2, tooLarge: false })

    const calls = ipc.calls('fetch_blob_value')
    expect(calls).toHaveLength(1)
    const args = calls[0] as Record<string, unknown>
    expect(args.connectionId).toBe('conn-1')
    expect(args.database).toBe('db')
    expect(args.table).toBe('photos')
    expect(args.column).toBe('photo')
    expect(args.pkPairs).toEqual([
      ['id', 1],
      ['version', 'v2'],
    ])
  })
})

describe('readFileBytes / writeFileBytes', () => {
  it('readFileBytes invokes read_file_bytes and returns base64', async () => {
    ipc.override('read_file_bytes', () => 'aGk=')
    const result = await readFileBytes('/tmp/photo.png')
    expect(result).toBe('aGk=')
    const args = ipc.calls('read_file_bytes')[0] as Record<string, unknown>
    expect(args.path).toBe('/tmp/photo.png')
  })

  it('writeFileBytes invokes write_file_bytes with path and base64', async () => {
    ipc.override('write_file_bytes', () => undefined)
    await writeFileBytes('/tmp/out.bin', 'aGk=')
    const args = ipc.calls('write_file_bytes')[0] as Record<string, unknown>
    expect(args.path).toBe('/tmp/out.bin')
    expect(args.base64).toBe('aGk=')
  })
})
