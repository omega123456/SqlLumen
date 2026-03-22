import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import {
  executeQuery,
  fetchResultPage,
  evictResults,
  fetchSchemaMetadata,
  readFile,
  writeFile,
} from '../../lib/query-commands'

const mockExecuteQueryFn = vi.fn(() => ({
  queryId: 'q1',
  columns: [{ name: 'id', dataType: 'INT' }],
  totalRows: 1,
  executionTimeMs: 5,
  affectedRows: 0,
  firstPage: [[1]],
  totalPages: 1,
  autoLimitApplied: false,
}))
const mockFetchResultPageFn = vi.fn(() => ({ rows: [[1]], page: 1, totalPages: 1 }))
const mockEvictResultsFn = vi.fn(() => null)
const mockFetchSchemaMetadataFn = vi.fn(() => ({
  databases: ['mydb'],
  tables: {
    mydb: [{ name: 'users', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 10, dataSize: 1024 }],
  },
  columns: { 'mydb.users': [{ name: 'id', dataType: 'INT' }] },
  routines: {},
}))
const mockReadFileFn = vi.fn(() => 'SELECT 1;')
const mockWriteFileFn = vi.fn(() => null)

beforeEach(() => {
  mockExecuteQueryFn.mockClear()
  mockFetchResultPageFn.mockClear()
  mockEvictResultsFn.mockClear()
  mockFetchSchemaMetadataFn.mockClear()
  mockReadFileFn.mockClear()
  mockWriteFileFn.mockClear()

  mockIPC((cmd) => {
    switch (cmd) {
      case 'execute_query':
        return mockExecuteQueryFn()
      case 'fetch_result_page':
        return mockFetchResultPageFn()
      case 'evict_results':
        return mockEvictResultsFn()
      case 'fetch_schema_metadata':
        return mockFetchSchemaMetadataFn()
      case 'read_file':
        return mockReadFileFn()
      case 'write_file':
        return mockWriteFileFn()
      default:
        return null
    }
  })
})

describe('query-commands', () => {
  it('executeQuery invokes execute_query command', async () => {
    const result = await executeQuery('conn-1', 'tab-1', 'SELECT 1')
    expect(result.queryId).toBe('q1')
    expect(result.columns).toHaveLength(1)
    expect(result.firstPage).toEqual([[1]])
  })

  it('fetchResultPage invokes fetch_result_page command', async () => {
    const result = await fetchResultPage('conn-1', 'tab-1', 'q1', 1)
    expect(result.rows).toEqual([[1]])
    expect(result.page).toBe(1)
  })

  it('evictResults invokes evict_results command', async () => {
    await evictResults('conn-1', 'tab-1')
    expect(mockEvictResultsFn).toHaveBeenCalled()
  })

  it('fetchSchemaMetadata invokes fetch_schema_metadata command', async () => {
    const result = await fetchSchemaMetadata('conn-1')
    expect(result.databases).toContain('mydb')
    expect(result.tables['mydb']).toHaveLength(1)
  })

  it('readFile invokes read_file command', async () => {
    const content = await readFile('/path/to/file.sql')
    expect(content).toBe('SELECT 1;')
  })

  it('writeFile invokes write_file command', async () => {
    await writeFile('/path/to/file.sql', 'SELECT 1;')
    expect(mockWriteFileFn).toHaveBeenCalled()
  })
})
