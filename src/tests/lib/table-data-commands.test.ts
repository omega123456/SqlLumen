import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import {
  fetchTableData,
  updateTableRow,
  insertTableRow,
  deleteTableRow,
  exportTableData,
} from '../../lib/table-data-commands'
import type { AgGridFilterModel, PrimaryKeyInfo } from '../../types/schema'

const mockFetchTableDataFn = vi.fn(() => ({
  columns: [
    {
      name: 'id',
      dataType: 'INT',
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
  totalRows: 2,
  currentPage: 1,
  totalPages: 1,
  pageSize: 1000,
  primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
  executionTimeMs: 10,
}))
const mockUpdateTableRowFn = vi.fn(() => null)
const mockInsertTableRowFn = vi.fn(() => [
  ['id', 3],
  ['name', 'Charlie'],
])
const mockDeleteTableRowFn = vi.fn(() => null)
const mockExportTableDataFn = vi.fn(() => null)

beforeEach(() => {
  mockFetchTableDataFn.mockClear()
  mockUpdateTableRowFn.mockClear()
  mockInsertTableRowFn.mockClear()
  mockDeleteTableRowFn.mockClear()
  mockExportTableDataFn.mockClear()

  mockIPC((cmd) => {
    switch (cmd) {
      case 'fetch_table_data':
        return mockFetchTableDataFn()
      case 'update_table_row':
        return mockUpdateTableRowFn()
      case 'insert_table_row':
        return mockInsertTableRowFn()
      case 'delete_table_row':
        return mockDeleteTableRowFn()
      case 'export_table_data':
        return mockExportTableDataFn()
      default:
        return null
    }
  })
})

describe('fetchTableData', () => {
  it('invokes fetch_table_data and returns response', async () => {
    const result = await fetchTableData({
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'users',
      page: 1,
      pageSize: 1000,
    })
    expect(result.columns).toHaveLength(1)
    expect(result.rows).toEqual([[1], [2]])
    expect(result.totalRows).toBe(2)
    expect(result.primaryKey?.keyColumns).toEqual(['id'])
    expect(mockFetchTableDataFn).toHaveBeenCalled()
  })

  it('invokes with sort and filter params', async () => {
    const filterModel: AgGridFilterModel = {
      name: { filterType: 'text', type: 'contains', filter: 'Alice' },
    }

    await fetchTableData({
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'users',
      page: 1,
      pageSize: 50,
      sortColumn: 'id',
      sortDirection: 'asc',
      filterModel,
    })
    expect(mockFetchTableDataFn).toHaveBeenCalled()
  })

  it('maps filter model type field to filterCondition for Rust backend', async () => {
    let capturedArgs: Record<string, unknown> = {}
    mockIPC((cmd, args) => {
      if (cmd === 'fetch_table_data') {
        capturedArgs = args as Record<string, unknown>
        return mockFetchTableDataFn()
      }
      return null
    })

    const filterModel: AgGridFilterModel = {
      name: { filterType: 'text', type: 'contains', filter: 'Alice' },
    }

    await fetchTableData({
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'users',
      page: 1,
      pageSize: 1000,
      filterModel,
    })

    const sentFilter = capturedArgs.filterModel as Record<string, Record<string, unknown>>
    expect(sentFilter.name.filterCondition).toBe('contains')
    expect(sentFilter.name.filterType).toBe('text')
    expect(sentFilter.name.filter).toBe('Alice')
  })
})

describe('updateTableRow', () => {
  it('invokes update_table_row with correct params', async () => {
    let capturedArgs: Record<string, unknown> = {}
    mockIPC((cmd, args) => {
      if (cmd === 'update_table_row') {
        capturedArgs = args as Record<string, unknown>
        return null
      }
      return null
    })

    await updateTableRow({
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'users',
      primaryKeyColumns: ['id'],
      originalPkValues: { id: 1 },
      updatedValues: { name: 'Updated' },
    })

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
    expect(mockInsertTableRowFn).toHaveBeenCalled()
  })
})

describe('deleteTableRow', () => {
  it('invokes delete_table_row with correct params', async () => {
    let capturedArgs: Record<string, unknown> = {}
    mockIPC((cmd, args) => {
      if (cmd === 'delete_table_row') {
        capturedArgs = args as Record<string, unknown>
        return null
      }
      return null
    })

    await deleteTableRow({
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'users',
      pkColumns: ['id'],
      pkValues: { id: 1 },
    })

    expect(capturedArgs.connectionId).toBe('conn-1')
    expect(capturedArgs.pkColumns).toEqual(['id'])
    expect(capturedArgs.pkValues).toEqual({ id: 1 })
  })
})

describe('exportTableData', () => {
  it('invokes export_table_data with correct params', async () => {
    let capturedArgs: Record<string, unknown> = {}
    mockIPC((cmd, args) => {
      if (cmd === 'export_table_data') {
        capturedArgs = args as Record<string, unknown>
        return null
      }
      return null
    })

    await exportTableData({
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'users',
      format: 'csv',
      filePath: '/tmp/export.csv',
      includeHeaders: true,
      tableNameForSql: 'users',
    })

    expect(capturedArgs.connectionId).toBe('conn-1')
    expect(capturedArgs.format).toBe('csv')
    expect(capturedArgs.filePath).toBe('/tmp/export.csv')
    expect(capturedArgs.includeHeaders).toBe(true)
    expect(capturedArgs.tableNameForSql).toBe('users')
  })

  it('passes filter and sort params for export', async () => {
    let capturedArgs: Record<string, unknown> = {}
    mockIPC((cmd, args) => {
      if (cmd === 'export_table_data') {
        capturedArgs = args as Record<string, unknown>
        return null
      }
      return null
    })

    const filterModel: AgGridFilterModel = {
      status: { filterType: 'text', type: 'equals', filter: 'active' },
    }

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

    expect(capturedArgs.sortColumn).toBe('name')
    expect(capturedArgs.sortDirection).toBe('desc')
    const sentFilter = capturedArgs.filterModel as Record<string, Record<string, unknown>>
    expect(sentFilter.status.filterCondition).toBe('equals')
  })

  it('maps sql-insert format to sql for the backend', async () => {
    let capturedArgs: Record<string, unknown> = {}
    mockIPC((cmd, args) => {
      if (cmd === 'export_table_data') {
        capturedArgs = args as Record<string, unknown>
        return null
      }
      return null
    })

    await exportTableData({
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'users',
      format: 'sql-insert',
      filePath: '/tmp/export.sql',
      includeHeaders: true,
      tableNameForSql: 'users',
    })

    expect(capturedArgs.format).toBe('sql')
  })

  it('passes through non-sql-insert formats unchanged', async () => {
    let capturedArgs: Record<string, unknown> = {}
    mockIPC((cmd, args) => {
      if (cmd === 'export_table_data') {
        capturedArgs = args as Record<string, unknown>
        return null
      }
      return null
    })

    await exportTableData({
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'users',
      format: 'csv',
      filePath: '/tmp/export.csv',
      includeHeaders: true,
      tableNameForSql: 'users',
    })

    expect(capturedArgs.format).toBe('csv')
  })
})

describe('error propagation', () => {
  it('propagates errors from invoke', async () => {
    mockIPC((cmd) => {
      if (cmd === 'fetch_table_data') {
        throw new Error('Connection lost')
      }
      return null
    })

    await expect(
      fetchTableData({
        connectionId: 'conn-1',
        database: 'mydb',
        table: 'users',
        page: 1,
        pageSize: 1000,
      })
    ).rejects.toThrow('Connection lost')
  })
})
