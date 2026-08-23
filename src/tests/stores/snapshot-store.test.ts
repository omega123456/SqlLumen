/**
 * Tests for snapshot-store: manual/auto create, restore ordering, delete,
 * periodic scheduling, and on-close behavior.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from '@testing-library/react'

import { ipc } from '../ipc-mock'
import {
  _resetSnapshotSchedulerForTests,
  registerSnapshotScheduler,
  SNAPSHOT_CHECK_INTERVAL_MS,
  useSnapshotStore,
} from '../../stores/snapshot-store'
import { useConnectionStore } from '../../stores/connection-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useSessionRestoreStore } from '../../stores/session-restore-store'
import { useToastStore } from '../../stores/toast-store'
import { resetWorkspaceStore } from '../helpers/workspace-test-utils'
import * as tauriEnv from '../../lib/tauri-env'

const restoreFromStateMock = vi.fn(async (_state: unknown) => {})
import type { SnapshotSummary } from '../../lib/session-snapshot-commands'
import type { ActiveConnection, SavedConnection } from '../../types/connection'
import type { WorkspaceTab } from '../../types/schema'

function makeProfile(id: string, name: string): SavedConnection {
  return {
    id,
    name,
    host: '127.0.0.1',
    port: 3306,
    username: 'root',
    hasPassword: true,
    defaultDatabase: 'testdb',
    sslEnabled: false,
    sslCaPath: null,
    sslCertPath: null,
    sslKeyPath: null,
    color: null,
    groupId: null,
    readOnly: false,
    sortOrder: 0,
    connectTimeoutSecs: 10,
    keepaliveIntervalSecs: 60,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  }
}

function makeActive(sessionId: string, profile: SavedConnection): ActiveConnection {
  return { id: sessionId, profile, status: 'connected', serverVersion: '8.0.0' }
}

function queryTab(connectionId: string, id: string): WorkspaceTab {
  return { id, type: 'query-editor', label: 'Query', connectionId } as WorkspaceTab
}

/** Seed two connections: ProdDB (2 serializable tabs + 1 non-serializable) and Staging (1 tab). */
function seedSession(): void {
  const prod = makeProfile('p-prod', 'ProdDB')
  const staging = makeProfile('p-staging', 'Staging')
  act(() => {
    useConnectionStore.setState({
      activeConnections: {
        'sess-prod': makeActive('sess-prod', prod),
        'sess-staging': makeActive('sess-staging', staging),
      },
      activeConnectionOrder: ['sess-prod', 'sess-staging'],
      activeTabId: 'sess-prod',
    })
    useWorkspaceStore.setState({
      tabsByConnection: {
        'sess-prod': [
          queryTab('sess-prod', 't1'),
          queryTab('sess-prod', 't2'),
          // processlist is NOT serializable and must not be counted
          {
            id: 't3',
            type: 'processlist',
            label: 'Processes',
            connectionId: 'sess-prod',
          } as WorkspaceTab,
        ],
        'sess-staging': [queryTab('sess-staging', 't4')],
      },
    })
  })
}

beforeEach(() => {
  restoreFromStateMock.mockReset()
  restoreFromStateMock.mockResolvedValue(undefined)
  act(() => {
    useSessionRestoreStore.setState({
      ...useSessionRestoreStore.getInitialState(),
      restoreFromState: restoreFromStateMock,
    })
    useSnapshotStore.setState(useSnapshotStore.getInitialState(), true)
    useConnectionStore.setState(useConnectionStore.getInitialState(), true)
    resetWorkspaceStore()
    useSettingsStore.setState({
      settings: { 'snapshots.frequency': 'daily', 'snapshots.keep': '10' },
      pendingChanges: {},
      isLoading: false,
      isDirty: false,
      activeSection: 'general',
    })
    useToastStore.setState({ toasts: [] })
  })

  ipc.override('log_frontend', () => undefined)
  _resetSnapshotSchedulerForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('createManualSnapshot', () => {
  it('computes counts/summary, passes current keep, and reloads the list', async () => {
    seedSession()
    act(() => {
      useSettingsStore.setState({
        settings: { 'snapshots.frequency': 'daily', 'snapshots.keep': '20' },
        pendingChanges: {},
        isLoading: false,
        isDirty: false,
        activeSection: 'general',
      })
    })

    let createArgs: Record<string, unknown> | undefined
    const listResult: SnapshotSummary[] = [
      {
        id: 1,
        createdAt: '2026-06-05T10:00:00Z',
        triggerType: 'manual',
        connectionCount: 2,
        tabCount: 3,
        connections: [],
      },
    ]
    ipc.override('create_session_snapshot', (args) => {
      createArgs = args as Record<string, unknown>
      return 1
    })
    ipc.override('list_session_snapshots', () => listResult)

    await act(async () => {
      await useSnapshotStore.getState().createManualSnapshot()
    })

    expect(createArgs?.triggerType).toBe('manual')
    expect(createArgs?.connectionCount).toBe(2)
    // ProdDB has 2 serializable tabs (processlist excluded) + Staging 1 = 3
    expect(createArgs?.tabCount).toBe(3)
    expect(createArgs?.keep).toBe(20)
    const summary = JSON.parse(createArgs?.summaryJson as string)
    expect(summary).toEqual([
      { name: 'ProdDB', tabCount: 2 },
      { name: 'Staging', tabCount: 1 },
    ])
    expect(useSnapshotStore.getState().snapshots).toEqual(listResult)
    expect(useSnapshotStore.getState().isBusy).toBe(false)
  })
})

describe('automatic snapshot persistence guard', () => {
  it('suppresses automatic snapshots but permits explicit snapshots', async () => {
    useSessionRestoreStore.setState({ hasIncompleteRestore: true })
    ipc.override('create_session_snapshot', () => 7)
    ipc.override('list_session_snapshots', () => [])

    await expect(useSnapshotStore.getState().createAutoSnapshot('daily')).resolves.toBeNull()
    await expect(useSnapshotStore.getState().createAutoSnapshot('weekly')).resolves.toBeNull()
    await expect(useSnapshotStore.getState().createAutoSnapshot('onClose')).resolves.toBeNull()
    expect(ipc.calls('create_session_snapshot')).toEqual([])

    await expect(useSnapshotStore.getState().createAutoSnapshot('beforeRestore')).resolves.toBe(7)
    await useSnapshotStore.getState().createManualSnapshot()
    expect(
      ipc
        .calls('create_session_snapshot')
        .map((args) => (args as { triggerType: string }).triggerType)
    ).toEqual(['beforeRestore', 'manual'])
  })
})

describe('restoreSnapshot', () => {
  it('gets state, creates beforeRestore, force-closes in order, then restores IN ORDER', async () => {
    seedSession()
    const order: string[] = []

    ipc.override('get_session_snapshot', () => {
      order.push('get')
      return JSON.stringify({
        version: 1,
        connections: [{ profileId: 'p-prod', activeTabIndex: 0, tabs: [] }],
      })
    })
    ipc.override('create_session_snapshot', () => {
      order.push('beforeRestore')
      return 99
    })
    ipc.override('list_session_snapshots', () => [])

    const closeConnectionSpy = vi.fn(async (sessionId: string) => {
      order.push(`close:${sessionId}`)
      const state = useConnectionStore.getState()
      const activeConnections = { ...state.activeConnections }
      delete activeConnections[sessionId]
      useConnectionStore.setState({
        activeConnections,
        activeConnectionOrder: state.activeConnectionOrder.filter((id) => id !== sessionId),
        activeTabId: state.activeTabId === sessionId ? null : state.activeTabId,
      })
      return true
    })
    act(() => {
      useConnectionStore.setState({ closeConnection: closeConnectionSpy })
    })
    restoreFromStateMock.mockImplementation(async () => {
      order.push('restore')
    })

    await act(async () => {
      await useSnapshotStore.getState().restoreSnapshot(5)
    })

    expect(order).toEqual([
      'get',
      'beforeRestore',
      'close:sess-prod',
      'close:sess-staging',
      'restore',
    ])
    expect(closeConnectionSpy).toHaveBeenNthCalledWith(1, 'sess-prod', { force: true })
    expect(closeConnectionSpy).toHaveBeenNthCalledWith(2, 'sess-staging', { force: true })
    expect(restoreFromStateMock).toHaveBeenCalledWith(expect.objectContaining({ version: 1 }))
    expect(useSnapshotStore.getState().isBusy).toBe(false)
    expect(useSnapshotStore.getState().isRestoring).toBe(false)
  })

  it('keeps isRestoring true through the whole restore, even after the nested beforeRestore create resets isBusy', async () => {
    seedSession()
    ipc.override('get_session_snapshot', () =>
      JSON.stringify({
        version: 1,
        connections: [{ profileId: 'p-prod', activeTabIndex: 0, tabs: [] }],
      })
    )
    ipc.override('create_session_snapshot', () => 99)
    ipc.override('list_session_snapshots', () => [])

    const closeConnectionSpy = vi.fn(async (sessionId: string) => {
      const state = useConnectionStore.getState()
      const activeConnections = { ...state.activeConnections }
      delete activeConnections[sessionId]
      useConnectionStore.setState({
        activeConnections,
        activeConnectionOrder: state.activeConnectionOrder.filter((id) => id !== sessionId),
        activeTabId: state.activeTabId === sessionId ? null : state.activeTabId,
      })
      return true
    })
    act(() => {
      useConnectionStore.setState({ closeConnection: closeConnectionSpy })
    })

    // The beforeRestore create runs (and its finally resets isBusy) before
    // restoreFromState. Capture the flags at that point: isRestoring must still
    // gate the UI so the confirm button cannot be spammed mid-restore.
    let busyAtRestore: boolean | null = null
    let restoringAtRestore: boolean | null = null
    restoreFromStateMock.mockImplementation(async () => {
      busyAtRestore = useSnapshotStore.getState().isBusy
      restoringAtRestore = useSnapshotStore.getState().isRestoring
    })

    await act(async () => {
      await useSnapshotStore.getState().restoreSnapshot(5)
    })

    expect(busyAtRestore).toBe(false)
    expect(restoringAtRestore).toBe(true)
    expect(useSnapshotStore.getState().isRestoring).toBe(false)
  })

  it('ignores a second restore call while one is already in progress', async () => {
    seedSession()
    ipc.override('get_session_snapshot', () =>
      JSON.stringify({
        version: 1,
        connections: [{ profileId: 'p-prod', activeTabIndex: 0, tabs: [] }],
      })
    )
    ipc.override('create_session_snapshot', () => 99)
    ipc.override('list_session_snapshots', () => [])

    const closeConnectionSpy = vi.fn(async (sessionId: string) => {
      const state = useConnectionStore.getState()
      const activeConnections = { ...state.activeConnections }
      delete activeConnections[sessionId]
      useConnectionStore.setState({
        activeConnections,
        activeConnectionOrder: state.activeConnectionOrder.filter((id) => id !== sessionId),
        activeTabId: state.activeTabId === sessionId ? null : state.activeTabId,
      })
      return true
    })
    act(() => {
      useConnectionStore.setState({ closeConnection: closeConnectionSpy })
    })

    // Hold the restore open inside restoreFromState so a second call lands
    // while the first is still in flight.
    let releaseRestore: (() => void) | null = null
    const restoreGate = new Promise<void>((resolve) => {
      releaseRestore = resolve
    })
    let secondCallResolved = false
    restoreFromStateMock.mockImplementation(async () => {
      await restoreGate
    })

    let firstCall: Promise<void> = Promise.resolve()
    await act(async () => {
      firstCall = useSnapshotStore.getState().restoreSnapshot(5)
      await Promise.resolve()
    })

    expect(useSnapshotStore.getState().isRestoring).toBe(true)

    await act(async () => {
      await useSnapshotStore.getState().restoreSnapshot(5)
      secondCallResolved = true
    })

    // The second call must have returned immediately without a second restore.
    expect(secondCallResolved).toBe(true)
    expect(restoreFromStateMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      releaseRestore?.()
      await firstCall
    })

    expect(useSnapshotStore.getState().isRestoring).toBe(false)
  })

  it('skips the beforeRestore snapshot when the current session is empty', async () => {
    // No seedSession — no active connections.
    ipc.override('get_session_snapshot', () =>
      JSON.stringify({
        version: 1,
        connections: [{ profileId: 'p-prod', activeTabIndex: 0, tabs: [] }],
      })
    )
    act(() => {
      useConnectionStore.setState({
        closeAllConnections: vi.fn(async () => {
          useConnectionStore.setState({
            activeConnections: {},
            activeConnectionOrder: [],
            activeTabId: null,
          })
          return true
        }),
      })
    })

    const createCalls = vi.fn()
    ipc.override('create_session_snapshot', () => {
      createCalls()
      return 1
    })
    const closeConnectionSpy = vi.fn(async () => true)
    act(() => {
      useConnectionStore.setState({ closeConnection: closeConnectionSpy })
    })

    await act(async () => {
      await useSnapshotStore.getState().restoreSnapshot(5)
    })

    expect(createCalls).not.toHaveBeenCalled()
    expect(closeConnectionSpy).not.toHaveBeenCalled()
  })

  it('does not prompt via globalThis.confirm even with dirty connections (force close)', async () => {
    seedSession()
    const confirmSpy = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmSpy)

    ipc.override('get_session_snapshot', () =>
      JSON.stringify({
        version: 1,
        connections: [{ profileId: 'p-prod', activeTabIndex: 0, tabs: [] }],
      })
    )
    ipc.override('create_session_snapshot', () => 1)
    const closeConnectionSpy = vi.fn(async (sessionId: string) => {
      const state = useConnectionStore.getState()
      const activeConnections = { ...state.activeConnections }
      delete activeConnections[sessionId]
      useConnectionStore.setState({
        activeConnections,
        activeConnectionOrder: state.activeConnectionOrder.filter((id) => id !== sessionId),
        activeTabId: state.activeTabId === sessionId ? null : state.activeTabId,
      })
      return true
    })
    act(() => {
      useConnectionStore.setState({ closeConnection: closeConnectionSpy })
    })

    await act(async () => {
      await useSnapshotStore.getState().restoreSnapshot(5)
    })

    expect(closeConnectionSpy).toHaveBeenNthCalledWith(1, 'sess-prod', { force: true })
    expect(closeConnectionSpy).toHaveBeenNthCalledWith(2, 'sess-staging', { force: true })
    expect(confirmSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('aborts restore when the beforeRestore snapshot cannot be created', async () => {
    seedSession()
    ipc.override('get_session_snapshot', () =>
      JSON.stringify({
        version: 1,
        connections: [{ profileId: 'p-prod', activeTabIndex: 0, tabs: [] }],
      })
    )
    ipc.override('create_session_snapshot', () => {
      throw new Error('disk full')
    })

    const closeConnectionSpy = vi.fn(async () => true)

    act(() => {
      useConnectionStore.setState({ closeConnection: closeConnectionSpy })
    })

    await act(async () => {
      await useSnapshotStore.getState().restoreSnapshot(5)
    })

    expect(closeConnectionSpy).not.toHaveBeenCalled()
    expect(restoreFromStateMock).not.toHaveBeenCalled()
    expect(useConnectionStore.getState().activeConnections['sess-prod']).toBeDefined()
  })

  it('fails fast when a session restore is already in progress', async () => {
    seedSession()
    const createSnapshotSpy = vi.fn(() => 1)
    const getSnapshotSpy = vi.fn(() =>
      JSON.stringify({
        version: 1,
        connections: [{ profileId: 'p-prod', activeTabIndex: 0, tabs: [] }],
      })
    )
    const closeConnectionSpy = vi.fn(async () => true)
    const logFrontendSpy = vi.fn((_args: unknown) => undefined)

    ipc.override('create_session_snapshot', createSnapshotSpy)
    ipc.override('get_session_snapshot', getSnapshotSpy)
    ipc.override('log_frontend', (args) => {
      logFrontendSpy(args)
      return undefined
    })

    act(() => {
      useSessionRestoreStore.setState({ isRestoring: true })
      useConnectionStore.setState({ closeConnection: closeConnectionSpy })
    })

    await act(async () => {
      await useSnapshotStore.getState().restoreSnapshot(5)
    })

    expect(getSnapshotSpy).not.toHaveBeenCalled()
    expect(createSnapshotSpy).not.toHaveBeenCalled()
    expect(closeConnectionSpy).not.toHaveBeenCalled()
    expect(restoreFromStateMock).not.toHaveBeenCalled()
    expect(logFrontendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        message: '[snapshot] Restore blocked while session restore is already in progress.',
      })
    )
    expect(useToastStore.getState().toasts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variant: 'error',
          title: 'Restore failed',
          message: 'Session restore is already in progress. Please wait and try again.',
        }),
      ])
    )
    expect(useSnapshotStore.getState().isBusy).toBe(false)
  })

  it('recovers already-closed connections when force-closing fails mid-restore', async () => {
    seedSession()
    ipc.override('get_session_snapshot', () =>
      JSON.stringify({
        version: 1,
        connections: [{ profileId: 'p-prod', activeTabIndex: 0, tabs: [] }],
      })
    )
    ipc.override('create_session_snapshot', () => 1)

    const closeConnectionSpy = vi.fn(async (sessionId: string) => {
      if (sessionId === 'sess-prod') {
        const state = useConnectionStore.getState()
        const activeConnections = { ...state.activeConnections }
        delete activeConnections[sessionId]
        useConnectionStore.setState({
          activeConnections,
          activeConnectionOrder: state.activeConnectionOrder.filter((id) => id !== sessionId),
          activeTabId: 'sess-staging',
        })
        return true
      }

      return false
    })

    restoreFromStateMock.mockImplementation(async (state) => {
      const recoveryState = state as { connections: Array<{ profileId: string }> }
      const existingConnections = useConnectionStore.getState().activeConnections
      useConnectionStore.setState({
        activeConnections: {
          ...existingConnections,
          'sess-prod-recovered': makeActive('sess-prod-recovered', makeProfile('p-prod', 'ProdDB')),
        },
        activeConnectionOrder: ['sess-prod-recovered', 'sess-staging'],
        activeTabId: 'sess-prod-recovered',
      })
      expect(recoveryState.connections).toEqual([expect.objectContaining({ profileId: 'p-prod' })])
    })

    act(() => {
      useConnectionStore.setState({ closeConnection: closeConnectionSpy })
    })

    await act(async () => {
      await useSnapshotStore.getState().restoreSnapshot(5)
    })

    expect(closeConnectionSpy).toHaveBeenNthCalledWith(1, 'sess-prod', { force: true })
    expect(closeConnectionSpy).toHaveBeenNthCalledWith(2, 'sess-staging', { force: true })
    expect(restoreFromStateMock).toHaveBeenCalledTimes(1)
    expect(useConnectionStore.getState().activeConnections['sess-staging']).toBeDefined()
    expect(useConnectionStore.getState().activeConnections['sess-prod-recovered']).toBeDefined()
    expect(useConnectionStore.getState().activeConnectionOrder).toEqual([
      'sess-prod-recovered',
      'sess-staging',
    ])
  })

  it('fetches the target state before any create/prune (independent of list state)', async () => {
    seedSession()
    const seq: string[] = []
    ipc.override('get_session_snapshot', () => {
      seq.push('get')
      return JSON.stringify({
        version: 1,
        connections: [{ profileId: 'p-prod', activeTabIndex: 0, tabs: [] }],
      })
    })
    ipc.override('create_session_snapshot', () => {
      seq.push('create')
      return 7
    })
    const closeConnectionSpy = vi.fn(async (sessionId: string) => {
      const state = useConnectionStore.getState()
      const activeConnections = { ...state.activeConnections }
      delete activeConnections[sessionId]
      useConnectionStore.setState({
        activeConnections,
        activeConnectionOrder: state.activeConnectionOrder.filter((id) => id !== sessionId),
        activeTabId: state.activeTabId === sessionId ? null : state.activeTabId,
      })
      return true
    })
    act(() => {
      useConnectionStore.setState({ closeConnection: closeConnectionSpy })
    })

    await act(async () => {
      await useSnapshotStore.getState().restoreSnapshot(5)
    })

    expect(seq[0]).toBe('get')
    expect(seq.indexOf('get')).toBeLessThan(seq.indexOf('create'))
  })
})

describe('registerSnapshotScheduler', () => {
  it('does not register the periodic loop outside Tauri', () => {
    vi.useFakeTimers()
    vi.spyOn(tauriEnv, 'hasTauriApis').mockReturnValue(false)
    const runPeriodicCheckSpy = vi.fn(async () => undefined)

    act(() => {
      useSnapshotStore.setState({ runPeriodicCheck: runPeriodicCheckSpy })
    })

    registerSnapshotScheduler()
    vi.advanceTimersByTime(SNAPSHOT_CHECK_INTERVAL_MS * 2)

    expect(runPeriodicCheckSpy).not.toHaveBeenCalled()
  })
})

describe('deleteSnapshot', () => {
  it('reloads the list and clears selection when the deleted snapshot was selected', async () => {
    act(() => {
      useSnapshotStore.setState({ selectedSnapshotId: 3 })
    })
    let deleted: number | undefined
    ipc.override('delete_session_snapshot', (args) => {
      deleted = (args as { id: number }).id
      return undefined
    })
    ipc.override('list_session_snapshots', () => [])

    await act(async () => {
      await useSnapshotStore.getState().deleteSnapshot(3)
    })

    expect(deleted).toBe(3)
    expect(useSnapshotStore.getState().selectedSnapshotId).toBeNull()
  })

  it('keeps selection when a different snapshot is deleted', async () => {
    act(() => {
      useSnapshotStore.setState({ selectedSnapshotId: 9 })
    })
    ipc.override('delete_session_snapshot', () => undefined)
    ipc.override('list_session_snapshots', () => [])

    await act(async () => {
      await useSnapshotStore.getState().deleteSnapshot(3)
    })

    expect(useSnapshotStore.getState().selectedSnapshotId).toBe(9)
  })
})

describe('runPeriodicCheck — daily', () => {
  it('creates a daily snapshot only when crossing a day boundary and updates the marker', async () => {
    seedSession()
    vi.useFakeTimers()
    const now = new Date('2026-06-06T14:15:16Z')
    vi.setSystemTime(now)
    act(() => {
      useSettingsStore.setState({
        settings: { 'snapshots.frequency': 'daily', 'snapshots.keep': '10' },
        pendingChanges: {},
        isLoading: false,
        isDirty: false,
        activeSection: 'general',
      })
    })

    const yesterdayEpochSeconds = String(Math.floor((now.getTime() - 25 * 60 * 60 * 1000) / 1000))
    let setMarker: string | undefined
    ipc.override('get_setting', () => yesterdayEpochSeconds)
    ipc.override('set_setting', (args) => {
      const a = args as { key: string; value: string }
      if (a.key === 'snapshots.lastPeriodicAt') {
        setMarker = a.value
      }
      return undefined
    })
    const createCalls = vi.fn()
    ipc.override('create_session_snapshot', (args) => {
      createCalls((args as { triggerType: string }).triggerType)
      return 1
    })

    await act(async () => {
      await useSnapshotStore.getState().runPeriodicCheck()
    })

    expect(createCalls).toHaveBeenCalledWith('daily')
    expect(setMarker).toBe(String(Math.floor(now.getTime() / 1000)))
  })

  it('does NOT create a daily snapshot when the marker is within today', async () => {
    seedSession()
    vi.useFakeTimers()
    const now = new Date('2026-06-06T14:15:16Z')
    vi.setSystemTime(now)
    ipc.override('get_setting', () => String(Math.floor(now.getTime() / 1000)))
    ipc.override('set_setting', () => undefined)
    const createCalls = vi.fn()
    ipc.override('create_session_snapshot', () => {
      createCalls()
      return 1
    })

    await act(async () => {
      await useSnapshotStore.getState().runPeriodicCheck()
    })

    expect(createCalls).not.toHaveBeenCalled()
  })
})

describe('runPeriodicCheck — weekly', () => {
  it('creates a weekly snapshot only when crossing a week boundary and updates the marker', async () => {
    seedSession()
    vi.useFakeTimers()
    const now = new Date('2026-06-10T09:30:45Z')
    vi.setSystemTime(now)
    act(() => {
      useSettingsStore.setState({
        settings: { 'snapshots.frequency': 'weekly', 'snapshots.keep': '10' },
        pendingChanges: {},
        isLoading: false,
        isDirty: false,
        activeSection: 'general',
      })
    })

    const lastWeekEpochSeconds = String(
      Math.floor((now.getTime() - 8 * 24 * 60 * 60 * 1000) / 1000)
    )
    let setMarker: string | undefined
    ipc.override('get_setting', () => lastWeekEpochSeconds)
    ipc.override('set_setting', (args) => {
      const a = args as { key: string; value: string }
      if (a.key === 'snapshots.lastPeriodicAt') {
        setMarker = a.value
      }
      return undefined
    })
    const createCalls = vi.fn()
    ipc.override('create_session_snapshot', (args) => {
      createCalls((args as { triggerType: string }).triggerType)
      return 1
    })

    await act(async () => {
      await useSnapshotStore.getState().runPeriodicCheck()
    })

    expect(createCalls).toHaveBeenCalledWith('weekly')
    expect(setMarker).toBe(String(Math.floor(now.getTime() / 1000)))
  })

  it('does NOT create a weekly snapshot when the marker is within the current week', async () => {
    seedSession()
    vi.useFakeTimers()
    const now = new Date('2026-06-10T09:30:45Z')
    vi.setSystemTime(now)
    act(() => {
      useSettingsStore.setState({
        settings: { 'snapshots.frequency': 'weekly', 'snapshots.keep': '10' },
        pendingChanges: {},
        isLoading: false,
        isDirty: false,
        activeSection: 'general',
      })
    })
    ipc.override('get_setting', () => String(Math.floor(now.getTime() / 1000)))
    ipc.override('set_setting', () => undefined)
    const createCalls = vi.fn()
    ipc.override('create_session_snapshot', () => {
      createCalls()
      return 1
    })

    await act(async () => {
      await useSnapshotStore.getState().runPeriodicCheck()
    })

    expect(createCalls).not.toHaveBeenCalled()
  })
})

describe('off frequency', () => {
  beforeEach(() => {
    act(() => {
      useSettingsStore.setState({
        settings: { 'snapshots.frequency': 'off', 'snapshots.keep': '10' },
        pendingChanges: {},
        isLoading: false,
        isDirty: false,
        activeSection: 'general',
      })
    })
  })

  it('suppresses periodic snapshots', async () => {
    seedSession()
    const createCalls = vi.fn()
    ipc.override('get_setting', () => null)
    ipc.override('set_setting', () => undefined)
    ipc.override('create_session_snapshot', () => {
      createCalls()
      return 1
    })

    await act(async () => {
      await useSnapshotStore.getState().runPeriodicCheck()
    })

    expect(createCalls).not.toHaveBeenCalled()
  })

  it('suppresses on-close snapshots', async () => {
    seedSession()
    const createCalls = vi.fn()
    ipc.override('create_session_snapshot', () => {
      createCalls()
      return 1
    })

    await act(async () => {
      await useSnapshotStore.getState().handleAppClose()
    })

    expect(createCalls).not.toHaveBeenCalled()
  })
})

describe('handleAppClose', () => {
  it('creates an onClose snapshot when frequency is not off', async () => {
    seedSession()
    const createCalls = vi.fn()
    ipc.override('create_session_snapshot', (args) => {
      createCalls((args as { triggerType: string }).triggerType)
      return 1
    })

    await act(async () => {
      await useSnapshotStore.getState().handleAppClose()
    })

    expect(createCalls).toHaveBeenCalledWith('onClose')
  })
})
