import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Sidebar } from '../../components/layout/Sidebar'
import { useConnectionStore } from '../../stores/connection-store'
import { useSchemaStore } from '../../stores/schema-store'
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
  // Mock loadDatabases to prevent real IPC calls in tests
  useSchemaStore.setState({
    connectionStates: {},
    loadDatabases: vi.fn().mockResolvedValue(undefined),
  })
})

describe('Sidebar', () => {
  it('renders the empty state message when no active connection', () => {
    render(<Sidebar />)
    expect(screen.getByText('No active connection')).toBeInTheDocument()
  })

  it('renders data-testid="sidebar-inner"', () => {
    render(<Sidebar />)
    expect(screen.getByTestId('sidebar-inner')).toBeInTheDocument()
  })

  it('renders ObjectBrowser when connected', () => {
    useConnectionStore.setState({
      activeConnections: { 'conn-1': makeActiveConnection() },
      activeTabId: 'conn-1',
    })

    render(<Sidebar />)
    expect(screen.getByTestId('object-browser')).toBeInTheDocument()
  })

  it('shows ObjectBrowser when connection is disconnected (preserves context)', () => {
    useConnectionStore.setState({
      activeConnections: {
        'conn-1': makeActiveConnection({ status: 'disconnected' }),
      },
      activeTabId: 'conn-1',
    })

    render(<Sidebar />)
    expect(screen.getByTestId('object-browser')).toBeInTheDocument()
  })
})
