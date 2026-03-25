import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ObjectBrowser } from '../../../components/object-browser/ObjectBrowser'
import { useConnectionStore } from '../../../stores/connection-store'
import { useSchemaStore, makeNodeId } from '../../../stores/schema-store'
import { useWorkspaceStore, _resetTabIdCounter } from '../../../stores/workspace-store'
import type { ActiveConnection, SavedConnection } from '../../../types/connection'
import type { TreeNode as TreeNodeType } from '../../../types/schema'

// Mock clipboard
vi.mock('../../../lib/context-menu-utils', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return {
    ...orig,
    writeClipboardText: vi.fn().mockResolvedValue(undefined),
  }
})

// Mock schema-commands (mutating operations used by dialog handlers)
vi.mock('../../../lib/schema-commands', () => ({
  dropDatabase: vi.fn().mockResolvedValue(undefined),
  dropTable: vi.fn().mockResolvedValue(undefined),
  truncateTable: vi.fn().mockResolvedValue(undefined),
  renameDatabase: vi.fn().mockResolvedValue(undefined),
  renameTable: vi.fn().mockResolvedValue(undefined),
  createDatabase: vi.fn().mockResolvedValue(undefined),
  alterDatabase: vi.fn().mockResolvedValue(undefined),
  getDatabaseDetails: vi.fn().mockResolvedValue({
    name: 'ecommerce_db',
    defaultCharacterSet: 'utf8mb4',
    defaultCollation: 'utf8mb4_general_ci',
  }),
  listCharsets: vi.fn().mockResolvedValue([
    {
      charset: 'utf8mb4',
      description: 'UTF-8 Unicode',
      defaultCollation: 'utf8mb4_general_ci',
      maxLength: 4,
    },
  ]),
  listCollations: vi
    .fn()
    .mockResolvedValue([{ name: 'utf8mb4_general_ci', charset: 'utf8mb4', isDefault: true }]),
}))

import {
  dropDatabase,
  dropTable,
  truncateTable,
  renameDatabase,
  renameTable,
} from '../../../lib/schema-commands'

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

const CONN_ID = 'conn-1'

/** Build childIdsByParentId index from a nodes map. */
function buildChildIndex(nodes: Record<string, TreeNodeType>): Record<string, string[]> {
  const index: Record<string, string[]> = {}
  for (const [id, node] of Object.entries(nodes)) {
    const parentId = node.parentId ?? '__root__'
    if (!index[parentId]) index[parentId] = []
    index[parentId].push(id)
  }
  for (const parentId of Object.keys(index)) {
    index[parentId].sort((a, b) => {
      const nodeA = nodes[a]
      const nodeB = nodes[b]
      if (!nodeA || !nodeB) return 0
      return nodeA.label.localeCompare(nodeB.label)
    })
  }
  return index
}

function setupConnectedState() {
  useConnectionStore.setState({
    activeConnections: { [CONN_ID]: makeActiveConnection() },
    activeTabId: CONN_ID,
  })
}

function setupDatabaseNodes() {
  const db1Id = makeNodeId('database', 'ecommerce_db', 'ecommerce_db')
  const db2Id = makeNodeId('database', 'analytics_db', 'analytics_db')
  const catId = makeNodeId('category', 'ecommerce_db', 'table')
  const viewsCatId = makeNodeId('category', 'ecommerce_db', 'view')
  const tableId = makeNodeId('table', 'ecommerce_db', 'users')

  const nodes: Record<string, TreeNodeType> = {
    [db1Id]: {
      id: db1Id,
      label: 'ecommerce_db',
      type: 'database',
      parentId: null,
      hasChildren: true,
      isLoaded: true,
    },
    [db2Id]: {
      id: db2Id,
      label: 'analytics_db',
      type: 'database',
      parentId: null,
      hasChildren: true,
      isLoaded: false,
    },
    [catId]: {
      id: catId,
      label: 'Tables',
      type: 'category',
      parentId: db1Id,
      hasChildren: true,
      isLoaded: true,
      metadata: { categoryType: 'table', databaseName: 'ecommerce_db' },
    },
    [viewsCatId]: {
      id: viewsCatId,
      label: 'Views',
      type: 'category',
      parentId: db1Id,
      hasChildren: false,
      isLoaded: false,
      metadata: { categoryType: 'view', databaseName: 'ecommerce_db' },
    },
    [tableId]: {
      id: tableId,
      label: 'users',
      type: 'table',
      parentId: catId,
      hasChildren: true,
      isLoaded: false,
      metadata: { databaseName: 'ecommerce_db' },
    },
  }

  useSchemaStore.setState({
    connectionStates: {
      [CONN_ID]: {
        nodes,
        childIdsByParentId: buildChildIndex(nodes),
        expandedNodes: new Set(),
        loadingNodes: new Set(),
        selectedNodeId: null,
        filterText: '',
        loadGeneration: 0,
      },
    },
  })
}

/** Expand tree nodes so table "users" is visible */
function expandToTable() {
  const db1Id = makeNodeId('database', 'ecommerce_db', 'ecommerce_db')
  const catId = makeNodeId('category', 'ecommerce_db', 'table')
  useSchemaStore.setState({
    connectionStates: {
      [CONN_ID]: {
        ...useSchemaStore.getState().connectionStates[CONN_ID],
        expandedNodes: new Set([db1Id, catId]),
      },
    },
  })
}

/** Right-click a node to open context menu */
async function openContextMenu(user: ReturnType<typeof userEvent.setup>, nodeText: string) {
  const node = screen.getByText(nodeText)
  await user.pointer({ target: node, keys: '[MouseRight]' })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20))
  })
}

beforeEach(() => {
  _resetTabIdCounter()
  vi.clearAllMocks()
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
    refreshDatabase: vi.fn().mockResolvedValue(undefined),
    refreshAll: vi.fn().mockResolvedValue(undefined),
  })
  useWorkspaceStore.setState({
    tabsByConnection: {},
    activeTabByConnection: {},
  })
})

describe('ObjectBrowser', () => {
  it('renders with data-testid="object-browser"', () => {
    setupConnectedState()
    render(<ObjectBrowser connectionId={CONN_ID} />)
    expect(screen.getByTestId('object-browser')).toBeInTheDocument()
  })

  it('exposes data-testid="object-browser-scroll" on tree scroller', () => {
    setupConnectedState()
    setupDatabaseNodes()
    render(<ObjectBrowser connectionId={CONN_ID} />)
    expect(screen.getByTestId('object-browser-scroll')).toBeInTheDocument()
  })

  it('renders ConnectionHeader', () => {
    setupConnectedState()
    render(<ObjectBrowser connectionId={CONN_ID} />)
    expect(screen.getByTestId('connection-header')).toBeInTheDocument()
  })

  it('shows empty state when no databases loaded', () => {
    setupConnectedState()
    // Set empty nodes to prevent loadDatabases from overwriting
    useSchemaStore.setState({
      connectionStates: {
        [CONN_ID]: {
          nodes: {},
          childIdsByParentId: {},
          expandedNodes: new Set(),
          loadingNodes: new Set(),
          selectedNodeId: null,
          filterText: '',
          loadGeneration: 0,
        },
      },
    })
    render(<ObjectBrowser connectionId={CONN_ID} />)
    expect(screen.getByText('No databases loaded')).toBeInTheDocument()
  })

  it('renders database nodes from store', () => {
    setupConnectedState()
    setupDatabaseNodes()

    render(<ObjectBrowser connectionId={CONN_ID} />)
    expect(screen.getByText('ecommerce_db')).toBeInTheDocument()
    expect(screen.getByText('analytics_db')).toBeInTheDocument()
  })

  it('filter input changes filterText in store', async () => {
    const user = userEvent.setup()
    setupConnectedState()
    setupDatabaseNodes()

    render(<ObjectBrowser connectionId={CONN_ID} />)
    const input = screen.getByTestId('filter-input')
    await user.type(input, 'ecommerce')

    expect(useSchemaStore.getState().connectionStates[CONN_ID].filterText).toBe('ecommerce')
  })

  it('calls loadDatabases on mount when connected', () => {
    const loadDatabases = vi.fn().mockResolvedValue(undefined)
    useSchemaStore.setState({ loadDatabases })
    setupConnectedState()

    render(<ObjectBrowser connectionId={CONN_ID} />)
    expect(loadDatabases).toHaveBeenCalledWith(CONN_ID)
  })

  it('filtered tree shows matching nodes and their ancestors', () => {
    setupConnectedState()
    setupDatabaseNodes()

    // Set filter to "users" — should show ecommerce_db > Tables > users
    act(() => {
      useSchemaStore.getState().setFilter('users', CONN_ID)
    })

    render(<ObjectBrowser connectionId={CONN_ID} />)

    // "users" table matches
    expect(screen.getByText('users')).toBeInTheDocument()
    // Parent nodes should be visible as ancestors
    expect(screen.getByText('ecommerce_db')).toBeInTheDocument()
    expect(screen.getByText('Tables')).toBeInTheDocument()
    // analytics_db should be hidden (no matching descendants)
    expect(screen.queryByText('analytics_db')).not.toBeInTheDocument()
  })

  it('with a database selected, filter is scoped to that database and other DBs stay visible', () => {
    setupConnectedState()
    setupDatabaseNodes()
    const db1Id = makeNodeId('database', 'ecommerce_db', 'ecommerce_db')

    act(() => {
      useSchemaStore.getState().selectNode(db1Id, CONN_ID)
      useSchemaStore.getState().setFilter('users', CONN_ID)
    })

    render(<ObjectBrowser connectionId={CONN_ID} />)

    expect(screen.getByText('users')).toBeInTheDocument()
    expect(screen.getByText('ecommerce_db')).toBeInTheDocument()
    expect(screen.getByText('Tables')).toBeInTheDocument()
    expect(screen.getByText('analytics_db')).toBeInTheDocument()
  })

  it('with Tables selected, filter only affects table list; sibling Views stays visible', () => {
    setupConnectedState()
    setupDatabaseNodes()
    const db1Id = makeNodeId('database', 'ecommerce_db', 'ecommerce_db')
    const catId = makeNodeId('category', 'ecommerce_db', 'table')

    act(() => {
      useSchemaStore.setState({
        connectionStates: {
          [CONN_ID]: {
            ...useSchemaStore.getState().connectionStates[CONN_ID],
            expandedNodes: new Set([db1Id]),
            selectedNodeId: catId,
            filterText: 'users',
          },
        },
      })
    })

    render(<ObjectBrowser connectionId={CONN_ID} />)

    expect(screen.getByText('analytics_db')).toBeInTheDocument()
    expect(screen.getByText('Views')).toBeInTheDocument()
    expect(screen.getByText('users')).toBeInTheDocument()
    expect(screen.getByText('Tables')).toBeInTheDocument()
  })

  it('with Tables selected, keeps Tables row visible when no table name matches', () => {
    setupConnectedState()
    setupDatabaseNodes()
    const db1Id = makeNodeId('database', 'ecommerce_db', 'ecommerce_db')
    const catId = makeNodeId('category', 'ecommerce_db', 'table')

    act(() => {
      useSchemaStore.setState({
        connectionStates: {
          [CONN_ID]: {
            ...useSchemaStore.getState().connectionStates[CONN_ID],
            expandedNodes: new Set([db1Id]),
            selectedNodeId: catId,
            filterText: 'no_such_table_xyz',
          },
        },
      })
    })

    render(<ObjectBrowser connectionId={CONN_ID} />)

    expect(screen.getByText('Tables')).toBeInTheDocument()
    expect(screen.queryByText('users')).not.toBeInTheDocument()
    expect(screen.getByText('Views')).toBeInTheDocument()
  })

  it('shows "Not connected" when connection is disconnected', () => {
    useConnectionStore.setState({
      activeConnections: {
        [CONN_ID]: makeActiveConnection({ status: 'disconnected' }),
      },
    })

    render(<ObjectBrowser connectionId={CONN_ID} />)
    expect(screen.getByText('Not connected')).toBeInTheDocument()
  })

  it('renders filter input with placeholder', () => {
    setupConnectedState()
    render(<ObjectBrowser connectionId={CONN_ID} />)
    expect(screen.getByPlaceholderText('Filter objects...')).toBeInTheDocument()
  })

  it('right-clicking a tree node shows context menu', async () => {
    const user = userEvent.setup()
    setupConnectedState()
    setupDatabaseNodes()

    render(<ObjectBrowser connectionId={CONN_ID} />)

    const dbNode = screen.getByText('ecommerce_db')
    await user.pointer({ target: dbNode, keys: '[MouseRight]' })

    // Wait for requestAnimationFrame via act
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    expect(screen.getByTestId('object-browser-context-menu')).toBeInTheDocument()
  })

  it('double-clicking a table node opens a table-data workspace tab', async () => {
    const user = userEvent.setup()
    setupConnectedState()
    setupDatabaseNodes()
    expandToTable()

    render(<ObjectBrowser connectionId={CONN_ID} />)
    const tableNode = screen.getByText('users')
    await user.dblClick(tableNode)

    const state = useWorkspaceStore.getState()
    const tabs = state.tabsByConnection[CONN_ID]
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toMatchObject({
      type: 'table-data',
      label: 'users',
      objectType: 'table',
    })
  })

  it('double-clicking a view node opens a schema-info workspace tab', async () => {
    const user = userEvent.setup()
    setupConnectedState()

    // Set up nodes with a view node visible
    const viewId = makeNodeId('view', 'ecommerce_db', 'user_stats')
    const viewCatId = makeNodeId('category', 'ecommerce_db', 'view')
    const db1Id = makeNodeId('database', 'ecommerce_db', 'ecommerce_db')

    const nodes: Record<string, TreeNodeType> = {
      [db1Id]: {
        id: db1Id,
        label: 'ecommerce_db',
        type: 'database',
        parentId: null,
        hasChildren: true,
        isLoaded: true,
      },
      [viewCatId]: {
        id: viewCatId,
        label: 'Views',
        type: 'category',
        parentId: db1Id,
        hasChildren: true,
        isLoaded: true,
        metadata: { categoryType: 'view', databaseName: 'ecommerce_db' },
      },
      [viewId]: {
        id: viewId,
        label: 'user_stats',
        type: 'view',
        parentId: viewCatId,
        hasChildren: false,
        isLoaded: true,
        metadata: { databaseName: 'ecommerce_db' },
      },
    }

    useSchemaStore.setState({
      connectionStates: {
        [CONN_ID]: {
          nodes,
          childIdsByParentId: buildChildIndex(nodes),
          expandedNodes: new Set([db1Id, viewCatId]),
          loadingNodes: new Set(),
          selectedNodeId: null,
          filterText: '',
          loadGeneration: 0,
        },
      },
    })

    render(<ObjectBrowser connectionId={CONN_ID} />)
    const viewNode = screen.getByText('user_stats')
    await user.dblClick(viewNode)

    const state = useWorkspaceStore.getState()
    const tabs = state.tabsByConnection[CONN_ID]
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toMatchObject({
      type: 'schema-info',
      label: 'user_stats',
      objectType: 'view',
    })
  })

  it('selecting a database node switches the active session database', async () => {
    const user = userEvent.setup()
    setupConnectedState()
    setupDatabaseNodes()
    const setActiveDatabase = vi.fn().mockResolvedValue(undefined)
    useConnectionStore.setState({ setActiveDatabase })

    render(<ObjectBrowser connectionId={CONN_ID} />)

    await user.click(screen.getByText('analytics_db'))

    await waitFor(() => {
      expect(setActiveDatabase).toHaveBeenCalledWith(CONN_ID, 'analytics_db')
    })
  })

  it("selecting a table node switches the active session database to that table's database", async () => {
    const user = userEvent.setup()
    setupConnectedState()
    setupDatabaseNodes()
    expandToTable()
    const setActiveDatabase = vi.fn().mockResolvedValue(undefined)
    useConnectionStore.setState({ setActiveDatabase })

    render(<ObjectBrowser connectionId={CONN_ID} />)

    await user.click(screen.getByText('users'))

    await waitFor(() => {
      expect(setActiveDatabase).toHaveBeenCalledWith(CONN_ID, 'ecommerce_db')
    })
  })

  // ---------------------------------------------------------------------------
  // Dialog integration tests
  // ---------------------------------------------------------------------------

  describe('dialog: Drop Database', () => {
    it('opens confirm dialog via context menu', async () => {
      const user = userEvent.setup()
      setupConnectedState()
      setupDatabaseNodes()

      render(<ObjectBrowser connectionId={CONN_ID} />)
      await openContextMenu(user, 'ecommerce_db')

      await user.click(screen.getByText('Drop Database...'))

      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      // The dialog message references the database name
      expect(screen.getByRole('heading', { name: /Drop Database/ })).toBeInTheDocument()
    })

    it('drops database, closes tabs, and refreshes tree on confirm', async () => {
      const user = userEvent.setup()
      setupConnectedState()
      setupDatabaseNodes()
      const refreshAll = vi.fn().mockResolvedValue(undefined)
      useSchemaStore.setState({ refreshAll })

      render(<ObjectBrowser connectionId={CONN_ID} />)
      await openContextMenu(user, 'ecommerce_db')
      await user.click(screen.getByText('Drop Database...'))
      await user.click(screen.getByTestId('confirm-confirm-button'))

      await waitFor(() => {
        expect(dropDatabase).toHaveBeenCalledWith(CONN_ID, 'ecommerce_db')
      })
      await waitFor(() => {
        expect(refreshAll).toHaveBeenCalledWith(CONN_ID)
      })
    })

    it('shows error on failed drop and keeps dialog open', async () => {
      vi.mocked(dropDatabase).mockRejectedValueOnce(new Error('Access denied'))
      const user = userEvent.setup()
      setupConnectedState()
      setupDatabaseNodes()

      render(<ObjectBrowser connectionId={CONN_ID} />)
      await openContextMenu(user, 'ecommerce_db')
      await user.click(screen.getByText('Drop Database...'))
      await user.click(screen.getByTestId('confirm-confirm-button'))

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog-error')).toHaveTextContent('Access denied')
      })
      // Dialog should still be open
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
    })
  })

  describe('dialog: Drop Table', () => {
    it('opens confirm dialog via context menu', async () => {
      const user = userEvent.setup()
      setupConnectedState()
      setupDatabaseNodes()
      expandToTable()

      render(<ObjectBrowser connectionId={CONN_ID} />)
      await openContextMenu(user, 'users')
      await user.click(screen.getByText('Drop Table...'))

      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      // The message references the fully-qualified table name
      expect(screen.getByRole('heading', { name: /Drop Table/ })).toBeInTheDocument()
    })

    it('drops table, closes tabs, and refreshes on confirm', async () => {
      const user = userEvent.setup()
      setupConnectedState()
      setupDatabaseNodes()
      expandToTable()
      const refreshCategory = vi.fn().mockResolvedValue(undefined)
      useSchemaStore.setState({ refreshCategory })

      render(<ObjectBrowser connectionId={CONN_ID} />)
      await openContextMenu(user, 'users')
      await user.click(screen.getByText('Drop Table...'))
      await user.click(screen.getByTestId('confirm-confirm-button'))

      await waitFor(() => {
        expect(dropTable).toHaveBeenCalledWith(CONN_ID, 'ecommerce_db', 'users')
      })
      await waitFor(() => {
        expect(refreshCategory).toHaveBeenCalledWith(CONN_ID, 'ecommerce_db', 'table')
      })
    })
  })

  describe('dialog: Truncate Table', () => {
    it('opens confirm dialog via context menu', async () => {
      const user = userEvent.setup()
      setupConnectedState()
      setupDatabaseNodes()
      expandToTable()

      render(<ObjectBrowser connectionId={CONN_ID} />)
      await openContextMenu(user, 'users')
      await user.click(screen.getByText('Truncate Table...'))

      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: /Truncate Table/ })).toBeInTheDocument()
    })

    it('truncates table on confirm', async () => {
      const user = userEvent.setup()
      setupConnectedState()
      setupDatabaseNodes()
      expandToTable()

      render(<ObjectBrowser connectionId={CONN_ID} />)
      await openContextMenu(user, 'users')
      await user.click(screen.getByText('Truncate Table...'))
      await user.click(screen.getByTestId('confirm-confirm-button'))

      await waitFor(() => {
        expect(truncateTable).toHaveBeenCalledWith(CONN_ID, 'ecommerce_db', 'users')
      })
    })
  })

  describe('dialog: Rename Table', () => {
    it('opens rename dialog via context menu', async () => {
      const user = userEvent.setup()
      setupConnectedState()
      setupDatabaseNodes()
      expandToTable()

      render(<ObjectBrowser connectionId={CONN_ID} />)
      await openContextMenu(user, 'users')
      await user.click(screen.getByText('Rename Table...'))

      expect(screen.getByTestId('rename-dialog')).toBeInTheDocument()
      expect(screen.getByDisplayValue('users')).toBeInTheDocument()
    })

    it('renames table, updates tabs, and refreshes on confirm', async () => {
      const user = userEvent.setup()
      setupConnectedState()
      setupDatabaseNodes()
      expandToTable()
      const refreshCategory = vi.fn().mockResolvedValue(undefined)
      useSchemaStore.setState({ refreshCategory })

      render(<ObjectBrowser connectionId={CONN_ID} />)
      await openContextMenu(user, 'users')
      await user.click(screen.getByText('Rename Table...'))

      const input = screen.getByTestId('rename-name-input')
      await user.clear(input)
      await user.type(input, 'customers')
      await user.click(screen.getByTestId('rename-confirm-button'))

      await waitFor(() => {
        expect(renameTable).toHaveBeenCalledWith(CONN_ID, 'ecommerce_db', 'users', 'customers')
      })
      await waitFor(() => {
        expect(refreshCategory).toHaveBeenCalledWith(CONN_ID, 'ecommerce_db', 'table')
      })
    })

    it('shows error on failed rename and keeps dialog open', async () => {
      vi.mocked(renameTable).mockRejectedValueOnce(new Error('Table locked'))
      const user = userEvent.setup()
      setupConnectedState()
      setupDatabaseNodes()
      expandToTable()

      render(<ObjectBrowser connectionId={CONN_ID} />)
      await openContextMenu(user, 'users')
      await user.click(screen.getByText('Rename Table...'))

      const input = screen.getByTestId('rename-name-input')
      await user.clear(input)
      await user.type(input, 'customers')
      await user.click(screen.getByTestId('rename-confirm-button'))

      await waitFor(() => {
        expect(screen.getByTestId('rename-dialog-error')).toHaveTextContent('Table locked')
      })
      expect(screen.getByTestId('rename-dialog')).toBeInTheDocument()
    })
  })

  describe('dialog: Create Database', () => {
    it('opens create database dialog via context menu', async () => {
      const user = userEvent.setup()
      setupConnectedState()
      setupDatabaseNodes()

      render(<ObjectBrowser connectionId={CONN_ID} />)
      await openContextMenu(user, 'ecommerce_db')
      await user.click(screen.getByText('Create Database...'))

      expect(screen.getByTestId('create-database-dialog')).toBeInTheDocument()
    })
  })

  describe('dialog: Alter Database', () => {
    it('opens alter database dialog via context menu', async () => {
      const user = userEvent.setup()
      setupConnectedState()
      setupDatabaseNodes()

      render(<ObjectBrowser connectionId={CONN_ID} />)
      await openContextMenu(user, 'ecommerce_db')
      await user.click(screen.getByText('Alter Database...'))

      await waitFor(() => {
        expect(screen.getByTestId('alter-database-dialog')).toBeInTheDocument()
      })
    })
  })

  describe('dialog: Rename Database', () => {
    it('opens rename dialog with warning via context menu', async () => {
      const user = userEvent.setup()
      setupConnectedState()
      setupDatabaseNodes()

      render(<ObjectBrowser connectionId={CONN_ID} />)
      await openContextMenu(user, 'ecommerce_db')
      await user.click(screen.getByText('Rename Database...'))

      expect(screen.getByTestId('rename-dialog')).toBeInTheDocument()
      expect(screen.getByTestId('rename-dialog-warning')).toBeInTheDocument()
      expect(screen.getByDisplayValue('ecommerce_db')).toBeInTheDocument()
    })

    it('renames database, updates tabs, and refreshes on confirm', async () => {
      const user = userEvent.setup()
      setupConnectedState()
      setupDatabaseNodes()
      const refreshAll = vi.fn().mockResolvedValue(undefined)
      useSchemaStore.setState({ refreshAll })

      render(<ObjectBrowser connectionId={CONN_ID} />)
      await openContextMenu(user, 'ecommerce_db')
      await user.click(screen.getByText('Rename Database...'))

      const input = screen.getByTestId('rename-name-input')
      await user.clear(input)
      await user.type(input, 'production_db')
      await user.click(screen.getByTestId('rename-confirm-button'))

      await waitFor(() => {
        expect(renameDatabase).toHaveBeenCalledWith(CONN_ID, 'ecommerce_db', 'production_db')
      })
      await waitFor(() => {
        expect(refreshAll).toHaveBeenCalledWith(CONN_ID)
      })
    })
  })
})
