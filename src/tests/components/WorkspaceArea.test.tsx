import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkspaceArea } from '../../components/layout/WorkspaceArea'
import { useConnectionStore } from '../../stores/connection-store'
import {
  useWorkspaceStore,
  _resetTabIdCounter,
  _resetQueryTabCounter,
} from '../../stores/workspace-store'
import { useQueryStore } from '../../stores/query-store'
import { useTableDataStore } from '../../stores/table-data-store'
import type { ActiveConnection, SavedConnection } from '../../types/connection'
import { mockIPC } from '@tauri-apps/api/mocks'

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

// Mock table-data-commands to prevent real IPC calls
vi.mock('../../lib/table-data-commands', () => ({
  fetchTableData: vi.fn().mockResolvedValue({
    columns: [
      {
        name: 'id',
        dataType: 'bigint',
        isNullable: false,
        isPrimaryKey: true,
        isUniqueKey: false,
        hasDefault: false,
        columnDefault: null,
        isBinary: false,
        isAutoIncrement: true,
      },
    ],
    rows: [[1]],
    totalRows: 1,
    currentPage: 1,
    totalPages: 1,
    pageSize: 1000,
    primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
    executionTimeMs: 12,
  }),
  updateTableRow: vi.fn().mockResolvedValue(undefined),
  insertTableRow: vi.fn().mockResolvedValue([]),
  deleteTableRow: vi.fn().mockResolvedValue(undefined),
  exportTableData: vi.fn().mockResolvedValue(undefined),
}))

// Mock AG Grid to avoid jsdom issues
vi.mock('ag-grid-community', () => ({
  AllCommunityModule: {},
  ModuleRegistry: { registerModules: vi.fn() },
}))

vi.mock('ag-grid-react', async () => {
  const React = await import('react')
  return {
    AgGridReact: vi.fn(() => {
      return React.createElement('div', { 'data-testid': 'ag-grid-inner' }, 'Grid Mock')
    }),
  }
})

// Mock tauri dialog for EditorToolbar (used by QueryEditorTab)
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(() => Promise.resolve(null)),
  open: vi.fn(() => Promise.resolve(null)),
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
  useQueryStore.setState({ tabs: {} })
  useTableDataStore.setState({ tabs: {} })
  _resetTabIdCounter()
  _resetQueryTabCounter()
  mockIPC(() => null)
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
    })
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
})
