import { useEffect, useMemo, useRef } from 'react'
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
import { isNullish } from '../../lib/value-checks'

const INDENT_PER_LEVEL_PX = 16
const GUIDE_LINE_OFFSET_PX = 12

/** Stable empty array used as fallback to avoid re-render loops from `[] !== []`. */
const EMPTY_CHILDREN: string[] = []

/** Stable empty nodes map when connection state is absent. */
const EMPTY_NODES: Record<string, TreeNodeData> = {}

/** Stable empty expanded-nodes set when connection state is absent. */
const EMPTY_EXPANDED_NODES = new Set<string>()

const SINGLE_CLICK_ACTIVATABLE_NODE_TYPES = new Set<NodeType>([
  'table',
  'view',
  'procedure',
  'function',
])

const DOUBLE_CLICK_ACTIVATABLE_NODE_TYPES = new Set<NodeType>(['trigger', 'event'])

function isSingleClickActivatableNodeType(type: NodeType): boolean {
  return SINGLE_CLICK_ACTIVATABLE_NODE_TYPES.has(type)
}

function isDoubleClickActivatableNodeType(type: NodeType): boolean {
  return DOUBLE_CLICK_ACTIVATABLE_NODE_TYPES.has(type)
}

function isKeyboardActivatableNodeType(type: NodeType): boolean {
  return isSingleClickActivatableNodeType(type) || isDoubleClickActivatableNodeType(type)
}

interface FilterScopeQuery {
  nodeId: string
  filterMatchIds: Set<string> | undefined
  filterScopeRootId: string | null
  nodes: Record<string, TreeNodeData>
}

function getEffectiveFilterMatchIds({
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
  nodes: Record<string, TreeNodeData>
}

function shouldRenderNodeInFilter({
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
  nodes: Record<string, TreeNodeData>
  expandedNodes: Set<string>
}

function isNodeVisibleInTree({
  nodeId,
  filterMatchIds,
  filterScopeRootId,
  nodes,
  expandedNodes,
}: TreeVisibilityQuery): boolean {
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
      !shouldRenderNodeInFilter({
        nodeId: currentId,
        node: currentNode,
        filterMatchIds: filterMatchIds,
        filterScopeRootId: filterScopeRootId,
        nodes: nodes,
      })
    ) {
      return false
    }

    const parentId: string | null = currentNode.parentId
    if (!parentId) {
      return true
    }

    const parentEffectiveFilterMatchIds = getEffectiveFilterMatchIds({
      nodeId: parentId,
      filterMatchIds: filterMatchIds,
      filterScopeRootId: filterScopeRootId,
      nodes: nodes,
    })
    const parentFilterDrivesExpand =
      parentEffectiveFilterMatchIds != null &&
      hasMatchingDescendantInFilter(parentId, parentEffectiveFilterMatchIds, nodes)

    const isParentShowingChildren = expandedNodes.has(parentId) || parentFilterDrivesExpand
    if (!isParentShowingChildren) {
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
  /** Called when the user collapses a node that the filter is holding open */
  onClearFilter?: () => void
  /** True if this is the first visible node in the tree (for roving tabindex) */
  isFirstVisible?: boolean
  /** Top-level database rows only: true while the row is stuck to the top of the tree */
  isPinned?: boolean
  /** Top-level database rows only: called when a pinned row is clicked */
  onRevealPinned?: (nodeId: string) => void
}

interface NodeIcon {
  icon: React.ReactNode
  className: string
}

const NODE_ICONS: Partial<Record<NodeType, NodeIcon>> = {
  database: { icon: <Database size={16} weight="regular" />, className: styles.iconDatabase },
  table: { icon: <Table size={16} weight="regular" />, className: styles.iconTable },
  view: { icon: <Eye size={16} weight="regular" />, className: styles.iconView },
  procedure: { icon: <Gear size={16} weight="regular" />, className: styles.iconProcedure },
  function: { icon: <MathOperations size={16} weight="regular" />, className: styles.iconFunction },
  trigger: { icon: <Lightning size={16} weight="regular" />, className: styles.iconTrigger },
  event: { icon: <CalendarBlank size={16} weight="regular" />, className: styles.iconEvent },
  column: { icon: <Columns size={14} weight="regular" />, className: styles.iconColumn },
}

const DEFAULT_NODE_ICON: NodeIcon = { icon: <Database size={16} weight="regular" />, className: '' }

function getNodeIcon(type: NodeType, isExpanded: boolean): NodeIcon {
  if (type !== 'category') return NODE_ICONS[type] ?? DEFAULT_NODE_ICON
  return {
    icon: isExpanded ? <FolderOpen size={16} weight="fill" /> : <Folder size={16} weight="fill" />,
    className: styles.iconCategory,
  }
}

function isFilterExpanded(filterDrivesExpand: boolean, isSuppressedByScope: boolean): boolean {
  return filterDrivesExpand && !isSuppressedByScope
}

function focusSiblingTreeItem(event: React.KeyboardEvent, delta: 1 | -1): void {
  event.preventDefault()
  const tree = event.currentTarget.closest('[role="tree"]')
  if (!tree) return
  const allItems = Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]'))
  const currentIndex = allItems.findIndex((item) => item === event.currentTarget)
  if (currentIndex < 0) return
  allItems[currentIndex + delta]?.focus()
}

function selectableClassName(
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

function shouldShowChildren(visibility: ChildVisibility): boolean {
  if (!visibility.hasChildren) return false
  if (visibility.childCount === 0) return false
  return visibility.isExpanded || visibility.filterDrivesExpand
}

function treeItemTabIndex(
  isSelected: boolean,
  isFirstVisible: boolean | undefined,
  selectedNodeIsVisible: boolean
): 0 | -1 {
  if (isSelected) return 0
  const isFallbackTabStop = isFirstVisible && !selectedNodeIsVisible
  return isFallbackTabStop ? 0 : -1
}

function databaseLabelTitle(node: TreeNodeData): string | undefined {
  return node.type === 'database' ? node.label : undefined
}

interface TreeNodeChevronProps {
  hasChildren: boolean
  isLoading: boolean
  showExpandedChrome: boolean
  onClick: (event: React.MouseEvent) => void
}

function TreeNodeChevron({
  hasChildren,
  isLoading,
  showExpandedChrome,
  onClick,
}: TreeNodeChevronProps) {
  if (!hasChildren) return <span className={styles.chevronPlaceholder} />
  if (isLoading) {
    return (
      <span className={styles.spinner} data-testid="tree-node-spinner">
        <CircleNotch size={12} weight="regular" />
      </span>
    )
  }
  return (
    <span
      className={`${styles.chevron} ${showExpandedChrome ? styles.chevronExpanded : ''}`}
      onClick={onClick}
      role="presentation"
      data-testid="tree-node-chevron"
    >
      <CaretRight size={12} weight="bold" />
    </span>
  )
}

function ColumnTypeAnnotation({ node }: { node: TreeNodeData }) {
  const columnType = node.type === 'column' ? node.metadata?.columnType : undefined
  if (!columnType) return null
  return <span className={styles.columnType}>{columnType}</span>
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
  onClearFilter,
  isFirstVisible,
  isPinned = false,
  onRevealPinned,
}: TreeNodeProps) {
  const rowRef = useRef<HTMLDivElement | null>(null)
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
    return getEffectiveFilterMatchIds({
      nodeId: nodeId,
      filterMatchIds: filterMatchIds,
      filterScopeRootId: filterScopeRootId,
      nodes: nodesMap,
    })
  }, [filterMatchIds, filterScopeRootId, nodeId, nodesMap])

  /** Force-expand only the ancestor path to matches; matched nodes themselves stay collapsed
   * unless the user explicitly expands them. */
  const filterDrivesExpand = useMemo(() => {
    if (effectiveFilterMatchIds == null) {
      return false
    }
    return hasMatchingDescendantInFilter(nodeId, effectiveFilterMatchIds, nodesMap)
  }, [effectiveFilterMatchIds, nodeId, nodesMap])

  // Use childIdsByParentId index instead of scanning the full nodes map (Simplification 4)
  const indexedChildIds = useSchemaStore(
    (state) =>
      (state.connectionStates[connectionId] as ConnectionTreeState | undefined)?.childIdsByParentId[
        nodeId
      ] ?? EMPTY_CHILDREN
  )

  const isSuppressedByScope = useMemo(() => {
    if (!filterMatchIds) return false
    if (!filterScopeRootId) return false
    if (isExpanded) return false
    const scopeParent = nodesMap[filterScopeRootId]?.parentId
    if (isNullish(scopeParent)) return false
    if (nodeId === filterScopeRootId) return false
    const nodeParent = nodesMap[nodeId]?.parentId
    return nodeParent === scopeParent
  }, [filterMatchIds, filterScopeRootId, nodesMap, nodeId, isExpanded])

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

  const isSelected = selectedNodeId === nodeId
  const wasSelectedRef = useRef(false)

  useEffect(() => {
    const hasJustBeenSelected = isSelected && !wasSelectedRef.current
    if (hasJustBeenSelected) {
      rowRef.current?.scrollIntoView({ block: 'nearest' })
    }
    wasSelectedRef.current = isSelected
  }, [isSelected])

  if (!node) return null

  // If filter is active, skip nodes that don't match and have no matching descendants.
  // Expanded table columns are intentionally exempt: the filter chooses which tables are
  // visible, but once a visible table is expanded its columns should remain browseable.
  if (
    !shouldRenderNodeInFilter({
      nodeId: nodeId,
      node: node,
      filterMatchIds: filterMatchIds,
      filterScopeRootId: filterScopeRootId,
      nodes: nodesMap,
    })
  ) {
    return null
  }

  const { hasChildren } = node
  const showExpandedChrome = isExpanded || isFilterExpanded(filterDrivesExpand, isSuppressedByScope)
  const { icon, className: iconClassName } = getNodeIcon(node.type, showExpandedChrome)

  const activateNode = () => {
    onActivate?.(nodeId)
  }

  const selectCurrentNode = () => {
    selectNode(nodeId, connectionId)
    onSelect?.(nodeId)
  }

  const collapseOrClearFilter = () => {
    const isOpenOnlyByFilter = !isExpanded && filterDrivesExpand
    if (isOpenOnlyByFilter) {
      onClearFilter?.()
      return
    }
    toggleExpand(nodeId, connectionId)
  }

  const activateOrToggleNode = () => {
    if (isKeyboardActivatableNodeType(node.type)) {
      activateNode()
      return
    }
    if (hasChildren) {
      collapseOrClearFilter()
    }
  }

  const handleRowClick = (event: React.MouseEvent<HTMLDivElement>) => {
    // A pinned database row scrolls back to its real position instead of toggling
    if (isPinned) {
      onRevealPinned?.(nodeId)
      return
    }

    selectCurrentNode()

    if (isSingleClickActivatableNodeType(node.type)) {
      if (event.detail === 1) {
        activateNode()
      }
      return
    }

    if (hasChildren) {
      collapseOrClearFilter()
    }
  }

  const handleChevronClick = (event: React.MouseEvent) => {
    event.stopPropagation()
    if (isPinned) {
      onRevealPinned?.(nodeId)
      return
    }
    selectCurrentNode()
    collapseOrClearFilter()
  }

  const handleContextMenu = (event: React.MouseEvent) => {
    onContextMenu?.(event, nodeId)
  }

  const handleDoubleClick = () => {
    if (isPinned) return
    if (isDoubleClickActivatableNodeType(node.type)) {
      activateNode()
    }
  }

  const keyHandlers: Record<string, (event: React.KeyboardEvent) => void> = {
    Enter: (event) => {
      selectCurrentNode()
      activateOrToggleNode()
      event.preventDefault()
    },
    ArrowRight: (event) => {
      if (!hasChildren) return
      if (isExpanded) return
      if (filterDrivesExpand) return
      toggleExpand(nodeId, connectionId)
      event.preventDefault()
    },
    ArrowLeft: (event) => {
      if (!hasChildren) return
      const isShowingChildren = isExpanded || filterDrivesExpand
      if (!isShowingChildren) return
      collapseOrClearFilter()
      event.preventDefault()
    },
    ArrowDown: (event) => focusSiblingTreeItem(event, 1),
    ArrowUp: (event) => focusSiblingTreeItem(event, -1),
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    keyHandlers[event.key]?.(event)
  }

  const indentPx = level * INDENT_PER_LEVEL_PX

  const rowClassName = selectableClassName(styles.nodeRow, styles.nodeRowSelected, isSelected)
  const labelClassName = selectableClassName(styles.label, styles.labelSelected, isSelected)
  const showChildren = shouldShowChildren({
    hasChildren: hasChildren,
    isExpanded: isExpanded,
    filterDrivesExpand: filterDrivesExpand,
    childCount: childIds.length,
  })

  const row = (
    <div
      ref={rowRef}
      className={rowClassName}
      role="treeitem"
      aria-expanded={hasChildren ? showChildren : undefined}
      aria-level={level + 1}
      aria-selected={isSelected}
      tabIndex={treeItemTabIndex(isSelected, isFirstVisible, selectedNodeIsVisible)}
      style={{ paddingLeft: `${indentPx}px` }}
      onClick={handleRowClick}
      onContextMenu={handleContextMenu}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      data-testid={`tree-node-${nodeId}`}
    >
      <TreeNodeChevron
        hasChildren={hasChildren}
        isLoading={isLoading}
        showExpandedChrome={showExpandedChrome}
        onClick={handleChevronClick}
      />

      {/* Icon */}
      <span className={`${styles.icon} ${iconClassName}`}>{icon}</span>

      {/* Label */}
      <span className={labelClassName} title={databaseLabelTitle(node)}>
        {node.label}
      </span>

      <ColumnTypeAnnotation node={node} />
    </div>
  )

  const children = showChildren && (
    <div className={styles.childrenContainer} role="group">
      <div className={styles.guideLine} style={{ left: `${indentPx + GUIDE_LINE_OFFSET_PX}px` }} />
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
          onClearFilter={onClearFilter}
        />
      ))}
    </div>
  )

  // Top-level database rows sit in their own section so the sticky row releases
  // at the end of that database's children instead of overlapping the next one.
  if (level === 0) {
    return (
      <div role="none" className={styles.databaseSection} data-database-section={nodeId}>
        <div
          role="none"
          className={styles.stickyRow}
          data-pinned={isPinned ? 'true' : undefined}
          data-testid={`tree-node-sticky-${nodeId}`}
        >
          {row}
        </div>
        {children}
      </div>
    )
  }

  return (
    <>
      {row}
      {children}
    </>
  )
}
