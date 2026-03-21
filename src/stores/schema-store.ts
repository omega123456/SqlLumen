import { create } from 'zustand'
import type { TreeNode, NodeType } from '../types/schema'
import { listDatabases, listSchemaObjects, listColumns } from '../lib/schema-commands'

// ---------------------------------------------------------------------------
// Node ID encoding helpers
// ---------------------------------------------------------------------------

/**
 * Encode a string to base64, handling Unicode safely.
 * Uses `encodeURIComponent` → `unescape` → `btoa` pattern.
 */
function toBase64(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
}

/** Decode a base64 string, reversing the Unicode-safe encoding. */
function fromBase64(b64: string): string {
  return decodeURIComponent(escape(atob(b64)))
}

/**
 * Build a collision-safe node ID.
 *
 * Format: `{type}:{base64(database)}:{base64(name)}`
 */
export function makeNodeId(type: NodeType, database: string, name: string): string {
  return `${type}:${toBase64(database)}:${toBase64(name)}`
}

/** Parse a node ID back into its components. */
export function parseNodeId(nodeId: string): { type: NodeType; database: string; name: string } {
  const firstColon = nodeId.indexOf(':')
  const secondColon = nodeId.indexOf(':', firstColon + 1)
  const type = nodeId.slice(0, firstColon) as NodeType
  const database = fromBase64(nodeId.slice(firstColon + 1, secondColon))
  const name = fromBase64(nodeId.slice(secondColon + 1))
  return { type, database, name }
}

// ---------------------------------------------------------------------------
// Schema categories (static virtual nodes created client-side)
// ---------------------------------------------------------------------------

export const SCHEMA_CATEGORIES = [
  { type: 'table', label: 'Tables' },
  { type: 'view', label: 'Views' },
  { type: 'procedure', label: 'Procedures' },
  { type: 'function', label: 'Functions' },
  { type: 'trigger', label: 'Triggers' },
  { type: 'event', label: 'Events' },
] as const

// ---------------------------------------------------------------------------
// Per-connection tree state
// ---------------------------------------------------------------------------

export interface ConnectionTreeState {
  nodes: Record<string, TreeNode>
  /** parentId → sorted child IDs (read-path optimization). */
  childIdsByParentId: Record<string, string[]>
  expandedNodes: Set<string>
  loadingNodes: Set<string>
  /** Currently selected node within this connection. */
  selectedNodeId: string | null
  /** Search filter text for this connection's tree. */
  filterText: string
  /** Increments on refresh/clear to invalidate in-flight async requests. */
  loadGeneration: number
}

function createDefaultConnectionState(): ConnectionTreeState {
  return {
    nodes: {},
    childIdsByParentId: {},
    expandedNodes: new Set(),
    loadingNodes: new Set(),
    selectedNodeId: null,
    filterText: '',
    loadGeneration: 0,
  }
}

// ---------------------------------------------------------------------------
// Child index helpers
// ---------------------------------------------------------------------------

/**
 * Rebuild the `childIdsByParentId` index from a nodes map.
 * Keeps children sorted alphabetically by label for consistent ordering.
 */
function buildChildIndex(nodes: Record<string, TreeNode>): Record<string, string[]> {
  const index: Record<string, string[]> = {}
  for (const [id, node] of Object.entries(nodes)) {
    const parentId = node.parentId ?? '__root__'
    if (!index[parentId]) index[parentId] = []
    index[parentId].push(id)
  }
  // Sort children by label
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

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface SchemaState {
  /** Per-connection tree data. */
  connectionStates: Record<string, ConnectionTreeState>

  // Actions
  loadDatabases: (connectionId: string) => Promise<void>
  loadChildren: (connectionId: string, nodeId: string) => Promise<void>
  toggleExpand: (nodeId: string, connectionId: string) => void
  selectNode: (nodeId: string, connectionId: string) => void
  setFilter: (text: string, connectionId: string) => void
  refreshDatabase: (connectionId: string, databaseName: string) => Promise<void>
  refreshCategory: (
    connectionId: string,
    databaseName: string,
    categoryType: string
  ) => Promise<void>
  refreshAll: (connectionId: string) => Promise<void>
  clearConnectionState: (connectionId: string) => void
}

// ---------------------------------------------------------------------------
// Helper: update a single connection's tree state immutably
// ---------------------------------------------------------------------------

function getConnState(state: SchemaState, connectionId: string): ConnectionTreeState {
  return state.connectionStates[connectionId] || createDefaultConnectionState()
}

function setConnState(
  state: SchemaState,
  connectionId: string,
  patch: Partial<ConnectionTreeState>
): Pick<SchemaState, 'connectionStates'> {
  const prev = getConnState(state, connectionId)
  return {
    connectionStates: {
      ...state.connectionStates,
      [connectionId]: { ...prev, ...patch },
    },
  }
}

// ---------------------------------------------------------------------------
// Simplification 6: Shared async fetch helper for loadChildren
// ---------------------------------------------------------------------------

/**
 * Internal helper that handles the async lifecycle of loading child nodes:
 * mark loading → fetch → merge nodes → mark loaded → clear loading.
 */
async function fetchChildren(
  get: () => SchemaState,
  set: (fn: (state: SchemaState) => Partial<SchemaState>) => void,
  connectionId: string,
  nodeId: string,
  fetchFn: () => Promise<TreeNode[]>
): Promise<void> {
  // 1. Mark loading and capture generation
  const connState = getConnState(get(), connectionId)
  const gen = connState.loadGeneration
  const newLoading = new Set(connState.loadingNodes)
  newLoading.add(nodeId)
  set((s) => setConnState(s, connectionId, { loadingNodes: newLoading }))

  try {
    // 2. Call fetchFn
    const childNodes = await fetchFn()

    // 3. Check connection still exists and generation matches after await
    const afterFetch = get()
    const currentConn = afterFetch.connectionStates[connectionId]
    if (!currentConn || currentConn.loadGeneration !== gen) {
      return // Connection was closed or refreshed while we were fetching
    }

    // 4. Merge returned nodes into state
    const freshConnState = getConnState(afterFetch, connectionId)
    const newNodes = { ...freshConnState.nodes }

    for (const child of childNodes) {
      newNodes[child.id] = child
    }
    newNodes[nodeId] = { ...newNodes[nodeId], isLoaded: true }

    // 5. Rebuild child index and clear loading
    const newChildIndex = buildChildIndex(newNodes)
    const doneLoading = new Set(freshConnState.loadingNodes)
    doneLoading.delete(nodeId)

    set((s) =>
      setConnState(s, connectionId, {
        nodes: newNodes,
        childIdsByParentId: newChildIndex,
        loadingNodes: doneLoading,
      })
    )
  } catch {
    // 6. Remove from loading on error (only if generation still matches)
    const currentConn = get().connectionStates[connectionId]
    if (!currentConn || currentConn.loadGeneration !== gen) return
    const freshConnState = getConnState(get(), connectionId)
    const doneLoading = new Set(freshConnState.loadingNodes)
    doneLoading.delete(nodeId)
    set((s) => setConnState(s, connectionId, { loadingNodes: doneLoading }))
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSchemaStore = create<SchemaState>()((set, get) => ({
  connectionStates: {},

  // ------ loadDatabases ------

  loadDatabases: async (connectionId: string) => {
    // Ensure connection state exists before capturing generation
    if (!get().connectionStates[connectionId]) {
      set((s) => setConnState(s, connectionId, createDefaultConnectionState()))
    }

    // Capture generation before async call
    const gen = get().connectionStates[connectionId].loadGeneration

    const databases = await listDatabases(connectionId)

    // Check generation after await — discard if stale
    const current = get().connectionStates[connectionId]
    if (!current || current.loadGeneration !== gen) return

    const nodes: Record<string, TreeNode> = {}

    for (const dbName of databases) {
      const id = makeNodeId('database', dbName, dbName)
      nodes[id] = {
        id,
        label: dbName,
        type: 'database',
        parentId: null,
        hasChildren: true,
        isLoaded: false,
        databaseName: dbName,
        objectName: dbName,
      }
    }

    const childIdsByParentId = buildChildIndex(nodes)

    set((state) =>
      setConnState(state, connectionId, {
        nodes,
        childIdsByParentId,
        expandedNodes: new Set(),
        loadingNodes: new Set(),
      })
    )
  },

  // ------ loadChildren ------

  loadChildren: async (connectionId: string, nodeId: string) => {
    const state = get()
    const connState = getConnState(state, connectionId)
    const node = connState.nodes[nodeId]
    if (!node || node.isLoaded) return

    if (node.type === 'database') {
      // Create category children synchronously — no backend call
      const parsed = parseNodeId(nodeId)
      const dbName = parsed.database
      const newNodes = { ...connState.nodes }

      for (const cat of SCHEMA_CATEGORIES) {
        const catId = makeNodeId('category', dbName, cat.type)
        newNodes[catId] = {
          id: catId,
          label: cat.label,
          type: 'category',
          parentId: nodeId,
          hasChildren: true,
          isLoaded: false,
          databaseName: dbName,
          metadata: { categoryType: cat.type, databaseName: dbName },
        }
      }
      newNodes[nodeId] = { ...node, isLoaded: true }

      const childIdsByParentId = buildChildIndex(newNodes)
      set((s) => setConnState(s, connectionId, { nodes: newNodes, childIdsByParentId }))
      return
    }

    if (node.type === 'category') {
      const parsed = parseNodeId(nodeId)
      const dbName = parsed.database
      const categoryType = parsed.name // e.g. 'table', 'view', etc.

      await fetchChildren(get, set, connectionId, nodeId, async () => {
        const objectNames = await listSchemaObjects(connectionId, dbName, categoryType)
        const objType = categoryType as TreeNode['type']
        return objectNames.map((objName) => {
          const objId = makeNodeId(objType, dbName, objName)
          return {
            id: objId,
            label: objName,
            type: objType,
            parentId: nodeId,
            hasChildren: objType === 'table',
            isLoaded: false,
            databaseName: dbName,
            objectName: objName,
            metadata: { databaseName: dbName },
          }
        })
      })
    } else if (node.type === 'table') {
      const parsed = parseNodeId(nodeId)
      const dbName = parsed.database
      const tableName = parsed.name

      await fetchChildren(get, set, connectionId, nodeId, async () => {
        const columns = await listColumns(connectionId, dbName, tableName)
        return columns.map((col) => {
          const colId = makeNodeId('column', dbName, `${tableName}.${col.name}`)
          return {
            id: colId,
            label: col.name,
            type: 'column' as const,
            parentId: nodeId,
            hasChildren: false,
            isLoaded: true,
            databaseName: dbName,
            objectName: col.name,
            metadata: { columnType: col.dataType, databaseName: dbName },
          }
        })
      })
    }
  },

  // ------ toggleExpand ------

  toggleExpand: (nodeId: string, connectionId: string) => {
    const state = get()
    const connState = getConnState(state, connectionId)
    const node = connState.nodes[nodeId]
    if (!node || !node.hasChildren) return

    const isExpanded = connState.expandedNodes.has(nodeId)

    if (isExpanded) {
      // Collapse
      const newExpanded = new Set(connState.expandedNodes)
      newExpanded.delete(nodeId)
      set((s) => setConnState(s, connectionId, { expandedNodes: newExpanded }))
    } else {
      // Expand
      const newExpanded = new Set(connState.expandedNodes)
      newExpanded.add(nodeId)
      set((s) => setConnState(s, connectionId, { expandedNodes: newExpanded }))

      if (!node.isLoaded) {
        // Fire-and-forget the async load
        void get().loadChildren(connectionId, nodeId)
      }
    }
  },

  // ------ selectNode ------

  selectNode: (nodeId: string, connectionId: string) => {
    set((s) => setConnState(s, connectionId, { selectedNodeId: nodeId }))
  },

  // ------ setFilter ------

  setFilter: (text: string, connectionId: string) => {
    set((s) => setConnState(s, connectionId, { filterText: text }))
  },

  // ------ refreshDatabase ------

  refreshDatabase: async (connectionId: string, databaseName: string) => {
    const state = get()
    const connState = getConnState(state, connectionId)
    const dbNodeId = makeNodeId('database', databaseName, databaseName)

    // Remove all children of this database node and mark it as not loaded
    const newNodes: Record<string, TreeNode> = {}
    for (const [id, node] of Object.entries(connState.nodes)) {
      if (id === dbNodeId) {
        newNodes[id] = { ...node, isLoaded: false }
      } else {
        // Keep nodes that don't belong to this database
        const parsed = parseNodeId(id)
        if (parsed.database !== databaseName || node.type === 'database') {
          newNodes[id] = node
        }
      }
    }

    // Keep the database expanded if it was, remove child nodes from expanded
    const newExpanded = new Set<string>()
    for (const nid of connState.expandedNodes) {
      if (nid === dbNodeId) {
        // Keep the database node expanded
        newExpanded.add(nid)
        continue
      }
      const parsed = parseNodeId(nid)
      if (parsed.database !== databaseName) {
        newExpanded.add(nid)
      }
    }

    // Clear loading state for nodes belonging to this database
    const newLoadingNodes = new Set<string>()
    for (const nid of connState.loadingNodes) {
      const parsed = parseNodeId(nid)
      if (parsed.database !== databaseName) {
        newLoadingNodes.add(nid)
      }
    }

    const childIdsByParentId = buildChildIndex(newNodes)

    // Clear selectedNodeId if it points to a node that was removed
    const newSelectedNodeId =
      connState.selectedNodeId && !newNodes[connState.selectedNodeId]
        ? null
        : connState.selectedNodeId

    set((s) =>
      setConnState(s, connectionId, {
        nodes: newNodes,
        childIdsByParentId,
        expandedNodes: newExpanded,
        loadingNodes: newLoadingNodes,
        selectedNodeId: newSelectedNodeId,
        loadGeneration: connState.loadGeneration + 1,
      })
    )

    // If the database was expanded, re-fetch its children (creates category nodes synchronously)
    if (newExpanded.has(dbNodeId)) {
      await get().loadChildren(connectionId, dbNodeId)
    }
  },

  // ------ refreshAll ------

  refreshAll: async (connectionId: string) => {
    const current = getConnState(get(), connectionId)
    // Preserve filterText and selectedNodeId; increment generation to invalidate in-flight requests
    const defaults = createDefaultConnectionState()
    set((s) =>
      setConnState(s, connectionId, {
        ...defaults,
        filterText: current.filterText,
        selectedNodeId: current.selectedNodeId,
        loadGeneration: current.loadGeneration + 1,
      })
    )
    await get().loadDatabases(connectionId)
  },

  // ------ refreshCategory ------

  refreshCategory: async (connectionId: string, databaseName: string, categoryType: string) => {
    const state = get()
    const connState = getConnState(state, connectionId)
    const catNodeId = makeNodeId('category', databaseName, categoryType)

    // Check if category node exists
    if (!connState.nodes[catNodeId]) return

    // Remove all children (and grandchildren) of this category node
    const childIds = connState.childIdsByParentId[catNodeId] || []
    const newNodes = { ...connState.nodes }

    for (const childId of childIds) {
      // Remove grandchildren (e.g., columns under tables)
      const grandchildIds = connState.childIdsByParentId[childId] || []
      for (const gcId of grandchildIds) {
        delete newNodes[gcId]
      }
      delete newNodes[childId]
    }

    // Mark category as not loaded so it can be re-fetched
    newNodes[catNodeId] = { ...newNodes[catNodeId], isLoaded: false }

    // Clear loading state for category and its children
    const newLoadingNodes = new Set(connState.loadingNodes)
    newLoadingNodes.delete(catNodeId)
    for (const childId of childIds) {
      newLoadingNodes.delete(childId)
    }

    // Remove expanded state for children of this category (tables that were expanded)
    const newExpanded = new Set(connState.expandedNodes)
    for (const childId of childIds) {
      newExpanded.delete(childId)
    }

    // Clear selectedNodeId if it points to a node that was removed
    const newSelectedNodeId =
      connState.selectedNodeId && !newNodes[connState.selectedNodeId]
        ? null
        : connState.selectedNodeId

    const childIdsByParentId = buildChildIndex(newNodes)

    set((s) =>
      setConnState(s, connectionId, {
        nodes: newNodes,
        childIdsByParentId,
        expandedNodes: newExpanded,
        loadingNodes: newLoadingNodes,
        selectedNodeId: newSelectedNodeId,
        loadGeneration: connState.loadGeneration + 1,
      })
    )

    // Re-fetch children for this category
    await get().loadChildren(connectionId, catNodeId)
  },

  // ------ clearConnectionState ------

  clearConnectionState: (connectionId: string) => {
    set((state) => {
      const newStates = { ...state.connectionStates }
      delete newStates[connectionId]
      return { connectionStates: newStates }
    })
  },
}))
