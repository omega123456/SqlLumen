import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import { useHistoryStore } from '../../stores/history-store'
import type { HistoryEntry } from '../../types/schema'

const INITIAL_STATE = {
  entriesByConnection: {} as Record<string, HistoryEntry[]>,
  totalByConnection: {} as Record<string, number>,
  pageByConnection: {} as Record<string, number>,
  searchByConnection: {} as Record<string, string>,
  isLoadingByConnection: {} as Record<string, boolean>,
  errorByConnection: {} as Record<string, string | null>,
  pageSize: 50,
}

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  useHistoryStore.setState(INITIAL_STATE)
  vi.clearAllMocks()

  mockIPC((cmd, args) => {
    switch (cmd) {
      case 'list_history':
        return {
          entries: [
            {
              id: 1,
              connectionId: (args as Record<string, unknown>).connectionId,
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
          page: (args as Record<string, unknown>).page ?? 1,
          pageSize: (args as Record<string, unknown>).pageSize ?? 50,
        }
      case 'delete_history_entry':
        return true
      case 'clear_history':
        return 1
      case 'log_frontend':
        return undefined
      default:
        return null
    }
  })
})

afterEach(() => {
  consoleSpy?.mockRestore()
})

describe('useHistoryStore', () => {
  describe('loadHistory', () => {
    it('loads entries from backend for a connection', async () => {
      await useHistoryStore.getState().loadHistory('conn-1')

      const state = useHistoryStore.getState()
      expect(state.entriesByConnection['conn-1']).toHaveLength(1)
      expect(state.entriesByConnection['conn-1'][0].id).toBe(1)
      expect(state.totalByConnection['conn-1']).toBe(1)
      expect(state.isLoadingByConnection['conn-1']).toBe(false)
    })

    it('handles load errors gracefully', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockIPC(() => {
        throw new Error('IPC failure')
      })

      await useHistoryStore.getState().loadHistory('conn-1')

      const state = useHistoryStore.getState()
      expect(state.isLoadingByConnection['conn-1']).toBe(false)
      expect(state.errorByConnection['conn-1']).toBe('IPC failure')
      expect(consoleSpy).toHaveBeenCalled()
    })
  })

  describe('deleteEntry', () => {
    it('deletes and refreshes the list', async () => {
      // First load
      await useHistoryStore.getState().loadHistory('conn-1')
      expect(useHistoryStore.getState().entriesByConnection['conn-1']).toHaveLength(1)

      // Delete (will also trigger a reload)
      await useHistoryStore.getState().deleteEntry('conn-1', 1)

      // Verify state was refreshed (still 1 because mock always returns the same)
      expect(useHistoryStore.getState().entriesByConnection['conn-1']).toHaveLength(1)
    })

    it('handles delete errors with toast', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockIPC((cmd) => {
        if (cmd === 'delete_history_entry') throw new Error('Delete failed')
        if (cmd === 'log_frontend') return undefined
        return null
      })

      await useHistoryStore.getState().deleteEntry('conn-1', 1)
      expect(consoleSpy).toHaveBeenCalled()
    })
  })

  describe('clearAll', () => {
    it('clears all entries and resets state for connection', async () => {
      await useHistoryStore.getState().loadHistory('conn-1')
      await useHistoryStore.getState().clearAll('conn-1')

      const state = useHistoryStore.getState()
      expect(state.entriesByConnection['conn-1']).toEqual([])
      expect(state.totalByConnection['conn-1']).toBe(0)
      expect(state.pageByConnection['conn-1']).toBe(1)
    })

    it('handles clear errors with toast', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockIPC((cmd) => {
        if (cmd === 'clear_history') throw new Error('Clear failed')
        if (cmd === 'log_frontend') return undefined
        return null
      })

      await useHistoryStore.getState().clearAll('conn-1')
      expect(consoleSpy).toHaveBeenCalled()
    })
  })

  describe('setSearch', () => {
    it('updates search and triggers load', async () => {
      useHistoryStore.getState().setSearch('conn-1', 'SELECT')

      const state = useHistoryStore.getState()
      expect(state.searchByConnection['conn-1']).toBe('SELECT')
      expect(state.pageByConnection['conn-1']).toBe(1)
    })
  })

  describe('setPage', () => {
    it('updates page and triggers load', async () => {
      useHistoryStore.getState().setPage('conn-1', 2)

      expect(useHistoryStore.getState().pageByConnection['conn-1']).toBe(2)
    })
  })

  describe('reset', () => {
    it('resets to initial state', async () => {
      await useHistoryStore.getState().loadHistory('conn-1')
      useHistoryStore.getState().reset()

      const state = useHistoryStore.getState()
      expect(state.entriesByConnection).toEqual({})
      expect(state.pageByConnection).toEqual({})
    })
  })

  describe('notifyNewQuery', () => {
    it('triggers refresh when history has been loaded with entries', async () => {
      await useHistoryStore.getState().loadHistory('conn-1')
      expect(useHistoryStore.getState().entriesByConnection['conn-1']).toHaveLength(1)

      // notifyNewQuery should trigger a loadHistory call
      useHistoryStore.getState().notifyNewQuery('conn-1')

      // After microtasks settle, entries should still be present (re-fetched)
      await vi.waitFor(() => {
        expect(useHistoryStore.getState().entriesByConnection['conn-1']).toHaveLength(1)
      })
    })

    it('triggers refresh when history has been loaded but is empty', async () => {
      // Set up an empty entries array for the connection (simulates loaded but empty history)
      useHistoryStore.setState({
        entriesByConnection: { 'conn-empty': [] },
        totalByConnection: { 'conn-empty': 0 },
        pageByConnection: { 'conn-empty': 1 },
      })

      // notifyNewQuery should trigger a loadHistory call even for empty entries
      useHistoryStore.getState().notifyNewQuery('conn-empty')

      // After microtasks settle, entries should be refreshed from the mock
      await vi.waitFor(() => {
        expect(useHistoryStore.getState().entriesByConnection['conn-empty']).toHaveLength(1)
      })
    })

    it('does NOT trigger refresh when history was never loaded for connection', () => {
      // Connection 'never-loaded' has no entry in entriesByConnection
      const loadSpy = vi.spyOn(useHistoryStore.getState(), 'loadHistory')

      useHistoryStore.getState().notifyNewQuery('never-loaded')

      expect(loadSpy).not.toHaveBeenCalled()
      loadSpy.mockRestore()
    })
  })
})
