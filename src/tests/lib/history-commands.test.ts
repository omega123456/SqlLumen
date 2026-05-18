import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipc } from '../ipc-mock'
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

    ipc.override('list_history', () => mockResponse)

    const result = await listHistory('conn-1', 1, 50)
    expect(ipc.calls('list_history')).toEqual([{ connectionId: 'conn-1', page: 1, pageSize: 50 }])
    expect(result).toEqual(mockResponse)
  })

  it('passes search parameter when provided', async () => {
    ipc.override('list_history', () => ({ entries: [], total: 0, page: 1, pageSize: 50 }))

    await listHistory('conn-1', 1, 50, 'SELECT')
    expect((ipc.calls('list_history')[0] as Record<string, unknown>).search).toBe('SELECT')
  })

  it('omits search parameter when null', async () => {
    ipc.override('list_history', () => ({ entries: [], total: 0, page: 1, pageSize: 50 }))

    await listHistory('conn-1', 1, 50, null)
    const args = ipc.calls('list_history')[0] as Record<string, unknown>
    expect('search' in args).toBe(false)
  })
})

describe('deleteHistoryEntry', () => {
  it('calls invoke with correct id', async () => {
    ipc.override('delete_history_entry', () => true)

    const result = await deleteHistoryEntry(1)
    expect(ipc.calls('delete_history_entry')).toEqual([{ id: 1 }])
    expect(result).toBe(true)
  })
})

describe('clearHistory', () => {
  it('calls invoke with correct connectionId', async () => {
    ipc.override('clear_history', () => 5)

    const result = await clearHistory('conn-1')
    expect(ipc.calls('clear_history')).toEqual([{ connectionId: 'conn-1' }])
    expect(result).toBe(5)
  })
})
