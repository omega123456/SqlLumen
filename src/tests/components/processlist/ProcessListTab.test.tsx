import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import ProcessListTab from '../../../components/processlist/ProcessListTab'
import { useProcessListStore } from '../../../stores/processlist-store'
import { useConnectionStore } from '../../../stores/connection-store'
import type { ActiveConnection, SavedConnection } from '../../../types/connection'

// Mock DataGrid
vi.mock('../../../components/shared/DataGrid', async () => {
  const React = await import('react')
  return {
    DataGrid: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      React.useImperativeHandle(ref, () => ({ selectCell: vi.fn() }))
      return React.createElement('div', { 'data-testid': props['data-testid'] }, 'grid')
    }),
  }
})

function makeSavedConnection(overrides: Partial<SavedConnection> = {}): SavedConnection {
  return {
    id: 'profile-1',
    name: 'Test DB',
    host: '127.0.0.1',
    port: 3306,
    username: 'root',
    hasPassword: true,
    defaultDatabase: null,
    sslEnabled: false,
    sslCaPath: null,
    sslCertPath: null,
    sslKeyPath: null,
    color: '#3b82f6',
    groupId: null,
    readOnly: false,
    sortOrder: 0,
    connectTimeoutSecs: 10,
    keepaliveIntervalSecs: 30,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

const MOCK_ROWS = [
  {
    id: 1,
    user: 'root',
    host: 'localhost',
    db: 'testdb',
    command: 'Query',
    time: 5,
    state: 'executing',
    info: 'SELECT 1',
  },
  {
    id: 2,
    user: 'app',
    host: '10.0.0.1',
    db: null,
    command: 'Sleep',
    time: 100,
    state: '',
    info: null,
  },
]

function setupStore() {
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
    hasFetchedByConnection: { 'conn-1': true },
  })

  const conn: ActiveConnection = {
    id: 'conn-1',
    profile: makeSavedConnection(),
    status: 'connected',
    serverVersion: '8.0.35',
  }
  useConnectionStore.setState({
    activeConnections: { 'conn-1': conn },
    activeTabId: 'conn-1',
  })
}

describe('ProcessListTab', () => {
  beforeEach(() => {
    mockIPC((cmd) => {
      if (cmd === 'log_frontend') return undefined
      if (cmd === 'get_processlist') return MOCK_ROWS
      if (cmd === 'kill_queries') return []
      throw new Error(`[vitest] Unmocked Tauri IPC command: ${cmd}`)
    })
    setupStore()
  })

  it('renders toolbar and grid', async () => {
    render(<ProcessListTab connectionId="conn-1" sessionId="conn-1" isActive={true} />)
    expect(screen.getByTestId('processlist-tab')).toBeInTheDocument()
    expect(screen.getByTestId('processlist-toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('processlist-grid')).toBeInTheDocument()
  })

  it('fetches process list on first activation', async () => {
    useProcessListStore.setState({
      hasFetchedByConnection: { 'conn-1': false },
    })
    render(<ProcessListTab connectionId="conn-1" sessionId="conn-1" isActive={true} />)
    await waitFor(() => {
      const rows = useProcessListStore.getState().rowsByConnection['conn-1']
      expect(rows).toBeDefined()
      expect(rows?.length).toBe(2)
    })
  })

  it('does not fetch when not active', () => {
    render(<ProcessListTab connectionId="conn-1" sessionId="conn-1" isActive={false} />)
    expect(useProcessListStore.getState().rowsByConnection['conn-1']).toBeUndefined()
  })

  it('sets up auto-refresh interval', async () => {
    vi.useFakeTimers()
    try {
      useProcessListStore.setState({
        refreshIntervalMsByConnection: { 'conn-1': 2000 },
        // Pre-populate rows so we don't depend on async fetch
        rowsByConnection: { 'conn-1': MOCK_ROWS },
        lastRefreshedAtByConnection: { 'conn-1': Date.now() },
        hasFetchedByConnection: { 'conn-1': false },
      })

      const fetchSpy = vi.fn()
      useProcessListStore.setState({ fetchProcessList: fetchSpy })

      render(<ProcessListTab connectionId="conn-1" sessionId="conn-1" isActive={true} />)

      // Initial auto-initiated fetch
      expect(fetchSpy).toHaveBeenCalledWith('conn-1', 'conn-1', false)
      fetchSpy.mockClear()

      // Advance past interval
      act(() => {
        vi.advanceTimersByTime(2100)
      })

      expect(fetchSpy).toHaveBeenCalledWith('conn-1', 'conn-1', false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('pauses auto-refresh when confirm dialog is open', async () => {
    vi.useFakeTimers()
    try {
      useProcessListStore.setState({
        refreshIntervalMsByConnection: { 'conn-1': 1000 },
        isConfirmDialogOpenByConnection: { 'conn-1': true },
        rowsByConnection: { 'conn-1': MOCK_ROWS },
        lastRefreshedAtByConnection: { 'conn-1': Date.now() },
        hasFetchedByConnection: { 'conn-1': false },
      })

      const fetchSpy = vi.fn()
      useProcessListStore.setState({ fetchProcessList: fetchSpy })

      render(<ProcessListTab connectionId="conn-1" sessionId="conn-1" isActive={true} />)

      // Initial manual fetch
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      fetchSpy.mockClear()

      // Advance past interval - should NOT auto-refresh
      act(() => {
        vi.advanceTimersByTime(2000)
      })

      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
