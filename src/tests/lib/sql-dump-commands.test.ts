import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipc } from '../ipc-mock'
import {
  listExportableObjects,
  startSqlDump,
  getDumpProgress,
  startSqlImport,
  getImportProgress,
  cancelImport,
} from '../../lib/sql-dump-commands'
import type {
  ExportableDatabase,
  DumpJobProgress,
  ImportJobProgress,
  StartDumpInput,
} from '../../lib/sql-dump-commands'

beforeEach(() => {
  ipc.reset()
  vi.clearAllMocks()
})

describe('listExportableObjects', () => {
  it('calls invoke with correct command and returns databases', async () => {
    const mockResponse: ExportableDatabase[] = [
      {
        name: 'testdb',
        tables: [
          { name: 'users', objectType: 'table', estimatedRows: 100 },
          { name: 'orders', objectType: 'table', estimatedRows: 500 },
        ],
      },
    ]
    ipc.override('list_exportable_objects', () => mockResponse)

    const result = await listExportableObjects('conn-1')
    expect(ipc.calls('list_exportable_objects')).toEqual([{ connectionId: 'conn-1' }])
    expect(result).toEqual(mockResponse)
    expect(result[0].tables).toHaveLength(2)
  })
})

describe('startSqlDump', () => {
  it('calls invoke with correct command and input', async () => {
    const input: StartDumpInput = {
      connectionId: 'conn-1',
      filePath: '/tmp/dump.sql',
      databases: ['testdb'],
      tables: { testdb: ['users', 'orders'] },
      options: {
        includeStructure: true,
        includeData: true,
        includeDrop: false,
        useTransaction: true,
      },
    }
    ipc.override('start_sql_dump', () => 'job-123')

    const jobId = await startSqlDump(input)
    expect(ipc.calls('start_sql_dump')).toEqual([{ input }])
    expect(jobId).toBe('job-123')
  })
})

describe('getDumpProgress', () => {
  it('calls invoke with correct command and returns progress', async () => {
    const mockProgress: DumpJobProgress = {
      jobId: 'job-123',
      status: 'running',
      tablesTotal: 5,
      tablesDone: 2,
      currentTable: 'orders',
      bytesWritten: 1024,
      errorMessage: null,
    }
    ipc.override('get_dump_progress', () => mockProgress)

    const result = await getDumpProgress('job-123')
    expect(ipc.calls('get_dump_progress')).toEqual([{ jobId: 'job-123' }])
    expect(result).toEqual(mockProgress)
    expect(result.status).toBe('running')
  })
})

describe('startSqlImport', () => {
  it('calls invoke with correct command and parameters', async () => {
    ipc.override('start_sql_import', () => 'import-job-456')

    const jobId = await startSqlImport('conn-1', '/tmp/import.sql', true)
    expect(ipc.calls('start_sql_import')).toEqual([
      { input: { connectionId: 'conn-1', filePath: '/tmp/import.sql', stopOnError: true } },
    ])
    expect(jobId).toBe('import-job-456')
  })
})

describe('getImportProgress', () => {
  it('calls invoke with correct command and returns progress', async () => {
    const mockProgress: ImportJobProgress = {
      jobId: 'import-job-456',
      status: 'completed',
      statementsTotal: 100,
      statementsDone: 100,
      errors: [],
      stopOnError: false,
      cancelRequested: false,
    }
    ipc.override('get_import_progress', () => mockProgress)

    const result = await getImportProgress('import-job-456')
    expect(ipc.calls('get_import_progress')).toEqual([{ jobId: 'import-job-456' }])
    expect(result).toEqual(mockProgress)
    expect(result.status).toBe('completed')
  })
})

describe('cancelImport', () => {
  it('calls invoke with correct command', async () => {
    ipc.override('cancel_import', () => undefined)

    await cancelImport('import-job-456')
    expect(ipc.calls('cancel_import')).toEqual([{ jobId: 'import-job-456' }])
  })
})
