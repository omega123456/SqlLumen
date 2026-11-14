import { hasMatchingDescendantInFilter, isNodeUnderFilterScope } from '../../../lib/tree-filter'
import type { NodeType, TreeNode as TreeNodeData } from '../../../types/schema'

type NodeMap = Record<string, TreeNodeData>

const SINGLE_CLICK_ACTIVATABLE_NODE_TYPES = new Set<NodeType>([
  'table',
  'view',
  'procedure',
  'function',
])

const DOUBLE_CLICK_ACTIVATABLE_NODE_TYPES = new Set<NodeType>(['trigger', 'event'])

export function isSingleClickActivatableNodeType(type: NodeType): boolean {
  return SINGLE_CLICK_ACTIVATABLE_NODE_TYPES.has(type)
}

export function isDoubleClickActivatableNodeType(type: NodeType): boolean {
  return DOUBLE_CLICK_ACTIVATABLE_NODE_TYPES.has(type)
}

export function isKeyboardActivatableNodeType(type: NodeType): boolean {
  return isSingleClickActivatableNodeType(type) || isDoubleClickActivatableNodeType(type)
}

interface FilterScopeQuery {
  nodeId: string
  filterMatchIds: Set<string> | undefined
  filterScopeRootId: string | null
  nodes: NodeMap
}

export function getEffectiveFilterMatchIds({
  nodeId,
  filterMatchIds,
  filterScopeRootId,
  nodes,
}: FilterScopeQuery): Set<string> | undefined {
  if (!filterMatchIds) {
    return undefined
  }

  if (filterScopeRootId == null) {
    return filterMatchIds
  }

  if (isNodeUnderFilterScope(nodeId, filterScopeRootId, nodes)) {
    return filterMatchIds
  }

  if (isNodeUnderFilterScope(filterScopeRootId, nodeId, nodes)) {
    return filterMatchIds
  }

  return undefined
}

interface NodeFilterQuery {
  nodeId: string
  node: TreeNodeData
  filterMatchIds: Set<string> | undefined
  filterScopeRootId: string | null
  nodes: NodeMap
}

export function shouldRenderNodeInFilter({
  nodeId,
  node,
  filterMatchIds,
  filterScopeRootId,
  nodes,
}: NodeFilterQuery): boolean {
  const effectiveFilterMatchIds = getEffectiveFilterMatchIds({
    nodeId: nodeId,
    filterMatchIds: filterMatchIds,
    filterScopeRootId: filterScopeRootId,
    nodes: nodes,
  })

  const shouldRenderColumnDespiteFilter =
    node.type === 'column' && node.parentId != null && nodes[node.parentId] != null

  return !(
    effectiveFilterMatchIds &&
    !effectiveFilterMatchIds.has(nodeId) &&
    !shouldRenderColumnDespiteFilter
  )
}

interface TreeVisibilityQuery {
  nodeId: string | null
  filterMatchIds: Set<string> | undefined
  filterScopeRootId: string | null
  nodes: NodeMap
  expandedNodes: Set<string>
}

type AncestorStep = 'hidden' | 'visible' | 'continue'

function isParentShowingChildren(query: TreeVisibilityQuery, parentId: string): boolean {
  const parentEffectiveFilterMatchIds = getEffectiveFilterMatchIds({
    nodeId: parentId,
    filterMatchIds: query.filterMatchIds,
    filterScopeRootId: query.filterScopeRootId,
    nodes: query.nodes,
  })
  const parentFilterDrivesExpand =
    parentEffectiveFilterMatchIds != null &&
    hasMatchingDescendantInFilter(parentId, parentEffectiveFilterMatchIds, query.nodes)
  return query.expandedNodes.has(parentId) || parentFilterDrivesExpand
}

function ancestorStep(query: TreeVisibilityQuery, currentId: string): AncestorStep {
  const currentNode: TreeNodeData | undefined = query.nodes[currentId]
  if (!currentNode) return 'hidden'
  const isRendered = shouldRenderNodeInFilter({
    nodeId: currentId,
    node: currentNode,
    filterMatchIds: query.filterMatchIds,
    filterScopeRootId: query.filterScopeRootId,
    nodes: query.nodes,
  })
  if (!isRendered) return 'hidden'
  const parentId = currentNode.parentId
  if (!parentId) return 'visible'
  return isParentShowingChildren(query, parentId) ? 'continue' : 'hidden'
}

export function isNodeVisibleInTree(query: TreeVisibilityQuery): boolean {
  let currentId: string | null = query.nodeId
  if (!currentId) return false
  while (currentId) {
    const step = ancestorStep(query, currentId)
    if (step !== 'continue') return step === 'visible'
    currentId = query.nodes[currentId]?.parentId ?? null
  }
  return true
}

export function isFilterExpanded(
  filterDrivesExpand: boolean,
  isSuppressedByScope: boolean
): boolean {
  return filterDrivesExpand && !isSuppressedByScope
}

export function focusSiblingTreeItem(event: React.KeyboardEvent, delta: 1 | -1): void {
  event.preventDefault()
  const tree = event.currentTarget.closest('[role="tree"]')
  if (!tree) return
  const allItems = Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]'))
  const currentIndex = allItems.findIndex((item) => item === event.currentTarget)
  if (currentIndex < 0) return
  allItems[currentIndex + delta]?.focus()
}

export function selectableClassName(
  baseClassName: string,
  selectedClassName: string,
  isSelected: boolean
) {
  return [baseClassName, isSelected ? selectedClassName : ''].filter(Boolean).join(' ')
}

interface ChildVisibility {
  hasChildren: boolean
  isExpanded: boolean
  filterDrivesExpand: boolean
  childCount: number
}

export function shouldShowChildren(visibility: ChildVisibility): boolean {
  if (!visibility.hasChildren) return false
  if (visibility.childCount === 0) return false
  return visibility.isExpanded || visibility.filterDrivesExpand
}

export function treeItemTabIndex(
  isSelected: boolean,
  isFirstVisible: boolean | undefined,
  selectedNodeIsVisible: boolean
): 0 | -1 {
  if (isSelected) return 0
  const isFallbackTabStop = isFirstVisible && !selectedNodeIsVisible
  return isFallbackTabStop ? 0 : -1
}

export function databaseLabelTitle(node: TreeNodeData): string | undefined {
  return node.type === 'database' ? node.label : undefined
}
