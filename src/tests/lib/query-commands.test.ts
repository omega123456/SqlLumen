import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipc } from '../ipc-mock'
import {
  executeQuery,
  evictResults,
  fetchSchemaMetadata,
  readFile,
  writeFile,
  selectDatabase,
  setResultView,
  fetchResultWindow,
  removeResultRows,
  analyzeQueryForEdit,
  updateResultCell,
  executeMultiQuery,
  executeCallQuery,
  reexecuteSingleResult,
  touchResults,
} from '../../lib/query-commands'

const QUERY_TAB = { connectionId: 'conn-1', tabId: 'tab-1' }

const mockExecuteQueryFn = vi.fn(() => ({
  queryId: 'q1',
  columns: [{ name: 'id', dataType: 'INT' }],
  totalRows: 1,
  executionTimeMs: 5,
  affectedRows: 0,
  autoLimitApplied: false,
  viewRowCount: 1,
  viewVersion: 1,
  truncated: false,
  rowCeiling: 100_000,
  appliedRowLimit: null,
  fullExportBlockedReason: null,
  firstWindow: { offset: 0, rows: [[1]], baseIndices: [0] },
}))
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
      firstWindow: { offset: 0, rows: [[1]], baseIndices: [0] },
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
      firstWindow: { offset: 0, rows: [[1]], baseIndices: [0] },
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
  firstWindow: { offset: 0, rows: [[1]], baseIndices: [0] },
  autoLimitApplied: false,
  error: null,
  reExecutable: true,
}))
const mockTouchResultsFn = vi.fn(() => ({ status: 'available' as const }))

beforeEach(() => {
  mockExecuteQueryFn.mockClear()
  mockEvictResultsFn.mockClear()
  mockFetchSchemaMetadataFn.mockClear()
  mockReadFileFn.mockClear()
  mockWriteFileFn.mockClear()
  mockSelectDatabaseFn.mockClear()
  mockAnalyzeQueryForEditFn.mockClear()
  mockUpdateResultCellFn.mockClear()
  mockExecuteMultiQueryFn.mockClear()
  mockExecuteCallQueryFn.mockClear()
  mockReexecuteSingleResultFn.mockClear()
  mockTouchResultsFn.mockClear()
  ipc.override('execute_query', () => mockExecuteQueryFn())
  ipc.override('evict_results', () => mockEvictResultsFn())
  ipc.override('fetch_schema_metadata', () => mockFetchSchemaMetadataFn())
  ipc.override('read_file', () => mockReadFileFn())
  ipc.override('write_file', () => mockWriteFileFn())
  ipc.override('select_database', () => mockSelectDatabaseFn())
  ipc.override('analyze_query_for_edit', () => mockAnalyzeQueryForEditFn())
  ipc.override('update_result_cell', () => mockUpdateResultCellFn())
  ipc.override('execute_multi_query', () => mockExecuteMultiQueryFn())
  ipc.override('execute_call_query', () => mockExecuteCallQueryFn())
  ipc.override('reexecute_single_result', () => mockReexecuteSingleResultFn())
  ipc.override('touch_results', () => mockTouchResultsFn())
})

describe('query-commands', () => {
  it('executeQuery invokes execute_query command', async () => {
    const result = await executeQuery({ ...QUERY_TAB, sql: 'SELECT 1', rowLimit: 1000 })
    expect(result.queryId).toBe('q1')
    expect(result.columns).toHaveLength(1)
    expect(result.firstWindow.rows).toEqual([[1]])
    expect(result.firstWindow.baseIndices).toEqual([0])
    expect('rows' in result).toBe(false)
  })

  it('executeQuery omits viewSpec by default and sends it when given', async () => {
    await executeQuery({ ...QUERY_TAB, sql: 'SELECT 1', rowLimit: 1000 })
    expect('viewSpec' in (ipc.payloads('execute_query')[0] as Record<string, unknown>)).toBe(false)

    const spec = { sort: { column: 'id', direction: 'desc' as const }, filters: [] }
    await executeQuery({ ...QUERY_TAB, sql: 'SELECT 1', rowLimit: 500, viewSpec: spec })
    expect(ipc.payloads('execute_query')[1]).toMatchObject({ rowLimit: 500, viewSpec: spec })
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

  const slot = { connectionId: 'conn-1', tabId: 'tab-1', resultIndex: 1, queryId: 'q1' }

  it('setResultView sends the slot, base view version and spec', async () => {
    const response = {
      viewVersion: 4,
      viewRowCount: 2,
      totalRows: 3,
      firstWindow: { offset: 0, rows: [[2], [1]], baseIndices: [1, 0] },
    }
    ipc.override('set_result_view', () => response)
    const spec = { sort: { column: 'id', direction: 'desc' as const }, filters: [] }
    await expect(setResultView({ ...slot, baseViewVersion: 3, viewSpec: spec })).resolves.toEqual(
      response
    )
    expect(ipc.payloads('set_result_view')[0]).toEqual({
      ...slot,
      baseViewVersion: 3,
      viewSpec: spec,
    })
  })

  it('fetchResultWindow sends the slot, view version, offset and limit', async () => {
    await fetchResultWindow({ ...slot, viewVersion: 2, offset: 500, limit: 500 })
    expect(ipc.payloads('fetch_result_window')[0]).toEqual({
      ...slot,
      viewVersion: 2,
      offset: 500,
      limit: 500,
    })
  })

  it('removeResultRows sends the base view version and base indices', async () => {
    await removeResultRows({ ...slot, baseViewVersion: 5, baseIndices: [1, 2] })
    expect(ipc.payloads('remove_result_rows')[0]).toEqual({
      ...slot,
      baseViewVersion: 5,
      baseIndices: [1, 2],
    })
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
    await updateResultCell({
      ...QUERY_TAB,
      rowIndex: 0,
      updates: { 1: 'updated value' },
      queryId: 'q-1',
    })
    expect(mockUpdateResultCellFn).toHaveBeenCalled()
    expect(ipc.payloads('update_result_cell')[0]).toMatchObject({ rowIndex: 0, queryId: 'q-1' })
  })

  // --- New multi-query wrappers ---

  it('executeMultiQuery invokes execute_multi_query command', async () => {
    const result = await executeMultiQuery({
      ...QUERY_TAB,
      statements: ['SELECT 1', 'SELECT 2'],
      rowLimit: 1000,
    })
    expect(result.results).toHaveLength(1)
    expect(result.results[0].queryId).toBe('mq1')
    expect(result.results[0].sourceSql).toBe('SELECT 1')
    expect(result.results[0].reExecutable).toBe(true)
    expect(mockExecuteMultiQueryFn).toHaveBeenCalled()
    expect(ipc.payloads('execute_multi_query')[0]).toMatchObject({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      statements: ['SELECT 1', 'SELECT 2'],
      rowLimit: 1000,
    })
  })

  it('passes rowLimit to executeQuery IPC', async () => {
    await executeQuery({ ...QUERY_TAB, sql: 'SELECT 1', rowLimit: 250 })
    expect(mockExecuteQueryFn).toHaveBeenCalled()
    expect(ipc.payloads('execute_query')[0]).toMatchObject({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      sql: 'SELECT 1',
      rowLimit: 250,
    })
  })

  it('executeCallQuery invokes execute_call_query command', async () => {
    const result = await executeCallQuery({ ...QUERY_TAB, sql: 'CALL sp_test()', rowLimit: 1000 })
    expect(result.results).toHaveLength(1)
    expect(result.results[0].queryId).toBe('cq1')
    expect(result.results[0].sourceSql).toBe('CALL sp_test()')
    expect(result.results[0].reExecutable).toBe(false)
    expect(mockExecuteCallQueryFn).toHaveBeenCalled()
    expect(ipc.payloads('execute_call_query')[0]).toMatchObject({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      sql: 'CALL sp_test()',
      rowLimit: 1000,
    })
  })

  it('reexecuteSingleResult invokes reexecute_single_result command', async () => {
    const result = await reexecuteSingleResult({
      ...QUERY_TAB,
      resultIndex: 0,
      sql: 'SELECT 1',
      rowLimit: 1000,
    })
    expect(result.queryId).toBe('rq1')
    expect(result.sourceSql).toBe('SELECT 1')
    expect(result.reExecutable).toBe(true)
    expect(mockReexecuteSingleResultFn).toHaveBeenCalled()
    expect(ipc.payloads('reexecute_single_result')[0]).toMatchObject({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      resultIndex: 0,
      sql: 'SELECT 1',
      rowLimit: 1000,
    })
  })

  it('touchResults invokes touch_results command', async () => {
    const result = await touchResults('conn-1', 'tab-1')
    expect(result).toEqual({ status: 'available' })
    expect(mockTouchResultsFn).toHaveBeenCalled()
  })

  // --- resultIndex optional parameter tests ---

  it('reexecuteSingleResult sends a view spec when given', async () => {
    const spec = { sort: null, filters: [{ column: 'id', operator: '==' as const, value: '1' }] }
    await reexecuteSingleResult({
      ...QUERY_TAB,
      resultIndex: 0,
      sql: 'SELECT 1',
      rowLimit: 1000,
      viewSpec: spec,
    })
    expect(ipc.payloads('reexecute_single_result')[0]).toMatchObject({ viewSpec: spec })
  })

  it('updateResultCell does not include resultIndex when omitted', async () => {
    await updateResultCell({ ...QUERY_TAB, rowIndex: 0, updates: { 1: 'val' }, queryId: 'q-1' })
    const args = ipc.payloads('update_result_cell')[0] as Record<string, unknown>
    expect('resultIndex' in args).toBe(false)
  })

  it('updateResultCell includes resultIndex when provided', async () => {
    await updateResultCell({
      ...QUERY_TAB,
      rowIndex: 0,
      updates: { 1: 'val' },
      queryId: 'q-1',
      resultIndex: 3,
    })
    expect((ipc.payloads('update_result_cell')[0] as Record<string, unknown>).resultIndex).toBe(3)
  })
})
