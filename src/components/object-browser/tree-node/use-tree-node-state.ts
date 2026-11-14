import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useSchemaStore, type ConnectionTreeState } from '../../../stores/schema-store'
import { hasMatchingDescendantInFilter } from '../../../lib/tree-filter'
import { isNullish } from '../../../lib/value-checks'
import type { TreeNode as TreeNodeData } from '../../../types/schema'
import { getEffectiveFilterMatchIds, isNodeVisibleInTree } from './tree-node-model'

const EMPTY_CHILDREN: string[] = []
const EMPTY_NODES: Record<string, TreeNodeData> = {}
const EMPTY_EXPANDED_NODES = new Set<string>()

export interface TreeNodeIdentity {
  nodeId: string
  connectionId: string
  filterMatchIds: Set<string> | undefined
  filterScopeRootId: string | null
}

type SchemaState = ReturnType<typeof useSchemaStore.getState>

function treeOf(state: SchemaState, connectionId: string): ConnectionTreeState | undefined {
  return state.connectionStates[connectionId]
}

function useTreeNodeStoreState({ nodeId, connectionId }: TreeNodeIdentity) {
  const node = useSchemaStore((state) => treeOf(state, connectionId)?.nodes[nodeId] ?? null)
  const isExpanded = useSchemaStore(
    (state) => treeOf(state, connectionId)?.expandedNodes.has(nodeId) ?? false
  )
  const isLoading = useSchemaStore(
    (state) => treeOf(state, connectionId)?.loadingNodes.has(nodeId) ?? false
  )
  const expandedNodes = useSchemaStore(
    (state) => treeOf(state, connectionId)?.expandedNodes ?? EMPTY_EXPANDED_NODES
  )
  const selectedNodeId = useSchemaStore(
    (state) => treeOf(state, connectionId)?.selectedNodeId ?? null
  )
  const nodesMap = useSchemaStore((state) => treeOf(state, connectionId)?.nodes ?? EMPTY_NODES)
  const indexedChildIds = useSchemaStore(
    (state) => treeOf(state, connectionId)?.childIdsByParentId[nodeId] ?? EMPTY_CHILDREN
  )
  return { node, isExpanded, isLoading, expandedNodes, selectedNodeId, nodesMap, indexedChildIds }
}

type TreeNodeStoreState = ReturnType<typeof useTreeNodeStoreState>

interface ScopeSuppressionQuery {
  nodeId: string
  filterMatchIds: Set<string> | undefined
  filterScopeRootId: string | null
  nodesMap: Record<string, TreeNodeData>
  isExpanded: boolean
}

function isSuppressedByFilterScope(query: ScopeSuppressionQuery): boolean {
  const { filterMatchIds, filterScopeRootId, nodesMap, nodeId, isExpanded } = query
  if (!filterMatchIds) return false
  if (!filterScopeRootId) return false
  if (isExpanded) return false
  const scopeParent = nodesMap[filterScopeRootId]?.parentId
  if (isNullish(scopeParent)) return false
  if (nodeId === filterScopeRootId) return false
  const nodeParent = nodesMap[nodeId]?.parentId
  return nodeParent === scopeParent
}

function useFilterExpansion(identity: TreeNodeIdentity, store: TreeNodeStoreState) {
  const { nodeId, filterMatchIds, filterScopeRootId } = identity
  const { nodesMap, isExpanded } = store
  const effectiveFilterMatchIds = useMemo(
    () =>
      getEffectiveFilterMatchIds({
        nodeId: nodeId,
        filterMatchIds: filterMatchIds,
        filterScopeRootId: filterScopeRootId,
        nodes: nodesMap,
      }),
    [filterMatchIds, filterScopeRootId, nodeId, nodesMap]
  )
  const filterDrivesExpand = useMemo(() => {
    if (effectiveFilterMatchIds == null) return false
    return hasMatchingDescendantInFilter(nodeId, effectiveFilterMatchIds, nodesMap)
  }, [effectiveFilterMatchIds, nodeId, nodesMap])
  const isSuppressedByScope = useMemo(
    () =>
      isSuppressedByFilterScope({
        nodeId: nodeId,
        filterMatchIds: filterMatchIds,
        filterScopeRootId: filterScopeRootId,
        nodesMap: nodesMap,
        isExpanded: isExpanded,
      }),
    [filterMatchIds, filterScopeRootId, nodesMap, nodeId, isExpanded]
  )
  return { filterDrivesExpand, isSuppressedByScope }
}

export function useScrollIntoViewWhenSelected(
  rowRef: RefObject<HTMLDivElement | null>,
  isSelected: boolean
): void {
  const wasSelectedRef = useRef(false)
  useEffect(() => {
    const hasJustBeenSelected = isSelected && !wasSelectedRef.current
    if (hasJustBeenSelected) {
      rowRef.current?.scrollIntoView({ block: 'nearest' })
    }
    wasSelectedRef.current = isSelected
  }, [isSelected, rowRef])
}

export function useTreeNodeState(identity: TreeNodeIdentity) {
  const store = useTreeNodeStoreState(identity)
  const { node, isExpanded, indexedChildIds, selectedNodeId, nodesMap, expandedNodes } = store
  const { filterMatchIds, filterScopeRootId } = identity
  const { filterDrivesExpand, isSuppressedByScope } = useFilterExpansion(identity, store)

  const childIds = useMemo(() => {
    if (!node) return []
    if (isSuppressedByScope) return []
    const isShowingChildren = isExpanded || filterDrivesExpand
    if (!isShowingChildren) return []
    return indexedChildIds
  }, [isExpanded, node, indexedChildIds, filterDrivesExpand, isSuppressedByScope])

  const selectedNodeIsVisible = useMemo(
    () =>
      isNodeVisibleInTree({
        nodeId: selectedNodeId,
        filterMatchIds: filterMatchIds,
        filterScopeRootId: filterScopeRootId,
        nodes: nodesMap,
        expandedNodes: expandedNodes,
      }),
    [expandedNodes, filterMatchIds, filterScopeRootId, nodesMap, selectedNodeId]
  )

  const isSelected = selectedNodeId === identity.nodeId
  return {
    ...store,
    filterDrivesExpand,
    isSuppressedByScope,
    childIds,
    selectedNodeIsVisible,
    isSelected,
  }
}
