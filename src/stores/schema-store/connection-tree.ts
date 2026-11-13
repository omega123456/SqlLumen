import type { TreeNode } from '../../types/schema'
import type { ConnectionTreeState } from '../schema-store'
import { databaseNodeId, makeNodeId, parseNodeId } from './node-ids'

const ROOT_PARENT_ID = '__root__'

export const SCHEMA_CATEGORIES = [
  { type: 'table', label: 'Tables' },
  { type: 'view', label: 'Views' },
  { type: 'procedure', label: 'Procedures' },
  { type: 'function', label: 'Functions' },
  { type: 'trigger', label: 'Triggers' },
  { type: 'event', label: 'Events' },
] as const

type TreeNodes = Record<string, TreeNode>
type TreeStructure = Pick<ConnectionTreeState, 'nodes' | 'childIdsByParentId'>
type TreeRefresh = Pick<
  ConnectionTreeState,
  | 'nodes'
  | 'childIdsByParentId'
  | 'expandedNodes'
  | 'loadingNodes'
  | 'selectedNodeId'
  | 'loadGeneration'
>

export interface LoadedChildren {
  nodeId: string
  childNodes: TreeNode[]
}

export interface CategoryRefreshTarget {
  databaseName: string
  categoryType: string
}

export function createDefaultConnectionState(): ConnectionTreeState {
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

function compareByLabel(nodes: TreeNodes) {
  return (left: string, right: string): number => {
    const leftNode = nodes[left]
    const rightNode = nodes[right]
    if (!leftNode) return 0
    if (!rightNode) return 0
    return leftNode.label.localeCompare(rightNode.label)
  }
}

export function buildChildIndex(nodes: TreeNodes): Record<string, string[]> {
  const index: Record<string, string[]> = {}
  for (const [id, node] of Object.entries(nodes)) {
    const parentId = node.parentId ?? ROOT_PARENT_ID
    if (!index[parentId]) index[parentId] = []
    index[parentId].push(id)
  }
  for (const parentId of Object.keys(index)) {
    index[parentId].sort(compareByLabel(nodes))
  }
  return index
}

function withChildIndex(nodes: TreeNodes): TreeStructure {
  return { nodes: nodes, childIdsByParentId: buildChildIndex(nodes) }
}

function withoutId(ids: Set<string>, id: string): Set<string> {
  const remaining = new Set(ids)
  remaining.delete(id)
  return remaining
}

function withoutIds(ids: Set<string>, removedIds: readonly string[]): Set<string> {
  const remaining = new Set(ids)
  for (const removedId of removedIds) {
    remaining.delete(removedId)
  }
  return remaining
}

function databaseNode(databaseName: string, existing: TreeNode | undefined): TreeNode {
  if (existing?.isLoaded) return existing
  return {
    id: databaseNodeId(databaseName),
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
  return databaseIds.has(databaseNodeId(node.databaseName))
}

function mergeDatabaseNodes(existingNodes: TreeNodes, databases: string[]): TreeNodes {
  const databaseIds = new Set<string>()
  const mergedNodes: TreeNodes = {}
  for (const databaseName of databases) {
    const id = databaseNodeId(databaseName)
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

export function treeWithListedDatabases(
  tree: ConnectionTreeState,
  databases: string[]
): Pick<ConnectionTreeState, 'nodes' | 'childIdsByParentId' | 'expandedNodes' | 'loadingNodes'> {
  return {
    ...withChildIndex(mergeDatabaseNodes(tree.nodes, databases)),
    expandedNodes: tree.expandedNodes,
    loadingNodes: new Set(),
  }
}

function categoryNode(databaseNodeIdValue: string, databaseName: string) {
  return (category: (typeof SCHEMA_CATEGORIES)[number]): TreeNode => ({
    id: makeNodeId('category', databaseName, category.type),
    label: category.label,
    type: 'category',
    parentId: databaseNodeIdValue,
    hasChildren: true,
    isLoaded: false,
    databaseName: databaseName,
    metadata: { categoryType: category.type, databaseName: databaseName },
  })
}

export function treeWithDatabaseCategories(
  tree: ConnectionTreeState,
  nodeId: string
): TreeStructure {
  const databaseName = parseNodeId(nodeId).database
  const nodes = { ...tree.nodes }
  for (const node of SCHEMA_CATEGORIES.map(categoryNode(nodeId, databaseName))) {
    nodes[node.id] = node
  }
  nodes[nodeId] = { ...nodes[nodeId], isLoaded: true }
  return withChildIndex(nodes)
}

export function treeWithNodeLoading(
  tree: ConnectionTreeState,
  nodeId: string
): Pick<ConnectionTreeState, 'loadingNodes'> {
  const loadingNodes = new Set(tree.loadingNodes)
  loadingNodes.add(nodeId)
  return { loadingNodes: loadingNodes }
}

export function treeWithNodeLoadingCleared(
  tree: ConnectionTreeState,
  nodeId: string
): Pick<ConnectionTreeState, 'loadingNodes'> {
  return { loadingNodes: withoutId(tree.loadingNodes, nodeId) }
}

export function treeWithLoadedChildren(
  tree: ConnectionTreeState,
  { nodeId, childNodes }: LoadedChildren
): Pick<ConnectionTreeState, 'nodes' | 'childIdsByParentId' | 'loadingNodes'> {
  const nodes = { ...tree.nodes }
  for (const child of childNodes) {
    nodes[child.id] = child
  }
  nodes[nodeId] = { ...nodes[nodeId], isLoaded: true }
  return {
    ...withChildIndex(nodes),
    loadingNodes: withoutId(tree.loadingNodes, nodeId),
  }
}

export function treeWithToggledExpansion(
  tree: ConnectionTreeState,
  nodeId: string
): Pick<ConnectionTreeState, 'expandedNodes'> {
  if (tree.expandedNodes.has(nodeId)) {
    return { expandedNodes: withoutId(tree.expandedNodes, nodeId) }
  }
  const expandedNodes = new Set(tree.expandedNodes)
  expandedNodes.add(nodeId)
  return { expandedNodes: expandedNodes }
}

function collapsedAncestorIds(tree: ConnectionTreeState, nodeId: string): string[] {
  const collapsedIds: string[] = []
  let currentId: string | null = nodeId
  while (currentId) {
    const node: TreeNode | undefined = tree.nodes[currentId]
    if (!node) break
    const isCollapsedParent = node.hasChildren && !tree.expandedNodes.has(currentId)
    if (isCollapsedParent) collapsedIds.push(currentId)
    currentId = node.parentId
  }
  return collapsedIds
}

export function treeWithPathExpanded(
  tree: ConnectionTreeState,
  nodeId: string
): Pick<ConnectionTreeState, 'expandedNodes'> | null {
  const collapsedIds = collapsedAncestorIds(tree, nodeId)
  if (collapsedIds.length === 0) return null
  return { expandedNodes: new Set([...tree.expandedNodes, ...collapsedIds]) }
}

function isOutsideDatabase(nodeId: string, databaseName: string): boolean {
  return parseNodeId(nodeId).database !== databaseName
}

function nodesWithDatabaseReset(
  nodes: TreeNodes,
  databaseNodeIdValue: string,
  databaseName: string
): TreeNodes {
  const keptNodes: TreeNodes = {}
  for (const [id, node] of Object.entries(nodes)) {
    if (id === databaseNodeIdValue) {
      keptNodes[id] = { ...node, isLoaded: false }
      continue
    }
    const isKeptNode = isOutsideDatabase(id, databaseName) || node.type === 'database'
    if (isKeptNode) {
      keptNodes[id] = node
    }
  }
  return keptNodes
}

function idsOutsideDatabase(ids: Set<string>, databaseName: string): Set<string> {
  return new Set([...ids].filter((id) => isOutsideDatabase(id, databaseName)))
}

function retainedSelectedNodeId(selectedNodeId: string | null, nodes: TreeNodes): string | null {
  if (!selectedNodeId) return selectedNodeId
  return nodes[selectedNodeId] ? selectedNodeId : null
}

export function treeWithDatabaseRefreshed(
  tree: ConnectionTreeState,
  databaseName: string
): TreeRefresh {
  const refreshedNodeId = databaseNodeId(databaseName)
  const nodes = nodesWithDatabaseReset(tree.nodes, refreshedNodeId, databaseName)
  const expandedNodes = idsOutsideDatabase(tree.expandedNodes, databaseName)
  if (tree.expandedNodes.has(refreshedNodeId)) {
    expandedNodes.add(refreshedNodeId)
  }
  return {
    ...withChildIndex(nodes),
    expandedNodes: expandedNodes,
    loadingNodes: idsOutsideDatabase(tree.loadingNodes, databaseName),
    selectedNodeId: retainedSelectedNodeId(tree.selectedNodeId, nodes),
    loadGeneration: tree.loadGeneration + 1,
  }
}

function nodesWithoutCategoryChildren(tree: ConnectionTreeState, childIds: string[]): TreeNodes {
  const nodes = { ...tree.nodes }
  for (const childId of childIds) {
    const grandchildIds = tree.childIdsByParentId[childId] || []
    for (const grandchildId of grandchildIds) {
      delete nodes[grandchildId]
    }
    delete nodes[childId]
  }
  return nodes
}

export function treeWithCategoryRefreshed(
  tree: ConnectionTreeState,
  categoryNodeId: string
): TreeRefresh {
  const childIds = tree.childIdsByParentId[categoryNodeId] || []
  const nodes = nodesWithoutCategoryChildren(tree, childIds)
  nodes[categoryNodeId] = { ...nodes[categoryNodeId], isLoaded: false }
  return {
    ...withChildIndex(nodes),
    expandedNodes: withoutIds(tree.expandedNodes, childIds),
    loadingNodes: withoutIds(tree.loadingNodes, [categoryNodeId, ...childIds]),
    selectedNodeId: retainedSelectedNodeId(tree.selectedNodeId, nodes),
    loadGeneration: tree.loadGeneration + 1,
  }
}

export function treeResetKeepingView(tree: ConnectionTreeState): ConnectionTreeState {
  return {
    ...createDefaultConnectionState(),
    filterText: tree.filterText,
    selectedNodeId: tree.selectedNodeId,
    loadGeneration: tree.loadGeneration + 1,
  }
}
