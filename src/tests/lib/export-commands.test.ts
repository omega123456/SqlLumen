import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipc } from '../ipc-mock'
import { exportResults } from '../../lib/export-commands'

beforeEach(() => {
  ipc.reset()
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

  it('does not include rowIndices when omitted', async () => {
    ipc.override('export_results', () => ({ bytesWritten: 100, rowsExported: 1 }))

    await exportResults('conn-1', 'tab-1', {
      format: 'csv',
      filePath: '/tmp/export.csv',
      includeHeaders: true,
    })

    const args = ipc.calls('export_results')[0] as Record<string, unknown>
    expect('rowIndices' in args).toBe(false)
  })

  it('includes rowIndices when provided', async () => {
    ipc.override('export_results', () => ({ bytesWritten: 100, rowsExported: 3 }))

    await exportResults(
      'conn-1',
      'tab-1',
      {
        format: 'csv',
        filePath: '/tmp/export.csv',
        includeHeaders: true,
      },
      0,
      [1, 3, 5]
    )

    expect((ipc.calls('export_results')[0] as Record<string, unknown>).rowIndices).toEqual([
      1, 3, 5,
    ])
  })
})
