import { useRef, type ReactNode, type RefObject } from 'react'
import type { TreeNode as TreeNodeData } from '../../types/schema'
import styles from './TreeNode.module.css'
import { getNodeIcon } from './tree-node/tree-node-icons'
import {
  databaseLabelTitle,
  isFilterExpanded,
  selectableClassName,
  shouldRenderNodeInFilter,
  shouldShowChildren,
  treeItemTabIndex,
} from './tree-node/tree-node-model'
import { ColumnTypeAnnotation, TreeNodeChevron } from './tree-node/TreeNodeParts'
import { useTreeNodeHandlers } from './tree-node/use-tree-node-handlers'
import { useScrollIntoViewWhenSelected, useTreeNodeState } from './tree-node/use-tree-node-state'

const INDENT_PER_LEVEL_PX = 16
const GUIDE_LINE_OFFSET_PX = 12

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

interface TreeNodeChildrenProps {
  props: TreeNodeProps
  childIds: string[]
  indentPx: number
}

function TreeNodeChildren({ props, childIds, indentPx }: TreeNodeChildrenProps) {
  return (
    <div className={styles.childrenContainer} role="group">
      <div className={styles.guideLine} style={{ left: `${indentPx + GUIDE_LINE_OFFSET_PX}px` }} />
      {childIds.map((childId) => (
        <TreeNode
          key={childId}
          nodeId={childId}
          connectionId={props.connectionId}
          level={props.level + 1}
          onSelect={props.onSelect}
          onContextMenu={props.onContextMenu}
          onActivate={props.onActivate}
          filterMatchIds={props.filterMatchIds}
          filterScopeRootId={props.filterScopeRootId}
          onClearFilter={props.onClearFilter}
        />
      ))}
    </div>
  )
}

interface DatabaseSectionProps {
  nodeId: string
  isPinned: boolean
  row: ReactNode
  childNodes: ReactNode
}

function DatabaseSection({ nodeId, isPinned, row, childNodes }: DatabaseSectionProps) {
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
      {childNodes}
    </div>
  )
}

function useTreeNodeView(props: TreeNodeProps) {
  const { nodeId, connectionId, filterMatchIds, filterScopeRootId = null } = props
  const state = useTreeNodeState({ nodeId, connectionId, filterMatchIds, filterScopeRootId })
  const { node, nodesMap } = state
  const isRendered =
    node !== null &&
    shouldRenderNodeInFilter({
      nodeId: nodeId,
      node: node,
      filterMatchIds: filterMatchIds,
      filterScopeRootId: filterScopeRootId,
      nodes: nodesMap,
    })
  return { state, isRendered }
}

type TreeNodeState = ReturnType<typeof useTreeNodeState>
type TreeNodeHandlers = ReturnType<typeof useTreeNodeHandlers>

interface TreeNodeRowState {
  isSelected: boolean
  tabIndex: 0 | -1
  showChildren: boolean
  isLoading: boolean
  showExpandedChrome: boolean
}

interface TreeNodeRowProps {
  rowRef: RefObject<HTMLDivElement | null>
  nodeId: string
  node: TreeNodeData
  level: number
  indentPx: number
  rowState: TreeNodeRowState
  handlers: TreeNodeHandlers
}

function TreeNodeRow(rowProps: TreeNodeRowProps) {
  const { rowRef, nodeId, node, level, indentPx, rowState, handlers } = rowProps
  const { isSelected, showExpandedChrome } = rowState
  const { icon, className: iconClassName } = getNodeIcon(node.type, showExpandedChrome)
  return (
    <div
      ref={rowRef}
      className={selectableClassName(styles.nodeRow, styles.nodeRowSelected, isSelected)}
      role="treeitem"
      aria-expanded={node.hasChildren ? rowState.showChildren : undefined}
      aria-level={level + 1}
      aria-selected={isSelected}
      tabIndex={rowState.tabIndex}
      style={{ paddingLeft: `${indentPx}px` }}
      onClick={handlers.handleRowClick}
      onContextMenu={handlers.handleContextMenu}
      onDoubleClick={handlers.handleDoubleClick}
      onKeyDown={handlers.handleKeyDown}
      data-testid={`tree-node-${nodeId}`}
    >
      <TreeNodeChevron
        hasChildren={node.hasChildren}
        isLoading={rowState.isLoading}
        showExpandedChrome={showExpandedChrome}
        onClick={handlers.handleChevronClick}
      />
      <span className={`${styles.icon} ${iconClassName}`}>{icon}</span>
      <span
        className={selectableClassName(styles.label, styles.labelSelected, isSelected)}
        title={databaseLabelTitle(node)}
      >
        {node.label}
      </span>
      <ColumnTypeAnnotation node={node} />
    </div>
  )
}

interface TreeNodeContentProps {
  props: TreeNodeProps
  state: TreeNodeState
  node: TreeNodeData
  rowRef: RefObject<HTMLDivElement | null>
}

function TreeNodeContent({ props, state, node, rowRef }: TreeNodeContentProps) {
  const { nodeId, connectionId, level, isPinned = false } = props
  const { isExpanded, filterDrivesExpand, isSelected, childIds } = state
  const handlers = useTreeNodeHandlers({
    node: node,
    nodeId: nodeId,
    connectionId: connectionId,
    isExpanded: isExpanded,
    filterDrivesExpand: filterDrivesExpand,
    isPinned: isPinned,
    callbacks: props,
  })
  const indentPx = level * INDENT_PER_LEVEL_PX
  const showChildren = shouldShowChildren({
    hasChildren: node.hasChildren,
    isExpanded: isExpanded,
    filterDrivesExpand: filterDrivesExpand,
    childCount: childIds.length,
  })
  const row = (
    <TreeNodeRow
      rowRef={rowRef}
      nodeId={nodeId}
      node={node}
      level={level}
      indentPx={indentPx}
      rowState={{
        isSelected: isSelected,
        tabIndex: treeItemTabIndex(isSelected, props.isFirstVisible, state.selectedNodeIsVisible),
        showChildren: showChildren,
        isLoading: state.isLoading,
        showExpandedChrome:
          isExpanded || isFilterExpanded(filterDrivesExpand, state.isSuppressedByScope),
      }}
      handlers={handlers}
    />
  )
  const children = showChildren && (
    <TreeNodeChildren props={props} childIds={childIds} indentPx={indentPx} />
  )
  if (level !== 0) {
    return (
      <>
        {row}
        {children}
      </>
    )
  }
  return <DatabaseSection nodeId={nodeId} isPinned={isPinned} row={row} childNodes={children} />
}

export function TreeNode(props: TreeNodeProps) {
  const rowRef = useRef<HTMLDivElement | null>(null)
  const { state, isRendered } = useTreeNodeView(props)
  useScrollIntoViewWhenSelected(rowRef, state.isSelected)
  if (!state.node) return null
  if (!isRendered) return null
  return <TreeNodeContent props={props} state={state} node={state.node} rowRef={rowRef} />
}
