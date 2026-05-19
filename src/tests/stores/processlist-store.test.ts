import { beforeEach, describe, expect, it } from 'vitest'
import { ipc, expectToast } from '../ipc-mock'
import { useProcessListStore } from '../../stores/processlist-store'
import { useToastStore, _resetToastTimeoutsForTests } from '../../stores/toast-store'
import type { ProcessRow, KillResult } from '../../lib/processlist-commands'
import { isIdleProcessRow } from '../../lib/processlist-filter'

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
    excludeIdleConnectionsByConnection: {},
    isConfirmDialogOpenByConnection: {},
    isSummaryDialogOpenByConnection: {},
    sortColumnByConnection: {},
    lastErrorToastAtByConnection: {},
    fetchErrorByConnection: {},
    isFetchingByConnection: {},
    fetchGenerationByConnection: {},
    hasFetchedByConnection: {},
  })
  useToastStore.setState({ toasts: [] })
  _resetToastTimeoutsForTests()
}

beforeEach(() => {
  resetStore()
})

describe('processlist-store', () => {
  describe('fetchProcessList', () => {
    it('fetches rows and updates state', async () => {
      const rows = makeRows(3)
      ipc.override('get_processlist', () => rows)

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
      ipc.override('get_processlist', () => rows)

      await useProcessListStore.getState().fetchProcessList(CONN, SESSION, true)

      const selected = useProcessListStore.getState().selectedIdsByConnection[CONN]
      expect(selected).toEqual(new Set([1, 2])) // 5 removed
    })

    it('removes selected IDs for rows hidden by the exclude-idle filter after refresh', async () => {
      useProcessListStore.setState({
        selectedIdsByConnection: { [CONN]: new Set([1, 2]) },
        excludeIdleConnectionsByConnection: { [CONN]: true },
      })

      const rows: ProcessRow[] = [
        {
          id: 1,
          user: 'root',
          host: 'localhost',
          db: 'mydb',
          command: 'Query',
          time: 0,
          state: 'executing',
          info: 'SELECT 1',
        },
        {
          id: 2,
          user: 'root',
          host: 'localhost',
          db: 'mydb',
          command: 'Sleep',
          time: 5,
          state: 'idle',
          info: null,
        },
      ]

      ipc.override('get_processlist', () => rows)

      await useProcessListStore.getState().fetchProcessList(CONN, SESSION, true)

      // ID 2 is idle and excluded by the filter, so it should be removed from selection
      expect(useProcessListStore.getState().selectedIdsByConnection[CONN]).toEqual(new Set([1]))
    })

    it('preserves all selected IDs when exclude-idle filter is off', async () => {
      useProcessListStore.setState({
        selectedIdsByConnection: { [CONN]: new Set([1, 2]) },
        excludeIdleConnectionsByConnection: { [CONN]: false },
      })

      const rows: ProcessRow[] = [
        {
          id: 1,
          user: 'root',
          host: 'localhost',
          db: 'mydb',
          command: 'Query',
          time: 0,
          state: 'executing',
          info: 'SELECT 1',
        },
        {
          id: 2,
          user: 'root',
          host: 'localhost',
          db: 'mydb',
          command: 'Sleep',
          time: 5,
          state: 'idle',
          info: null,
        },
      ]

      ipc.override('get_processlist', () => rows)

      await useProcessListStore.getState().fetchProcessList(CONN, SESSION, true)

      // Filter is off, so both IDs survive reconciliation
      expect(useProcessListStore.getState().selectedIdsByConnection[CONN]).toEqual(new Set([1, 2]))
    })

    it('shows error toast on manual fetch failure', async () => {
      ipc.override('get_processlist', () => {
        throw new Error('fail')
      })

      await useProcessListStore.getState().fetchProcessList(CONN, SESSION, true)

      await expectToast('error', 'Failed to fetch process list')
      expect(useProcessListStore.getState().fetchErrorByConnection[CONN]).toBe('fail')
    })

    it('logs warning on auto-refresh failure and throttles toasts', async () => {
      ipc.override('get_processlist', () => {
        throw new Error('timeout')
      })

      await useProcessListStore.getState().fetchProcessList(CONN, SESSION, false)

      // Auto-refresh failure should log a warning via IPC and show a toast
      const logCalls = ipc.calls('log_frontend')
      const hasAutoRefreshWarning = logCalls.some(
        (call) =>
          (call as Record<string, unknown>)?.level === 'warn' &&
          String((call as Record<string, unknown>)?.message ?? '').includes('Auto-refresh failed')
      )
      expect(hasAutoRefreshWarning).toBe(true)
      await expectToast('error', 'Process list refresh failed')

      // Second call within cooldown should not show toast again
      const toastsBefore = useToastStore.getState().toasts.length
      ipc.override('get_processlist', () => {
        throw new Error('timeout')
      })
      await useProcessListStore.getState().fetchProcessList(CONN, SESSION, false)
      expect(useToastStore.getState().toasts.length).toBe(toastsBefore)
    })

    it('normalizes non-Error throw values on manual fetch failure', async () => {
      ipc.override('get_processlist', () => {
        throw 'plain-error'
      })

      await useProcessListStore.getState().fetchProcessList(CONN, SESSION, true)

      await expectToast('error', 'Failed to fetch process list')
      expect(useProcessListStore.getState().fetchErrorByConnection[CONN]).toBe('plain-error')
    })

    it('skips overlapping fetches', async () => {
      let callCount = 0
      ipc.override('get_processlist', () => {
        callCount++
        return makeRows(1)
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
      ipc.override('kill_queries', (args) => {
        expect((args as { ids: number[] }).ids).toEqual([1, 2])
        return results
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

    it('setExcludeIdleConnections removes idle selections when enabling exclude-idle filter', () => {
      const rows: ProcessRow[] = [
        {
          id: 1,
          user: 'root',
          host: 'localhost',
          db: 'mydb',
          command: 'Query',
          time: 0,
          state: 'executing',
          info: 'SELECT 1',
        },
        {
          id: 2,
          user: 'root',
          host: 'localhost',
          db: 'mydb',
          command: 'Sleep',
          time: 5,
          state: 'idle',
          info: null,
        },
      ]

      expect(isIdleProcessRow(rows[1])).toBe(true)

      useProcessListStore.setState({
        rowsByConnection: { [CONN]: rows },
        selectedIdsByConnection: { [CONN]: new Set([1, 2]) },
      })

      useProcessListStore.getState().setExcludeIdleConnections(CONN, true)

      const state = useProcessListStore.getState()
      expect(state.excludeIdleConnectionsByConnection[CONN]).toBe(true)
      // ID 2 is idle and now filtered out, so it should be removed from selection
      expect(state.selectedIdsByConnection[CONN]).toEqual(new Set([1]))
    })

    it('setExcludeIdleConnections preserves all selections when disabling exclude-idle filter', () => {
      const rows: ProcessRow[] = [
        {
          id: 1,
          user: 'root',
          host: 'localhost',
          db: 'mydb',
          command: 'Query',
          time: 0,
          state: 'executing',
          info: 'SELECT 1',
        },
        {
          id: 2,
          user: 'root',
          host: 'localhost',
          db: 'mydb',
          command: 'Sleep',
          time: 5,
          state: 'idle',
          info: null,
        },
      ]

      useProcessListStore.setState({
        rowsByConnection: { [CONN]: rows },
        selectedIdsByConnection: { [CONN]: new Set([1, 2]) },
      })

      useProcessListStore.getState().setExcludeIdleConnections(CONN, false)

      const state = useProcessListStore.getState()
      expect(state.excludeIdleConnectionsByConnection[CONN]).toBe(false)
      // Filter is off, so all rows are visible and all selections are preserved
      expect(state.selectedIdsByConnection[CONN]).toEqual(new Set([1, 2]))
    })

    it('setExcludeIdleConnections can show idle rows again', () => {
      useProcessListStore.getState().setExcludeIdleConnections(CONN, false)
      expect(useProcessListStore.getState().excludeIdleConnectionsByConnection[CONN]).toBe(false)
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
        excludeIdleConnectionsByConnection: { [CONN]: false },
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
      expect(state.excludeIdleConnectionsByConnection[CONN]).toBeUndefined()
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
      ipc.override(
        'get_processlist',
        () =>
          new Promise<ProcessRow[]>((resolve) => {
            resolveIpc = resolve
          })
      )

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
      ipc.override(
        'get_processlist',
        () =>
          new Promise<ProcessRow[]>((_, reject) => {
            rejectIpc = reject
          })
      )

      const fetchPromise = useProcessListStore.getState().fetchProcessList(CONN, SESSION, true)
      useProcessListStore.getState().resetConnection(CONN)

      rejectIpc!('stale-failure')
      await fetchPromise

      expect(useProcessListStore.getState().fetchErrorByConnection[CONN]).toBeUndefined()
      expect(useToastStore.getState().toasts.some((t) => t.variant === 'error')).toBe(false)
    })
  })
})
