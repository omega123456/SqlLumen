import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipc } from '../ipc-mock'
import {
  cancelResultExport,
  exportResults,
  getResultExportProgress,
  startResultExport,
} from '../../lib/export-commands'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('exportResults', () => {
  it('calls invoke with correct command and parameters', async () => {
    const mockResponse = { bytesWritten: 2048, rowsExported: 10 }
    ipc.override('export_results', () => mockResponse)

    const result = await exportResults('conn-1', 'tab-1', {
      format: 'csv',
      filePath: '/tmp/export.csv',
      includeHeaders: true,
    })

    const args = ipc.calls('export_results')[0] as Record<string, unknown>
    expect(args.connectionId).toBe('conn-1')
    expect(args.tabId).toBe('tab-1')
    expect(args.options).toEqual({
      format: 'csv',
      filePath: '/tmp/export.csv',
      includeHeaders: true,
    })
    expect(result).toEqual(mockResponse)
  })

  it('passes tableName for sql-insert format', async () => {
    ipc.override('export_results', () => ({ bytesWritten: 512, rowsExported: 5 }))

    const result = await exportResults('conn-1', 'tab-1', {
      format: 'sql-insert',
      filePath: '/tmp/export.sql',
      includeHeaders: true,
      tableName: 'my_table',
    })

    const args = ipc.calls('export_results')[0] as Record<string, unknown>
    expect(args.options).toEqual({
      format: 'sql-insert',
      filePath: '/tmp/export.sql',
      includeHeaders: true,
      tableName: 'my_table',
    })
    expect(result.bytesWritten).toBe(512)
    expect(result.rowsExported).toBe(5)
  })

  it('does not include resultIndex when omitted', async () => {
    ipc.override('export_results', () => ({ bytesWritten: 100, rowsExported: 1 }))

    await exportResults('conn-1', 'tab-1', {
      format: 'csv',
      filePath: '/tmp/export.csv',
      includeHeaders: true,
    })

    const args = ipc.calls('export_results')[0] as Record<string, unknown>
    expect('resultIndex' in args).toBe(false)
  })

  it('includes resultIndex when provided', async () => {
    ipc.override('export_results', () => ({ bytesWritten: 100, rowsExported: 1 }))

    await exportResults(
      'conn-1',
      'tab-1',
      {
        format: 'csv',
        filePath: '/tmp/export.csv',
        includeHeaders: true,
      },
      2
    )

    expect((ipc.calls('export_results')[0] as Record<string, unknown>).resultIndex).toBe(2)
  })

  it('never sends rowIndices: the backend exports the current view', async () => {
    ipc.override('export_results', () => ({ bytesWritten: 100, rowsExported: 1 }))

    await exportResults(
      'conn-1',
      'tab-1',
      {
        format: 'csv',
        filePath: '/tmp/export.csv',
        includeHeaders: true,
      },
      0
    )

    const args = ipc.calls('export_results')[0] as Record<string, unknown>
    expect('rowIndices' in args).toBe(false)
  })
})

describe('streaming full export wrappers', () => {
  it('startResultExport sends the exact IPC arguments and returns the job id', async () => {
    ipc.override('start_result_export', () => 'job-42')

    const jobId = await startResultExport({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      resultIndex: 2,
      queryId: 'q-1',
      format: 'sql-insert',
      filePath: '/tmp/all.sql',
      includeHeaders: false,
      tableName: 'people',
    })

    expect(jobId).toBe('job-42')
    expect(ipc.calls('start_result_export')[0]).toEqual({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      resultIndex: 2,
      queryId: 'q-1',
      format: 'sql-insert',
      filePath: '/tmp/all.sql',
      includeHeaders: false,
      tableName: 'people',
    })
  })

  it('startResultExport sends a null table name when none is given', async () => {
    await startResultExport({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      resultIndex: 0,
      queryId: 'q-1',
      format: 'csv',
      filePath: '/tmp/all.csv',
      includeHeaders: true,
    })
    expect((ipc.calls('start_result_export')[0] as Record<string, unknown>).tableName).toBeNull()
  })

  it('getResultExportProgress returns the job progress', async () => {
    const progress = {
      status: 'completed',
      rowsWritten: 10,
      bytesWritten: 100,
      elapsedMs: 5,
      stoppedAtSheetLimit: true,
      error: null,
    }
    ipc.override('get_result_export_progress', () => progress)

    await expect(getResultExportProgress('job-42')).resolves.toEqual(progress)
    expect(ipc.calls('get_result_export_progress')[0]).toEqual({ jobId: 'job-42' })
  })

  it('cancelResultExport sends the job id', async () => {
    await expect(cancelResultExport('job-42')).resolves.toBeUndefined()
    expect(ipc.calls('cancel_result_export')[0]).toEqual({ jobId: 'job-42' })
  })

  it('propagates backend errors', async () => {
    ipc.override('start_result_export', () => {
      throw new Error("Full export isn't available for this result.")
    })
    await expect(
      startResultExport({
        connectionId: 'conn-1',
        tabId: 'tab-1',
        resultIndex: 0,
        queryId: 'q-1',
        format: 'csv',
        filePath: '/tmp/all.csv',
        includeHeaders: true,
      })
    ).rejects.toThrow("Full export isn't available for this result.")
  })
})
