import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
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
    mockIPC((cmd, args) => {
      if (cmd === 'list_exportable_objects') {
        expect((args as Record<string, unknown>).connectionId).toBe('conn-1')
        return mockResponse
      }
      return null
    })

    const result = await listExportableObjects('conn-1')
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
    mockIPC((cmd, args) => {
      if (cmd === 'start_sql_dump') {
        expect((args as Record<string, unknown>).input).toEqual(input)
        return 'job-123'
      }
      return null
    })

    const jobId = await startSqlDump(input)
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
    mockIPC((cmd, args) => {
      if (cmd === 'get_dump_progress') {
        expect((args as Record<string, unknown>).jobId).toBe('job-123')
        return mockProgress
      }
      return null
    })

    const result = await getDumpProgress('job-123')
    expect(result).toEqual(mockProgress)
    expect(result.status).toBe('running')
  })
})

describe('startSqlImport', () => {
  it('calls invoke with correct command and parameters', async () => {
    mockIPC((cmd, args) => {
      if (cmd === 'start_sql_import') {
        const input = (args as Record<string, unknown>).input as Record<string, unknown>
        expect(input.connectionId).toBe('conn-1')
        expect(input.filePath).toBe('/tmp/import.sql')
        expect(input.stopOnError).toBe(true)
        return 'import-job-456'
      }
      return null
    })

    const jobId = await startSqlImport('conn-1', '/tmp/import.sql', true)
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
    mockIPC((cmd, args) => {
      if (cmd === 'get_import_progress') {
        expect((args as Record<string, unknown>).jobId).toBe('import-job-456')
        return mockProgress
      }
      return null
    })

    const result = await getImportProgress('import-job-456')
    expect(result).toEqual(mockProgress)
    expect(result.status).toBe('completed')
  })
})

describe('cancelImport', () => {
  it('calls invoke with correct command', async () => {
    mockIPC((cmd, args) => {
      if (cmd === 'cancel_import') {
        expect((args as Record<string, unknown>).jobId).toBe('import-job-456')
        return undefined
      }
      return null
    })

    await cancelImport('import-job-456')
  })
})
