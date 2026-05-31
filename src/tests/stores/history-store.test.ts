import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ipc } from '../ipc-mock'
import { useHistoryStore } from '../../stores/history-store'
import type { HistoryEntry } from '../../types/schema'

const INITIAL_STATE = {
  entriesByConnection: {} as Record<string, HistoryEntry[]>,
  totalByConnection: {} as Record<string, number>,
  pageByConnection: {} as Record<string, number>,
  searchByConnection: {} as Record<string, string>,
  sinceByConnection: {} as Record<string, string | null>,
  isLoadingByConnection: {} as Record<string, boolean>,
  isLoadingMoreByConnection: {} as Record<string, boolean>,
  errorByConnection: {} as Record<string, string | null>,
  pageSize: 50,
}

/** Build a deterministic entry whose id encodes its global row index. */
function makeEntry(id: number, connectionId: unknown): HistoryEntry {
  return {
    id,
    connectionId: String(connectionId),
    databaseName: 'db1',
    sqlText: `SELECT ${id}`,
    timestamp: '2025-01-01T00:00:00Z',
    durationMs: 10,
    rowCount: 1,
    affectedRows: 0,
    success: true,
    errorMessage: null,
  }
}

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  useHistoryStore.setState(INITIAL_STATE)
  vi.clearAllMocks()
  // Default mock: returns `page`-worth of rows so pagination/append can be tested.
  // Total is large enough that "load more" is always available.
  ipc.override('list_history', (args) => {
    const request = args as Record<string, unknown>
    const page = (request.page as number) ?? 1
    const pageSize = (request.pageSize as number) ?? 50
    const startId = (page - 1) * pageSize + 1
    const entries = Array.from({ length: pageSize }, (_, i) =>
      makeEntry(startId + i, request.connectionId)
    )
    return { entries, total: 500, page, pageSize }
  })
})

afterEach(() => {
  consoleSpy?.mockRestore()
})

describe('useHistoryStore', () => {
  describe('loadHistory', () => {
    it('loads the first page (replace) for a connection', async () => {
      await useHistoryStore.getState().loadHistory('conn-1')

      const state = useHistoryStore.getState()
      expect(state.entriesByConnection['conn-1']).toHaveLength(50)
      expect(state.entriesByConnection['conn-1'][0].id).toBe(1)
      expect(state.totalByConnection['conn-1']).toBe(500)
      expect(state.pageByConnection['conn-1']).toBe(1)
      expect(state.isLoadingByConnection['conn-1']).toBe(false)
    })

    it('forwards the time-range cutoff to the backend and stores it', async () => {
      let receivedSince: unknown
      ipc.override('list_history', (args) => {
        const request = args as Record<string, unknown>
        receivedSince = request.since
        return { entries: [makeEntry(1, request.connectionId)], total: 1, page: 1, pageSize: 50 }
      })

      await useHistoryStore.getState().loadHistory('conn-1', { since: '2025-05-01T00:00:00.000Z' })

      expect(receivedSince).toBe('2025-05-01T00:00:00.000Z')
      expect(useHistoryStore.getState().sinceByConnection['conn-1']).toBe(
        '2025-05-01T00:00:00.000Z'
      )
    })

    it('replacing reset the accumulated list back to a single page', async () => {
      await useHistoryStore.getState().loadHistory('conn-1')
      await useHistoryStore.getState().loadMore('conn-1')
      expect(useHistoryStore.getState().entriesByConnection['conn-1']).toHaveLength(100)

      // A fresh load (no append) replaces the accumulated rows.
      await useHistoryStore.getState().loadHistory('conn-1', { page: 1 })
      expect(useHistoryStore.getState().entriesByConnection['conn-1']).toHaveLength(50)
      expect(useHistoryStore.getState().pageByConnection['conn-1']).toBe(1)
    })

    it('handles load errors gracefully', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      ipc.override('list_history', () => {
        throw new Error('IPC failure')
      })

      await useHistoryStore.getState().loadHistory('conn-1')

      const state = useHistoryStore.getState()
      expect(state.isLoadingByConnection['conn-1']).toBe(false)
      expect(state.errorByConnection['conn-1']).toBe('IPC failure')
      expect(consoleSpy).not.toHaveBeenCalled()
    })
  })

  describe('loadMore', () => {
    it('appends the next page and preserves the stored time range', async () => {
      const seenSince: unknown[] = []
      ipc.override('list_history', (args) => {
        const request = args as Record<string, unknown>
        seenSince.push(request.since)
        const page = (request.page as number) ?? 1
        return {
          entries: [makeEntry(page * 1000, request.connectionId)],
          total: 500,
          page,
          pageSize: 50,
        }
      })

      await useHistoryStore.getState().loadHistory('conn-1', { since: '2025-05-01T00:00:00.000Z' })
      await useHistoryStore.getState().loadMore('conn-1')

      const state = useHistoryStore.getState()
      expect(state.entriesByConnection['conn-1']).toHaveLength(2)
      expect(state.pageByConnection['conn-1']).toBe(2)
      expect(state.isLoadingMoreByConnection['conn-1']).toBe(false)
      // Both the initial load and the load-more reused the same cutoff.
      expect(seenSince).toEqual(['2025-05-01T00:00:00.000Z', '2025-05-01T00:00:00.000Z'])
    })

    it('keeps existing rows visible when the append request fails', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await useHistoryStore.getState().loadHistory('conn-1')
      expect(useHistoryStore.getState().entriesByConnection['conn-1']).toHaveLength(50)

      ipc.override('list_history', () => {
        throw new Error('append failure')
      })
      await useHistoryStore.getState().loadMore('conn-1')

      const state = useHistoryStore.getState()
      // Rows preserved, no full-panel error, spinner cleared.
      expect(state.entriesByConnection['conn-1']).toHaveLength(50)
      expect(state.errorByConnection['conn-1']).toBeFalsy()
      expect(state.isLoadingMoreByConnection['conn-1']).toBe(false)
    })
  })

  describe('deleteEntry', () => {
    it('deletes and refreshes the list', async () => {
      await useHistoryStore.getState().loadHistory('conn-1')
      expect(useHistoryStore.getState().entriesByConnection['conn-1']).toHaveLength(50)

      await useHistoryStore.getState().deleteEntry('conn-1', 1)

      // Reloaded the current page (mock still returns a full page).
      expect(useHistoryStore.getState().entriesByConnection['conn-1']).toHaveLength(50)
    })

    it('handles delete errors with toast', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      ipc.override('delete_history_entry', () => {
        throw new Error('Delete failed')
      })

      await useHistoryStore.getState().deleteEntry('conn-1', 1)
      expect(consoleSpy).not.toHaveBeenCalled()
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
      ipc.override('clear_history', () => {
        throw new Error('Clear failed')
      })

      await useHistoryStore.getState().clearAll('conn-1')
      expect(consoleSpy).not.toHaveBeenCalled()
    })
  })

  describe('setSearch', () => {
    it('updates search, resets to first page, and triggers load', async () => {
      useHistoryStore.getState().setSearch('conn-1', 'SELECT')

      await vi.waitFor(() => {
        const state = useHistoryStore.getState()
        expect(state.searchByConnection['conn-1']).toBe('SELECT')
        expect(state.pageByConnection['conn-1']).toBe(1)
      })
    })
  })

  describe('setPage', () => {
    it('updates page and triggers load', async () => {
      useHistoryStore.getState().setPage('conn-1', 2)

      await vi.waitFor(() => {
        expect(useHistoryStore.getState().pageByConnection['conn-1']).toBe(2)
      })
    })
  })

  describe('reset', () => {
    it('resets to initial state', async () => {
      await useHistoryStore.getState().loadHistory('conn-1')
      useHistoryStore.getState().reset()

      const state = useHistoryStore.getState()
      expect(state.entriesByConnection).toEqual({})
      expect(state.pageByConnection).toEqual({})
      expect(state.sinceByConnection).toEqual({})
    })
  })

  describe('notifyNewQuery', () => {
    it('triggers refresh when history has been loaded with entries', async () => {
      await useHistoryStore.getState().loadHistory('conn-1')
      expect(useHistoryStore.getState().entriesByConnection['conn-1']).toHaveLength(50)

      useHistoryStore.getState().notifyNewQuery('conn-1')

      await vi.waitFor(() => {
        expect(useHistoryStore.getState().pageByConnection['conn-1']).toBe(1)
        expect(useHistoryStore.getState().entriesByConnection['conn-1']).toHaveLength(50)
      })
    })

    it('collapses any load-more window back to the first page', async () => {
      await useHistoryStore.getState().loadHistory('conn-1')
      await useHistoryStore.getState().loadMore('conn-1')
      expect(useHistoryStore.getState().pageByConnection['conn-1']).toBe(2)

      useHistoryStore.getState().notifyNewQuery('conn-1')

      await vi.waitFor(() => {
        expect(useHistoryStore.getState().pageByConnection['conn-1']).toBe(1)
        expect(useHistoryStore.getState().entriesByConnection['conn-1']).toHaveLength(50)
      })
    })

    it('triggers refresh when history has been loaded but is empty', async () => {
      useHistoryStore.setState({
        entriesByConnection: { 'conn-empty': [] },
        totalByConnection: { 'conn-empty': 0 },
        pageByConnection: { 'conn-empty': 1 },
      })

      useHistoryStore.getState().notifyNewQuery('conn-empty')

      await vi.waitFor(() => {
        expect(useHistoryStore.getState().entriesByConnection['conn-empty']).toHaveLength(50)
      })
    })

    it('does NOT trigger refresh when history was never loaded for connection', () => {
      const loadSpy = vi.spyOn(useHistoryStore.getState(), 'loadHistory')

      useHistoryStore.getState().notifyNewQuery('never-loaded')

      expect(loadSpy).not.toHaveBeenCalled()
      loadSpy.mockRestore()
    })
  })
})
