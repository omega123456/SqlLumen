import type { TreeNode } from '../types/schema'

/**
 * True if `nodeId` is `scopeRootId` or a descendant of it in `nodes`.
 */
export function isNodeUnderFilterScope(
  nodeId: string,
  scopeRootId: string,
  nodes: Record<string, TreeNode>
): boolean {
  let cur: string | null = nodeId
  while (cur) {
    if (cur === scopeRootId) {
      return true
    }
    cur = nodes[cur]?.parentId ?? null
  }
  return false
}

/**
 * True if `matchIds` contains a node that is a strict descendant of `nodeId`
 * (walks from each candidate upward until root).
 */
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

/**
 * Collect all node IDs that match the filter text (case-insensitive substring),
 * plus all their ancestor node IDs (so the tree context is preserved).
 * Column labels are intentionally excluded from direct matching: the filter chooses
 * which objects are visible, and expanded table columns remain browseable separately.
 */
export function computeFilterMatchIds(
  nodes: Record<string, TreeNode>,
  filterText: string
): Set<string> {
  const matchIds = new Set<string>()
  const lowerFilter = filterText.toLowerCase()

  for (const [id, node] of Object.entries(nodes)) {
    if (node.type === 'column') {
      continue
    }

    if (node.label.toLowerCase().includes(lowerFilter)) {
      matchIds.add(id)
      let parentId = node.parentId
      while (parentId) {
        matchIds.add(parentId)
        const parent = nodes[parentId]
        parentId = parent?.parentId ?? null
      }
    }
  }

  return matchIds
}

/**
 * Like `computeFilterMatchIds`, but ancestor paths stop at `scopeRootId`.
 * When `scopeRootId` is null or not in `nodes`, uses global matching.
 */
export function computeScopedFilterMatchIds(
  nodes: Record<string, TreeNode>,
  filterText: string,
  scopeRootId: string | null
): Set<string> {
  if (!scopeRootId || !nodes[scopeRootId]) {
    return computeFilterMatchIds(nodes, filterText)
  }

  const matchIds = new Set<string>()
  const lowerFilter = filterText.toLowerCase()

  for (const [id, node] of Object.entries(nodes)) {
    if (!isNodeUnderFilterScope(id, scopeRootId, nodes)) {
      continue
    }
    if (node.type === 'column') {
      continue
    }
    if (!node.label.toLowerCase().includes(lowerFilter)) {
      continue
    }
    let cur: string | null = id
    while (cur) {
      matchIds.add(cur)
      if (cur === scopeRootId) {
        break
      }
      cur = nodes[cur]?.parentId ?? null
    }
  }

  // Keep the scope root visible even when no label in the subtree matches.
  matchIds.add(scopeRootId)

  return matchIds
}
