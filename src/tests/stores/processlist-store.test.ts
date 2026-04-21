import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import { useProcessListStore } from '../../stores/processlist-store'
import type { ProcessRow, KillResult } from '../../lib/processlist-commands'

// Mock toast and log
vi.mock('../../stores/toast-store', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}))

vi.mock('../../lib/app-log-commands', () => ({
  logFrontend: vi.fn(),
}))

import { showErrorToast } from '../../stores/toast-store'
import { logFrontend } from '../../lib/app-log-commands'

const CONN = 'conn-1'
const SESSION = 'session-1'

function makeRows(count: number): ProcessRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    user: 'root',
    host: 'localhost',
    db: 'mydb',
    command: 'Query',
    time: i,
    state: 'executing',
    info: `SELECT ${i}`,
  }))
}

function resetStore() {
  useProcessListStore.setState({
    rowsByConnection: {},
    lastRefreshedAtByConnection: {},
    selectedIdsByConnection: {},
    refreshIntervalMsByConnection: {},
    isConfirmDialogOpenByConnection: {},
    isSummaryDialogOpenByConnection: {},
    sortColumnByConnection: {},
    lastErrorToastAtByConnection: {},
    fetchErrorByConnection: {},
    isFetchingByConnection: {},
    fetchGenerationByConnection: {},
  })
}

beforeEach(() => {
  resetStore()
  vi.clearAllMocks()
})

describe('processlist-store', () => {
  describe('fetchProcessList', () => {
    it('fetches rows and updates state', async () => {
      const rows = makeRows(3)
      mockIPC((cmd) => {
        if (cmd === 'get_processlist') return rows
        return null
      })

      await useProcessListStore.getState().fetchProcessList(CONN, SESSION, true)

      const state = useProcessListStore.getState()
      expect(state.rowsByConnection[CONN]).toEqual(rows)
      expect(state.isFetchingByConnection[CONN]).toBe(false)
      expect(state.lastRefreshedAtByConnection[CONN]).toBeGreaterThan(0)
      expect(state.fetchErrorByConnection[CONN]).toBeNull()
    })

    it('reconciles selected IDs with new rows', async () => {
      // Pre-select IDs 1, 2, 5
      useProcessListStore.setState({
        selectedIdsByConnection: { [CONN]: new Set([1, 2, 5]) },
      })

      const rows = makeRows(3) // IDs 1, 2, 3
      mockIPC((cmd) => {
        if (cmd === 'get_processlist') return rows
        return null
      })

      await useProcessListStore.getState().fetchProcessList(CONN, SESSION, true)

      const selected = useProcessListStore.getState().selectedIdsByConnection[CONN]
      expect(selected).toEqual(new Set([1, 2])) // 5 removed
    })

    it('shows error toast on manual fetch failure', async () => {
      mockIPC((cmd) => {
        if (cmd === 'get_processlist') throw new Error('fail')
        return null
      })

      await useProcessListStore.getState().fetchProcessList(CONN, SESSION, true)

      expect(showErrorToast).toHaveBeenCalledWith('Failed to fetch process list', 'fail')
      expect(useProcessListStore.getState().fetchErrorByConnection[CONN]).toBe('fail')
    })

    it('logs warning on auto-refresh failure and throttles toasts', async () => {
      mockIPC((cmd) => {
        if (cmd === 'get_processlist') throw new Error('timeout')
        return null
      })

      await useProcessListStore.getState().fetchProcessList(CONN, SESSION, false)

      expect(logFrontend).toHaveBeenCalledWith(
        'warn',
        expect.stringContaining('Auto-refresh failed')
      )
      expect(showErrorToast).toHaveBeenCalledTimes(1)

      // Second call within cooldown should not show toast again
      vi.clearAllMocks()
      await useProcessListStore.getState().fetchProcessList(CONN, SESSION, false)
      expect(showErrorToast).not.toHaveBeenCalled()
    })

    it('normalizes non-Error throw values on manual fetch failure', async () => {
      mockIPC((cmd) => {
        if (cmd === 'get_processlist') {
          throw 'plain-error'
        }
        return null
      })

      await useProcessListStore.getState().fetchProcessList(CONN, SESSION, true)

      expect(showErrorToast).toHaveBeenCalledWith('Failed to fetch process list', 'plain-error')
      expect(useProcessListStore.getState().fetchErrorByConnection[CONN]).toBe('plain-error')
    })

    it('skips overlapping fetches', async () => {
      let callCount = 0
      mockIPC((cmd) => {
        if (cmd === 'get_processlist') {
          callCount++
          return makeRows(1)
        }
        return null
      })

      // Set isFetching manually
      useProcessListStore.setState({
        isFetchingByConnection: { [CONN]: true },
      })

      await useProcessListStore.getState().fetchProcessList(CONN, SESSION, true)
      expect(callCount).toBe(0)
    })
  })

  describe('killSelectedProcesses', () => {
    it('calls kill with selected IDs', async () => {
      const results: KillResult[] = [
        { id: 1, success: true, error: null },
        { id: 2, success: false, error: 'access denied' },
      ]
      mockIPC((cmd, args) => {
        if (cmd === 'kill_queries') {
          expect((args as { ids: number[] }).ids).toEqual([1, 2])
          return results
        }
        return null
      })

      useProcessListStore.setState({
        selectedIdsByConnection: { [CONN]: new Set([1, 2]) },
      })

      const res = await useProcessListStore.getState().killSelectedProcesses(CONN, SESSION)
      expect(res).toEqual(results)
    })

    it('returns empty array when no selection', async () => {
      const res = await useProcessListStore.getState().killSelectedProcesses(CONN, SESSION)
      expect(res).toEqual([])
    })
  })

  describe('selection actions', () => {
    it('setSelectedIds replaces selection', () => {
      useProcessListStore.getState().setSelectedIds(CONN, new Set([10, 20]))
      expect(useProcessListStore.getState().selectedIdsByConnection[CONN]).toEqual(
        new Set([10, 20])
      )
    })

    it('toggleSelectedId adds and removes', () => {
      useProcessListStore.getState().toggleSelectedId(CONN, 5)
      expect(useProcessListStore.getState().selectedIdsByConnection[CONN]).toEqual(new Set([5]))

      useProcessListStore.getState().toggleSelectedId(CONN, 5)
      expect(useProcessListStore.getState().selectedIdsByConnection[CONN]).toEqual(new Set())
    })
  })

  describe('config actions', () => {
    it('setRefreshInterval updates interval', () => {
      useProcessListStore.getState().setRefreshInterval(CONN, 10000)
      expect(useProcessListStore.getState().refreshIntervalMsByConnection[CONN]).toBe(10000)
    })

    it('setConfirmDialogOpen updates state', () => {
      useProcessListStore.getState().setConfirmDialogOpen(CONN, true)
      expect(useProcessListStore.getState().isConfirmDialogOpenByConnection[CONN]).toBe(true)
    })

    it('setSortColumn updates sort', () => {
      useProcessListStore.getState().setSortColumn(CONN, { columnKey: 'time', direction: 'DESC' })
      expect(useProcessListStore.getState().sortColumnByConnection[CONN]).toEqual({
        columnKey: 'time',
        direction: 'DESC',
      })

      useProcessListStore.getState().setSortColumn(CONN, null)
      expect(useProcessListStore.getState().sortColumnByConnection[CONN]).toBeNull()
    })
  })

  describe('resetConnection', () => {
    it('clears all state for a connection', () => {
      useProcessListStore.setState({
        rowsByConnection: { [CONN]: makeRows(2) },
        selectedIdsByConnection: { [CONN]: new Set([1]) },
        refreshIntervalMsByConnection: { [CONN]: 3000 },
        isConfirmDialogOpenByConnection: { [CONN]: true },
        isSummaryDialogOpenByConnection: { [CONN]: true },
        sortColumnByConnection: { [CONN]: { columnKey: 'id', direction: 'ASC' } },
        lastErrorToastAtByConnection: { [CONN]: 123 },
        fetchErrorByConnection: { [CONN]: 'err' },
        isFetchingByConnection: { [CONN]: true },
        lastRefreshedAtByConnection: { [CONN]: 999 },
        fetchGenerationByConnection: { [CONN]: 5 },
      })

      useProcessListStore.getState().resetConnection(CONN)

      const state = useProcessListStore.getState()
      expect(state.rowsByConnection[CONN]).toBeUndefined()
      expect(state.selectedIdsByConnection[CONN]).toBeUndefined()
      expect(state.refreshIntervalMsByConnection[CONN]).toBeUndefined()
      expect(state.isFetchingByConnection[CONN]).toBeUndefined()
      expect(state.isSummaryDialogOpenByConnection[CONN]).toBeUndefined()
    })

    it('increments generation to invalidate in-flight fetches', () => {
      useProcessListStore.setState({
        fetchGenerationByConnection: { [CONN]: 3 },
      })

      useProcessListStore.getState().resetConnection(CONN)

      // Generation should be incremented (even though other keys are deleted)
      expect(useProcessListStore.getState().fetchGenerationByConnection[CONN]).toBe(4)
    })
  })

  describe('setSummaryDialogOpen', () => {
    it('updates summary dialog state', () => {
      useProcessListStore.getState().setSummaryDialogOpen(CONN, true)
      expect(useProcessListStore.getState().isSummaryDialogOpenByConnection[CONN]).toBe(true)

      useProcessListStore.getState().setSummaryDialogOpen(CONN, false)
      expect(useProcessListStore.getState().isSummaryDialogOpenByConnection[CONN]).toBe(false)
    })
  })

  describe('generation guard', () => {
    it('discards stale fetch results after resetConnection', async () => {
      let resolveIpc: ((rows: ProcessRow[]) => void) | null = null
      mockIPC((cmd) => {
        if (cmd === 'get_processlist') {
          return new Promise<ProcessRow[]>((resolve) => {
            resolveIpc = resolve
          })
        }
        return null
      })

      // Start fetch
      const fetchPromise = useProcessListStore.getState().fetchProcessList(CONN, SESSION, true)

      // Reset connection while fetch is in-flight
      useProcessListStore.getState().resetConnection(CONN)

      // Resolve the IPC
      resolveIpc!(makeRows(3))
      await fetchPromise

      // Rows should NOT be written since generation mismatched
      expect(useProcessListStore.getState().rowsByConnection[CONN]).toBeUndefined()
    })

    it('discards stale fetch errors after resetConnection', async () => {
      let rejectIpc: ((reason?: unknown) => void) | null = null
      mockIPC((cmd) => {
        if (cmd === 'get_processlist') {
          return new Promise<ProcessRow[]>((_, reject) => {
            rejectIpc = reject
          })
        }
        return null
      })

      const fetchPromise = useProcessListStore.getState().fetchProcessList(CONN, SESSION, true)
      useProcessListStore.getState().resetConnection(CONN)

      rejectIpc!('stale-failure')
      await fetchPromise

      expect(useProcessListStore.getState().fetchErrorByConnection[CONN]).toBeUndefined()
      expect(showErrorToast).not.toHaveBeenCalled()
    })
  })
})
