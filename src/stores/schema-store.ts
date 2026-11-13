import { create } from 'zustand'
import type { TreeNode } from '../types/schema'
import {
  invalidateMetadataCache,
  listDatabases,
  listSchemaObjects,
  listColumns,
} from '../lib/schema-commands'
import { logFrontendWarning } from '../lib/app-log-commands'
import { databaseNodeId, makeNodeId, parseNodeId } from './schema-store/node-ids'
import {
  createDefaultConnectionState,
  treeResetKeepingView,
  treeWithCategoryRefreshed,
  treeWithDatabaseCategories,
  treeWithDatabaseRefreshed,
  treeWithListedDatabases,
  treeWithLoadedChildren,
  treeWithNodeLoading,
  treeWithNodeLoadingCleared,
  treeWithPathExpanded,
  treeWithToggledExpansion,
} from './schema-store/connection-tree'
import {
  getConnectionState,
  isCurrentLoadGeneration,
  nextRevealRequest,
  patchConnectionTree,
  removeConnectionTree,
} from './schema-store/schema-reducers'

export { makeNodeId, parseNodeId } from './schema-store/node-ids'
export { SCHEMA_CATEGORIES } from './schema-store/connection-tree'

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

/** A request for the object browser to scroll to and focus a node. */
export interface TreeRevealRequest {
  connectionId: string
  nodeId: string
  /** Increments on every request so repeated reveals of the same node still fire. */
  seq: number
}

export interface SchemaState {
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
  const patchTree = (patch: Partial<ConnectionTreeState>) =>
    set((state) => patchConnectionTree(state, { connectionId: connectionId, patch: patch }))
  const connectionState = getConnectionState(get(), connectionId)
  const generation = connectionState.loadGeneration
  patchTree(treeWithNodeLoading(connectionState, nodeId))

  try {
    const childNodes = await fetchNodes()
    if (!isCurrentLoadGeneration(get(), connectionId, generation)) return
    const freshTree = getConnectionState(get(), connectionId)
    patchTree(treeWithLoadedChildren(freshTree, { nodeId: nodeId, childNodes: childNodes }))
  } catch (error) {
    logFrontendWarning('[schema-store] Failed to load child nodes:', error)
    if (!isCurrentLoadGeneration(get(), connectionId, generation)) return
    patchTree(treeWithNodeLoadingCleared(getConnectionState(get(), connectionId), nodeId))
  }
}

type ChildLoader = (connectionId: string, nodeId: string) => Promise<TreeNode[]>

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

export const useSchemaStore = create<SchemaState>()((set, get) => {
  const patchTree = (connectionId: string, patch: Partial<ConnectionTreeState>) => {
    set((state) => patchConnectionTree(state, { connectionId: connectionId, patch: patch }))
  }

  const treeOf = (connectionId: string) => getConnectionState(get(), connectionId)

  return {
    connectionStates: {},
    revealRequest: null,

    loadDatabases: async (connectionId: string) => {
      if (!get().connectionStates[connectionId]) {
        patchTree(connectionId, createDefaultConnectionState())
      }

      const generation = get().connectionStates[connectionId].loadGeneration
      const databases = await listDatabases(connectionId)
      if (!isCurrentLoadGeneration(get(), connectionId, generation)) return

      patchTree(connectionId, treeWithListedDatabases(treeOf(connectionId), databases))
    },

    loadChildren: async (connectionId: string, nodeId: string) => {
      const connectionState = treeOf(connectionId)
      const node = connectionState.nodes[nodeId]
      if (!node) return
      if (node.isLoaded) return

      if (node.type === 'database') {
        patchTree(connectionId, treeWithDatabaseCategories(connectionState, nodeId))
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

    toggleExpand: (nodeId: string, connectionId: string) => {
      const connectionState = treeOf(connectionId)
      const node = connectionState.nodes[nodeId]
      if (!node) return
      if (!node.hasChildren) return

      const wasExpanded = connectionState.expandedNodes.has(nodeId)
      patchTree(connectionId, treeWithToggledExpansion(connectionState, nodeId))
      if (wasExpanded) return
      if (!node.isLoaded) {
        void get().loadChildren(connectionId, nodeId)
      }
    },

    ensurePathExpanded: (connectionId: string, nodeId: string) => {
      const expansion = treeWithPathExpanded(treeOf(connectionId), nodeId)
      if (!expansion) return
      patchTree(connectionId, expansion)
    },

    selectNode: (nodeId: string, connectionId: string) => {
      patchTree(connectionId, { selectedNodeId: nodeId })
    },

    requestReveal: (connectionId: string, nodeId: string) => {
      set((state) => nextRevealRequest(state, { connectionId: connectionId, nodeId: nodeId }))
    },

    setFilter: (text: string, connectionId: string) => {
      patchTree(connectionId, { filterText: text })
    },

    refreshDatabase: async (connectionId: string, databaseName: string) => {
      const refreshed = treeWithDatabaseRefreshed(treeOf(connectionId), databaseName)
      patchTree(connectionId, refreshed)

      const refreshedNodeId = databaseNodeId(databaseName)
      if (refreshed.expandedNodes.has(refreshedNodeId)) {
        await get().loadChildren(connectionId, refreshedNodeId)
      }
    },

    refreshAll: async (connectionId: string) => {
      patchTree(connectionId, treeResetKeepingView(treeOf(connectionId)))
      await get().loadDatabases(connectionId)
      void invalidateMetadataCache(connectionId).catch((error) => {
        logFrontendWarning(
          '[schema-store] Failed to invalidate backend metadata cache during refreshAll:',
          error
        )
      })
    },

    refreshCategory: async (connectionId: string, databaseName: string, categoryType: string) => {
      const connectionState = treeOf(connectionId)
      const categoryNodeId = makeNodeId('category', databaseName, categoryType)
      if (!connectionState.nodes[categoryNodeId]) return

      patchTree(connectionId, treeWithCategoryRefreshed(connectionState, categoryNodeId))
      await get().loadChildren(connectionId, categoryNodeId)
    },

    clearConnectionState: (connectionId: string) => {
      set((state) => removeConnectionTree(state, connectionId))
    },
  }
})
