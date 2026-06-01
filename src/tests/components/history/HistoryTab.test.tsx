import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HistoryTab } from '../../../components/history/HistoryTab'
import { useConnectionStore } from '../../../stores/connection-store'
import { useHistoryStore } from '../../../stores/history-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { resetWorkspaceStore } from '../../helpers/workspace-test-utils'
import { useQueryStore } from '../../../stores/query-store'
import type { ActiveConnection, SavedConnection } from '../../../types/connection'
import type { HistoryTab as HistoryTabType, HistoryEntry } from '../../../types/schema'

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

function makeActiveConnection(overrides: Partial<ActiveConnection> = {}): ActiveConnection {
  return {
    id: 'conn-1',
    profile: makeSavedConnection(),
    status: 'connected',
    serverVersion: '8.0.35',
    ...overrides,
  }
}

function makeHistoryEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 1,
    connectionId: 'conn-1',
    databaseName: 'testdb',
    sqlText: 'SELECT * FROM users',
    timestamp: new Date().toISOString(),
    durationMs: 42,
    rowCount: 10,
    affectedRows: 0,
    success: true,
    errorMessage: null,
    ...overrides,
  }
}

const TAB: HistoryTabType = {
  id: 'tab-1',
  type: 'history',
  label: 'History',
  connectionId: 'conn-1',
}

beforeEach(() => {
  useHistoryStore.setState({
    entriesByConnection: {},
    totalByConnection: {},
    pageByConnection: {},
    searchByConnection: {},
    sinceByConnection: {},
    isLoadingByConnection: {},
    isLoadingMoreByConnection: {},
    errorByConnection: {},
    pageSize: 50,
  })
  useConnectionStore.setState({
    activeConnections: {},
    activeTabId: null,
    dialogOpen: false,
    error: null,
  })
  resetWorkspaceStore({ visibleConnectionSessionId: 'conn-1' })
  useQueryStore.setState({ tabs: {} })
  vi.clearAllMocks()
})

describe('HistoryTab', () => {
  it('shows "No active connection" when connection is absent', () => {
    render(<HistoryTab tab={TAB} />)
    expect(screen.getByText('No active connection')).toBeInTheDocument()
    expect(screen.getByTestId('history-tab')).toBeInTheDocument()
  })

  it('renders filter panel, table, and detail panel when connected', async () => {
    const conn = makeActiveConnection()
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    render(<HistoryTab tab={TAB} />)

    await waitFor(() => {
      expect(screen.getByTestId('history-filter-panel')).toBeInTheDocument()
      expect(screen.getByTestId('history-table')).toBeInTheDocument()
      expect(screen.getByTestId('history-detail-panel')).toBeInTheDocument()
    })
  })

  it('loads history on mount with no time-range cutoff', async () => {
    const conn = makeActiveConnection()
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    const loadHistorySpy = vi.fn()
    useHistoryStore.setState({ loadHistory: loadHistorySpy })

    render(<HistoryTab tab={TAB} />)

    await waitFor(() => {
      expect(loadHistorySpy).toHaveBeenCalledWith('conn-1', { page: 1, since: null })
    })
  })

  it('does not load history while the tab is inactive', async () => {
    const conn = makeActiveConnection()
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    const loadHistorySpy = vi.fn()
    useHistoryStore.setState({ loadHistory: loadHistorySpy })

    const { rerender } = render(<HistoryTab tab={TAB} isActive={false} />)

    // Nothing requested while hidden.
    expect(loadHistorySpy).not.toHaveBeenCalled()

    // Becoming active refreshes (covers the "open the tab" auto-refresh).
    rerender(<HistoryTab tab={TAB} isActive />)
    await waitFor(() => {
      expect(loadHistorySpy).toHaveBeenCalledWith('conn-1', { page: 1, since: null })
    })
  })

  it('changing the time range reloads with the matching cutoff', async () => {
    const user = userEvent.setup()
    const conn = makeActiveConnection()
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    const loadHistorySpy = vi.fn()
    useHistoryStore.setState({ loadHistory: loadHistorySpy })

    render(<HistoryTab tab={TAB} />)

    await waitFor(() => {
      expect(loadHistorySpy).toHaveBeenCalledWith('conn-1', { page: 1, since: null })
    })

    // Switch to "Past 24h" — backend reload requested with a ~24h cutoff.
    await user.click(screen.getByTestId('filter-24h'))

    await waitFor(() => {
      const calls = loadHistorySpy.mock.calls
      const lastCall = calls[calls.length - 1]
      expect(lastCall?.[0]).toBe('conn-1')
      expect(lastCall?.[1].page).toBe(1)
      const since = lastCall?.[1].since as string
      const ageMs = Date.now() - new Date(since).getTime()
      // Within a small tolerance of 24 hours.
      expect(ageMs).toBeGreaterThan(23 * 60 * 60 * 1000)
      expect(ageMs).toBeLessThan(25 * 60 * 60 * 1000)
    })
  })

  it('clicking a row selects it and shows detail', async () => {
    const user = userEvent.setup()
    const conn = makeActiveConnection()
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    const entry = makeHistoryEntry({
      id: 1,
      sqlText: 'SELECT * FROM users',
      durationMs: 42,
      success: true,
    })

    // Mock loadHistory so the on-activation refresh does not replace the
    // pre-seeded rows with the empty default IPC fixture.
    useHistoryStore.setState({
      entriesByConnection: { 'conn-1': [entry] },
      totalByConnection: { 'conn-1': 1 },
      loadHistory: vi.fn(),
    })

    render(<HistoryTab tab={TAB} />)

    // Detail shows empty state
    await waitFor(() => {
      expect(screen.getByTestId('history-detail-empty')).toBeInTheDocument()
    })

    // Click the row
    await user.click(screen.getByTestId('history-table-row-1'))

    // Detail should now show entry data
    await waitFor(() => {
      expect(screen.queryByTestId('history-detail-empty')).not.toBeInTheDocument()
      // SQL appears in both the table row and the detail panel
      const sqlMatches = screen.getAllByText('SELECT * FROM users')
      expect(sqlMatches.length).toBeGreaterThanOrEqual(2) // table row + code panel
      expect(screen.getByText('42ms')).toBeInTheDocument()
    })
  })

  it('"Open in Editor" opens a query tab pre-filled with SQL text', async () => {
    const user = userEvent.setup()
    const conn = makeActiveConnection()
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    const entry = makeHistoryEntry({
      id: 1,
      sqlText: 'SELECT * FROM orders',
    })

    useHistoryStore.setState({
      entriesByConnection: { 'conn-1': [entry] },
      totalByConnection: { 'conn-1': 1 },
      loadHistory: vi.fn(),
    })

    render(<HistoryTab tab={TAB} />)

    // Select the row first
    await user.click(screen.getByTestId('history-table-row-1'))

    // Click "Open in Editor"
    await waitFor(() => {
      expect(screen.getByTestId('history-open-in-editor')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('history-open-in-editor'))

    // Should have created a workspace tab
    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    expect(tabs).toHaveLength(1)
    expect(tabs[0].type).toBe('query-editor')
    expect(tabs[0].label).toBe('History Query')

    // Should have set content in query store
    const queryTab = useQueryStore.getState().tabs[tabs[0].id]
    expect(queryTab?.content).toBe('SELECT * FROM orders')
  })

  it('shows loading state when loading with no entries', async () => {
    const conn = makeActiveConnection()
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    useHistoryStore.setState({
      isLoadingByConnection: { 'conn-1': true },
      entriesByConnection: {},
      loadHistory: vi.fn(),
    })

    render(<HistoryTab tab={TAB} />)

    await waitFor(() => {
      expect(screen.getByTestId('history-loading')).toBeInTheDocument()
      expect(screen.getByText('Loading history...')).toBeInTheDocument()
    })
  })

  it('shows error state with retry button', async () => {
    const user = userEvent.setup()
    const conn = makeActiveConnection()
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    const loadHistorySpy = vi.fn()
    useHistoryStore.setState({
      errorByConnection: { 'conn-1': 'Failed to load history' },
      loadHistory: loadHistorySpy,
    })

    render(<HistoryTab tab={TAB} />)

    await waitFor(() => {
      expect(screen.getByTestId('history-error')).toBeInTheDocument()
      expect(screen.getByText('Failed to load history')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('history-retry'))
    expect(loadHistorySpy).toHaveBeenCalledWith('conn-1', { page: 1, since: null })
  })
})
