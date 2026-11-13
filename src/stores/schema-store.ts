import { create } from 'zustand'
import type { TreeNode, NodeType } from '../types/schema'
import {
  invalidateMetadataCache,
  listDatabases,
  listSchemaObjects,
  listColumns,
} from '../lib/schema-commands'
import { logFrontendWarning } from '../lib/app-log-commands'

// ---------------------------------------------------------------------------
// Node ID encoding helpers
// ---------------------------------------------------------------------------

/**
 * Encode a string to base64, handling Unicode safely.
 * Uses `encodeURIComponent` → `unescape` → `btoa` pattern.
 */
function toBase64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)))
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
    index[parentId].sort((left, right) => {
      const nodeA = nodes[left]
      const nodeB = nodes[right]
      if (!nodeA) return 0
      if (!nodeB) return 0
      return nodeA.label.localeCompare(nodeB.label)
    })
  }
  return index
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

/** A request for the object browser to scroll to and focus a node. */
export interface TreeRevealRequest {
  connectionId: string
  nodeId: string
  /** Increments on every request so repeated reveals of the same node still fire. */
  seq: number
}

interface SchemaState {
  /** Per-connection tree data. */
  connectionStates: Record<string, ConnectionTreeState>
  /** Latest "reveal in object browser" request (null until the first one). */
  revealRequest: TreeRevealRequest | null

  // Actions
  loadDatabases: (connectionId: string) => Promise<void>
  loadChildren: (connectionId: string, nodeId: string) => Promise<void>
  toggleExpand: (nodeId: string, connectionId: string) => void
  ensurePathExpanded: (connectionId: string, nodeId: string) => void
  selectNode: (nodeId: string, connectionId: string) => void
  /** Ask the object browser to show its tree, scroll to `nodeId` and focus it. */
  requestReveal: (connectionId: string, nodeId: string) => void
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

function isCurrentLoadGeneration(
  state: SchemaState,
  connectionId: string,
  generation: number
): boolean {
  return state.connectionStates[connectionId]?.loadGeneration === generation
}

function getConnectionState(state: SchemaState, connectionId: string): ConnectionTreeState {
  return state.connectionStates[connectionId] || createDefaultConnectionState()
}

function setConnectionState(
  state: SchemaState,
  connectionId: string,
  patch: Partial<ConnectionTreeState>
): Pick<SchemaState, 'connectionStates'> {
  const previous = getConnectionState(state, connectionId)
  return {
    connectionStates: {
      ...state.connectionStates,
      [connectionId]: { ...previous, ...patch },
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
interface SchemaStoreAccess {
  get: () => SchemaState
  set: (updater: (state: SchemaState) => Partial<SchemaState>) => void
}

interface ChildNodeFetch {
  connectionId: string
  nodeId: string
  fetchNodes: () => Promise<TreeNode[]>
}

async function fetchChildren(
  { get, set }: SchemaStoreAccess,
  { connectionId, nodeId, fetchNodes }: ChildNodeFetch
): Promise<void> {
  // 1. Mark loading and capture generation
  const connectionState = getConnectionState(get(), connectionId)
  const gen = connectionState.loadGeneration
  const newLoading = new Set(connectionState.loadingNodes)
  newLoading.add(nodeId)
  set((state) => setConnectionState(state, connectionId, { loadingNodes: newLoading }))

  try {
    // 2. Call fetchFn
    const childNodes = await fetchNodes()

    // 3. Check connection still exists and generation matches after await
    const afterFetch = get()
    if (!isCurrentLoadGeneration(afterFetch, connectionId, gen)) return

    // 4. Merge returned nodes into state
    const freshConnectionState = getConnectionState(afterFetch, connectionId)
    const newNodes = { ...freshConnectionState.nodes }

    for (const child of childNodes) {
      newNodes[child.id] = child
    }
    newNodes[nodeId] = { ...newNodes[nodeId], isLoaded: true }

    // 5. Rebuild child index and clear loading
    const newChildIndex = buildChildIndex(newNodes)
    const doneLoading = new Set(freshConnectionState.loadingNodes)
    doneLoading.delete(nodeId)

    set((state) =>
      setConnectionState(state, connectionId, {
        nodes: newNodes,
        childIdsByParentId: newChildIndex,
        loadingNodes: doneLoading,
      })
    )
  } catch {
    if (!isCurrentLoadGeneration(get(), connectionId, gen)) return
    const freshConnectionState = getConnectionState(get(), connectionId)
    const doneLoading = new Set(freshConnectionState.loadingNodes)
    doneLoading.delete(nodeId)
    set((state) => setConnectionState(state, connectionId, { loadingNodes: doneLoading }))
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type ChildLoader = (connectionId: string, nodeId: string) => Promise<TreeNode[]>

function databaseNode(databaseName: string, existing: TreeNode | undefined): TreeNode {
  if (existing?.isLoaded) return existing
  return {
    id: makeNodeId('database', databaseName, databaseName),
    label: databaseName,
    type: 'database',
    parentId: null,
    hasChildren: true,
    isLoaded: false,
    databaseName: databaseName,
    objectName: databaseName,
  }
}

function isInListedDatabase(node: TreeNode, databaseIds: Set<string>): boolean {
  if (!node.databaseName) return false
  return databaseIds.has(makeNodeId('database', node.databaseName, node.databaseName))
}

function mergeDatabaseNodes(
  existingNodes: Record<string, TreeNode>,
  databases: string[]
): Record<string, TreeNode> {
  const databaseIds = new Set<string>()
  const mergedNodes: Record<string, TreeNode> = {}
  for (const databaseName of databases) {
    const id = makeNodeId('database', databaseName, databaseName)
    databaseIds.add(id)
    mergedNodes[id] = databaseNode(databaseName, existingNodes[id])
  }
  for (const [nodeId, node] of Object.entries(existingNodes)) {
    if (node.type === 'database') continue
    if (isInListedDatabase(node, databaseIds)) {
      mergedNodes[nodeId] = node
    }
  }
  return mergedNodes
}

async function loadCategoryChildren(connectionId: string, nodeId: string): Promise<TreeNode[]> {
  const parsed = parseNodeId(nodeId)
  const databaseName = parsed.database
  const categoryType = parsed.name
  const objectNames = await listSchemaObjects(connectionId, databaseName, categoryType)
  const objectType = categoryType as TreeNode['type']
  return objectNames.map((objectName) => ({
    id: makeNodeId(objectType, databaseName, objectName),
    label: objectName,
    type: objectType,
    parentId: nodeId,
    hasChildren: objectType === 'table',
    isLoaded: false,
    databaseName: databaseName,
    objectName: objectName,
    metadata: { databaseName: databaseName },
  }))
}

async function loadTableColumns(connectionId: string, nodeId: string): Promise<TreeNode[]> {
  const parsed = parseNodeId(nodeId)
  const databaseName = parsed.database
  const tableName = parsed.name
  const columns = await listColumns(connectionId, databaseName, tableName)
  return columns.map((column) => ({
    id: makeNodeId('column', databaseName, `${tableName}.${column.name}`),
    label: column.name,
    type: 'column' as const,
    parentId: nodeId,
    hasChildren: false,
    isLoaded: true,
    databaseName: databaseName,
    objectName: column.name,
    metadata: { columnType: column.dataType, databaseName: databaseName },
  }))
}

const CHILD_LOADERS: Partial<Record<TreeNode['type'], ChildLoader>> = {
  category: loadCategoryChildren,
  table: loadTableColumns,
}

function isOutsideDatabase(nodeId: string, databaseName: string): boolean {
  return parseNodeId(nodeId).database !== databaseName
}

function nodesWithDatabaseReset(
  nodes: Record<string, TreeNode>,
  databaseNodeId: string,
  databaseName: string
): Record<string, TreeNode> {
  const newNodes: Record<string, TreeNode> = {}
  for (const [id, node] of Object.entries(nodes)) {
    if (id === databaseNodeId) {
      newNodes[id] = { ...node, isLoaded: false }
      continue
    }
    const isKeptNode = isOutsideDatabase(id, databaseName) || node.type === 'database'
    if (isKeptNode) {
      newNodes[id] = node
    }
  }
  return newNodes
}

function idsOutsideDatabase(ids: Set<string>, databaseName: string): Set<string> {
  return new Set([...ids].filter((id) => isOutsideDatabase(id, databaseName)))
}

function retainedSelectedNodeId(
  selectedNodeId: string | null,
  nodes: Record<string, TreeNode>
): string | null {
  if (!selectedNodeId) return selectedNodeId
  return nodes[selectedNodeId] ? selectedNodeId : null
}

export const useSchemaStore = create<SchemaState>()((set, get) => ({
  connectionStates: {},
  revealRequest: null,

  // ------ loadDatabases ------

  loadDatabases: async (connectionId: string) => {
    // Ensure connection state exists before capturing generation
    if (!get().connectionStates[connectionId]) {
      set((state) => setConnectionState(state, connectionId, createDefaultConnectionState()))
    }

    // Capture generation before async call
    const gen = get().connectionStates[connectionId].loadGeneration

    const databases = await listDatabases(connectionId)

    if (!isCurrentLoadGeneration(get(), connectionId, gen)) return
    const current = getConnectionState(get(), connectionId)

    const mergedNodes = mergeDatabaseNodes(current.nodes, databases)
    const childIdsByParentId = buildChildIndex(mergedNodes)

    set((state) =>
      setConnectionState(state, connectionId, {
        nodes: mergedNodes,
        childIdsByParentId: childIdsByParentId,
        expandedNodes: getConnectionState(get(), connectionId).expandedNodes,
        loadingNodes: new Set(),
      })
    )
  },

  // ------ loadChildren ------

  loadChildren: async (connectionId: string, nodeId: string) => {
    const state = get()
    const connectionState = getConnectionState(state, connectionId)
    const node = connectionState.nodes[nodeId]
    if (!node) return
    if (node.isLoaded) return

    if (node.type === 'database') {
      // Create category children synchronously — no backend call
      const parsed = parseNodeId(nodeId)
      const dbName = parsed.database
      const newNodes = { ...connectionState.nodes }

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
      set((state) =>
        setConnectionState(state, connectionId, {
          nodes: newNodes,
          childIdsByParentId: childIdsByParentId,
        })
      )
      return
    }

    const loadChildNodes = CHILD_LOADERS[node.type]
    if (!loadChildNodes) return
    await fetchChildren(
      { get: get, set: set },
      {
        connectionId: connectionId,
        nodeId: nodeId,
        fetchNodes: () => loadChildNodes(connectionId, nodeId),
      }
    )
  },

  // ------ toggleExpand ------

  toggleExpand: (nodeId: string, connectionId: string) => {
    const state = get()
    const connectionState = getConnectionState(state, connectionId)
    const node = connectionState.nodes[nodeId]
    if (!node) return
    if (!node.hasChildren) return

    const isExpanded = connectionState.expandedNodes.has(nodeId)

    const newExpanded = new Set(connectionState.expandedNodes)
    if (isExpanded) {
      newExpanded.delete(nodeId)
      set((state) => setConnectionState(state, connectionId, { expandedNodes: newExpanded }))
      return
    }

    newExpanded.add(nodeId)
    set((state) => setConnectionState(state, connectionId, { expandedNodes: newExpanded }))
    if (!node.isLoaded) {
      void get().loadChildren(connectionId, nodeId)
    }
  },

  // ------ ensurePathExpanded ------

  ensurePathExpanded: (connectionId: string, nodeId: string) => {
    set((state) => {
      const connectionState = getConnectionState(state, connectionId)
      const newExpanded = new Set(connectionState.expandedNodes)
      let changed = false
      let current: string | null = nodeId
      while (current) {
        const nd: TreeNode | undefined = connectionState.nodes[current]
        if (!nd) break
        const isCollapsedParent = nd.hasChildren && !newExpanded.has(current)
        if (isCollapsedParent) {
          newExpanded.add(current)
          changed = true
        }
        current = nd.parentId
      }
      return changed
        ? setConnectionState(state, connectionId, { expandedNodes: newExpanded })
        : state
    })
  },

  // ------ selectNode ------

  selectNode: (nodeId: string, connectionId: string) => {
    set((state) => setConnectionState(state, connectionId, { selectedNodeId: nodeId }))
  },

  // ------ requestReveal ------

  requestReveal: (connectionId: string, nodeId: string) => {
    set((state) => ({
      revealRequest: {
        connectionId: connectionId,
        nodeId: nodeId,
        seq: (state.revealRequest?.seq ?? 0) + 1,
      },
    }))
  },

  // ------ setFilter ------

  setFilter: (text: string, connectionId: string) => {
    set((state) => setConnectionState(state, connectionId, { filterText: text }))
  },

  // ------ refreshDatabase ------

  refreshDatabase: async (connectionId: string, databaseName: string) => {
    const state = get()
    const connectionState = getConnectionState(state, connectionId)
    const dbNodeId = makeNodeId('database', databaseName, databaseName)

    const newNodes = nodesWithDatabaseReset(connectionState.nodes, dbNodeId, databaseName)
    const newExpanded = idsOutsideDatabase(connectionState.expandedNodes, databaseName)
    if (connectionState.expandedNodes.has(dbNodeId)) {
      newExpanded.add(dbNodeId)
    }
    const newLoadingNodes = idsOutsideDatabase(connectionState.loadingNodes, databaseName)
    const childIdsByParentId = buildChildIndex(newNodes)
    const newSelectedNodeId = retainedSelectedNodeId(connectionState.selectedNodeId, newNodes)

    set((state) =>
      setConnectionState(state, connectionId, {
        nodes: newNodes,
        childIdsByParentId: childIdsByParentId,
        expandedNodes: newExpanded,
        loadingNodes: newLoadingNodes,
        selectedNodeId: newSelectedNodeId,
        loadGeneration: connectionState.loadGeneration + 1,
      })
    )

    // If the database was expanded, re-fetch its children (creates category nodes synchronously)
    if (newExpanded.has(dbNodeId)) {
      await get().loadChildren(connectionId, dbNodeId)
    }
  },

  // ------ refreshAll ------

  refreshAll: async (connectionId: string) => {
    const current = getConnectionState(get(), connectionId)
    // Preserve filterText and selectedNodeId; increment generation to invalidate in-flight requests
    const defaults = createDefaultConnectionState()
    set((state) =>
      setConnectionState(state, connectionId, {
        ...defaults,
        filterText: current.filterText,
        selectedNodeId: current.selectedNodeId,
        loadGeneration: current.loadGeneration + 1,
      })
    )
    await get().loadDatabases(connectionId)
    void invalidateMetadataCache(connectionId).catch((error) => {
      logFrontendWarning(
        '[schema-store] Failed to invalidate backend metadata cache during refreshAll:',
        error
      )
    })
  },

  // ------ refreshCategory ------

  refreshCategory: async (connectionId: string, databaseName: string, categoryType: string) => {
    const state = get()
    const connectionState = getConnectionState(state, connectionId)
    const catNodeId = makeNodeId('category', databaseName, categoryType)

    // Check if category node exists
    if (!connectionState.nodes[catNodeId]) return

    // Remove all children (and grandchildren) of this category node
    const childIds = connectionState.childIdsByParentId[catNodeId] || []
    const newNodes = { ...connectionState.nodes }

    for (const childId of childIds) {
      // Remove grandchildren (e.g., columns under tables)
      const grandchildIds = connectionState.childIdsByParentId[childId] || []
      for (const gcId of grandchildIds) {
        delete newNodes[gcId]
      }
      delete newNodes[childId]
    }

    // Mark category as not loaded so it can be re-fetched
    newNodes[catNodeId] = { ...newNodes[catNodeId], isLoaded: false }

    // Clear loading state for category and its children
    const newLoadingNodes = new Set(connectionState.loadingNodes)
    newLoadingNodes.delete(catNodeId)
    for (const childId of childIds) {
      newLoadingNodes.delete(childId)
    }

    // Remove expanded state for children of this category (tables that were expanded)
    const newExpanded = new Set(connectionState.expandedNodes)
    for (const childId of childIds) {
      newExpanded.delete(childId)
    }

    // Clear selectedNodeId if it points to a node that was removed
    const newSelectedNodeId = retainedSelectedNodeId(connectionState.selectedNodeId, newNodes)

    const childIdsByParentId = buildChildIndex(newNodes)

    set((state) =>
      setConnectionState(state, connectionId, {
        nodes: newNodes,
        childIdsByParentId: childIdsByParentId,
        expandedNodes: newExpanded,
        loadingNodes: newLoadingNodes,
        selectedNodeId: newSelectedNodeId,
        loadGeneration: connectionState.loadGeneration + 1,
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
