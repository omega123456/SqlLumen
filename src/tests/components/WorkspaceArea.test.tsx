import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkspaceArea } from '../../components/layout/WorkspaceArea'
import { useConnectionStore } from '../../stores/connection-store'
import { useWorkspaceStore, _resetTabIdCounter } from '../../stores/workspace-store'
import type { ActiveConnection, SavedConnection } from '../../types/connection'

vi.mock('../../lib/schema-commands', () => ({
  getSchemaInfo: vi.fn().mockResolvedValue({
    columns: [
      {
        name: 'id',
        dataType: 'bigint',
        nullable: false,
        columnKey: 'PRI',
        defaultValue: null,
        extra: 'auto_increment',
        ordinalPosition: 1,
      },
    ],
    indexes: [],
    foreignKeys: [],
    ddl: 'CREATE TABLE `users` (`id` bigint NOT NULL)',
    metadata: {
      engine: 'InnoDB',
      collation: 'utf8mb4_general_ci',
      autoIncrement: 1,
      createTime: '2023-01-01',
      tableRows: 100,
      dataLength: 16384,
      indexLength: 8192,
    },
  }),
}))

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
  _resetTabIdCounter()
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

  it('renders workspace tabs when connection has tabs', () => {
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
    expect(screen.getByTestId('table-data-placeholder')).toBeInTheDocument()
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

  it('renders TableDataPlaceholder with correct database and table name', () => {
    const conn = makeActiveConnection()
    useConnectionStore.setState({
      activeConnections: { 'conn-1': conn },
      activeTabId: 'conn-1',
    })

    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'orders',
      connectionId: 'conn-1',
      databaseName: 'ecommerce',
      objectName: 'orders',
      objectType: 'table',
    })

    render(<WorkspaceArea />)

    expect(screen.getByText('ecommerce.orders')).toBeInTheDocument()
    expect(screen.getByText('Table data viewing will be available in Phase 6')).toBeInTheDocument()
  })
})
