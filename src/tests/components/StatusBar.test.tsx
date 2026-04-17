import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { StatusBar } from '../../components/layout/StatusBar'
import { useConnectionStore } from '../../stores/connection-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useQueryStore } from '../../stores/query-store'
import { useThemeStore } from '../../stores/theme-store'
import { useSchemaIndexStore } from '../../stores/schema-index-store'
import type { ActiveConnection, SavedConnection } from '../../types/connection'
import type { WorkspaceTab } from '../../types/schema'
import { makeTabState } from '../helpers/query-test-utils'

function makeSavedConnection(overrides: Partial<SavedConnection> = {}): SavedConnection {
  return {
    id: 'conn-1',
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

function setupActiveConnection() {
  const conn = makeActiveConnection()
  useConnectionStore.setState({
    activeConnections: { 'conn-1': conn },
    activeTabId: 'conn-1',
  })
}

beforeEach(() => {
  useConnectionStore.setState({
    activeConnections: {},
    activeTabId: null,
    dialogOpen: false,
    error: null,
  })
  useWorkspaceStore.setState({
    tabsByConnection: {},
    activeTabByConnection: {},
  })
  useQueryStore.setState({ tabs: {} })
  useSchemaIndexStore.setState({
    connections: {},
    profileToSessions: {},
    sessionToProfile: {},
  })
})

describe('StatusBar', () => {
  it('renders the Ready status text when no connections', () => {
    render(<StatusBar />)
    expect(screen.getByText('Ready')).toBeInTheDocument()
  })

  it('shows connection name and host:port when connection is active', () => {
    const conn = makeActiveConnection()
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    render(<StatusBar />)

    expect(screen.queryByText('Ready')).not.toBeInTheDocument()
    expect(screen.getByText(/Test DB/)).toBeInTheDocument()
    expect(screen.getByText(/127\.0\.0\.1/)).toBeInTheDocument()
    expect(screen.getByText(/3306/)).toBeInTheDocument()
  })

  it('shows correct status text for connected state', () => {
    const conn = makeActiveConnection({ status: 'connected' })
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    render(<StatusBar />)
    expect(screen.getByText('Connected')).toBeInTheDocument()
  })

  it('shows correct status text for reconnecting state', () => {
    const conn = makeActiveConnection({ status: 'reconnecting' })
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    render(<StatusBar />)
    expect(screen.getByText('Reconnecting...')).toBeInTheDocument()
  })

  it('shows correct status text for disconnected state', () => {
    const conn = makeActiveConnection({ status: 'disconnected' })
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    render(<StatusBar />)
    expect(screen.getByText('Disconnected')).toBeInTheDocument()
  })

  it('shows status dot with correct aria label', () => {
    const conn = makeActiveConnection({ status: 'connected' })
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    render(<StatusBar />)
    const dot = screen.getByTestId('status-dot')
    expect(dot).toBeInTheDocument()
    expect(dot).toHaveAttribute('aria-label', 'Status: connected')
  })

  it('shows server version', () => {
    const conn = makeActiveConnection({ serverVersion: '8.0.35' })
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    render(<StatusBar />)
    expect(screen.getByText('8.0.35')).toBeInTheDocument()
  })

  describe('query info', () => {
    const successQueryState = makeTabState({
      content: 'SELECT * FROM users',
      status: 'success',
      totalRows: 42,
      executionTimeMs: 150,
      queryId: 'q1',
    })

    function setupQueryEditorTab() {
      const conn = makeActiveConnection()
      useConnectionStore.setState({
        activeConnections: { 'conn-1': conn },
        activeTabId: 'conn-1',
      })
      useWorkspaceStore.setState({
        tabsByConnection: {
          'conn-1': [
            {
              id: 'tab-1',
              type: 'query-editor',
              label: 'Query 1',
              connectionId: 'conn-1',
            } as WorkspaceTab,
          ],
        },
        activeTabByConnection: { 'conn-1': 'tab-1' },
      })
    }

    it('shows row count and execution time in dark theme when query-editor has success status', () => {
      useThemeStore.setState({ resolvedTheme: 'dark' })
      setupQueryEditorTab()
      useQueryStore.setState({ tabs: { 'tab-1': successQueryState } })

      render(<StatusBar />)

      expect(screen.getByTestId('query-info')).toBeInTheDocument()
      expect(screen.getByTestId('query-rows')).toHaveTextContent('Rows: 42')
      expect(screen.getByTestId('query-time')).toHaveTextContent('150ms')
    })

    it('shows uppercase query info in light theme when query-editor has success status', () => {
      useThemeStore.setState({ resolvedTheme: 'light' })
      setupQueryEditorTab()
      useQueryStore.setState({ tabs: { 'tab-1': successQueryState } })

      render(<StatusBar />)

      expect(screen.getByTestId('query-info')).toBeInTheDocument()
      expect(screen.getByTestId('query-time')).toHaveTextContent('QUERY: 150ms')
      expect(screen.getByTestId('query-rows')).toHaveTextContent('ROWS: 42')
    })

    it('does not show query info when active tab is not query-editor', () => {
      const conn = makeActiveConnection()
      useConnectionStore.setState({
        activeConnections: { 'conn-1': conn },
        activeTabId: 'conn-1',
      })
      useWorkspaceStore.setState({
        tabsByConnection: {
          'conn-1': [
            {
              id: 'tab-1',
              type: 'schema-info',
              label: 'mydb.users',
              connectionId: 'conn-1',
              databaseName: 'mydb',
              objectName: 'users',
              objectType: 'table',
            } as WorkspaceTab,
          ],
        },
        activeTabByConnection: { 'conn-1': 'tab-1' },
      })

      render(<StatusBar />)
      expect(screen.queryByTestId('query-info')).not.toBeInTheDocument()
    })

    it('does not show query info when query status is idle', () => {
      setupQueryEditorTab()
      useQueryStore.setState({
        tabs: {
          'tab-1': makeTabState({
            content: 'SELECT * FROM users',
            status: 'idle',
          }),
        },
      })

      render(<StatusBar />)
      expect(screen.queryByTestId('query-info')).not.toBeInTheDocument()
    })

    it('does not show query info when query status is running', () => {
      setupQueryEditorTab()
      useQueryStore.setState({
        tabs: {
          'tab-1': makeTabState({
            content: 'SELECT * FROM users',
            status: 'running',
          }),
        },
      })

      render(<StatusBar />)
      expect(screen.queryByTestId('query-info')).not.toBeInTheDocument()
    })

    it('shows running indicator when query status is running', () => {
      setupQueryEditorTab()
      useQueryStore.setState({
        tabs: {
          'tab-1': makeTabState({
            content: 'SELECT * FROM users',
            status: 'running',
            executionStartedAt: Date.now(),
          }),
        },
      })

      render(<StatusBar />)
      expect(screen.getByTestId('query-running-info')).toBeInTheDocument()
      expect(screen.getByText('Running...')).toBeInTheDocument()
      // Ensure query info is NOT shown simultaneously
      expect(screen.queryByTestId('query-info')).not.toBeInTheDocument()
    })

    it('does not show running indicator when query status is success', () => {
      setupQueryEditorTab()
      useQueryStore.setState({ tabs: { 'tab-1': successQueryState } })

      render(<StatusBar />)
      expect(screen.queryByTestId('query-running-info')).not.toBeInTheDocument()
      expect(screen.getByTestId('query-info')).toBeInTheDocument()
    })

    it('does not show running indicator when active tab is not query-editor', () => {
      const conn = makeActiveConnection()
      useConnectionStore.setState({
        activeConnections: { 'conn-1': conn },
        activeTabId: 'conn-1',
      })
      useWorkspaceStore.setState({
        tabsByConnection: {
          'conn-1': [
            {
              id: 'tab-1',
              type: 'schema-info',
              label: 'mydb.users',
              connectionId: 'conn-1',
              databaseName: 'mydb',
              objectName: 'users',
              objectType: 'table',
            } as WorkspaceTab,
          ],
        },
        activeTabByConnection: { 'conn-1': 'tab-1' },
      })
      useQueryStore.setState({
        tabs: {
          'tab-1': makeTabState({
            content: 'SELECT * FROM users',
            status: 'running',
            executionStartedAt: Date.now(),
          }),
        },
      })

      render(<StatusBar />)
      expect(screen.queryByTestId('query-running-info')).not.toBeInTheDocument()
    })

    it('does not show query info when query status is error', () => {
      setupQueryEditorTab()
      useQueryStore.setState({
        tabs: {
          'tab-1': makeTabState({
            content: 'SELECT * FROM users',
            status: 'error',
            errorMessage: 'Syntax error near...',
          }),
        },
      })

      render(<StatusBar />)
      expect(screen.queryByTestId('query-info')).not.toBeInTheDocument()
    })

    it('does not show query info when no workspace tab exists', () => {
      const conn = makeActiveConnection()
      useConnectionStore.setState({
        activeConnections: { 'conn-1': conn },
        activeTabId: 'conn-1',
      })
      // No workspace tabs at all
      useWorkspaceStore.setState({
        tabsByConnection: {},
        activeTabByConnection: {},
      })

      render(<StatusBar />)
      expect(screen.queryByTestId('query-info')).not.toBeInTheDocument()
    })
  })

  describe('schema indexing indicator', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('shows indexing indicator with correct table counts when status is building', () => {
      useThemeStore.setState({ resolvedTheme: 'dark' })
      setupActiveConnection()
      useSchemaIndexStore.setState({
        connections: {
          'conn-1': {
            status: 'building',
            phase: 'embedding',
            tablesDone: 3,
            tablesTotal: 10,
            lastBuildTimestamp: 0,
          },
        },
      })

      render(<StatusBar />)

      expect(screen.getByTestId('indexing-indicator')).toBeInTheDocument()
      expect(screen.getByTestId('indexing-text')).toHaveTextContent('Indexing 3/10')
    })

    it('shows uppercase indexing text in light theme', () => {
      useThemeStore.setState({ resolvedTheme: 'light' })
      setupActiveConnection()
      useSchemaIndexStore.setState({
        connections: {
          'conn-1': {
            status: 'building',
            phase: 'embedding',
            tablesDone: 5,
            tablesTotal: 20,
            lastBuildTimestamp: 0,
          },
        },
      })

      render(<StatusBar />)

      expect(screen.getByTestId('indexing-text')).toHaveTextContent('INDEXING: 5/20 TABLES')
    })

    it('shows "Reading schema..." during loading_schema phase with no tables yet (dark)', () => {
      useThemeStore.setState({ resolvedTheme: 'dark' })
      setupActiveConnection()
      useSchemaIndexStore.setState({
        connections: {
          'conn-1': {
            status: 'building',
            phase: 'loading_schema',
            tablesDone: 0,
            tablesTotal: 0,
            lastBuildTimestamp: 0,
          },
        },
      })

      render(<StatusBar />)

      expect(screen.getByTestId('indexing-text')).toHaveTextContent('Reading schema...')
    })

    it('shows table count during loading_schema phase when tablesDone > 0', () => {
      useThemeStore.setState({ resolvedTheme: 'dark' })
      setupActiveConnection()
      useSchemaIndexStore.setState({
        connections: {
          'conn-1': {
            status: 'building',
            phase: 'loading_schema',
            tablesDone: 12,
            tablesTotal: 0,
            lastBuildTimestamp: 0,
          },
        },
      })

      render(<StatusBar />)

      expect(screen.getByTestId('indexing-text')).toHaveTextContent('Reading schema (12 tables)...')
    })

    it('shows count-based finalizing indicator after embedding table progress reaches completion', () => {
      useThemeStore.setState({ resolvedTheme: 'dark' })
      setupActiveConnection()
      useSchemaIndexStore.setState({
        connections: {
          'conn-1': {
            status: 'building',
            phase: 'finalizing',
            tablesDone: 20,
            tablesTotal: 20,
            lastBuildTimestamp: 0,
          },
        },
      })

      render(<StatusBar />)

      const indicator = screen.getByTestId('indexing-indicator')
      expect(screen.getByTestId('indexing-text')).toHaveTextContent('Finalizing 20/20')
      expect(indicator).toHaveAttribute('role', 'progressbar')
      expect(indicator).toHaveAttribute('aria-valuenow', '20')
      expect(indicator).toHaveAttribute('aria-valuemax', '20')
    })

    it('shows "Preparing index..." when phase is null (build just started)', () => {
      useThemeStore.setState({ resolvedTheme: 'dark' })
      setupActiveConnection()
      useSchemaIndexStore.setState({
        connections: {
          'conn-1': {
            status: 'building',
            phase: null,
            tablesDone: 0,
            tablesTotal: 0,
            lastBuildTimestamp: 0,
          },
        },
      })

      render(<StatusBar />)

      expect(screen.getByTestId('indexing-text')).toHaveTextContent('Reading schema...')
    })

    it('uses role="status" (not "progressbar") during loading_schema phase', () => {
      setupActiveConnection()
      useSchemaIndexStore.setState({
        connections: {
          'conn-1': {
            status: 'building',
            phase: 'loading_schema',
            tablesDone: 4,
            tablesTotal: 0,
            lastBuildTimestamp: 0,
          },
        },
      })

      render(<StatusBar />)

      const indicator = screen.getByTestId('indexing-indicator')
      expect(indicator).toHaveAttribute('role', 'status')
      expect(indicator).not.toHaveAttribute('aria-valuenow')
    })

    it('shows completion flash when status transitions to ready', () => {
      vi.useFakeTimers()
      setupActiveConnection()
      useSchemaIndexStore.setState({
        connections: {
          'conn-1': {
            status: 'building',
            phase: 'embedding',
            tablesDone: 10,
            tablesTotal: 10,
            lastBuildTimestamp: 0,
          },
        },
      })

      const { rerender } = render(<StatusBar />)

      expect(screen.getByTestId('indexing-indicator')).toBeInTheDocument()

      // Transition to ready
      act(() => {
        useSchemaIndexStore.setState({
          connections: {
            'conn-1': {
              status: 'ready',
              phase: null,
              tablesDone: 10,
              tablesTotal: 10,
              lastBuildTimestamp: Date.now(),
            },
          },
        })
      })

      rerender(<StatusBar />)

      expect(screen.getByTestId('indexing-ready')).toBeInTheDocument()
      expect(screen.queryByTestId('indexing-indicator')).not.toBeInTheDocument()
    })

    it('completion flash disappears after 2 seconds', () => {
      vi.useFakeTimers()
      setupActiveConnection()
      useSchemaIndexStore.setState({
        connections: {
          'conn-1': {
            status: 'building',
            phase: 'embedding',
            tablesDone: 10,
            tablesTotal: 10,
            lastBuildTimestamp: 0,
          },
        },
      })

      render(<StatusBar />)

      // Transition to ready
      act(() => {
        useSchemaIndexStore.setState({
          connections: {
            'conn-1': {
              status: 'ready',
              phase: null,
              tablesDone: 10,
              tablesTotal: 10,
              lastBuildTimestamp: Date.now(),
            },
          },
        })
      })

      expect(screen.getByTestId('indexing-ready')).toBeInTheDocument()

      // Advance past the 2s flash duration + 500ms fade
      act(() => {
        vi.advanceTimersByTime(2501)
      })

      expect(screen.queryByTestId('indexing-ready')).not.toBeInTheDocument()
    })

    it('shows error flash when status transitions to error', () => {
      vi.useFakeTimers()
      setupActiveConnection()
      useSchemaIndexStore.setState({
        connections: {
          'conn-1': {
            status: 'building',
            phase: 'embedding',
            tablesDone: 5,
            tablesTotal: 10,
            lastBuildTimestamp: 0,
          },
        },
      })

      const { rerender } = render(<StatusBar />)

      // Transition to error
      act(() => {
        useSchemaIndexStore.setState({
          connections: {
            'conn-1': {
              status: 'error',
              phase: null,
              tablesDone: 5,
              tablesTotal: 10,
              lastBuildTimestamp: 0,
              error: 'Connection lost',
            },
          },
        })
      })

      rerender(<StatusBar />)

      expect(screen.getByTestId('indexing-error')).toBeInTheDocument()
      expect(screen.queryByTestId('indexing-indicator')).not.toBeInTheDocument()
    })

    it('error flash disappears after 3 seconds', () => {
      vi.useFakeTimers()
      setupActiveConnection()
      useSchemaIndexStore.setState({
        connections: {
          'conn-1': {
            status: 'building',
            phase: 'embedding',
            tablesDone: 5,
            tablesTotal: 10,
            lastBuildTimestamp: 0,
          },
        },
      })

      render(<StatusBar />)

      // Transition to error
      act(() => {
        useSchemaIndexStore.setState({
          connections: {
            'conn-1': {
              status: 'error',
              phase: null,
              tablesDone: 5,
              tablesTotal: 10,
              lastBuildTimestamp: 0,
              error: 'Failed',
            },
          },
        })
      })

      expect(screen.getByTestId('indexing-error')).toBeInTheDocument()

      // Advance past the 3s flash duration + 500ms fade
      act(() => {
        vi.advanceTimersByTime(3501)
      })

      expect(screen.queryByTestId('indexing-error')).not.toBeInTheDocument()
    })

    it('does not show any indicator when status is not_configured', () => {
      setupActiveConnection()
      useSchemaIndexStore.setState({
        connections: {
          'conn-1': {
            status: 'not_configured',
            phase: null,
            tablesDone: 0,
            tablesTotal: 0,
            lastBuildTimestamp: 0,
          },
        },
      })

      render(<StatusBar />)

      expect(screen.queryByTestId('indexing-indicator')).not.toBeInTheDocument()
      expect(screen.queryByTestId('indexing-ready')).not.toBeInTheDocument()
      expect(screen.queryByTestId('indexing-error')).not.toBeInTheDocument()
    })

    it('does not show any indicator when no index state exists', () => {
      setupActiveConnection()
      // No entry in connections for 'conn-1'
      useSchemaIndexStore.setState({ connections: {} })

      render(<StatusBar />)

      expect(screen.queryByTestId('indexing-indicator')).not.toBeInTheDocument()
      expect(screen.queryByTestId('indexing-ready')).not.toBeInTheDocument()
      expect(screen.queryByTestId('indexing-error')).not.toBeInTheDocument()
    })

    it('has correct ARIA attributes when building', () => {
      setupActiveConnection()
      useSchemaIndexStore.setState({
        connections: {
          'conn-1': {
            status: 'building',
            phase: 'embedding',
            tablesDone: 7,
            tablesTotal: 15,
            lastBuildTimestamp: 0,
          },
        },
      })

      render(<StatusBar />)

      const indicator = screen.getByTestId('indexing-indicator')
      expect(indicator).toHaveAttribute('role', 'progressbar')
      expect(indicator).toHaveAttribute('aria-valuenow', '7')
      expect(indicator).toHaveAttribute('aria-valuemin', '0')
      expect(indicator).toHaveAttribute('aria-valuemax', '15')
      expect(indicator).toHaveAttribute(
        'aria-valuetext',
        'Schema indexing progress: 7 of 15'
      )
    })

    it('has aria-live="polite" region', () => {
      setupActiveConnection()
      useSchemaIndexStore.setState({
        connections: {
          'conn-1': {
            status: 'building',
            phase: 'embedding',
            tablesDone: 1,
            tablesTotal: 5,
            lastBuildTimestamp: 0,
          },
        },
      })

      render(<StatusBar />)

      const liveRegion = screen.getByTestId('indexing-indicator').parentElement
      expect(liveRegion).toHaveAttribute('aria-live', 'polite')
    })
  })
})
