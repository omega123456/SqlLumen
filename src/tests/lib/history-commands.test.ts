import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import { listHistory, deleteHistoryEntry, clearHistory } from '../../lib/history-commands'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listHistory', () => {
  it('calls invoke with correct parameters', async () => {
    const mockResponse = {
      entries: [
        {
          id: 1,
          connectionId: 'conn-1',
          databaseName: 'db1',
          sqlText: 'SELECT 1',
          timestamp: '2025-01-01T00:00:00Z',
          durationMs: 10,
          rowCount: 1,
          affectedRows: 0,
          success: true,
          errorMessage: null,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    }

    mockIPC((cmd, args) => {
      if (cmd === 'list_history') {
        expect((args as Record<string, unknown>).connectionId).toBe('conn-1')
        expect((args as Record<string, unknown>).page).toBe(1)
        expect((args as Record<string, unknown>).pageSize).toBe(50)
        return mockResponse
      }
      return null
    })

    const result = await listHistory('conn-1', 1, 50)
    expect(result).toEqual(mockResponse)
  })

  it('passes search parameter when provided', async () => {
    let capturedArgs: Record<string, unknown> | undefined

    mockIPC((cmd, args) => {
      if (cmd === 'list_history') {
        capturedArgs = args as Record<string, unknown>
        return { entries: [], total: 0, page: 1, pageSize: 50 }
      }
      return null
    })

    await listHistory('conn-1', 1, 50, 'SELECT')
    expect(capturedArgs).toBeDefined()
    expect(capturedArgs!.search).toBe('SELECT')
  })

  it('omits search parameter when null', async () => {
    let capturedArgs: Record<string, unknown> | undefined

    mockIPC((cmd, args) => {
      if (cmd === 'list_history') {
        capturedArgs = args as Record<string, unknown>
        return { entries: [], total: 0, page: 1, pageSize: 50 }
      }
      return null
    })

    await listHistory('conn-1', 1, 50, null)
    expect(capturedArgs).toBeDefined()
    expect('search' in capturedArgs!).toBe(false)
  })
})

describe('deleteHistoryEntry', () => {
  it('calls invoke with correct id', async () => {
    mockIPC((cmd, args) => {
      if (cmd === 'delete_history_entry') {
        expect((args as Record<string, unknown>).id).toBe(1)
        return true
      }
      return null
    })

    const result = await deleteHistoryEntry(1)
    expect(result).toBe(true)
  })
})

describe('clearHistory', () => {
  it('calls invoke with correct connectionId', async () => {
    mockIPC((cmd, args) => {
      if (cmd === 'clear_history') {
        expect((args as Record<string, unknown>).connectionId).toBe('conn-1')
        return 5
      }
      return null
    })

    const result = await clearHistory('conn-1')
    expect(result).toBe(5)
  })
})
