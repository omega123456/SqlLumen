import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  useSchemaStore,
  makeNodeId,
  parseNodeId,
  SCHEMA_CATEGORIES,
} from '../../stores/schema-store'

// Mock the schema-commands module
vi.mock('../../lib/schema-commands', () => ({
  listDatabases: vi.fn(),
  listSchemaObjects: vi.fn(),
  listColumns: vi.fn(),
}))

import { listDatabases, listSchemaObjects, listColumns } from '../../lib/schema-commands'
const mockListDatabases = vi.mocked(listDatabases)
const mockListSchemaObjects = vi.mocked(listSchemaObjects)
const mockListColumns = vi.mocked(listColumns)

beforeEach(() => {
  useSchemaStore.setState({
    connectionStates: {},
  })
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Node ID helpers
// ---------------------------------------------------------------------------

describe('makeNodeId / parseNodeId', () => {
  it('creates and parses a node ID correctly', () => {
    const id = makeNodeId('database', 'mydb', 'mydb')
    const parsed = parseNodeId(id)
    expect(parsed.type).toBe('database')
    expect(parsed.database).toBe('mydb')
    expect(parsed.name).toBe('mydb')
  })

  it('handles Unicode characters in names', () => {
    const id = makeNodeId('table', 'données', 'ütf8_tëst')
    const parsed = parseNodeId(id)
    expect(parsed.type).toBe('table')
    expect(parsed.database).toBe('données')
    expect(parsed.name).toBe('ütf8_tëst')
  })

  it('handles colons in names via base64 encoding', () => {
    const id = makeNodeId('table', 'db:name', 'tbl:name')
    const parsed = parseNodeId(id)
    expect(parsed.database).toBe('db:name')
    expect(parsed.name).toBe('tbl:name')
  })
})

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('useSchemaStore — initial state', () => {
  it('has correct initial state', () => {
    const state = useSchemaStore.getState()
    expect(state.connectionStates).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// loadDatabases
// ---------------------------------------------------------------------------

describe('useSchemaStore — loadDatabases', () => {
  it('creates database nodes from backend response', async () => {
    mockListDatabases.mockResolvedValue(['db1', 'db2', 'db3'])

    await useSchemaStore.getState().loadDatabases('conn-1')

    const connState = useSchemaStore.getState().connectionStates['conn-1']
    expect(connState).toBeDefined()
    const nodeValues = Object.values(connState.nodes)
    expect(nodeValues).toHaveLength(3)

    const db1Node = nodeValues.find((n) => n.label === 'db1')
    expect(db1Node).toBeDefined()
    expect(db1Node!.type).toBe('database')
    expect(db1Node!.parentId).toBeNull()
    expect(db1Node!.hasChildren).toBe(true)
    expect(db1Node!.isLoaded).toBe(false)
  })

  it('calls listDatabases with the correct connectionId', async () => {
    mockListDatabases.mockResolvedValue([])
    await useSchemaStore.getState().loadDatabases('conn-42')
    expect(mockListDatabases).toHaveBeenCalledWith('conn-42')
  })

  it('propagates errors from the backend', async () => {
    mockListDatabases.mockRejectedValue(new Error('Connection lost'))
    await expect(useSchemaStore.getState().loadDatabases('conn-1')).rejects.toThrow(
      'Connection lost'
    )
  })
})

// ---------------------------------------------------------------------------
// toggleExpand — database node creates category nodes
// ---------------------------------------------------------------------------

describe('useSchemaStore — toggleExpand on database', () => {
  it('creates category child nodes (no backend call)', async () => {
    mockListDatabases.mockResolvedValue(['mydb'])
    await useSchemaStore.getState().loadDatabases('conn-1')

    const dbNodeId = makeNodeId('database', 'mydb', 'mydb')
    useSchemaStore.getState().toggleExpand(dbNodeId, 'conn-1')

    // Should NOT call any backend function for categories
    expect(mockListSchemaObjects).not.toHaveBeenCalled()

    const connState = useSchemaStore.getState().connectionStates['conn-1']
    const children = Object.values(connState.nodes).filter((n) => n.parentId === dbNodeId)

    // Should have 6 category nodes
    expect(children).toHaveLength(SCHEMA_CATEGORIES.length)
    expect(children.every((c) => c.type === 'category')).toBe(true)
    expect(children.map((c) => c.label).sort()).toEqual([
      'Events',
      'Functions',
      'Procedures',
      'Tables',
      'Triggers',
      'Views',
    ])

    // Each category should have metadata
    const tablesCategory = children.find((c) => c.label === 'Tables')
    expect(tablesCategory!.metadata?.categoryType).toBe('table')
    expect(tablesCategory!.metadata?.databaseName).toBe('mydb')
    expect(tablesCategory!.hasChildren).toBe(true)
    expect(tablesCategory!.isLoaded).toBe(false)
  })

  it('adds node to expandedNodes set', async () => {
    mockListDatabases.mockResolvedValue(['mydb'])
    await useSchemaStore.getState().loadDatabases('conn-1')

    const dbNodeId = makeNodeId('database', 'mydb', 'mydb')
    useSchemaStore.getState().toggleExpand(dbNodeId, 'conn-1')

    const connState = useSchemaStore.getState().connectionStates['conn-1']
    expect(connState.expandedNodes.has(dbNodeId)).toBe(true)
  })

  it('collapses when toggled again', async () => {
    mockListDatabases.mockResolvedValue(['mydb'])
    await useSchemaStore.getState().loadDatabases('conn-1')

    const dbNodeId = makeNodeId('database', 'mydb', 'mydb')
    useSchemaStore.getState().toggleExpand(dbNodeId, 'conn-1') // expand
    useSchemaStore.getState().toggleExpand(dbNodeId, 'conn-1') // collapse

    const connState = useSchemaStore.getState().connectionStates['conn-1']
    expect(connState.expandedNodes.has(dbNodeId)).toBe(false)
  })

  it('marks database node as loaded after expansion', async () => {
    mockListDatabases.mockResolvedValue(['mydb'])
    await useSchemaStore.getState().loadDatabases('conn-1')

    const dbNodeId = makeNodeId('database', 'mydb', 'mydb')
    useSchemaStore.getState().toggleExpand(dbNodeId, 'conn-1')

    const connState = useSchemaStore.getState().connectionStates['conn-1']
    expect(connState.nodes[dbNodeId].isLoaded).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// toggleExpand — category node triggers backend fetch
// ---------------------------------------------------------------------------

describe('useSchemaStore — toggleExpand on category', () => {
  it('triggers backend fetch and creates object nodes', async () => {
    mockListDatabases.mockResolvedValue(['mydb'])
    mockListSchemaObjects.mockResolvedValue(['users', 'orders'])
    await useSchemaStore.getState().loadDatabases('conn-1')

    // Expand database first
    const dbNodeId = makeNodeId('database', 'mydb', 'mydb')
    useSchemaStore.getState().toggleExpand(dbNodeId, 'conn-1')

    // Now expand the Tables category
    const tablesCatId = makeNodeId('category', 'mydb', 'table')
    useSchemaStore.getState().toggleExpand(tablesCatId, 'conn-1')

    // Wait for async load to complete
    await vi.waitFor(() => {
      const connState = useSchemaStore.getState().connectionStates['conn-1']
      expect(connState.nodes[tablesCatId].isLoaded).toBe(true)
    })

    expect(mockListSchemaObjects).toHaveBeenCalledWith('conn-1', 'mydb', 'table')

    const connState = useSchemaStore.getState().connectionStates['conn-1']
    const tableNodes = Object.values(connState.nodes).filter((n) => n.parentId === tablesCatId)
    expect(tableNodes).toHaveLength(2)
    expect(tableNodes.map((n) => n.label).sort()).toEqual(['orders', 'users'])
    expect(tableNodes[0].type).toBe('table')
    expect(tableNodes[0].metadata?.databaseName).toBe('mydb')
  })

  it('sets tables as having children, other types as leaf nodes', async () => {
    mockListDatabases.mockResolvedValue(['mydb'])
    mockListSchemaObjects.mockResolvedValue(['my_proc'])
    await useSchemaStore.getState().loadDatabases('conn-1')

    const dbNodeId = makeNodeId('database', 'mydb', 'mydb')
    useSchemaStore.getState().toggleExpand(dbNodeId, 'conn-1')

    const procCatId = makeNodeId('category', 'mydb', 'procedure')
    useSchemaStore.getState().toggleExpand(procCatId, 'conn-1')

    await vi.waitFor(() => {
      const connState = useSchemaStore.getState().connectionStates['conn-1']
      expect(connState.nodes[procCatId].isLoaded).toBe(true)
    })

    const connState = useSchemaStore.getState().connectionStates['conn-1']
    const procNodes = Object.values(connState.nodes).filter((n) => n.parentId === procCatId)
    expect(procNodes).toHaveLength(1)
    expect(procNodes[0].hasChildren).toBe(false) // procedures don't expand
  })
})

// ---------------------------------------------------------------------------
// loadChildren — table node loads columns
// ---------------------------------------------------------------------------

describe('useSchemaStore — loadChildren for table node', () => {
  it('loads columns from backend', async () => {
    mockListDatabases.mockResolvedValue(['mydb'])
    mockListSchemaObjects.mockResolvedValue(['users'])
    mockListColumns.mockResolvedValue([
      {
        name: 'id',
        dataType: 'int',
        nullable: false,
        columnKey: 'PRI',
        defaultValue: null,
        extra: '',
        ordinalPosition: 1,
      },
      {
        name: 'email',
        dataType: 'varchar',
        nullable: true,
        columnKey: '',
        defaultValue: null,
        extra: '',
        ordinalPosition: 2,
      },
    ])

    await useSchemaStore.getState().loadDatabases('conn-1')

    // Expand db → categories, then Tables → tables
    const dbNodeId = makeNodeId('database', 'mydb', 'mydb')
    useSchemaStore.getState().toggleExpand(dbNodeId, 'conn-1')

    const tablesCatId = makeNodeId('category', 'mydb', 'table')
    useSchemaStore.getState().toggleExpand(tablesCatId, 'conn-1')

    await vi.waitFor(() => {
      const cs = useSchemaStore.getState().connectionStates['conn-1']
      expect(cs.nodes[tablesCatId].isLoaded).toBe(true)
    })

    // Now expand the users table
    const usersNodeId = makeNodeId('table', 'mydb', 'users')
    useSchemaStore.getState().toggleExpand(usersNodeId, 'conn-1')

    await vi.waitFor(() => {
      const cs = useSchemaStore.getState().connectionStates['conn-1']
      expect(cs.nodes[usersNodeId].isLoaded).toBe(true)
    })

    expect(mockListColumns).toHaveBeenCalledWith('conn-1', 'mydb', 'users')

    const connState = useSchemaStore.getState().connectionStates['conn-1']
    const colNodes = Object.values(connState.nodes).filter((n) => n.parentId === usersNodeId)
    expect(colNodes).toHaveLength(2)
    expect(colNodes.map((n) => n.label).sort()).toEqual(['email', 'id'])
    expect(colNodes[0].type).toBe('column')
    expect(colNodes[0].hasChildren).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// selectNode
// ---------------------------------------------------------------------------

describe('useSchemaStore — selectNode', () => {
  it('updates selectedNodeId in connection state', async () => {
    mockListDatabases.mockResolvedValue(['db1'])
    await useSchemaStore.getState().loadDatabases('conn-1')

    useSchemaStore.getState().selectNode('some-node-id', 'conn-1')
    expect(useSchemaStore.getState().connectionStates['conn-1'].selectedNodeId).toBe('some-node-id')
  })

  it('can change selection', async () => {
    mockListDatabases.mockResolvedValue(['db1'])
    await useSchemaStore.getState().loadDatabases('conn-1')

    useSchemaStore.getState().selectNode('node-1', 'conn-1')
    useSchemaStore.getState().selectNode('node-2', 'conn-1')
    expect(useSchemaStore.getState().connectionStates['conn-1'].selectedNodeId).toBe('node-2')
  })
})

// ---------------------------------------------------------------------------
// setFilter
// ---------------------------------------------------------------------------

describe('useSchemaStore — setFilter', () => {
  it('updates filterText in connection state', async () => {
    mockListDatabases.mockResolvedValue(['db1'])
    await useSchemaStore.getState().loadDatabases('conn-1')

    useSchemaStore.getState().setFilter('users', 'conn-1')
    expect(useSchemaStore.getState().connectionStates['conn-1'].filterText).toBe('users')
  })

  it('can clear filter', async () => {
    mockListDatabases.mockResolvedValue(['db1'])
    await useSchemaStore.getState().loadDatabases('conn-1')

    useSchemaStore.getState().setFilter('search', 'conn-1')
    useSchemaStore.getState().setFilter('', 'conn-1')
    expect(useSchemaStore.getState().connectionStates['conn-1'].filterText).toBe('')
  })
})

// ---------------------------------------------------------------------------
// clearConnectionState
// ---------------------------------------------------------------------------

describe('useSchemaStore — clearConnectionState', () => {
  it('removes all state for the connection', async () => {
    mockListDatabases.mockResolvedValue(['db1'])
    await useSchemaStore.getState().loadDatabases('conn-1')

    // Verify state exists
    expect(useSchemaStore.getState().connectionStates['conn-1']).toBeDefined()

    useSchemaStore.getState().clearConnectionState('conn-1')

    expect(useSchemaStore.getState().connectionStates['conn-1']).toBeUndefined()
  })

  it('does not affect other connections', async () => {
    mockListDatabases.mockResolvedValue(['db1'])
    await useSchemaStore.getState().loadDatabases('conn-1')
    await useSchemaStore.getState().loadDatabases('conn-2')

    useSchemaStore.getState().clearConnectionState('conn-1')

    expect(useSchemaStore.getState().connectionStates['conn-1']).toBeUndefined()
    expect(useSchemaStore.getState().connectionStates['conn-2']).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// refreshAll
// ---------------------------------------------------------------------------

describe('useSchemaStore — refreshAll', () => {
  it('resets and reloads database list', async () => {
    mockListDatabases.mockResolvedValue(['db1'])
    await useSchemaStore.getState().loadDatabases('conn-1')

    mockListDatabases.mockResolvedValue(['db1', 'db2'])
    await useSchemaStore.getState().refreshAll('conn-1')

    const connState = useSchemaStore.getState().connectionStates['conn-1']
    const nodes = Object.values(connState.nodes)
    expect(nodes).toHaveLength(2)
    expect(nodes.map((n) => n.label).sort()).toEqual(['db1', 'db2'])
  })

  it('preserves filterText and selectedNodeId on refresh', async () => {
    mockListDatabases.mockResolvedValue(['db1'])
    await useSchemaStore.getState().loadDatabases('conn-1')

    // Set filter and selection
    useSchemaStore.getState().setFilter('my-filter', 'conn-1')
    useSchemaStore.getState().selectNode('some-node', 'conn-1')

    mockListDatabases.mockResolvedValue(['db1', 'db2'])
    await useSchemaStore.getState().refreshAll('conn-1')

    const connState = useSchemaStore.getState().connectionStates['conn-1']
    expect(connState.filterText).toBe('my-filter')
    expect(connState.selectedNodeId).toBe('some-node')
  })

  it('increments loadGeneration on refresh', async () => {
    mockListDatabases.mockResolvedValue(['db1'])
    await useSchemaStore.getState().loadDatabases('conn-1')

    const genBefore = useSchemaStore.getState().connectionStates['conn-1'].loadGeneration

    mockListDatabases.mockResolvedValue(['db1'])
    await useSchemaStore.getState().refreshAll('conn-1')

    const genAfter = useSchemaStore.getState().connectionStates['conn-1'].loadGeneration
    expect(genAfter).toBeGreaterThan(genBefore)
  })
})

// ---------------------------------------------------------------------------
// refreshDatabase
// ---------------------------------------------------------------------------

describe('useSchemaStore — refreshDatabase', () => {
  it('resets a specific database subtree and re-fetches categories if expanded', async () => {
    mockListDatabases.mockResolvedValue(['db1', 'db2'])
    await useSchemaStore.getState().loadDatabases('conn-1')

    // Expand db1
    const db1Id = makeNodeId('database', 'db1', 'db1')
    useSchemaStore.getState().toggleExpand(db1Id, 'conn-1')

    // db1 should have category children
    let connState = useSchemaStore.getState().connectionStates['conn-1']
    const childrenBefore = Object.values(connState.nodes).filter((n) => n.parentId === db1Id)
    expect(childrenBefore.length).toBeGreaterThan(0)

    // Refresh db1 — should keep it expanded and re-create categories
    await useSchemaStore.getState().refreshDatabase('conn-1', 'db1')

    connState = useSchemaStore.getState().connectionStates['conn-1']
    // Database node is re-loaded with fresh category nodes
    expect(connState.nodes[db1Id].isLoaded).toBe(true) // re-loaded after refresh
    expect(connState.expandedNodes.has(db1Id)).toBe(true) // stays expanded
    const childrenAfter = Object.values(connState.nodes).filter((n) => n.parentId === db1Id)
    expect(childrenAfter).toHaveLength(SCHEMA_CATEGORIES.length) // 6 categories re-created

    // db2 node should still exist
    const db2Id = makeNodeId('database', 'db2', 'db2')
    expect(connState.nodes[db2Id]).toBeDefined()
  })

  it('does not re-fetch children if database was collapsed', async () => {
    mockListDatabases.mockResolvedValue(['db1'])
    await useSchemaStore.getState().loadDatabases('conn-1')

    // Do NOT expand db1
    const db1Id = makeNodeId('database', 'db1', 'db1')

    await useSchemaStore.getState().refreshDatabase('conn-1', 'db1')

    const connState = useSchemaStore.getState().connectionStates['conn-1']
    expect(connState.nodes[db1Id].isLoaded).toBe(false) // stays unloaded
    const children = Object.values(connState.nodes).filter((n) => n.parentId === db1Id)
    expect(children).toHaveLength(0) // no children since it was never expanded
  })

  it('clears selectedNodeId when the selected node is removed', async () => {
    mockListDatabases.mockResolvedValue(['db1'])
    mockListSchemaObjects.mockResolvedValue(['users'])
    await useSchemaStore.getState().loadDatabases('conn-1')

    // Expand db1 and its Tables category
    const db1Id = makeNodeId('database', 'db1', 'db1')
    useSchemaStore.getState().toggleExpand(db1Id, 'conn-1')

    const tablesCatId = makeNodeId('category', 'db1', 'table')
    useSchemaStore.getState().toggleExpand(tablesCatId, 'conn-1')

    await vi.waitFor(() => {
      const cs = useSchemaStore.getState().connectionStates['conn-1']
      expect(cs.nodes[tablesCatId].isLoaded).toBe(true)
    })

    // Select the "users" table node
    const usersNodeId = makeNodeId('table', 'db1', 'users')
    useSchemaStore.getState().selectNode(usersNodeId, 'conn-1')
    expect(useSchemaStore.getState().connectionStates['conn-1'].selectedNodeId).toBe(usersNodeId)

    // Refresh the database — removes all children including the selected node
    await useSchemaStore.getState().refreshDatabase('conn-1', 'db1')

    const connState = useSchemaStore.getState().connectionStates['conn-1']
    // "users" table node was removed; selectedNodeId should be cleared
    expect(connState.selectedNodeId).toBeNull()
  })

  it('preserves selectedNodeId when the selected node still exists', async () => {
    mockListDatabases.mockResolvedValue(['db1', 'db2'])
    await useSchemaStore.getState().loadDatabases('conn-1')

    // Select db2 node (which is NOT under db1)
    const db2Id = makeNodeId('database', 'db2', 'db2')
    useSchemaStore.getState().selectNode(db2Id, 'conn-1')

    // Refresh db1 — db2 should still exist
    await useSchemaStore.getState().refreshDatabase('conn-1', 'db1')

    const connState = useSchemaStore.getState().connectionStates['conn-1']
    expect(connState.selectedNodeId).toBe(db2Id)
  })

  it('increments loadGeneration on refreshDatabase', async () => {
    mockListDatabases.mockResolvedValue(['db1'])
    await useSchemaStore.getState().loadDatabases('conn-1')

    const genBefore = useSchemaStore.getState().connectionStates['conn-1'].loadGeneration

    await useSchemaStore.getState().refreshDatabase('conn-1', 'db1')

    const genAfter = useSchemaStore.getState().connectionStates['conn-1'].loadGeneration
    expect(genAfter).toBeGreaterThan(genBefore)
  })
})

// ---------------------------------------------------------------------------
// refreshCategory
// ---------------------------------------------------------------------------

describe('useSchemaStore — refreshCategory', () => {
  it('resets only the specified category and re-fetches its children', async () => {
    mockListDatabases.mockResolvedValue(['mydb'])
    mockListSchemaObjects.mockResolvedValue(['users', 'orders'])
    await useSchemaStore.getState().loadDatabases('conn-1')

    // Expand database → categories
    const dbNodeId = makeNodeId('database', 'mydb', 'mydb')
    useSchemaStore.getState().toggleExpand(dbNodeId, 'conn-1')

    // Expand Tables category
    const tablesCatId = makeNodeId('category', 'mydb', 'table')
    useSchemaStore.getState().toggleExpand(tablesCatId, 'conn-1')

    await vi.waitFor(() => {
      const cs = useSchemaStore.getState().connectionStates['conn-1']
      expect(cs.nodes[tablesCatId].isLoaded).toBe(true)
    })

    // Verify we have 2 table nodes
    let connState = useSchemaStore.getState().connectionStates['conn-1']
    let tableNodes = Object.values(connState.nodes).filter((n) => n.parentId === tablesCatId)
    expect(tableNodes).toHaveLength(2)

    // Now refresh with different data
    mockListSchemaObjects.mockResolvedValue(['users', 'orders', 'products'])
    await useSchemaStore.getState().refreshCategory('conn-1', 'mydb', 'table')

    connState = useSchemaStore.getState().connectionStates['conn-1']
    tableNodes = Object.values(connState.nodes).filter((n) => n.parentId === tablesCatId)
    expect(tableNodes).toHaveLength(3)
    expect(tableNodes.map((n) => n.label).sort()).toEqual(['orders', 'products', 'users'])
  })

  it('does not affect other categories', async () => {
    mockListDatabases.mockResolvedValue(['mydb'])
    mockListSchemaObjects.mockResolvedValue(['my_view'])
    await useSchemaStore.getState().loadDatabases('conn-1')

    // Expand database → categories
    const dbNodeId = makeNodeId('database', 'mydb', 'mydb')
    useSchemaStore.getState().toggleExpand(dbNodeId, 'conn-1')

    // Expand Views category
    const viewsCatId = makeNodeId('category', 'mydb', 'view')
    useSchemaStore.getState().toggleExpand(viewsCatId, 'conn-1')

    await vi.waitFor(() => {
      const cs = useSchemaStore.getState().connectionStates['conn-1']
      expect(cs.nodes[viewsCatId].isLoaded).toBe(true)
    })

    // Now refresh Tables category — Views should be untouched
    mockListSchemaObjects.mockResolvedValue(['users'])
    await useSchemaStore.getState().refreshCategory('conn-1', 'mydb', 'table')

    const connState = useSchemaStore.getState().connectionStates['conn-1']
    // Views category should still be loaded
    expect(connState.nodes[viewsCatId].isLoaded).toBe(true)
    const viewNodes = Object.values(connState.nodes).filter((n) => n.parentId === viewsCatId)
    expect(viewNodes).toHaveLength(1)
    expect(viewNodes[0].label).toBe('my_view')
  })

  it('clears selectedNodeId when the selected node is removed by category refresh', async () => {
    mockListDatabases.mockResolvedValue(['mydb'])
    mockListSchemaObjects.mockResolvedValue(['users'])
    await useSchemaStore.getState().loadDatabases('conn-1')

    const dbNodeId = makeNodeId('database', 'mydb', 'mydb')
    useSchemaStore.getState().toggleExpand(dbNodeId, 'conn-1')

    const tablesCatId = makeNodeId('category', 'mydb', 'table')
    useSchemaStore.getState().toggleExpand(tablesCatId, 'conn-1')

    await vi.waitFor(() => {
      const cs = useSchemaStore.getState().connectionStates['conn-1']
      expect(cs.nodes[tablesCatId].isLoaded).toBe(true)
    })

    // Select the table node
    const usersNodeId = makeNodeId('table', 'mydb', 'users')
    useSchemaStore.getState().selectNode(usersNodeId, 'conn-1')

    // Refresh category — table is removed and re-created, but selectedNodeId should clear
    // because the old node reference is removed before the re-fetch
    mockListSchemaObjects.mockResolvedValue([])
    await useSchemaStore.getState().refreshCategory('conn-1', 'mydb', 'table')

    const connState = useSchemaStore.getState().connectionStates['conn-1']
    expect(connState.selectedNodeId).toBeNull()
  })

  it('increments loadGeneration on refreshCategory', async () => {
    mockListDatabases.mockResolvedValue(['mydb'])
    mockListSchemaObjects.mockResolvedValue(['users'])
    await useSchemaStore.getState().loadDatabases('conn-1')

    const dbNodeId = makeNodeId('database', 'mydb', 'mydb')
    useSchemaStore.getState().toggleExpand(dbNodeId, 'conn-1')

    const tablesCatId = makeNodeId('category', 'mydb', 'table')
    useSchemaStore.getState().toggleExpand(tablesCatId, 'conn-1')

    await vi.waitFor(() => {
      const cs = useSchemaStore.getState().connectionStates['conn-1']
      expect(cs.nodes[tablesCatId].isLoaded).toBe(true)
    })

    const genBefore = useSchemaStore.getState().connectionStates['conn-1'].loadGeneration

    mockListSchemaObjects.mockResolvedValue(['users'])
    await useSchemaStore.getState().refreshCategory('conn-1', 'mydb', 'table')

    const genAfter = useSchemaStore.getState().connectionStates['conn-1'].loadGeneration
    expect(genAfter).toBeGreaterThan(genBefore)
  })

  it('does nothing if category node does not exist', async () => {
    mockListDatabases.mockResolvedValue(['mydb'])
    await useSchemaStore.getState().loadDatabases('conn-1')

    // Category node doesn't exist (database not expanded)
    await useSchemaStore.getState().refreshCategory('conn-1', 'mydb', 'table')

    // Should not throw and should not call backend
    expect(mockListSchemaObjects).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// loadGeneration — stale async guard
// ---------------------------------------------------------------------------

describe('useSchemaStore — loadGeneration stale guard', () => {
  it('discards loadDatabases results when generation changes during fetch', async () => {
    let resolveListDatabases!: (value: string[]) => void
    mockListDatabases.mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          resolveListDatabases = resolve
        })
    )

    // Start loading databases
    const loadPromise = useSchemaStore.getState().loadDatabases('conn-1')

    // While loading, clear the connection (removes state)
    useSchemaStore.getState().clearConnectionState('conn-1')

    // Now resolve the original request
    resolveListDatabases(['stale_db'])

    await loadPromise

    // State should NOT have the stale data
    expect(useSchemaStore.getState().connectionStates['conn-1']).toBeUndefined()
  })

  it('discards fetchChildren results when generation changes during fetch', async () => {
    mockListDatabases.mockResolvedValue(['mydb'])
    await useSchemaStore.getState().loadDatabases('conn-1')

    // Expand database to get category nodes
    const dbNodeId = makeNodeId('database', 'mydb', 'mydb')
    useSchemaStore.getState().toggleExpand(dbNodeId, 'conn-1')

    // Set up a deferred response for listSchemaObjects
    let resolveSchemaObjects!: (value: string[]) => void
    mockListSchemaObjects.mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          resolveSchemaObjects = resolve
        })
    )

    // Start loading children for the Tables category
    const tablesCatId = makeNodeId('category', 'mydb', 'table')
    const loadPromise = useSchemaStore.getState().loadChildren('conn-1', tablesCatId)

    // While loading, refresh the database (increments generation)
    mockListDatabases.mockResolvedValue(['mydb'])
    mockListSchemaObjects.mockResolvedValue([]) // for the refresh's loadChildren
    await useSchemaStore.getState().refreshDatabase('conn-1', 'mydb')

    // Now resolve the original (stale) request
    resolveSchemaObjects(['stale_table'])

    await loadPromise

    // The stale "stale_table" should NOT appear in the tree
    const connState = useSchemaStore.getState().connectionStates['conn-1']
    const allLabels = Object.values(connState.nodes).map((n) => n.label)
    expect(allLabels).not.toContain('stale_table')
  })
})
