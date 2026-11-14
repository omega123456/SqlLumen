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
  childIdsByParentId: Record<string, string[]>
  expandedNodes: Set<string>
  loadingNodes: Set<string>
  selectedNodeId: string | null
  filterText: string
  loadGeneration: number
}

export interface TreeRevealRequest {
  connectionId: string
  nodeId: string
  seq: number
}

export interface SchemaState {
  connectionStates: Record<string, ConnectionTreeState>
  revealRequest: TreeRevealRequest | null

  loadDatabases: (connectionId: string) => Promise<void>
  loadChildren: (connectionId: string, nodeId: string) => Promise<void>
  toggleExpand: (nodeId: string, connectionId: string) => void
  ensurePathExpanded: (connectionId: string, nodeId: string) => void
  selectNode: (nodeId: string, connectionId: string) => void
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

function patchTree(connectionId: string, patch: Partial<ConnectionTreeState>) {
  useSchemaStore.setState((state) =>
    patchConnectionTree(state, { connectionId: connectionId, patch: patch })
  )
}

function treeOf(connectionId: string) {
  return getConnectionState(useSchemaStore.getState(), connectionId)
}

async function loadDatabases(connectionId: string): Promise<void> {
  if (!useSchemaStore.getState().connectionStates[connectionId]) {
    patchTree(connectionId, createDefaultConnectionState())
  }

  const generation = useSchemaStore.getState().connectionStates[connectionId].loadGeneration
  const databases = await listDatabases(connectionId)
  if (!isCurrentLoadGeneration(useSchemaStore.getState(), connectionId, generation)) return

  patchTree(connectionId, treeWithListedDatabases(treeOf(connectionId), databases))
}

async function loadChildren(connectionId: string, nodeId: string): Promise<void> {
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
    { get: useSchemaStore.getState, set: useSchemaStore.setState },
    {
      connectionId: connectionId,
      nodeId: nodeId,
      fetchNodes: () => loadChildNodes(connectionId, nodeId),
    }
  )
}

function toggleExpand(nodeId: string, connectionId: string): void {
  const connectionState = treeOf(connectionId)
  const node = connectionState.nodes[nodeId]
  if (!node) return
  if (!node.hasChildren) return

  const wasExpanded = connectionState.expandedNodes.has(nodeId)
  patchTree(connectionId, treeWithToggledExpansion(connectionState, nodeId))
  if (wasExpanded) return
  if (!node.isLoaded) {
    void useSchemaStore.getState().loadChildren(connectionId, nodeId)
  }
}

function ensurePathExpanded(connectionId: string, nodeId: string): void {
  const expansion = treeWithPathExpanded(treeOf(connectionId), nodeId)
  if (!expansion) return
  patchTree(connectionId, expansion)
}

function selectNode(nodeId: string, connectionId: string): void {
  patchTree(connectionId, { selectedNodeId: nodeId })
}

function requestReveal(connectionId: string, nodeId: string): void {
  useSchemaStore.setState((state) =>
    nextRevealRequest(state, { connectionId: connectionId, nodeId: nodeId })
  )
}

function setFilter(text: string, connectionId: string): void {
  patchTree(connectionId, { filterText: text })
}

async function refreshDatabase(connectionId: string, databaseName: string): Promise<void> {
  const refreshed = treeWithDatabaseRefreshed(treeOf(connectionId), databaseName)
  patchTree(connectionId, refreshed)

  const refreshedNodeId = databaseNodeId(databaseName)
  if (refreshed.expandedNodes.has(refreshedNodeId)) {
    await useSchemaStore.getState().loadChildren(connectionId, refreshedNodeId)
  }
}

async function refreshAll(connectionId: string): Promise<void> {
  patchTree(connectionId, treeResetKeepingView(treeOf(connectionId)))
  await useSchemaStore.getState().loadDatabases(connectionId)
  void invalidateMetadataCache(connectionId).catch((error) => {
    logFrontendWarning(
      '[schema-store] Failed to invalidate backend metadata cache during refreshAll:',
      error
    )
  })
}

async function refreshCategory(
  connectionId: string,
  databaseName: string,
  categoryType: string
): Promise<void> {
  const connectionState = treeOf(connectionId)
  const categoryNodeId = makeNodeId('category', databaseName, categoryType)
  if (!connectionState.nodes[categoryNodeId]) return

  patchTree(connectionId, treeWithCategoryRefreshed(connectionState, categoryNodeId))
  await useSchemaStore.getState().loadChildren(connectionId, categoryNodeId)
}

function clearConnectionState(connectionId: string): void {
  useSchemaStore.setState((state) => removeConnectionTree(state, connectionId))
}

export const useSchemaStore = create<SchemaState>()(() => ({
  connectionStates: {},
  revealRequest: null,
  loadDatabases: loadDatabases,
  loadChildren: loadChildren,
  toggleExpand: toggleExpand,
  ensurePathExpanded: ensurePathExpanded,
  selectNode: selectNode,
  requestReveal: requestReveal,
  setFilter: setFilter,
  refreshDatabase: refreshDatabase,
  refreshAll: refreshAll,
  refreshCategory: refreshCategory,
  clearConnectionState: clearConnectionState,
}))
