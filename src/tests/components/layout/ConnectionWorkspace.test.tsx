import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConnectionWorkspace } from '../../../components/layout/ConnectionWorkspace'
import { useConnectionStore } from '../../../stores/connection-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { resetWorkspaceStore } from '../../helpers/workspace-test-utils'
import { useQueryStore } from '../../../stores/query-store'
import { useTableDataStore } from '../../../stores/table-data-store'
import { useTableDesignerStore } from '../../../stores/table-designer-store'
import { useFavoritesStore } from '../../../stores/favorites-store'
import type { ActiveConnection, SavedConnection } from '../../../types/connection'

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

function makeActiveConnection(sessionId: string): ActiveConnection {
  return {
    id: sessionId,
    profile: makeSavedConnection({ id: sessionId }),
    status: 'connected',
    serverVersion: '8.0.35',
  }
}

beforeEach(() => {
  useConnectionStore.setState({
    activeConnections: { 'session-a': makeActiveConnection('session-a') },
    activeTabId: 'session-a',
    dialogOpen: false,
    error: null,
  })
  resetWorkspaceStore({ visibleConnectionSessionId: 'session-a' })
  useQueryStore.setState({ tabs: {} })
  useTableDataStore.setState({ tabs: {} })
  useTableDesignerStore.setState({ tabs: {} })
  useFavoritesStore.setState({ dialogOpen: false, editingFavorite: null })
})

describe('ConnectionWorkspace', () => {
  it('renders an active root that is visible and interactive', () => {
    useWorkspaceStore.getState().openQueryTab('session-a')

    render(<ConnectionWorkspace sessionId="session-a" isActive={true} />)

    const root = screen.getByTestId('active-connection-workspace')
    expect(root).toBeInTheDocument()
    expect(root).not.toHaveAttribute('aria-hidden')
    expect(root).not.toHaveAttribute('inert')
    expect(root).toHaveAttribute('data-active', 'true')
  })

  it('keeps an inactive root mounted but hidden, aria-hidden, and inert', () => {
    useWorkspaceStore.getState().openQueryTab('session-a')

    render(<ConnectionWorkspace sessionId="session-a" isActive={false} />)

    const root = screen.getByTestId('inactive-connection-workspace')
    // Mounted: descendant tab rail still rendered.
    expect(within(root).getByTestId('workspace-tabs')).toBeInTheDocument()
    expect(root).toHaveAttribute('aria-hidden', 'true')
    expect(root).toHaveAttribute('inert')
    expect(root).toHaveAttribute('data-active', 'false')
  })

  it('marks no descendant workspace panel active while inactive', async () => {
    useWorkspaceStore.getState().openQueryTab('session-a')

    render(<ConnectionWorkspace sessionId="session-a" isActive={false} />)

    await waitFor(() => {
      expect(screen.getByTestId('workspace-panel')).toBeInTheDocument()
    })
    const panels = screen.getAllByTestId('workspace-panel')
    expect(panels.every((panel) => panel.getAttribute('data-active') === 'false')).toBe(true)
  })

  it('marks the selected workspace panel active when active', async () => {
    const queryTabId = useWorkspaceStore.getState().openQueryTab('session-a')

    render(<ConnectionWorkspace sessionId="session-a" isActive={true} />)

    await waitFor(() => {
      expect(screen.getByTestId('workspace-panel')).toBeInTheDocument()
    })
    const panel = screen.getByTestId('workspace-panel')
    expect(panel).toHaveAttribute('data-tab-id', queryTabId)
    expect(panel).toHaveAttribute('data-active', 'true')
  })

  it('keeps mounted panels stable when toggling from active to inactive', async () => {
    const firstTabId = useWorkspaceStore.getState().openQueryTab('session-a')
    const secondTabId = useWorkspaceStore.getState().openQueryTab('session-a')

    const { rerender } = render(<ConnectionWorkspace sessionId="session-a" isActive={true} />)

    await waitFor(() => expect(screen.getAllByTestId('workspace-panel')).toHaveLength(2))
    const orderActive = screen
      .getAllByTestId('workspace-panel')
      .map((panel) => panel.getAttribute('data-tab-id'))
    expect(orderActive).toEqual([firstTabId, secondTabId])

    rerender(<ConnectionWorkspace sessionId="session-a" isActive={false} />)

    const orderInactive = screen
      .getAllByTestId('workspace-panel')
      .map((panel) => panel.getAttribute('data-tab-id'))
    expect(orderInactive).toEqual([firstTabId, secondTabId])
  })

  it('suppresses the tab-rail active-tab scroll lookup while the connection is inactive', () => {
    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'session-a',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })
    const tableTabId = useWorkspaceStore.getState().activeTabByConnection['session-a']!

    const querySpy = vi.spyOn(document, 'querySelector')

    render(<ConnectionWorkspace sessionId="session-a" isActive={false} />)

    // The inactive tab rail must not perform the visible-only scroll-into-view
    // lookup for its active tab.
    const lookedUpActiveTab = querySpy.mock.calls.some(
      ([selector]) => selector === `[data-testid="workspace-tab-${tableTabId}"]`
    )
    expect(lookedUpActiveTab).toBe(false)

    querySpy.mockRestore()
  })

  it('does not auto-scroll active stack or member tabs while the workspace is inactive', () => {
    const scrollIntoViewMock = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoViewMock

    useWorkspaceStore.getState().openQueryTab('session-a', 'Query A')
    useWorkspaceStore.getState().openQueryTab('session-a', 'Query B')

    render(<ConnectionWorkspace sessionId="session-a" isActive={false} />)

    expect(scrollIntoViewMock).not.toHaveBeenCalled()
  })

  it('scopes duplicate stack chip interactions to the active workspace root', async () => {
    const user = userEvent.setup()

    useConnectionStore.setState({
      activeConnections: {
        'session-a': makeActiveConnection('session-a'),
        'session-b': makeActiveConnection('session-b'),
      },
      activeTabId: 'session-a',
      dialogOpen: false,
      error: null,
    })

    useWorkspaceStore.getState().openQueryTab('session-a', 'A Query')
    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'session-a',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })

    useWorkspaceStore.getState().openQueryTab('session-b', 'B Query')
    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'orders',
      connectionId: 'session-b',
      databaseName: 'mydb',
      objectName: 'orders',
      objectType: 'table',
    })

    render(
      <>
        <ConnectionWorkspace sessionId="session-a" isActive={true} />
        <ConnectionWorkspace sessionId="session-b" isActive={false} />
      </>
    )

    const activeRoot = screen.getByTestId('active-connection-workspace')
    const inactiveRoot = screen.getByTestId('inactive-connection-workspace')

    expect(within(activeRoot).getByTestId('workspace-stack-chip-tables')).toBeInTheDocument()
    expect(within(inactiveRoot).getByTestId('workspace-stack-chip-tables')).toBeInTheDocument()

    await user.click(within(activeRoot).getByTestId('workspace-stack-chip-queries'))

    expect(within(activeRoot).getByText('A Query')).toBeInTheDocument()
    expect(within(activeRoot).queryByText('users')).not.toBeInTheDocument()
    expect(within(inactiveRoot).queryByText('B Query')).not.toBeInTheDocument()
  })

  it('renders nothing when the session is not an open connection', () => {
    const { container } = render(<ConnectionWorkspace sessionId="missing" isActive={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('mounts the favorite dialog when active and the dialog is open', () => {
    useWorkspaceStore.getState().openQueryTab('session-a')
    useFavoritesStore.setState({ dialogOpen: true, editingFavorite: null })

    render(<ConnectionWorkspace sessionId="session-a" isActive={true} />)

    expect(screen.getByTestId('favorite-dialog')).toBeInTheDocument()
  })

  it('does not mount the favorite dialog while the connection is inactive', () => {
    useWorkspaceStore.getState().openQueryTab('session-a')
    useFavoritesStore.setState({ dialogOpen: true, editingFavorite: null })

    render(<ConnectionWorkspace sessionId="session-a" isActive={false} />)

    expect(screen.queryByTestId('favorite-dialog')).not.toBeInTheDocument()
  })
})
