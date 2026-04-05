import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import { exportResults } from '../../lib/export-commands'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('exportResults', () => {
  it('calls invoke with correct command and parameters', async () => {
    const mockResponse = { bytesWritten: 2048, rowsExported: 10 }
    mockIPC((cmd, args) => {
      if (cmd === 'export_results') {
        expect((args as Record<string, unknown>).connectionId).toBe('conn-1')
        expect((args as Record<string, unknown>).tabId).toBe('tab-1')
        const options = (args as Record<string, unknown>).options as Record<string, unknown>
        expect(options.format).toBe('csv')
        expect(options.filePath).toBe('/tmp/export.csv')
        expect(options.includeHeaders).toBe(true)
        return mockResponse
      }
      return null
    })

    const result = await exportResults('conn-1', 'tab-1', {
      format: 'csv',
      filePath: '/tmp/export.csv',
      includeHeaders: true,
    })

    expect(result).toEqual(mockResponse)
  })

  it('passes tableName for sql-insert format', async () => {
    mockIPC((cmd, args) => {
      if (cmd === 'export_results') {
        const options = (args as Record<string, unknown>).options as Record<string, unknown>
        expect(options.format).toBe('sql-insert')
        expect(options.tableName).toBe('my_table')
        return { bytesWritten: 512, rowsExported: 5 }
      }
      return null
    })

    const result = await exportResults('conn-1', 'tab-1', {
      format: 'sql-insert',
      filePath: '/tmp/export.sql',
      includeHeaders: true,
      tableName: 'my_table',
    })

    expect(result.bytesWritten).toBe(512)
    expect(result.rowsExported).toBe(5)
  })

  it('does not include resultIndex when omitted', async () => {
    let capturedArgs: Record<string, unknown> | undefined
    mockIPC((cmd, args) => {
      if (cmd === 'export_results') {
        capturedArgs = args as Record<string, unknown>
        return { bytesWritten: 100, rowsExported: 1 }
      }
      return null
    })

    await exportResults('conn-1', 'tab-1', {
      format: 'csv',
      filePath: '/tmp/export.csv',
      includeHeaders: true,
    })

    expect(capturedArgs).toBeDefined()
    expect('resultIndex' in capturedArgs!).toBe(false)
  })

  it('includes resultIndex when provided', async () => {
    let capturedArgs: Record<string, unknown> | undefined
    mockIPC((cmd, args) => {
      if (cmd === 'export_results') {
        capturedArgs = args as Record<string, unknown>
        return { bytesWritten: 100, rowsExported: 1 }
      }
      return null
    })

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

    expect(capturedArgs).toBeDefined()
    expect(capturedArgs!.resultIndex).toBe(2)
  })
})
