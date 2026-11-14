import type { TreeNode } from '../types/schema'

const UNFILTERED_NODE_TYPES: ReadonlySet<TreeNode['type']> = new Set<TreeNode['type']>([
  'column',
  'category',
])

export function isNodeUnderFilterScope(
  nodeId: string,
  scopeRootId: string,
  nodes: Record<string, TreeNode>
): boolean {
  let current: string | null = nodeId
  while (current) {
    if (current === scopeRootId) {
      return true
    }
    current = nodes[current]?.parentId ?? null
  }
  return false
}

export function hasMatchingDescendantInFilter(
  nodeId: string,
  matchIds: Set<string>,
  nodes: Record<string, TreeNode>
): boolean {
  for (const id of matchIds) {
    if (id === nodeId) {
      continue
    }
    if (isNodeUnderFilterScope(id, nodeId, nodes)) {
      return true
    }
  }
  return false
}

export function computeFilterMatchIds(
  nodes: Record<string, TreeNode>,
  filterText: string
): Set<string> {
  const matchIds = new Set<string>()
  const lowerFilter = filterText.toLowerCase()

  for (const [id, node] of Object.entries(nodes)) {
    if (!isFilterCandidateMatch(node, lowerFilter)) {
      continue
    }

    matchIds.add(id)
    let parentId = node.parentId
    while (parentId) {
      matchIds.add(parentId)
      const parent = nodes[parentId]
      parentId = parent?.parentId ?? null
    }
  }

  return matchIds
}

export function computeScopedFilterMatchIds(
  nodes: Record<string, TreeNode>,
  filterText: string,
  scopeRootId: string | null
): Set<string> {
  const hasNoScopeRoot = !scopeRootId || !nodes[scopeRootId]
  if (hasNoScopeRoot) {
    return computeFilterMatchIds(nodes, filterText)
  }

  const matchIds = new Set<string>()
  const lowerFilter = filterText.toLowerCase()

  for (const [id, node] of Object.entries(nodes)) {
    if (!isNodeUnderFilterScope(id, scopeRootId, nodes)) {
      continue
    }
    if (!isFilterCandidateMatch(node, lowerFilter)) {
      continue
    }
    for (const pathId of collectPathUpToScopeRoot(id, scopeRootId, nodes)) {
      matchIds.add(pathId)
    }
  }

  for (const ancestorId of collectPathToTreeRoot(scopeRootId, nodes)) {
    matchIds.add(ancestorId)
  }

  return matchIds
}

function isFilterCandidateMatch(node: TreeNode, lowerFilter: string): boolean {
  if (UNFILTERED_NODE_TYPES.has(node.type)) {
    return false
  }
  return node.label.toLowerCase().includes(lowerFilter)
}

function collectPathUpToScopeRoot(
  nodeId: string,
  scopeRootId: string,
  nodes: Record<string, TreeNode>
): string[] {
  const path: string[] = []
  let current: string | null = nodeId
  while (current) {
    path.push(current)
    if (current === scopeRootId) {
      break
    }
    current = nodes[current]?.parentId ?? null
  }
  return path
}

function collectPathToTreeRoot(nodeId: string, nodes: Record<string, TreeNode>): string[] {
  const path: string[] = []
  let current: string | null = nodeId
  while (current) {
    path.push(current)
    current = nodes[current]?.parentId ?? null
  }
  return path
}
