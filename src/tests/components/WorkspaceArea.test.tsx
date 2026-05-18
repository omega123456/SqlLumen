import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkspaceArea } from '../../components/layout/WorkspaceArea'
import { useConnectionStore } from '../../stores/connection-store'
import {
  useWorkspaceStore,
  _resetTabIdCounter,
  _resetQueryTabCounter,
} from '../../stores/workspace-store'
import { useQueryStore } from '../../stores/query-store'
import { useSettingsStore, SETTINGS_DEFAULTS } from '../../stores/settings-store'
import { useTableDataStore } from '../../stores/table-data-store'
import type { ActiveConnection, SavedConnection } from '../../types/connection'
import { ipc } from '../ipc-mock'

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
  useTableDataStore.setState({ tabs: {} })
  _resetTabIdCounter()
  _resetQueryTabCounter()
})

describe('WorkspaceArea', () => {
  it('renders the welcome message when no connections', () => {
    render(<WorkspaceArea />)
    expect(screen.getByText('Welcome!')).toBeInTheDocument()
    expect(screen.getByText('Connect to a MySQL server to get started')).toBeInTheDocument()
  })

  it('renders the New Connection button when no connections', () => {
    render(<WorkspaceArea />)
    expect(screen.getByText('+ New Connection')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ New Connection' })).toHaveClass(
      'ui-button-primary'
    )
  })

  it('"New Connection" button calls openDialog()', async () => {
    const user = userEvent.setup()
    render(<WorkspaceArea />)

    expect(useConnectionStore.getState().dialogOpen).toBe(false)
    await user.click(screen.getByText('+ New Connection'))
    expect(useConnectionStore.getState().dialogOpen).toBe(true)
  })

  it('shows connected placeholder when connection is active and no tabs', () => {
    const conn = makeActiveConnection()
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    render(<WorkspaceArea />)

    expect(screen.queryByText('Welcome!')).not.toBeInTheDocument()
    expect(screen.getByText(/Connected to Test DB/)).toBeInTheDocument()
    expect(screen.getByText(/127\.0\.0\.1:3306/)).toBeInTheDocument()
  })

  it('shows welcome screen when activeTabId is null', () => {
    useConnectionStore.setState({
      activeConnections: {},
      activeTabId: null,
    })

    render(<WorkspaceArea />)
    expect(screen.getByText('Welcome!')).toBeInTheDocument()
  })

  it('renders TableDataTab when workspace has a table-data tab', async () => {
    const conn = makeActiveConnection()
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })

    render(<WorkspaceArea />)

    expect(screen.getByTestId('workspace-tabs')).toBeInTheDocument()
    expect(screen.getByText('users')).toBeInTheDocument()
    // TableDataTab is rendered, which includes the toolbar
    await waitFor(() => {
      expect(screen.getByTestId('table-data-tab')).toBeInTheDocument()
      expect(screen.getByTestId('workspace-panel')).toHaveAttribute('data-active', 'true')
    })
  })

  it('keeps multiple active-connection tabs mounted in workspace panels', async () => {
    const conn = makeActiveConnection()
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })
    useWorkspaceStore.getState().openQueryTab('conn-1')

    render(<WorkspaceArea />)

    await waitFor(() => {
      expect(screen.getByTestId('table-data-tab')).toBeInTheDocument()
      expect(screen.getByTestId('query-editor-tab')).toBeInTheDocument()
    })
    expect(screen.getAllByTestId('workspace-panel')).toHaveLength(2)
  })

  it('marks only the active workspace panel as active', async () => {
    const conn = makeActiveConnection()
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })
    const tableTabId = useWorkspaceStore.getState().activeTabByConnection['conn-1']!
    const queryTabId = useWorkspaceStore.getState().openQueryTab('conn-1')
    useWorkspaceStore.getState().setActiveTab('conn-1', queryTabId)

    render(<WorkspaceArea />)

    await waitFor(() => expect(screen.getAllByTestId('workspace-panel')).toHaveLength(2))
    const panels = screen.getAllByTestId('workspace-panel')
    expect(panels.filter((panel) => panel.getAttribute('data-active') === 'true')).toHaveLength(1)
    expect(
      screen.getByTestId('workspace-area').querySelector(`[data-tab-id="${queryTabId}"]`)
    ).toHaveAttribute('data-active', 'true')
    expect(
      screen.getByTestId('workspace-area').querySelector(`[data-tab-id="${tableTabId}"]`)
    ).toHaveAttribute('data-active', 'false')
  })

  it('keeps mounted workspace panel DOM order stable when query tabs reorder', async () => {
    const conn = makeActiveConnection()
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    const firstQueryTabId = useWorkspaceStore.getState().openQueryTab('conn-1')
    const secondQueryTabId = useWorkspaceStore.getState().openQueryTab('conn-1')

    render(<WorkspaceArea />)

    await waitFor(() => expect(screen.getAllByTestId('workspace-panel')).toHaveLength(2))
    const initialOrder = screen
      .getAllByTestId('workspace-panel')
      .map((panel) => panel.getAttribute('data-tab-id'))
    expect(initialOrder).toEqual([firstQueryTabId, secondQueryTabId])

    act(() => {
      useWorkspaceStore.getState().reorderWorkspaceTab('conn-1', firstQueryTabId, 2)
    })

    expect(
      useWorkspaceStore
        .getState()
        .tabsByConnection['conn-1'].filter((tab) => tab.type === 'query-editor')
        .map((tab) => tab.id)
    ).toEqual([secondQueryTabId, firstQueryTabId])

    const reorderedPanelOrder = screen
      .getAllByTestId('workspace-panel')
      .map((panel) => panel.getAttribute('data-tab-id'))
    expect(reorderedPanelOrder).toEqual([firstQueryTabId, secondQueryTabId])
  })

  it('emits deactivation before activation when active tab changes', async () => {
    const events: string[] = []
    const onDeactivated = (event: Event) => {
      events.push(`deactivated:${(event as CustomEvent<{ tabId: string }>).detail.tabId}`)
    }
    const onActivated = (event: Event) => {
      events.push(`activated:${(event as CustomEvent<{ tabId: string }>).detail.tabId}`)
    }
    document.addEventListener('workspace-tab-deactivated', onDeactivated)
    document.addEventListener('workspace-tab-activated', onActivated)

    try {
      const conn = makeActiveConnection()
      useConnectionStore.setState({
        activeConnections: { 'conn-1': conn },
        activeTabId: 'conn-1',
      })

      const firstTabId = useWorkspaceStore.getState().openQueryTab('conn-1')
      const secondTabId = useWorkspaceStore.getState().openQueryTab('conn-1')
      useWorkspaceStore.getState().setActiveTab('conn-1', firstTabId)

      render(<WorkspaceArea />)
      await waitFor(() => expect(events).toEqual([`activated:${firstTabId}`]))

      act(() => {
        useWorkspaceStore.getState().setActiveTab('conn-1', secondTabId)
      })
      await waitFor(() =>
        expect(events).toEqual([
          `activated:${firstTabId}`,
          `deactivated:${firstTabId}`,
          `activated:${secondTabId}`,
        ])
      )
    } finally {
      document.removeEventListener('workspace-tab-deactivated', onDeactivated)
      document.removeEventListener('workspace-tab-activated', onActivated)
    }
  })

  it('renders SchemaInfoTab for schema-info tab type', async () => {
    const conn = makeActiveConnection()
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    useWorkspaceStore.getState().openTab({
      type: 'schema-info',
      label: 'users info',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })

    render(<WorkspaceArea />)

    // SchemaInfoTab shows loading then data
    await waitFor(() => {
      expect(screen.getByTestId('schema-info-tab')).toBeInTheDocument()
    })
  })

  it('renders QueryEditorTab for query-editor tab type', () => {
    const conn = makeActiveConnection()
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    useWorkspaceStore.getState().openQueryTab('conn-1')

    render(<WorkspaceArea />)

    expect(screen.getByTestId('query-editor-tab')).toBeInTheDocument()
    expect(screen.getByTestId('editor-toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('monaco-editor-wrapper')).toBeInTheDocument()
    expect(screen.getByTestId('result-panel')).toBeInTheDocument()
  })

  it('shows the workspace AI panel host when AI is enabled and a query tab is active', () => {
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.embeddingModel': 'nomic-embed-text',
      },
      pendingChanges: {},
      isDirty: false,
      isLoading: false,
      activeSection: 'ai',
      isDialogOpen: false,
      dialogSection: undefined,
    })

    const conn = makeActiveConnection()
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    useWorkspaceStore.getState().openQueryTab('conn-1')

    render(<WorkspaceArea />)

    expect(screen.getByTestId('workspace-ai-panel-host')).toBeInTheDocument()
  })

  it('renders TableDesignerTab for table-designer tab type', () => {
    const conn = makeActiveConnection()
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    useWorkspaceStore.getState().openTab({
      type: 'table-designer',
      label: 'users',
      connectionId: 'conn-1',
      mode: 'alter',
      databaseName: 'mydb',
      objectName: 'users',
    })

    render(<WorkspaceArea />)

    expect(screen.getByTestId('table-designer-tab')).toBeInTheDocument()
  })

  it('always shows workspace-tabs and "+" button when connected', () => {
    const conn = makeActiveConnection()
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    render(<WorkspaceArea />)

    // Tab bar is present even with no tabs
    expect(screen.getByTestId('workspace-tabs')).toBeInTheDocument()
    expect(screen.getByTestId('new-query-tab-button')).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // Scoped table-data placement and cascade-close dialog tests
  // ---------------------------------------------------------------------------

  describe('table-data tab placement', () => {
    function enableBottomTableTabs() {
      useSettingsStore.setState({
        settings: {
          ...SETTINGS_DEFAULTS,
          'results.tableTabsInBottomPanel': 'true',
        },
        pendingChanges: {},
        isDirty: false,
        isLoading: false,
        activeSection: 'general',
        isDialogOpen: false,
        dialogSection: undefined,
      })
    }

    function disableBottomTableTabs() {
      useSettingsStore.setState({
        settings: {
          ...SETTINGS_DEFAULTS,
          'results.tableTabsInBottomPanel': 'false',
        },
        pendingChanges: {},
        isDirty: false,
        isLoading: false,
        activeSection: 'general',
        isDialogOpen: false,
        dialogSection: undefined,
      })
    }

    it('with setting off (default): table-data tabs appear in the workspace stack and top rail', async () => {
      disableBottomTableTabs()

      const conn = makeActiveConnection()
      useConnectionStore.setState({
        activeConnections: { 'conn-1': conn },
        activeTabId: 'conn-1',
      })

      useWorkspaceStore.getState().openTab({
        type: 'table-data',
        label: 'users',
        connectionId: 'conn-1',
        databaseName: 'mydb',
        objectName: 'users',
        objectType: 'table',
      })

      render(<WorkspaceArea />)

      // Top rail shows the table-data tab
      const topRail = screen.getByTestId('workspace-tabs')
      expect(topRail).toBeInTheDocument()
      expect(screen.getByText('users')).toBeInTheDocument()

      expect(screen.getByTestId('table-data-tab')).toBeInTheDocument()
    })

    it('with setting on: scoped table-data tabs are excluded from the top rail and live in the query panel', async () => {
      enableBottomTableTabs()

      const conn = makeActiveConnection()
      useConnectionStore.setState({
        activeConnections: { 'conn-1': conn },
        activeTabId: 'conn-1',
      })

      useWorkspaceStore.getState().openTab({
        type: 'table-data',
        label: 'users',
        connectionId: 'conn-1',
        databaseName: 'mydb',
        objectName: 'users',
        objectType: 'table',
      })

      render(<WorkspaceArea />)

      expect(screen.getByTestId('table-data-tab')).toBeInTheDocument()
      const topRail = screen.getByTestId('workspace-tabs')
      expect(topRail).not.toHaveTextContent('users')
      expect(screen.getAllByTestId('workspace-panel')).toHaveLength(1)
    })

    it('with setting on: query tabs still render normally in top rail', async () => {
      enableBottomTableTabs()

      const conn = makeActiveConnection()
      useConnectionStore.setState({
        activeConnections: { 'conn-1': conn },
        activeTabId: 'conn-1',
      })

      useWorkspaceStore.getState().openTab({
        type: 'table-data',
        label: 'users',
        connectionId: 'conn-1',
        databaseName: 'mydb',
        objectName: 'users',
        objectType: 'table',
      })
      useWorkspaceStore.getState().openQueryTab('conn-1')

      render(<WorkspaceArea />)

      // Query tab should be in the top rail
      const topRail = screen.getByTestId('workspace-tabs')
      expect(topRail).toHaveTextContent('Query 1')
      expect(topRail).not.toHaveTextContent('users')
    })

    it('saving the setting updates placement immediately without reloading', () => {
      // Start with setting off
      disableBottomTableTabs()

      const conn = makeActiveConnection()
      useConnectionStore.setState({
        activeConnections: { 'conn-1': conn },
        activeTabId: 'conn-1',
      })

      useWorkspaceStore.getState().openTab({
        type: 'table-data',
        label: 'users',
        connectionId: 'conn-1',
        databaseName: 'mydb',
        objectName: 'users',
        objectType: 'table',
      })

      render(<WorkspaceArea />)

      expect(screen.getByTestId('table-data-tab')).toBeInTheDocument()

      // Simulate saving the setting (committed to settings, not just pending)
      act(() => {
        enableBottomTableTabs()
      })

      expect(screen.getByTestId('table-data-tab')).toBeInTheDocument()

      // Simulate turning it back off
      act(() => {
        disableBottomTableTabs()
      })

      expect(screen.getByTestId('table-data-tab')).toBeInTheDocument()
    })

    it('with setting on and AI enabled: AI panel host still appears for active query tab', () => {
      enableBottomTableTabs()

      useSettingsStore.setState({
        settings: {
          ...SETTINGS_DEFAULTS,
          'results.tableTabsInBottomPanel': 'true',
          'ai.enabled': 'true',
          'ai.embeddingModel': 'nomic-embed-text',
        },
        pendingChanges: {},
        isDirty: false,
        isLoading: false,
        activeSection: 'ai',
        isDialogOpen: false,
        dialogSection: undefined,
      })

      const conn = makeActiveConnection()
      useConnectionStore.setState({
        activeConnections: { 'conn-1': conn },
        activeTabId: 'conn-1',
      })

      // Add a scoped table-data tab and a query tab.
      useWorkspaceStore.getState().openTab({
        type: 'table-data',
        label: 'users',
        connectionId: 'conn-1',
        databaseName: 'mydb',
        objectName: 'users',
        objectType: 'table',
      })
      useWorkspaceStore.getState().openQueryTab('conn-1')

      render(<WorkspaceArea />)

      // AI panel host should be present for the active query tab
      expect(screen.getAllByTestId('workspace-ai-panel-host').length).toBeGreaterThan(0)
    })

    it('keeps scoped table-data content inside the query workspace panel when setting is on', async () => {
      enableBottomTableTabs()

      const conn = makeActiveConnection()
      useConnectionStore.setState({
        activeConnections: { 'conn-1': conn },
        activeTabId: 'conn-1',
      })

      const queryTabId = useWorkspaceStore.getState().openQueryTab('conn-1')
      useWorkspaceStore.getState().openTab({
        type: 'table-data',
        label: 'users',
        connectionId: 'conn-1',
        databaseName: 'mydb',
        objectName: 'users',
        objectType: 'table',
      })

      render(<WorkspaceArea />)

      await waitFor(() => {
        expect(screen.getByTestId('query-editor-tab')).toBeInTheDocument()
      })

      expect(screen.queryByTestId('bottom-table-tabs')).not.toBeInTheDocument()
      expect(screen.getByTestId('table-data-tab')).toBeInTheDocument()
      expect(screen.getAllByTestId('workspace-panel')).toHaveLength(1)
      expect(useWorkspaceStore.getState().activeTabByConnection['conn-1']).toBe(queryTabId)
    })

    it('renders the cascade close confirm dialog when pendingCascadeClose is set', async () => {
      enableBottomTableTabs()

      const conn = makeActiveConnection()
      useConnectionStore.setState({
        activeConnections: { 'conn-1': conn },
        activeTabId: 'conn-1',
      })

      useWorkspaceStore.setState({
        pendingCascadeClose: {
          queryTabId: 'query-1',
          queryResultItems: ['Result 2'],
          tableDataItems: ['users', 'orders'],
          onConfirm: vi.fn(),
          onCancel: vi.fn(),
        },
      })

      render(<WorkspaceArea />)

      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument()
      expect(screen.getByText('Query results')).toBeInTheDocument()
      expect(screen.getByText('Table data tabs')).toBeInTheDocument()
      expect(screen.getByText('Result 2')).toBeInTheDocument()
      expect(screen.getByText('users')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Discard and Close' })).toBeInTheDocument()
    })
  })
})
