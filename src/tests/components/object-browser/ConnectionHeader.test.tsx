import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConnectionHeader } from '../../../components/object-browser/ConnectionHeader'
import { useConnectionStore } from '../../../stores/connection-store'
import { useSchemaStore } from '../../../stores/schema-store'
import type { ActiveConnection, SavedConnection } from '../../../types/connection'

function makeSavedConnection(overrides: Partial<SavedConnection> = {}): SavedConnection {
  return {
    id: 'conn-1',
    name: 'Production DB',
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
  useSchemaStore.setState({
    connectionStates: {},
  })
})

describe('ConnectionHeader', () => {
  it('renders data-testid="connection-header"', () => {
    useConnectionStore.setState({
      activeConnections: { 'conn-1': makeActiveConnection() },
    })

    render(<ConnectionHeader connectionId="conn-1" />)
    expect(screen.getByTestId('connection-header')).toBeInTheDocument()
  })

  it('renders connection name from store', () => {
    useConnectionStore.setState({
      activeConnections: { 'conn-1': makeActiveConnection() },
    })

    render(<ConnectionHeader connectionId="conn-1" />)
    expect(screen.getByText('Production DB')).toBeInTheDocument()
  })

  it('renders server version', () => {
    useConnectionStore.setState({
      activeConnections: { 'conn-1': makeActiveConnection({ serverVersion: '8.0.35' }) },
    })

    render(<ConnectionHeader connectionId="conn-1" />)
    expect(screen.getByText('8.0.35')).toBeInTheDocument()
  })

  it('renders fallback when server version is empty', () => {
    useConnectionStore.setState({
      activeConnections: { 'conn-1': makeActiveConnection({ serverVersion: '' }) },
    })

    render(<ConnectionHeader connectionId="conn-1" />)
    expect(screen.getByText('MySQL Server')).toBeInTheDocument()
  })

  it('renders nothing when connection not found', () => {
    const { container } = render(<ConnectionHeader connectionId="nonexistent" />)
    expect(container.innerHTML).toBe('')
  })

  it('refresh button calls refreshAll', async () => {
    const user = userEvent.setup()
    const refreshAll = vi.fn().mockResolvedValue(undefined)
    useSchemaStore.setState({ refreshAll })
    useConnectionStore.setState({
      activeConnections: { 'conn-1': makeActiveConnection() },
    })

    render(<ConnectionHeader connectionId="conn-1" />)
    const refreshBtn = screen.getByRole('button', { name: /refresh/i })
    await user.click(refreshBtn)
    expect(refreshAll).toHaveBeenCalledWith('conn-1')
  })

  it('shows status indicator dot', () => {
    useConnectionStore.setState({
      activeConnections: { 'conn-1': makeActiveConnection({ status: 'connected' }) },
    })

    render(<ConnectionHeader connectionId="conn-1" />)
    const indicator = screen.getByTestId('connection-status-indicator')
    expect(indicator).toBeInTheDocument()
    expect(indicator).toHaveAttribute('title', 'Connected')
  })

  it('status indicator shows reconnecting state', () => {
    useConnectionStore.setState({
      activeConnections: { 'conn-1': makeActiveConnection({ status: 'reconnecting' }) },
    })

    render(<ConnectionHeader connectionId="conn-1" />)
    const indicator = screen.getByTestId('connection-status-indicator')
    expect(indicator).toHaveAttribute('title', 'Reconnecting')
  })

  it('status indicator shows disconnected state', () => {
    useConnectionStore.setState({
      activeConnections: { 'conn-1': makeActiveConnection({ status: 'disconnected' }) },
    })

    render(<ConnectionHeader connectionId="conn-1" />)
    const indicator = screen.getByTestId('connection-status-indicator')
    expect(indicator).toHaveAttribute('title', 'Disconnected')
  })
})
