import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBar } from '../../components/layout/StatusBar'
import { useConnectionStore } from '../../stores/connection-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useQueryStore } from '../../stores/query-store'
import { useThemeStore } from '../../stores/theme-store'
import type { ActiveConnection, SavedConnection } from '../../types/connection'
import type { WorkspaceTab } from '../../types/schema'
import type { TabQueryState } from '../../stores/query-store'

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
    const successQueryState: TabQueryState = {
      content: 'SELECT * FROM users',
      filePath: null,
      status: 'success',
      columns: [],
      rows: [],
      totalRows: 42,
      executionTimeMs: 150,
      affectedRows: 0,
      queryId: 'q1',
      currentPage: 1,
      totalPages: 1,
      pageSize: 1000,
      autoLimitApplied: false,
      errorMessage: null,
      cursorPosition: null,
      viewMode: 'grid',
      sortColumn: null,
      sortDirection: null,
      selectedRowIndex: null,
      exportDialogOpen: false,
      lastExecutedSql: null,
      editMode: null,
      editTableMetadata: {},
      editState: null,
      isAnalyzingQuery: false,
      editableColumnMap: new Map(),
      editColumnBindings: new Map(),
      editBoundColumnIndexMap: new Map(),
      pendingNavigationAction: null,
      saveError: null,
      editConnectionId: null,
      editingRowIndex: null,
      executionStartedAt: null,
      isCancelling: false,
      wasCancelled: false,
    }

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
        tabs: { 'tab-1': { ...successQueryState, status: 'idle' } },
      })

      render(<StatusBar />)
      expect(screen.queryByTestId('query-info')).not.toBeInTheDocument()
    })

    it('does not show query info when query status is running', () => {
      setupQueryEditorTab()
      useQueryStore.setState({
        tabs: { 'tab-1': { ...successQueryState, status: 'running' } },
      })

      render(<StatusBar />)
      expect(screen.queryByTestId('query-info')).not.toBeInTheDocument()
    })

    it('shows running indicator when query status is running', () => {
      setupQueryEditorTab()
      useQueryStore.setState({
        tabs: {
          'tab-1': {
            ...successQueryState,
            status: 'running',
            executionStartedAt: Date.now(),
          },
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
          'tab-1': {
            ...successQueryState,
            status: 'running',
            executionStartedAt: Date.now(),
          },
        },
      })

      render(<StatusBar />)
      expect(screen.queryByTestId('query-running-info')).not.toBeInTheDocument()
    })

    it('does not show query info when query status is error', () => {
      setupQueryEditorTab()
      useQueryStore.setState({
        tabs: {
          'tab-1': {
            ...successQueryState,
            status: 'error',
            errorMessage: 'Syntax error near...',
          },
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
})
