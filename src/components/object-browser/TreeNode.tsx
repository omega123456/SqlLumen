import { useMemo } from 'react'
import {
  CaretRight,
  CircleNotch,
  Database,
  FolderOpen,
  Folder,
  Table,
  Eye,
  Gear,
  MathOperations,
  Lightning,
  CalendarBlank,
  Columns,
} from '@phosphor-icons/react'
import { useSchemaStore, type ConnectionTreeState } from '../../stores/schema-store'
import { hasMatchingDescendantInFilter, isNodeUnderFilterScope } from '../../lib/tree-filter'
import type { NodeType, TreeNode as TreeNodeData } from '../../types/schema'
import styles from './TreeNode.module.css'

/** Stable empty array used as fallback to avoid re-render loops from `[] !== []`. */
const EMPTY_CHILDREN: string[] = []

/** Stable empty nodes map when connection state is absent. */
const EMPTY_NODES: Record<string, TreeNodeData> = {}

/** Stable empty expanded-nodes set when connection state is absent. */
const EMPTY_EXPANDED_NODES = new Set<string>()

function getEffectiveFilterMatchIds(
  nodeId: string,
  filterMatchIds: Set<string> | undefined,
  filterScopeRootId: string | null,
  nodes: Record<string, TreeNodeData>
): Set<string> | undefined {
  if (!filterMatchIds) {
    return undefined
  }

  if (filterScopeRootId == null) {
    return filterMatchIds
  }

  return isNodeUnderFilterScope(nodeId, filterScopeRootId, nodes) ? filterMatchIds : undefined
}

function shouldRenderNodeInFilter(
  nodeId: string,
  node: TreeNodeData,
  filterMatchIds: Set<string> | undefined,
  filterScopeRootId: string | null,
  nodes: Record<string, TreeNodeData>
): boolean {
  const effectiveFilterMatchIds = getEffectiveFilterMatchIds(
    nodeId,
    filterMatchIds,
    filterScopeRootId,
    nodes
  )

  const shouldRenderColumnDespiteFilter =
    node.type === 'column' && node.parentId != null && nodes[node.parentId] != null

  return !(
    effectiveFilterMatchIds &&
    !effectiveFilterMatchIds.has(nodeId) &&
    !shouldRenderColumnDespiteFilter
  )
}

function isNodeVisibleInTree(
  nodeId: string | null,
  filterMatchIds: Set<string> | undefined,
  filterScopeRootId: string | null,
  nodes: Record<string, TreeNodeData>,
  expandedNodes: Set<string>
): boolean {
  if (!nodeId) {
    return false
  }

  let currentId: string | null = nodeId

  while (currentId) {
    const currentNode: TreeNodeData | undefined = nodes[currentId]
    if (!currentNode) {
      return false
    }

    if (
      !shouldRenderNodeInFilter(currentId, currentNode, filterMatchIds, filterScopeRootId, nodes)
    ) {
      return false
    }

    const parentId: string | null = currentNode.parentId
    if (!parentId) {
      return true
    }

    const parentEffectiveFilterMatchIds = getEffectiveFilterMatchIds(
      parentId,
      filterMatchIds,
      filterScopeRootId,
      nodes
    )
    const parentFilterDrivesExpand =
      parentEffectiveFilterMatchIds != null &&
      hasMatchingDescendantInFilter(parentId, parentEffectiveFilterMatchIds, nodes)

    if (!expandedNodes.has(parentId) && !parentFilterDrivesExpand) {
      return false
    }

    currentId = parentId
  }

  return true
}

export interface TreeNodeProps {
  nodeId: string
  connectionId: string
  level: number
  onSelect?: (nodeId: string) => void
  onContextMenu?: (e: React.MouseEvent, nodeId: string) => void
  onActivate?: (nodeId: string) => void
  /** Set of node IDs that match the current filter (undefined = no filter active) */
  filterMatchIds?: Set<string>
  /**
   * When set with a non-empty filter, only nodes under this subtree use `filterMatchIds`;
   * `null` means the filter applies to the whole tree.
   */
  filterScopeRootId?: string | null
  /** True if this is the first visible node in the tree (for roving tabindex) */
  isFirstVisible?: boolean
}

function getNodeIcon(
  type: NodeType,
  isExpanded: boolean
): { icon: React.ReactNode; className: string } {
  switch (type) {
    case 'database':
      return {
        icon: isExpanded ? (
          <FolderOpen size={16} weight="regular" />
        ) : (
          <Folder size={16} weight="regular" />
        ),
        className: styles.iconDatabase,
      }
    case 'table':
      return { icon: <Table size={16} weight="regular" />, className: styles.iconTable }
    case 'view':
      return { icon: <Eye size={16} weight="regular" />, className: styles.iconView }
    case 'procedure':
      return { icon: <Gear size={16} weight="regular" />, className: styles.iconProcedure }
    case 'function':
      return { icon: <MathOperations size={16} weight="regular" />, className: styles.iconFunction }
    case 'trigger':
      return { icon: <Lightning size={16} weight="regular" />, className: styles.iconTrigger }
    case 'event':
      return { icon: <CalendarBlank size={16} weight="regular" />, className: styles.iconEvent }
    case 'column':
      return { icon: <Columns size={14} weight="regular" />, className: styles.iconColumn }
    case 'category':
      return {
        icon: isExpanded ? (
          <FolderOpen size={14} weight="regular" />
        ) : (
          <Folder size={14} weight="regular" />
        ),
        className: styles.iconCategory,
      }
    default:
      return { icon: <Database size={16} weight="regular" />, className: '' }
  }
}

export function TreeNode({
  nodeId,
  connectionId,
  level,
  onSelect,
  onContextMenu,
  onActivate,
  filterMatchIds,
  filterScopeRootId = null,
  isFirstVisible,
}: TreeNodeProps) {
  const node = useSchemaStore(
    (state) =>
      (state.connectionStates[connectionId] as ConnectionTreeState | undefined)?.nodes[nodeId] ??
      null
  )
  const isExpanded = useSchemaStore(
    (state) =>
      (state.connectionStates[connectionId] as ConnectionTreeState | undefined)?.expandedNodes.has(
        nodeId
      ) ?? false
  )
  const isLoading = useSchemaStore(
    (state) =>
      (state.connectionStates[connectionId] as ConnectionTreeState | undefined)?.loadingNodes.has(
        nodeId
      ) ?? false
  )
  const expandedNodes = useSchemaStore(
    (state) =>
      (state.connectionStates[connectionId] as ConnectionTreeState | undefined)?.expandedNodes ??
      EMPTY_EXPANDED_NODES
  )
  const selectedNodeId = useSchemaStore(
    (state) =>
      (state.connectionStates[connectionId] as ConnectionTreeState | undefined)?.selectedNodeId ??
      null
  )
  const toggleExpand = useSchemaStore((state) => state.toggleExpand)
  const selectNode = useSchemaStore((state) => state.selectNode)

  const nodesMap = useSchemaStore(
    (state) =>
      (state.connectionStates[connectionId] as ConnectionTreeState | undefined)?.nodes ??
      EMPTY_NODES
  )

  const effectiveFilterMatchIds = useMemo(() => {
    return getEffectiveFilterMatchIds(nodeId, filterMatchIds, filterScopeRootId, nodesMap)
  }, [filterMatchIds, filterScopeRootId, nodeId, nodesMap])

  /** Force-expand only the ancestor path to matches; matched nodes themselves stay collapsed
   * unless the user explicitly expands them. */
  const filterDrivesExpand = useMemo(() => {
    if (effectiveFilterMatchIds == null) {
      return false
    }
    return hasMatchingDescendantInFilter(nodeId, effectiveFilterMatchIds, nodesMap)
  }, [effectiveFilterMatchIds, filterScopeRootId, nodeId, nodesMap])

  // Use childIdsByParentId index instead of scanning the full nodes map (Simplification 4)
  const indexedChildIds = useSchemaStore(
    (state) =>
      (state.connectionStates[connectionId] as ConnectionTreeState | undefined)?.childIdsByParentId[
        nodeId
      ] ?? EMPTY_CHILDREN
  )

  const childIds = useMemo(() => {
    if (!node) return []
    // Show children if expanded OR if filter forces expansion (paths to matches)
    if (!isExpanded && !filterDrivesExpand) return []
    return indexedChildIds
  }, [isExpanded, node, indexedChildIds, filterDrivesExpand])

  const selectedNodeIsVisible = useMemo(
    () =>
      isNodeVisibleInTree(
        selectedNodeId,
        filterMatchIds,
        filterScopeRootId,
        nodesMap,
        expandedNodes
      ),
    [expandedNodes, filterMatchIds, filterScopeRootId, nodesMap, selectedNodeId]
  )

  if (!node) return null

  // If filter is active, skip nodes that don't match and have no matching descendants.
  // Expanded table columns are intentionally exempt: the filter chooses which tables are
  // visible, but once a visible table is expanded its columns should remain browseable.
  if (!shouldRenderNodeInFilter(nodeId, node, filterMatchIds, filterScopeRootId, nodesMap)) {
    return null
  }

  const isSelected = selectedNodeId === nodeId
  const { hasChildren } = node
  const showExpandedChrome = isExpanded || filterDrivesExpand
  const { icon, className: iconClassName } = getNodeIcon(node.type, showExpandedChrome)

  const activateNode = () => {
    onActivate?.(nodeId)
  }

  const selectCurrentNode = () => {
    selectNode(nodeId, connectionId)
    onSelect?.(nodeId)
  }

  const handleRowClick = (e: React.MouseEvent<HTMLDivElement>) => {
    selectCurrentNode()

    if (node.type === 'table') {
      if (e.detail === 1) {
        activateNode()
      }
      return
    }

    if (hasChildren) {
      toggleExpand(nodeId, connectionId)
    }
  }

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    selectCurrentNode()
    toggleExpand(nodeId, connectionId)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    onContextMenu?.(e, nodeId)
  }

  const handleDoubleClick = () => {
    if (node.type !== 'table') {
      activateNode()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Enter':
        selectCurrentNode()
        if (node.type === 'table') {
          activateNode()
        } else if (hasChildren) {
          toggleExpand(nodeId, connectionId)
        }
        e.preventDefault()
        break
      case 'ArrowRight':
        if (hasChildren && !isExpanded) {
          toggleExpand(nodeId, connectionId)
          e.preventDefault()
        }
        break
      case 'ArrowLeft':
        if (hasChildren && isExpanded) {
          toggleExpand(nodeId, connectionId)
          e.preventDefault()
        }
        break
      case 'ArrowDown': {
        e.preventDefault()
        const tree = e.currentTarget.closest('[role="tree"]')
        if (!tree) break
        const allItems = Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]'))
        const currentIdx = allItems.indexOf(e.currentTarget as HTMLElement)
        if (currentIdx >= 0 && currentIdx < allItems.length - 1) {
          allItems[currentIdx + 1].focus()
        }
        break
      }
      case 'ArrowUp': {
        e.preventDefault()
        const tree = e.currentTarget.closest('[role="tree"]')
        if (!tree) break
        const allItems = Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]'))
        const currentIdx = allItems.indexOf(e.currentTarget as HTMLElement)
        if (currentIdx > 0) {
          allItems[currentIdx - 1].focus()
        }
        break
      }
    }
  }

  const indentPx = level * 16

  const rowClassName = [styles.nodeRow, isSelected ? styles.nodeRowSelected : '']
    .filter(Boolean)
    .join(' ')

  const labelClassName = [styles.label, isSelected ? styles.labelSelected : '']
    .filter(Boolean)
    .join(' ')

  // Determine if we should show expanded children (either normally expanded or forced by filter)
  const showChildren =
    hasChildren &&
    (isExpanded || (filterDrivesExpand && childIds.length > 0)) &&
    childIds.length > 0

  return (
    <>
      <div
        className={rowClassName}
        role="treeitem"
        aria-expanded={
          hasChildren ? isExpanded || (filterDrivesExpand && childIds.length > 0) : undefined
        }
        aria-level={level + 1}
        aria-selected={isSelected}
        tabIndex={isSelected || (isFirstVisible && !selectedNodeIsVisible) ? 0 : -1}
        style={{ paddingLeft: `${indentPx}px` }}
        onClick={handleRowClick}
        onContextMenu={handleContextMenu}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        data-testid={`tree-node-${nodeId}`}
      >
        {/* Chevron / spinner / placeholder */}
        {hasChildren ? (
          isLoading ? (
            <span className={styles.spinner} data-testid="tree-node-spinner">
              <CircleNotch size={12} weight="regular" />
            </span>
          ) : (
            <span
              className={`${styles.chevron} ${showExpandedChrome ? styles.chevronExpanded : ''}`}
              onClick={handleChevronClick}
              role="presentation"
              data-testid="tree-node-chevron"
            >
              <CaretRight size={12} weight="bold" />
            </span>
          )
        ) : (
          <span className={styles.chevronPlaceholder} />
        )}

        {/* Icon */}
        <span className={`${styles.icon} ${iconClassName}`}>{icon}</span>

        {/* Label */}
        <span className={labelClassName}>{node.label}</span>

        {/* Column type annotation */}
        {node.type === 'column' && node.metadata?.columnType && (
          <span className={styles.columnType}>{node.metadata.columnType}</span>
        )}
      </div>

      {/* Children */}
      {showChildren && (
        <div className={styles.childrenContainer} role="group">
          <div className={styles.guideLine} style={{ left: `${indentPx + 12}px` }} />
          {childIds.map((childId) => (
            <TreeNode
              key={childId}
              nodeId={childId}
              connectionId={connectionId}
              level={level + 1}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
              onActivate={onActivate}
              filterMatchIds={filterMatchIds}
              filterScopeRootId={filterScopeRootId}
            />
          ))}
        </div>
      )}
    </>
  )
}
