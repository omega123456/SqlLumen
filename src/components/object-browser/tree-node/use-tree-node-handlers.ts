import { useSchemaStore } from '../../../stores/schema-store'
import type { TreeNode as TreeNodeData } from '../../../types/schema'
import {
  focusSiblingTreeItem,
  isDoubleClickActivatableNodeType,
  isKeyboardActivatableNodeType,
  isSingleClickActivatableNodeType,
} from './tree-node-model'

export interface TreeNodeCallbacks {
  onSelect?: (nodeId: string) => void
  onContextMenu?: (event: React.MouseEvent, nodeId: string) => void
  onActivate?: (nodeId: string) => void
  onClearFilter?: () => void
  onRevealPinned?: (nodeId: string) => void
}

interface TreeNodeHandlersInput {
  node: TreeNodeData
  nodeId: string
  connectionId: string
  isExpanded: boolean
  filterDrivesExpand: boolean
  isPinned: boolean
  callbacks: TreeNodeCallbacks
}

type KeyHandler = (event: React.KeyboardEvent) => void

interface NodeOperations {
  activateNode: () => void
  selectCurrentNode: () => void
  collapseOrClearFilter: () => void
  activateOrToggleNode: () => void
  expandNode: () => void
}

function useNodeOperations(input: TreeNodeHandlersInput): NodeOperations {
  const { node, nodeId, connectionId, isExpanded, filterDrivesExpand, callbacks } = input
  const toggleExpand = useSchemaStore((state) => state.toggleExpand)
  const selectNode = useSchemaStore((state) => state.selectNode)
  const activateNode = () => callbacks.onActivate?.(nodeId)
  const collapseOrClearFilter = () => {
    const isOpenOnlyByFilter = !isExpanded && filterDrivesExpand
    if (isOpenOnlyByFilter) {
      callbacks.onClearFilter?.()
      return
    }
    toggleExpand(nodeId, connectionId)
  }
  return {
    activateNode: activateNode,
    selectCurrentNode: () => {
      selectNode(nodeId, connectionId)
      callbacks.onSelect?.(nodeId)
    },
    collapseOrClearFilter: collapseOrClearFilter,
    activateOrToggleNode: () => {
      if (isKeyboardActivatableNodeType(node.type)) {
        activateNode()
        return
      }
      if (node.hasChildren) collapseOrClearFilter()
    },
    expandNode: () => toggleExpand(nodeId, connectionId),
  }
}

function treeKeyHandlers(
  input: TreeNodeHandlersInput,
  operations: NodeOperations
): Record<string, KeyHandler> {
  const { node, isExpanded, filterDrivesExpand } = input
  return {
    Enter: (event) => {
      operations.selectCurrentNode()
      operations.activateOrToggleNode()
      event.preventDefault()
    },
    ArrowRight: (event) => {
      if (!node.hasChildren) return
      if (isExpanded) return
      if (filterDrivesExpand) return
      operations.expandNode()
      event.preventDefault()
    },
    ArrowLeft: (event) => {
      if (!node.hasChildren) return
      const isShowingChildren = isExpanded || filterDrivesExpand
      if (!isShowingChildren) return
      operations.collapseOrClearFilter()
      event.preventDefault()
    },
    ArrowDown: (event) => focusSiblingTreeItem(event, 1),
    ArrowUp: (event) => focusSiblingTreeItem(event, -1),
  }
}

export function useTreeNodeHandlers(input: TreeNodeHandlersInput) {
  const { node, nodeId, isPinned, callbacks } = input
  const operations = useNodeOperations(input)
  const keyHandlers = treeKeyHandlers(input, operations)

  const handleRowClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isPinned) {
      callbacks.onRevealPinned?.(nodeId)
      return
    }
    operations.selectCurrentNode()
    if (isSingleClickActivatableNodeType(node.type)) {
      if (event.detail === 1) operations.activateNode()
      return
    }
    if (node.hasChildren) operations.collapseOrClearFilter()
  }

  const handleChevronClick = (event: React.MouseEvent) => {
    event.stopPropagation()
    if (isPinned) {
      callbacks.onRevealPinned?.(nodeId)
      return
    }
    operations.selectCurrentNode()
    operations.collapseOrClearFilter()
  }

  const handleDoubleClick = () => {
    if (isPinned) return
    if (isDoubleClickActivatableNodeType(node.type)) operations.activateNode()
  }

  return {
    handleRowClick: handleRowClick,
    handleChevronClick: handleChevronClick,
    handleContextMenu: (event: React.MouseEvent) => callbacks.onContextMenu?.(event, nodeId),
    handleDoubleClick: handleDoubleClick,
    handleKeyDown: (event: React.KeyboardEvent) => keyHandlers[event.key]?.(event),
  }
}
