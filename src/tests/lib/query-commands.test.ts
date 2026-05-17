import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipc } from '../ipc-mock'
import {
  executeQuery,
  fetchResultPage,
  evictResults,
  fetchSchemaMetadata,
  readFile,
  writeFile,
  sortResults,
  selectDatabase,
  analyzeQueryForEdit,
  updateResultCell,
  executeMultiQuery,
  executeCallQuery,
  reexecuteSingleResult,
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
const mockSortResultsFn = vi.fn(() => ({ rows: [[1], [2], [3]], page: 1, totalPages: 1 }))
const mockSelectDatabaseFn = vi.fn(() => null)
const mockAnalyzeQueryForEditFn = vi.fn(() => [
  {
    database: 'mydb',
    table: 'users',
    columns: [
      {
        name: 'id',
        dataType: 'INT',
        isBooleanAlias: false,
        enumValues: null,
        isNullable: false,
        isPrimaryKey: true,
        isUniqueKey: false,
        hasDefault: false,
        columnDefault: null,
        isBinary: false,
        isAutoIncrement: true,
      },
    ],
    primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
    foreignKeys: [],
  },
])
const mockUpdateResultCellFn = vi.fn(() => null)
const mockExecuteMultiQueryFn = vi.fn(() => ({
  results: [
    {
      queryId: 'mq1',
      sourceSql: 'SELECT 1',
      columns: [{ name: 'id', dataType: 'INT' }],
      totalRows: 1,
      executionTimeMs: 5,
      affectedRows: 0,
      firstPage: [[1]],
      totalPages: 1,
      autoLimitApplied: false,
      error: null,
      reExecutable: true,
    },
  ],
}))
const mockExecuteCallQueryFn = vi.fn(() => ({
  results: [
    {
      queryId: 'cq1',
      sourceSql: 'CALL sp_test()',
      columns: [{ name: 'id', dataType: 'INT' }],
      totalRows: 1,
      executionTimeMs: 10,
      affectedRows: 0,
      firstPage: [[1]],
      totalPages: 1,
      autoLimitApplied: false,
      error: null,
      reExecutable: false,
    },
  ],
}))
const mockReexecuteSingleResultFn = vi.fn(() => ({
  queryId: 'rq1',
  sourceSql: 'SELECT 1',
  columns: [{ name: 'id', dataType: 'INT' }],
  totalRows: 1,
  executionTimeMs: 3,
  affectedRows: 0,
  firstPage: [[1]],
  totalPages: 1,
  autoLimitApplied: false,
  error: null,
  reExecutable: true,
}))

beforeEach(() => {
  mockExecuteQueryFn.mockClear()
  mockFetchResultPageFn.mockClear()
  mockEvictResultsFn.mockClear()
  mockFetchSchemaMetadataFn.mockClear()
  mockReadFileFn.mockClear()
  mockWriteFileFn.mockClear()
  mockSortResultsFn.mockClear()
  mockSelectDatabaseFn.mockClear()
  mockAnalyzeQueryForEditFn.mockClear()
  mockUpdateResultCellFn.mockClear()
  mockExecuteMultiQueryFn.mockClear()
  mockExecuteCallQueryFn.mockClear()
  mockReexecuteSingleResultFn.mockClear()
  ipc.reset()
  ipc.override('execute_query', () => mockExecuteQueryFn())
  ipc.override('fetch_result_page', () => mockFetchResultPageFn())
  ipc.override('evict_results', () => mockEvictResultsFn())
  ipc.override('fetch_schema_metadata', () => mockFetchSchemaMetadataFn())
  ipc.override('read_file', () => mockReadFileFn())
  ipc.override('write_file', () => mockWriteFileFn())
  ipc.override('sort_results', () => mockSortResultsFn())
  ipc.override('select_database', () => mockSelectDatabaseFn())
  ipc.override('analyze_query_for_edit', () => mockAnalyzeQueryForEditFn())
  ipc.override('update_result_cell', () => mockUpdateResultCellFn())
  ipc.override('execute_multi_query', () => mockExecuteMultiQueryFn())
  ipc.override('execute_call_query', () => mockExecuteCallQueryFn())
  ipc.override('reexecute_single_result', () => mockReexecuteSingleResultFn())
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

  it('sortResults invokes sort_results command', async () => {
    const result = await sortResults('conn-1', 'tab-1', 'id', 'asc')
    expect(result.rows).toEqual([[1], [2], [3]])
    expect(result.page).toBe(1)
    expect(result.totalPages).toBe(1)
    expect(mockSortResultsFn).toHaveBeenCalled()
  })

  it('selectDatabase invokes select_database command', async () => {
    await selectDatabase('conn-1', 'analytics_db')
    expect(mockSelectDatabaseFn).toHaveBeenCalled()
  })

  it('analyzeQueryForEdit invokes analyze_query_for_edit command', async () => {
    const result = await analyzeQueryForEdit('conn-1', 'SELECT * FROM users')
    expect(result).toHaveLength(1)
    expect(result[0].database).toBe('mydb')
    expect(result[0].table).toBe('users')
    expect(result[0].primaryKey).toBeDefined()
    expect(mockAnalyzeQueryForEditFn).toHaveBeenCalled()
  })

  it('updateResultCell invokes update_result_cell command', async () => {
    await updateResultCell('conn-1', 'tab-1', 0, { 1: 'updated value' })
    expect(mockUpdateResultCellFn).toHaveBeenCalled()
  })

  // --- New multi-query wrappers ---

  it('executeMultiQuery invokes execute_multi_query command', async () => {
    const result = await executeMultiQuery('conn-1', 'tab-1', ['SELECT 1', 'SELECT 2'], 1000)
    expect(result.results).toHaveLength(1)
    expect(result.results[0].queryId).toBe('mq1')
    expect(result.results[0].sourceSql).toBe('SELECT 1')
    expect(result.results[0].reExecutable).toBe(true)
    expect(mockExecuteMultiQueryFn).toHaveBeenCalled()
  })

  it('executeCallQuery invokes execute_call_query command', async () => {
    const result = await executeCallQuery('conn-1', 'tab-1', 'CALL sp_test()', 1000)
    expect(result.results).toHaveLength(1)
    expect(result.results[0].queryId).toBe('cq1')
    expect(result.results[0].sourceSql).toBe('CALL sp_test()')
    expect(result.results[0].reExecutable).toBe(false)
    expect(mockExecuteCallQueryFn).toHaveBeenCalled()
  })

  it('reexecuteSingleResult invokes reexecute_single_result command', async () => {
    const result = await reexecuteSingleResult('conn-1', 'tab-1', 0, 'SELECT 1', 1000)
    expect(result.queryId).toBe('rq1')
    expect(result.sourceSql).toBe('SELECT 1')
    expect(result.reExecutable).toBe(true)
    expect(mockReexecuteSingleResultFn).toHaveBeenCalled()
  })

  // --- resultIndex optional parameter tests ---

  it('fetchResultPage does not include resultIndex when omitted', async () => {
    await fetchResultPage('conn-1', 'tab-1', 'q1', 1)
    const args = ipc.calls('fetch_result_page')[0] as Record<string, unknown>
    expect('resultIndex' in args).toBe(false)
  })

  it('fetchResultPage includes resultIndex when provided', async () => {
    await fetchResultPage('conn-1', 'tab-1', 'q1', 1, 2)
    expect((ipc.calls('fetch_result_page')[0] as Record<string, unknown>).resultIndex).toBe(2)
  })

  it('sortResults does not include resultIndex when omitted', async () => {
    await sortResults('conn-1', 'tab-1', 'id', 'asc')
    const args = ipc.calls('sort_results')[0] as Record<string, unknown>
    expect('resultIndex' in args).toBe(false)
  })

  it('sortResults includes resultIndex when provided', async () => {
    await sortResults('conn-1', 'tab-1', 'id', 'asc', 1)
    expect((ipc.calls('sort_results')[0] as Record<string, unknown>).resultIndex).toBe(1)
  })

  it('updateResultCell does not include resultIndex when omitted', async () => {
    await updateResultCell('conn-1', 'tab-1', 0, { 1: 'val' })
    const args = ipc.calls('update_result_cell')[0] as Record<string, unknown>
    expect('resultIndex' in args).toBe(false)
  })

  it('updateResultCell includes resultIndex when provided', async () => {
    await updateResultCell('conn-1', 'tab-1', 0, { 1: 'val' }, 3)
    expect((ipc.calls('update_result_cell')[0] as Record<string, unknown>).resultIndex).toBe(3)
  })
})
