import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ObjectBrowser } from '../../../components/object-browser/ObjectBrowser'
import { useConnectionStore } from '../../../stores/connection-store'
import { useSchemaStore, makeNodeId } from '../../../stores/schema-store'
import { useSettingsStore, SETTINGS_DEFAULTS } from '../../../stores/settings-store'
import { useWorkspaceStore, _resetTabIdCounter } from '../../../stores/workspace-store'
import { ipc } from '../../ipc-mock'
import type { ActiveConnection, SavedConnection } from '../../../types/connection'
import type { TreeNode as TreeNodeType, WorkspaceTab } from '../../../types/schema'

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

function setupConnectedState(overrides: Partial<SavedConnection> = {}) {
  act(() => {
    useConnectionStore.setState({
      activeConnections: {
        [CONN_ID]: makeActiveConnection({ profile: makeSavedConnection(overrides) }),
      },
      activeTabId: CONN_ID,
    })
  })
}

function setConnectionState(update: Partial<ReturnType<typeof useConnectionStore.getState>>) {
  act(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useConnectionStore.setState(update as any)
  })
}

function setSchemaState(update: Partial<ReturnType<typeof useSchemaStore.getState>>) {
  act(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useSchemaStore.setState(update as any)
  })
}

function setWorkspaceState(update: Partial<ReturnType<typeof useWorkspaceStore.getState>>) {
  act(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useWorkspaceStore.setState(update as any)
  })
}

function setBottomPanelSetting(enabled: boolean) {
  act(() => {
    useSettingsStore.setState((state) => ({
      ...state,
      settings: {
        ...SETTINGS_DEFAULTS,
        ...state.settings,
        'results.tableTabsInBottomPanel': enabled ? 'true' : 'false',
      },
      pendingChanges: {},
    }))
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

  act(() => {
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
  })
}

function setupCopyableObjectNodes(nodeType: 'procedure' | 'function' | 'trigger' | 'event') {
  const databaseId = makeNodeId('database', 'ecommerce_db', 'ecommerce_db')
  const categoryId = makeNodeId('category', 'ecommerce_db', nodeType)
  const objectNameMap = {
    procedure: 'sp_recalc',
    function: 'fn_total',
    trigger: 'trg_audit',
    event: 'nightly_cleanup',
  } as const
  const labelMap = {
    procedure: 'Procedures',
    function: 'Functions',
    trigger: 'Triggers',
    event: 'Events',
  } as const
  const objectName = objectNameMap[nodeType]
  const nodeId = makeNodeId(nodeType, 'ecommerce_db', objectName)

  const nodes: Record<string, TreeNodeType> = {
    [databaseId]: {
      id: databaseId,
      label: 'ecommerce_db',
      type: 'database',
      parentId: null,
      hasChildren: true,
      isLoaded: true,
    },
    [categoryId]: {
      id: categoryId,
      label: labelMap[nodeType],
      type: 'category',
      parentId: databaseId,
      hasChildren: true,
      isLoaded: true,
      metadata: { categoryType: nodeType, databaseName: 'ecommerce_db' },
    },
    [nodeId]: {
      id: nodeId,
      label: objectName,
      type: nodeType,
      parentId: categoryId,
      hasChildren: false,
      isLoaded: true,
      metadata: { databaseName: 'ecommerce_db' },
    },
  }

  act(() => {
    useSchemaStore.setState({
      connectionStates: {
        [CONN_ID]: {
          nodes,
          childIdsByParentId: buildChildIndex(nodes),
          expandedNodes: new Set([databaseId, categoryId]),
          loadingNodes: new Set(),
          selectedNodeId: null,
          filterText: '',
          loadGeneration: 0,
        },
      },
    })
  })

  return { objectName }
}

function setupFilteredTableNodes() {
  const dbId = makeNodeId('database', 'ecommerce_db', 'ecommerce_db')
  const tablesId = makeNodeId('category', 'ecommerce_db', 'table')
  const usersId = makeNodeId('table', 'ecommerce_db', 'users')
  const ordersId = makeNodeId('table', 'ecommerce_db', 'orders')
  const userIdColumnId = makeNodeId('column', 'ecommerce_db', 'users.id')

  const nodes: Record<string, TreeNodeType> = {
    [dbId]: {
      id: dbId,
      label: 'ecommerce_db',
      type: 'database',
      parentId: null,
      hasChildren: true,
      isLoaded: true,
      databaseName: 'ecommerce_db',
      objectName: 'ecommerce_db',
    },
    [tablesId]: {
      id: tablesId,
      label: 'Tables',
      type: 'category',
      parentId: dbId,
      hasChildren: true,
      isLoaded: true,
      databaseName: 'ecommerce_db',
      metadata: { categoryType: 'table', databaseName: 'ecommerce_db' },
    },
    [usersId]: {
      id: usersId,
      label: 'users',
      type: 'table',
      parentId: tablesId,
      hasChildren: true,
      isLoaded: true,
      databaseName: 'ecommerce_db',
      objectName: 'users',
      metadata: { databaseName: 'ecommerce_db' },
    },
    [ordersId]: {
      id: ordersId,
      label: 'orders',
      type: 'table',
      parentId: tablesId,
      hasChildren: true,
      isLoaded: false,
      databaseName: 'ecommerce_db',
      objectName: 'orders',
      metadata: { databaseName: 'ecommerce_db' },
    },
    [userIdColumnId]: {
      id: userIdColumnId,
      label: 'id',
      type: 'column',
      parentId: usersId,
      hasChildren: false,
      isLoaded: true,
      databaseName: 'ecommerce_db',
      objectName: 'id',
      metadata: { columnType: 'bigint', databaseName: 'ecommerce_db' },
    },
  }

  act(() => {
    useSchemaStore.setState({
      connectionStates: {
        [CONN_ID]: {
          nodes,
          childIdsByParentId: buildChildIndex(nodes),
          expandedNodes: new Set([dbId, tablesId]),
          loadingNodes: new Set(),
          selectedNodeId: tablesId,
          filterText: 'user',
          loadGeneration: 0,
        },
      },
    })
  })

  return { dbId, tablesId, usersId, ordersId, userIdColumnId }
}

/** Expand tree nodes so table "users" is visible */
function expandToTable() {
  const db1Id = makeNodeId('database', 'ecommerce_db', 'ecommerce_db')
  const catId = makeNodeId('category', 'ecommerce_db', 'table')
  act(() => {
    useSchemaStore.setState({
      connectionStates: {
        [CONN_ID]: {
          ...useSchemaStore.getState().connectionStates[CONN_ID],
          expandedNodes: new Set([db1Id, catId]),
        },
      },
    })
  })
}

/** Right-click a node to open context menu */
async function openContextMenu(user: ReturnType<typeof userEvent.setup>, nodeText: string) {
  const node = screen.getByText(nodeText)
  await user.pointer({ target: node, keys: '[MouseRight]' })
  await screen.findByTestId('object-browser-context-menu')
}

beforeEach(() => {
  _resetTabIdCounter()
  vi.clearAllMocks()
  act(() => {
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
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS },
      pendingChanges: {},
      isDirty: false,
      isLoading: false,
      activeSection: 'general',
      isDialogOpen: false,
      dialogSection: undefined,
    })
  })
})

describe('ObjectBrowser', () => {
  it('renders with data-testid="object-browser"', () => {
    setupConnectedState()
    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )
    expect(screen.getByTestId('object-browser')).toBeInTheDocument()
  })

  it('exposes data-testid="object-browser-scroll" on tree scroller', () => {
    setupConnectedState()
    setupDatabaseNodes()
    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )
    expect(screen.getByTestId('object-browser-scroll')).toBeInTheDocument()
  })

  it('renders ConnectionHeader', () => {
    setupConnectedState()
    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )
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
    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )
    expect(screen.getByText('No databases loaded')).toBeInTheDocument()
  })

  it('renders database nodes from store', () => {
    setupConnectedState()
    setupDatabaseNodes()

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )
    expect(screen.getByText('ecommerce_db')).toBeInTheDocument()
    expect(screen.getByText('analytics_db')).toBeInTheDocument()
  })

  it('filter input changes filterText in store', async () => {
    const user = userEvent.setup()
    setupConnectedState()
    setupDatabaseNodes()

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )
    const input = screen.getByTestId('filter-input')
    await user.type(input, 'ecommerce')

    expect(useSchemaStore.getState().connectionStates[CONN_ID].filterText).toBe('ecommerce')
  })

  it('starts filtering when typing from the tree without focusing the filter input first', async () => {
    const user = userEvent.setup()
    setupConnectedState()
    setupDatabaseNodes()
    const db1Id = makeNodeId('database', 'ecommerce_db', 'ecommerce_db')

    setSchemaState({
      connectionStates: {
        [CONN_ID]: {
          ...useSchemaStore.getState().connectionStates[CONN_ID],
          expandedNodes: new Set([db1Id]),
        },
      },
    })

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

    const tablesNode = screen.getByText('Tables').closest('[role="treeitem"]')
    expect(tablesNode).not.toBeNull()

    await user.click(tablesNode!)
    await user.keyboard('user')

    expect(screen.getByTestId('filter-input')).toHaveValue('user')
    expect(useSchemaStore.getState().connectionStates[CONN_ID].filterText).toBe('user')
  })

  it('calls loadDatabases on mount when connected', () => {
    const loadDatabases = vi.fn().mockResolvedValue(undefined)
    useSchemaStore.setState({ loadDatabases })
    setupConnectedState()

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )
    expect(loadDatabases).toHaveBeenCalledWith(CONN_ID)
  })

  it('filtered tree shows matching nodes and their ancestors', () => {
    setupConnectedState()
    setupDatabaseNodes()

    // Set filter to "users" — should show ecommerce_db > Tables > users
    act(() => {
      useSchemaStore.getState().setFilter('users', CONN_ID)
    })

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

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

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

    expect(screen.getByText('users')).toBeInTheDocument()
    expect(screen.getByText('ecommerce_db')).toBeInTheDocument()
    expect(screen.getByText('Tables')).toBeInTheDocument()
    expect(screen.getByText('analytics_db')).toBeInTheDocument()
  })

  it('when the first root is filtered out, the first visible remaining row stays tabbable', () => {
    setupConnectedState()
    setupDatabaseNodes()

    act(() => {
      useSchemaStore.getState().setFilter('commerce', CONN_ID)
    })

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

    const treeItems = screen.getAllByRole('treeitem')
    expect(treeItems[0]).toHaveTextContent('ecommerce_db')
    expect(treeItems[0]).toHaveAttribute('tabindex', '0')
    expect(screen.queryByText('analytics_db')).not.toBeInTheDocument()
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

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

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

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

    expect(screen.getByText('Tables')).toBeInTheDocument()
    expect(screen.queryByText('users')).not.toBeInTheDocument()
    expect(screen.getByText('Views')).toBeInTheDocument()
  })

  it('clicking a filtered table keeps sibling tables filtered out', async () => {
    const user = userEvent.setup()
    setupConnectedState()
    setupFilteredTableNodes()

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

    expect(screen.getByText('users')).toBeInTheDocument()
    expect(screen.queryByText('orders')).not.toBeInTheDocument()

    await user.click(screen.getByText('users'))

    expect(screen.getByTestId('filter-input')).toHaveValue('user')
    expect(screen.queryByText('orders')).not.toBeInTheDocument()
  })

  it('expanded columns stay visible even when the filter only matches the table name', async () => {
    const user = userEvent.setup()
    setupConnectedState()
    setupFilteredTableNodes()

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

    const usersRow = screen.getByText('users').closest<HTMLElement>('[role="treeitem"]')
    expect(usersRow).not.toBeNull()

    await user.click(within(usersRow!).getByTestId('tree-node-chevron'))

    expect(screen.getByText('id')).toBeInTheDocument()
    expect(screen.queryByText('orders')).not.toBeInTheDocument()
    expect(screen.getByTestId('filter-input')).toHaveValue('user')
  })

  it('with Tables selected, filtering by a column name does not surface tables or columns', () => {
    setupConnectedState()
    const { tablesId } = setupFilteredTableNodes()

    setSchemaState({
      connectionStates: {
        [CONN_ID]: {
          ...useSchemaStore.getState().connectionStates[CONN_ID],
          selectedNodeId: tablesId,
          filterText: 'id',
        },
      },
    })

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

    expect(screen.getByText('Tables')).toBeInTheDocument()
    expect(screen.queryByText('users')).not.toBeInTheDocument()
    expect(screen.queryByText('orders')).not.toBeInTheDocument()
    expect(screen.queryByText('id')).not.toBeInTheDocument()
  })

  it('with a filtered column selected, sibling tables stay filtered out and the selected column stays focusable', () => {
    setupConnectedState()
    const { usersId, userIdColumnId } = setupFilteredTableNodes()

    setSchemaState({
      connectionStates: {
        [CONN_ID]: {
          ...useSchemaStore.getState().connectionStates[CONN_ID],
          expandedNodes: new Set([
            makeNodeId('database', 'ecommerce_db', 'ecommerce_db'),
            makeNodeId('category', 'ecommerce_db', 'table'),
            usersId,
          ]),
          selectedNodeId: userIdColumnId,
        },
      },
    })

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

    expect(screen.getByText('users')).toBeInTheDocument()
    expect(screen.queryByText('orders')).not.toBeInTheDocument()

    const selectedColumnRow = screen.getByText('id').closest('[role="treeitem"]')
    expect(selectedColumnRow).not.toBeNull()
    expect(selectedColumnRow).toHaveAttribute('tabindex', '0')
    expect(screen.getAllByRole('treeitem')[0]).toHaveAttribute('tabindex', '-1')
  })

  it('backspace from the tree updates the filter without focusing the input first', async () => {
    const user = userEvent.setup()
    setupConnectedState()
    setupFilteredTableNodes()

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

    const tablesNode = screen.getByText('Tables').closest('[role="treeitem"]')
    expect(tablesNode).not.toBeNull()

    await user.click(tablesNode!)
    await user.keyboard('{Backspace}')

    expect(screen.getByTestId('filter-input')).toHaveValue('use')
    expect(useSchemaStore.getState().connectionStates[CONN_ID].filterText).toBe('use')
  })

  it('single-clicking a table opens the table view without expanding its columns', async () => {
    const user = userEvent.setup()
    setupConnectedState()
    setupFilteredTableNodes()

    useSchemaStore.setState({
      connectionStates: {
        [CONN_ID]: {
          ...useSchemaStore.getState().connectionStates[CONN_ID],
          filterText: '',
        },
      },
    })

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

    expect(screen.queryByText('id')).not.toBeInTheDocument()

    await user.click(screen.getByText('users'))

    expect(screen.queryByText('id')).not.toBeInTheDocument()

    const tabs = useWorkspaceStore.getState().tabsByConnection[CONN_ID]
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toMatchObject({
      type: 'table-data',
      label: 'users',
      objectType: 'table',
      objectName: 'users',
      databaseName: 'ecommerce_db',
    })
  })

  it('shows "Not connected" when connection is disconnected', () => {
    setConnectionState({
      activeConnections: {
        [CONN_ID]: makeActiveConnection({ status: 'disconnected' }),
      },
    })

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )
    expect(screen.getByText('Not connected')).toBeInTheDocument()
  })

  it('renders filter input with placeholder', () => {
    setupConnectedState()
    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )
    expect(screen.getByPlaceholderText('Filter objects...')).toBeInTheDocument()
  })

  it('right-clicking a tree node shows context menu', async () => {
    const user = userEvent.setup()
    setupConnectedState()
    setupDatabaseNodes()

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

    const dbNode = screen.getByText('ecommerce_db')
    await user.pointer({ target: dbNode, keys: '[MouseRight]' })
    await screen.findByTestId('object-browser-context-menu')

    expect(screen.getByTestId('object-browser-context-menu')).toBeInTheDocument()
  })

  it('double-clicking a table node opens a table-data workspace tab', async () => {
    const user = userEvent.setup()
    setupConnectedState()
    setupDatabaseNodes()
    expandToTable()

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )
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

  it('scopes a double-clicked table tab to the active query tab when the setting is enabled', async () => {
    const user = userEvent.setup()
    setupConnectedState()
    setupDatabaseNodes()
    expandToTable()
    setBottomPanelSetting(true)

    act(() => {
      useWorkspaceStore.getState().openQueryTab(CONN_ID, 'Query 1')
    })

    const activeQueryTabId = useWorkspaceStore.getState().activeTabByConnection[CONN_ID]
    expect(activeQueryTabId).toBeTruthy()

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

    await user.dblClick(screen.getByText('users'))

    const state = useWorkspaceStore.getState()
    const tabs = state.tabsByConnection[CONN_ID]
    const tableTabs = tabs.filter((tab) => tab.type === 'table-data')
    expect(tableTabs).toHaveLength(1)
    expect(tableTabs[0]).toMatchObject({
      type: 'table-data',
      objectName: 'users',
      objectType: 'table',
      parentQueryTabId: activeQueryTabId,
    })
    expect(state.activeTabByConnection[CONN_ID]).toBe(activeQueryTabId)
  })

  it('auto-creates a parent query tab for a double-clicked table when the setting is enabled', async () => {
    const user = userEvent.setup()
    setupConnectedState()
    setupDatabaseNodes()
    expandToTable()
    setBottomPanelSetting(true)

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

    await user.dblClick(screen.getByText('users'))

    const state = useWorkspaceStore.getState()
    const tabs = state.tabsByConnection[CONN_ID]
    const queryTabs = tabs.filter((tab) => tab.type === 'query-editor')
    const tableTabs = tabs.filter((tab) => tab.type === 'table-data')

    expect(queryTabs).toHaveLength(1)
    expect(tableTabs).toHaveLength(1)
    expect(tableTabs[0]).toMatchObject({
      parentQueryTabId: queryTabs[0].id,
      objectName: 'users',
    })
    expect(state.activeTabByConnection[CONN_ID]).toBe(queryTabs[0].id)
  })

  it('keeps table tabs standalone when the setting is disabled', async () => {
    const user = userEvent.setup()
    setupConnectedState()
    setupDatabaseNodes()
    expandToTable()
    setBottomPanelSetting(false)

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

    await user.dblClick(screen.getByText('users'))

    const state = useWorkspaceStore.getState()
    const tabs = state.tabsByConnection[CONN_ID]
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toMatchObject({
      type: 'table-data',
      objectName: 'users',
    })
    expect(tabs[0]).not.toHaveProperty('parentQueryTabId')
    expect(state.activeTabByConnection[CONN_ID]).toBe(tabs[0].id)
  })

  it('deduplicates table opens within a query context but allows the same table in a different query tab', async () => {
    const user = userEvent.setup()
    setupConnectedState()
    setupDatabaseNodes()
    expandToTable()
    setBottomPanelSetting(true)

    act(() => {
      useWorkspaceStore.getState().openQueryTab(CONN_ID, 'Query 1')
    })

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

    await user.dblClick(screen.getByText('users'))
    await user.dblClick(screen.getByText('users'))

    let state = useWorkspaceStore.getState()
    let tabs = state.tabsByConnection[CONN_ID]
    let queryTabs = tabs.filter((tab) => tab.type === 'query-editor')
    let tableTabs = tabs.filter((tab) => tab.type === 'table-data')

    expect(queryTabs).toHaveLength(1)
    expect(tableTabs).toHaveLength(1)
    expect(state.activeTabByConnection[CONN_ID]).toBe(queryTabs[0].id)

    act(() => {
      useWorkspaceStore.getState().openQueryTab(CONN_ID, 'Query 2')
    })

    const secondQueryTabId = useWorkspaceStore.getState().activeTabByConnection[CONN_ID]

    await user.dblClick(screen.getByText('users'))

    state = useWorkspaceStore.getState()
    tabs = state.tabsByConnection[CONN_ID]
    queryTabs = tabs.filter((tab) => tab.type === 'query-editor')
    tableTabs = tabs.filter((tab) => tab.type === 'table-data')

    expect(queryTabs).toHaveLength(2)
    expect(tableTabs).toHaveLength(2)
    expect(tableTabs.map((tab) => tab.parentQueryTabId)).toEqual([
      queryTabs[0].id,
      secondQueryTabId,
    ])
    expect(state.activeTabByConnection[CONN_ID]).toBe(secondQueryTabId)
  })

  it('double-clicking a table row does not expand its columns', async () => {
    const user = userEvent.setup()
    setupConnectedState()
    setupFilteredTableNodes()

    setSchemaState({
      connectionStates: {
        [CONN_ID]: {
          ...useSchemaStore.getState().connectionStates[CONN_ID],
          filterText: '',
        },
      },
    })

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

    expect(screen.queryByText('id')).not.toBeInTheDocument()

    await user.dblClick(screen.getByText('users'))

    expect(screen.queryByText('id')).not.toBeInTheDocument()

    const tabs = useWorkspaceStore.getState().tabsByConnection[CONN_ID]
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toMatchObject({
      type: 'table-data',
      label: 'users',
      objectType: 'table',
      objectName: 'users',
      databaseName: 'ecommerce_db',
    })
  })

  it('design table context menu item opens table-designer tab in alter mode', async () => {
    const user = userEvent.setup()
    setupConnectedState()
    setupDatabaseNodes()
    expandToTable()

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

    await openContextMenu(user, 'users')
    await user.click(screen.getByText('Alter Table...'))

    const tabs = useWorkspaceStore.getState().tabsByConnection[CONN_ID]
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toMatchObject({
      type: 'table-designer',
      mode: 'alter',
      objectName: 'users',
      databaseName: 'ecommerce_db',
      connectionId: CONN_ID,
      label: 'users',
    })
  })

  it('copy-to-host on a database menu opens the dialog with source context and no preselection', async () => {
    const user = userEvent.setup()
    setupConnectedState()
    setupDatabaseNodes()

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

    await openContextMenu(user, 'ecommerce_db')
    await user.click(screen.getByText('Copy to Another Host...'))

    expect(await screen.findByRole('heading', { name: 'Copy to Another Host' })).toBeInTheDocument()
    expect((screen.getByTestId('copy-source-connection') as HTMLInputElement).value).toBe('Test DB')
    expect((screen.getByTestId('copy-source-database') as HTMLInputElement).value).toBe(
      'ecommerce_db'
    )
    expect(await screen.findByTestId('copy-object-tables-users')).toBeInTheDocument()
    expect((screen.getByTestId('copy-object-tables-users') as HTMLInputElement).checked).toBe(false)
  })

  it.each([
    ['table', 'users', 'copy-object-tables-users'],
    ['procedure', 'sp_recalc', 'copy-object-procedures-sp_recalc'],
    ['function', 'fn_total', 'copy-object-functions-fn_total'],
    ['trigger', 'trg_audit', 'copy-object-triggers-trg_audit'],
    ['event', 'nightly_cleanup', 'copy-object-events-nightly_cleanup'],
  ] as const)(
    'copy-to-host on a %s menu opens the dialog with the correct preselection',
    async (nodeType, nodeLabel, expectedCheckboxTestId) => {
      const user = userEvent.setup()
      setupConnectedState()
      if (nodeType === 'event') {
        ipc.override('list_copyable_objects', () => ({
          tables: [
            { name: 'users', estimatedRows: 100 },
            { name: 'orders', estimatedRows: 500 },
          ],
          procedures: ['sp_recalc'],
          functions: ['fn_total'],
          triggers: ['trg_audit'],
          events: ['nightly_cleanup'],
        }))
      }

      if (nodeType === 'table') {
        setupDatabaseNodes()
        expandToTable()
      } else {
        setupCopyableObjectNodes(nodeType)
      }

      render(
        <ObjectBrowser
          connectionId={CONN_ID}
          favouritesOpen={false}
          onToggleFavourites={() => {}}
        />
      )

      await openContextMenu(user, nodeLabel)
      await user.click(screen.getByText('Copy to Another Host...'))

      expect(
        await screen.findByRole('heading', { name: 'Copy to Another Host' })
      ).toBeInTheDocument()
      expect((await screen.findByTestId(expectedCheckboxTestId)) as HTMLInputElement).toBeChecked()
    }
  )

  it('create table context menu item on table node opens designer in create mode', async () => {
    const user = userEvent.setup()
    setupConnectedState()
    setupDatabaseNodes()
    expandToTable()

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

    await openContextMenu(user, 'users')
    await user.click(screen.getByText('Create Table...'))

    const tabs = useWorkspaceStore.getState().tabsByConnection[CONN_ID]
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toMatchObject({
      type: 'table-designer',
      mode: 'create',
      objectName: '__new_table__',
      databaseName: 'ecommerce_db',
      connectionId: CONN_ID,
      label: 'New Table',
    })
  })

  it('create table context menu item on database node opens designer in create mode', async () => {
    const user = userEvent.setup()
    setupConnectedState()
    setupDatabaseNodes()

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

    await openContextMenu(user, 'ecommerce_db')
    await user.click(screen.getByTestId('ctx-create-table'))

    const tabs = useWorkspaceStore.getState().tabsByConnection[CONN_ID]
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toMatchObject({
      type: 'table-designer',
      mode: 'create',
      objectName: '__new_table__',
      databaseName: 'ecommerce_db',
      connectionId: CONN_ID,
      label: 'New Table',
    })
  })

  it('design table item disabled when connection is read-only', async () => {
    const user = userEvent.setup()
    setupConnectedState({ readOnly: true })
    setupDatabaseNodes()
    expandToTable()

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

    await openContextMenu(user, 'users')

    expect(screen.queryByText('Alter Table...')).not.toBeInTheDocument()
  })

  it('create table item disabled when connection is read-only', async () => {
    const user = userEvent.setup()
    setupConnectedState({ readOnly: true })
    setupDatabaseNodes()
    expandToTable()

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

    await openContextMenu(user, 'users')

    expect(screen.queryByText('Create Table...')).not.toBeInTheDocument()
  })

  it('double-clicking a view node opens a table-data tab with objectType view', async () => {
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

    setSchemaState({
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

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )
    const viewNode = screen.getByText('user_stats')
    await user.dblClick(viewNode)

    const state = useWorkspaceStore.getState()
    const tabs = state.tabsByConnection[CONN_ID]
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toMatchObject({
      type: 'table-data',
      label: 'user_stats',
      objectType: 'view',
      objectName: 'user_stats',
    })
  })

  it.each([
    ['view', 'user_stats', 'table-data', 'view'],
    ['procedure', 'sp_test', 'schema-info', 'procedure'],
    ['function', 'fn_test', 'schema-info', 'function'],
  ] as const)(
    'single-clicking a %s node opens the expected workspace tab',
    async (nodeType, objectName, expectedTabType, expectedObjectType) => {
      const user = userEvent.setup()
      setupConnectedState()

      const nodeId = makeNodeId(nodeType, 'ecommerce_db', objectName)
      const categoryId = makeNodeId('category', 'ecommerce_db', nodeType)
      const databaseId = makeNodeId('database', 'ecommerce_db', 'ecommerce_db')

      const nodes: Record<string, TreeNodeType> = {
        [databaseId]: {
          id: databaseId,
          label: 'ecommerce_db',
          type: 'database',
          parentId: null,
          hasChildren: true,
          isLoaded: true,
        },
        [categoryId]: {
          id: categoryId,
          label: `${nodeType[0].toUpperCase()}${nodeType.slice(1)}s`,
          type: 'category',
          parentId: databaseId,
          hasChildren: true,
          isLoaded: true,
          metadata: { categoryType: nodeType, databaseName: 'ecommerce_db' },
        },
        [nodeId]: {
          id: nodeId,
          label: objectName,
          type: nodeType,
          parentId: categoryId,
          hasChildren: false,
          isLoaded: true,
          metadata: { databaseName: 'ecommerce_db' },
        },
      }

      setSchemaState({
        connectionStates: {
          [CONN_ID]: {
            nodes,
            childIdsByParentId: buildChildIndex(nodes),
            expandedNodes: new Set([databaseId, categoryId]),
            loadingNodes: new Set(),
            selectedNodeId: null,
            filterText: '',
            loadGeneration: 0,
          },
        },
      })

      render(
        <ObjectBrowser
          connectionId={CONN_ID}
          favouritesOpen={false}
          onToggleFavourites={() => {}}
        />
      )

      await user.click(screen.getByText(objectName))

      const state = useWorkspaceStore.getState()
      const tabs = state.tabsByConnection[CONN_ID]
      expect(tabs).toHaveLength(1)
      expect(tabs[0]).toMatchObject({
        type: expectedTabType,
        label: objectName,
        objectType: expectedObjectType,
        objectName,
        databaseName: 'ecommerce_db',
      })
    }
  )

  it('selecting a database node switches the active session database', async () => {
    const user = userEvent.setup()
    setupConnectedState()
    setupDatabaseNodes()
    const setActiveDatabase = vi.fn().mockResolvedValue(undefined)
    setConnectionState({ setActiveDatabase })

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

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
    setConnectionState({ setActiveDatabase })

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

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

      render(
        <ObjectBrowser
          connectionId={CONN_ID}
          favouritesOpen={false}
          onToggleFavourites={() => {}}
        />
      )
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
      setSchemaState({ refreshAll })

      render(
        <ObjectBrowser
          connectionId={CONN_ID}
          favouritesOpen={false}
          onToggleFavourites={() => {}}
        />
      )
      await openContextMenu(user, 'ecommerce_db')
      await user.click(screen.getByText('Drop Database...'))
      await user.click(screen.getByTestId('confirm-confirm-button'))

      await waitFor(() => {
        expect(ipc.calls('drop_database')).toContainEqual({
          connectionId: CONN_ID,
          name: 'ecommerce_db',
        })
      })
      await waitFor(() => {
        expect(refreshAll).toHaveBeenCalledWith(CONN_ID)
      })
    })

    it('shows error on failed drop and keeps dialog open', async () => {
      ipc.override('drop_database', () => {
        throw new Error('Access denied')
      })
      const user = userEvent.setup()
      setupConnectedState()
      setupDatabaseNodes()

      render(
        <ObjectBrowser
          connectionId={CONN_ID}
          favouritesOpen={false}
          onToggleFavourites={() => {}}
        />
      )
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

      render(
        <ObjectBrowser
          connectionId={CONN_ID}
          favouritesOpen={false}
          onToggleFavourites={() => {}}
        />
      )
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
      setSchemaState({ refreshCategory })

      render(
        <ObjectBrowser
          connectionId={CONN_ID}
          favouritesOpen={false}
          onToggleFavourites={() => {}}
        />
      )
      await openContextMenu(user, 'users')
      await user.click(screen.getByText('Drop Table...'))
      await user.click(screen.getByTestId('confirm-confirm-button'))

      await waitFor(() => {
        expect(ipc.calls('drop_table')).toContainEqual({
          connectionId: CONN_ID,
          database: 'ecommerce_db',
          table: 'users',
        })
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

      render(
        <ObjectBrowser
          connectionId={CONN_ID}
          favouritesOpen={false}
          onToggleFavourites={() => {}}
        />
      )
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

      render(
        <ObjectBrowser
          connectionId={CONN_ID}
          favouritesOpen={false}
          onToggleFavourites={() => {}}
        />
      )
      await openContextMenu(user, 'users')
      await user.click(screen.getByText('Truncate Table...'))
      await user.click(screen.getByTestId('confirm-confirm-button'))

      await waitFor(() => {
        expect(ipc.calls('truncate_table')).toContainEqual({
          connectionId: CONN_ID,
          database: 'ecommerce_db',
          table: 'users',
        })
      })
    })
  })

  describe('dialog: Rename Table', () => {
    it('opens rename dialog via context menu', async () => {
      const user = userEvent.setup()
      setupConnectedState()
      setupDatabaseNodes()
      expandToTable()

      render(
        <ObjectBrowser
          connectionId={CONN_ID}
          favouritesOpen={false}
          onToggleFavourites={() => {}}
        />
      )
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
      setSchemaState({ refreshCategory })

      render(
        <ObjectBrowser
          connectionId={CONN_ID}
          favouritesOpen={false}
          onToggleFavourites={() => {}}
        />
      )
      await openContextMenu(user, 'users')
      await user.click(screen.getByText('Rename Table...'))

      const input = screen.getByTestId('rename-name-input')
      await user.clear(input)
      await user.type(input, 'customers')
      await user.click(screen.getByTestId('rename-confirm-button'))

      await waitFor(() => {
        expect(ipc.calls('rename_table')).toContainEqual({
          connectionId: CONN_ID,
          database: 'ecommerce_db',
          oldName: 'users',
          newName: 'customers',
        })
      })
      await waitFor(() => {
        expect(refreshCategory).toHaveBeenCalledWith(CONN_ID, 'ecommerce_db', 'table')
      })
    })

    it('shows error on failed rename and keeps dialog open', async () => {
      ipc.override('rename_table', () => {
        throw new Error('Table locked')
      })
      const user = userEvent.setup()
      setupConnectedState()
      setupDatabaseNodes()
      expandToTable()

      render(
        <ObjectBrowser
          connectionId={CONN_ID}
          favouritesOpen={false}
          onToggleFavourites={() => {}}
        />
      )
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

      render(
        <ObjectBrowser
          connectionId={CONN_ID}
          favouritesOpen={false}
          onToggleFavourites={() => {}}
        />
      )
      await openContextMenu(user, 'ecommerce_db')
      await user.click(screen.getByText('Create Database...'))

      expect(screen.getByTestId('create-database-dialog')).toBeInTheDocument()
    })

    it('opening and closing create database dialog does not trigger a hook-order crash', async () => {
      const user = userEvent.setup()
      setupConnectedState()
      setupDatabaseNodes()
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      try {
        render(
          <ObjectBrowser
            connectionId={CONN_ID}
            favouritesOpen={false}
            onToggleFavourites={() => {}}
          />
        )
        await openContextMenu(user, 'ecommerce_db')
        await user.click(screen.getByText('Create Database...'))

        await waitFor(() => {
          expect(screen.getByTestId('create-database-dialog')).toBeInTheDocument()
        })

        await user.click(screen.getByTestId('create-db-cancel-button'))

        await waitFor(() => {
          expect(screen.queryByTestId('create-database-dialog')).not.toBeInTheDocument()
        })

        expect(consoleErrorSpy).not.toHaveBeenCalledWith(
          expect.stringContaining('React has detected a change in the order of Hooks called')
        )
      } finally {
        consoleErrorSpy.mockRestore()
      }
    })
  })

  describe('dialog: Alter Database', () => {
    it('opens alter database dialog via context menu', async () => {
      const user = userEvent.setup()
      setupConnectedState()
      setupDatabaseNodes()

      render(
        <ObjectBrowser
          connectionId={CONN_ID}
          favouritesOpen={false}
          onToggleFavourites={() => {}}
        />
      )
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

      render(
        <ObjectBrowser
          connectionId={CONN_ID}
          favouritesOpen={false}
          onToggleFavourites={() => {}}
        />
      )
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
      setSchemaState({ refreshAll })

      render(
        <ObjectBrowser
          connectionId={CONN_ID}
          favouritesOpen={false}
          onToggleFavourites={() => {}}
        />
      )
      await openContextMenu(user, 'ecommerce_db')
      await user.click(screen.getByText('Rename Database...'))

      const input = screen.getByTestId('rename-name-input')
      await user.clear(input)
      await user.type(input, 'production_db')
      await user.click(screen.getByTestId('rename-confirm-button'))

      await waitFor(() => {
        expect(ipc.calls('rename_database')).toContainEqual({
          connectionId: CONN_ID,
          oldName: 'ecommerce_db',
          newName: 'production_db',
        })
      })
      await waitFor(() => {
        expect(refreshAll).toHaveBeenCalledWith(CONN_ID)
      })
    })
  })

  describe('closeTabsByObject: view table-data tabs', () => {
    it('closes view table-data tab when dropping a view via closeTabsByObject', () => {
      setupConnectedState()

      // Simulate an open view table-data tab
      setWorkspaceState({
        tabsByConnection: {
          [CONN_ID]: [
            {
              id: 'tab-view-1',
              type: 'table-data',
              label: 'user_stats',
              connectionId: CONN_ID,
              databaseName: 'ecommerce_db',
              objectName: 'user_stats',
              objectType: 'view',
            } as WorkspaceTab,
          ],
        },
        activeTabByConnection: {
          [CONN_ID]: 'tab-view-1',
        },
      })

      // Call closeTabsByObject with objectType 'view' — as handleDropObjectConfirm does
      useWorkspaceStore.getState().closeTabsByObject(CONN_ID, 'ecommerce_db', 'user_stats', 'view')

      const tabs = useWorkspaceStore.getState().tabsByConnection[CONN_ID]
      expect(tabs).toHaveLength(0)
    })

    it('does not close a table table-data tab when dropping a view with the same name', () => {
      setupConnectedState()

      // Simulate an open TABLE tab with the same name as the view being dropped
      setWorkspaceState({
        tabsByConnection: {
          [CONN_ID]: [
            {
              id: 'tab-table-1',
              type: 'table-data',
              label: 'shared_name',
              connectionId: CONN_ID,
              databaseName: 'ecommerce_db',
              objectName: 'shared_name',
              objectType: 'table',
            } as WorkspaceTab,
          ],
        },
        activeTabByConnection: {
          [CONN_ID]: 'tab-table-1',
        },
      })

      // Dropping a VIEW named 'shared_name' should NOT close the table's tab
      useWorkspaceStore.getState().closeTabsByObject(CONN_ID, 'ecommerce_db', 'shared_name', 'view')

      const tabs = useWorkspaceStore.getState().tabsByConnection[CONN_ID]
      expect(tabs).toHaveLength(1)
      expect(tabs[0].id).toBe('tab-table-1')
    })
  })

  // ---------------------------------------------------------------------------
  // Bug: F5 should refresh the selected/active database
  // ---------------------------------------------------------------------------

  it('pressing F5 on the tree calls refreshDatabase for the selected database', async () => {
    const user = userEvent.setup()
    setupConnectedState()
    setupDatabaseNodes()
    const db1Id = makeNodeId('database', 'ecommerce_db', 'ecommerce_db')
    const refreshDatabase = vi.fn().mockResolvedValue(undefined)
    setSchemaState({
      refreshDatabase,
      connectionStates: {
        [CONN_ID]: {
          ...useSchemaStore.getState().connectionStates[CONN_ID],
          selectedNodeId: db1Id,
          expandedNodes: new Set([db1Id]),
        },
      },
    })

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

    // Focus a tree item and press F5
    const dbNode = screen.getByText('ecommerce_db').closest('[role="treeitem"]')
    expect(dbNode).not.toBeNull()
    await user.click(dbNode!)
    await user.keyboard('{F5}')

    await waitFor(() => {
      expect(refreshDatabase).toHaveBeenCalledWith(CONN_ID, 'ecommerce_db')
    })
  })

  // ---------------------------------------------------------------------------
  // Bug regression: filter text should clear on scope change
  // ---------------------------------------------------------------------------

  it('clears filter text when clicking a different database node (scope change)', async () => {
    const user = userEvent.setup()
    setupConnectedState()
    setupDatabaseNodes()
    const db1Id = makeNodeId('database', 'ecommerce_db', 'ecommerce_db')

    // Set initial state: ecommerce_db selected with filterText 'users'
    act(() => {
      useSchemaStore.setState({
        connectionStates: {
          [CONN_ID]: {
            ...useSchemaStore.getState().connectionStates[CONN_ID],
            selectedNodeId: db1Id,
            filterText: 'users',
            expandedNodes: new Set([db1Id]),
          },
        },
      })
    })

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

    // Verify filter input shows 'users'
    expect(screen.getByTestId('filter-input')).toHaveValue('users')

    // Click analytics_db to change scope
    await user.click(screen.getByText('analytics_db'))

    // After clicking a different database, the filter should be cleared
    await waitFor(() => {
      expect(useSchemaStore.getState().connectionStates[CONN_ID].filterText).toBe('')
    })
    expect(screen.getByTestId('filter-input')).toHaveValue('')
  })

  // ---------------------------------------------------------------------------
  // Bug regression: filter input should have a clear (×) button
  // ---------------------------------------------------------------------------

  it('shows a clear button when filter has text, and clears filter on click', async () => {
    const user = userEvent.setup()
    setupConnectedState()
    setupDatabaseNodes()

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

    // No clear button when filter is empty
    expect(screen.queryByTestId('filter-clear-button')).not.toBeInTheDocument()

    // Type into the filter input
    const input = screen.getByTestId('filter-input')
    await user.type(input, 'users')

    // Clear button should now be visible
    expect(screen.getByTestId('filter-clear-button')).toBeInTheDocument()

    // Click the clear button
    await user.click(screen.getByTestId('filter-clear-button'))

    // Filter should be cleared
    expect(screen.getByTestId('filter-input')).toHaveValue('')
    expect(useSchemaStore.getState().connectionStates[CONN_ID].filterText).toBe('')
  })

  it('F5 should call refreshDatabase for selected database', async () => {
    setupConnectedState()
    setupDatabaseNodes()

    const db1Id = makeNodeId('database', 'ecommerce_db', 'ecommerce_db')

    // Select a database node and set up mock before render
    const refreshMock = vi.fn().mockResolvedValue(undefined)
    const origRefresh = useSchemaStore.getState().refreshDatabase

    act(() => {
      const state = useSchemaStore.getState()
      useSchemaStore.setState({
        refreshDatabase: refreshMock,
        connectionStates: {
          ...state.connectionStates,
          [CONN_ID]: {
            ...state.connectionStates[CONN_ID],
            selectedNodeId: db1Id,
          },
        },
      })
    })

    render(
      <ObjectBrowser connectionId={CONN_ID} favouritesOpen={false} onToggleFavourites={vi.fn()} />
    )

    // Fire F5 keydown on the tree container
    const treeContainer = screen.getByTestId('object-browser-scroll')
    fireEvent.keyDown(treeContainer, { key: 'F5' })

    expect(refreshMock).toHaveBeenCalledWith(CONN_ID, 'ecommerce_db')
    setSchemaState({ refreshDatabase: origRefresh })
  })

  it('preserves each connection per-tab search state when switching connection tabs', async () => {
    const CONN_A = 'conn-A'
    const CONN_B = 'conn-B'

    const dbId = makeNodeId('database', 'ecommerce_db', 'ecommerce_db')
    const tablesId = makeNodeId('category', 'ecommerce_db', 'table')
    const usersId = makeNodeId('table', 'ecommerce_db', 'users')
    const ordersId = makeNodeId('table', 'ecommerce_db', 'orders')

    const nodes: Record<string, TreeNodeType> = {
      [dbId]: {
        id: dbId,
        label: 'ecommerce_db',
        type: 'database',
        parentId: null,
        hasChildren: true,
        isLoaded: true,
        databaseName: 'ecommerce_db',
        objectName: 'ecommerce_db',
      },
      [tablesId]: {
        id: tablesId,
        label: 'Tables',
        type: 'category',
        parentId: dbId,
        hasChildren: true,
        isLoaded: true,
        databaseName: 'ecommerce_db',
        metadata: { categoryType: 'table', databaseName: 'ecommerce_db' },
      },
      [usersId]: {
        id: usersId,
        label: 'users',
        type: 'table',
        parentId: tablesId,
        hasChildren: false,
        isLoaded: true,
        databaseName: 'ecommerce_db',
        objectName: 'users',
        metadata: { databaseName: 'ecommerce_db' },
      },
      [ordersId]: {
        id: ordersId,
        label: 'orders',
        type: 'table',
        parentId: tablesId,
        hasChildren: false,
        isLoaded: true,
        databaseName: 'ecommerce_db',
        objectName: 'orders',
        metadata: { databaseName: 'ecommerce_db' },
      },
    }

    setConnectionState({
      activeConnections: {
        [CONN_A]: makeActiveConnection({ id: CONN_A }),
        [CONN_B]: makeActiveConnection({ id: CONN_B }),
      },
      activeTabId: CONN_A,
    })

    // Connection A: no selection (scope = whole tree), keyword "users".
    // Connection B: Tables category selected (scope = tablesId), keyword "orders".
    setSchemaState({
      connectionStates: {
        [CONN_A]: {
          nodes,
          childIdsByParentId: buildChildIndex(nodes),
          expandedNodes: new Set([dbId, tablesId]),
          loadingNodes: new Set(),
          selectedNodeId: null,
          filterText: 'users',
          loadGeneration: 0,
        },
        [CONN_B]: {
          nodes,
          childIdsByParentId: buildChildIndex(nodes),
          expandedNodes: new Set([dbId, tablesId]),
          loadingNodes: new Set(),
          selectedNodeId: tablesId,
          filterText: 'orders',
          loadGeneration: 0,
        },
      },
    })

    const { rerender } = render(
      <ObjectBrowser connectionId={CONN_A} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

    expect(screen.getByTestId('filter-input')).toHaveValue('users')

    // Switch to connection B (same component instance, new connectionId prop).
    setConnectionState({ activeTabId: CONN_B })
    rerender(
      <ObjectBrowser connectionId={CONN_B} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

    await waitFor(() => {
      expect(screen.getByTestId('filter-input')).toHaveValue('orders')
    })
    // B's keyword must NOT be wiped by the scope-change effect on tab switch.
    expect(useSchemaStore.getState().connectionStates[CONN_B].filterText).toBe('orders')

    // Switch back to connection A; its original keyword must be intact.
    setConnectionState({ activeTabId: CONN_A })
    rerender(
      <ObjectBrowser connectionId={CONN_A} favouritesOpen={false} onToggleFavourites={() => {}} />
    )

    await waitFor(() => {
      expect(screen.getByTestId('filter-input')).toHaveValue('users')
    })
    expect(useSchemaStore.getState().connectionStates[CONN_A].filterText).toBe('users')
  })
})
