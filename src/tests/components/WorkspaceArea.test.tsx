import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkspaceArea } from '../../components/layout/WorkspaceArea'
import { useConnectionStore } from '../../stores/connection-store'
import type { ActiveConnection, SavedConnection } from '../../types/connection'

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
    expect(screen.getByRole('button', { name: '+ New Connection' })).toHaveClass('ui-button-primary')
  })

  it('"New Connection" button calls openDialog()', async () => {
    const user = userEvent.setup()
    render(<WorkspaceArea />)

    expect(useConnectionStore.getState().dialogOpen).toBe(false)
    await user.click(screen.getByText('+ New Connection'))
    expect(useConnectionStore.getState().dialogOpen).toBe(true)
  })

  it('shows connected placeholder when connection is active', () => {
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
})
