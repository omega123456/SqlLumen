import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TreeNode } from '../../../components/object-browser/TreeNode'
import { useSchemaStore, makeNodeId } from '../../../stores/schema-store'
import type { TreeNode as TreeNodeType } from '../../../types/schema'

function makeTreeNode(overrides: Partial<TreeNodeType> = {}): TreeNodeType {
  return {
    id: makeNodeId('table', 'testdb', 'users'),
    label: 'users',
    type: 'table',
    parentId: null,
    hasChildren: true,
    isLoaded: false,
    ...overrides,
  }
}

const CONN_ID = 'conn-test'

function setNodes(
  nodes: Record<string, TreeNodeType>,
  opts?: { expanded?: Set<string>; loading?: Set<string> }
) {
  // Build childIdsByParentId index
  const childIdsByParentId: Record<string, string[]> = {}
  for (const [id, node] of Object.entries(nodes)) {
    const parentId = node.parentId ?? '__root__'
    if (!childIdsByParentId[parentId]) childIdsByParentId[parentId] = []
    childIdsByParentId[parentId].push(id)
  }
  for (const parentId of Object.keys(childIdsByParentId)) {
    childIdsByParentId[parentId].sort((a, b) => {
      const nodeA = nodes[a]
      const nodeB = nodes[b]
      if (!nodeA || !nodeB) return 0
      return nodeA.label.localeCompare(nodeB.label)
    })
  }

  useSchemaStore.setState({
    connectionStates: {
      [CONN_ID]: {
        nodes,
        childIdsByParentId,
        expandedNodes: opts?.expanded ?? new Set(),
        loadingNodes: opts?.loading ?? new Set(),
        selectedNodeId: null,
        filterText: '',
        loadGeneration: 0,
      },
    },
  })
}

beforeEach(() => {
  useSchemaStore.setState({
    connectionStates: {},
  })
})

describe('TreeNode', () => {
  it('renders node label', () => {
    const node = makeTreeNode()
    setNodes({ [node.id]: node })

    render(
      <div role="tree">
        <TreeNode nodeId={node.id} connectionId={CONN_ID} level={0} />
      </div>
    )
    expect(screen.getByText('users')).toBeInTheDocument()
  })

  it('renders chevron for nodes with hasChildren=true', () => {
    const node = makeTreeNode({ hasChildren: true })
    setNodes({ [node.id]: node })

    render(
      <div role="tree">
        <TreeNode nodeId={node.id} connectionId={CONN_ID} level={0} />
      </div>
    )
    expect(screen.getByTestId('tree-node-chevron')).toBeInTheDocument()
  })

  it('does not render chevron for column nodes (hasChildren=false)', () => {
    const colId = makeNodeId('column', 'testdb', 'users.id')
    const colNode: TreeNodeType = {
      id: colId,
      label: 'id',
      type: 'column',
      parentId: null,
      hasChildren: false,
      isLoaded: true,
      metadata: { columnType: 'bigint' },
    }
    setNodes({ [colId]: colNode })

    render(
      <div role="tree">
        <TreeNode nodeId={colId} connectionId={CONN_ID} level={0} />
      </div>
    )
    expect(screen.queryByTestId('tree-node-chevron')).not.toBeInTheDocument()
  })

  it('click on chevron selects node and calls toggleExpand', async () => {
    const user = userEvent.setup()
    const node = makeTreeNode({ hasChildren: true })
    setNodes({ [node.id]: node })

    const toggleExpand = vi.fn()
    const selectNode = vi.fn()
    useSchemaStore.setState({ toggleExpand, selectNode })

    render(
      <div role="tree">
        <TreeNode nodeId={node.id} connectionId={CONN_ID} level={0} />
      </div>
    )

    await user.click(screen.getByTestId('tree-node-chevron'))
    expect(selectNode).toHaveBeenCalledWith(node.id, CONN_ID)
    expect(toggleExpand).toHaveBeenCalledWith(node.id, CONN_ID)
  })

  it('calls onSelect when the row is clicked', async () => {
    const user = userEvent.setup()
    const node = makeTreeNode()
    setNodes({ [node.id]: node })
    const onSelect = vi.fn()

    render(
      <div role="tree">
        <TreeNode nodeId={node.id} connectionId={CONN_ID} level={0} onSelect={onSelect} />
      </div>
    )

    await user.click(screen.getByRole('treeitem'))
    expect(onSelect).toHaveBeenCalledWith(node.id)
  })

  it('shows loading spinner when node is in loadingNodes', () => {
    const node = makeTreeNode({ hasChildren: true })
    setNodes({ [node.id]: node }, { loading: new Set([node.id]) })

    render(
      <div role="tree">
        <TreeNode nodeId={node.id} connectionId={CONN_ID} level={0} />
      </div>
    )
    expect(screen.getByTestId('tree-node-spinner')).toBeInTheDocument()
    expect(screen.queryByTestId('tree-node-chevron')).not.toBeInTheDocument()
  })

  it('shows children when expanded', () => {
    const parentId = makeNodeId('database', 'testdb', 'testdb')
    const childId = makeNodeId('category', 'testdb', 'table')
    const parentNode: TreeNodeType = {
      id: parentId,
      label: 'testdb',
      type: 'database',
      parentId: null,
      hasChildren: true,
      isLoaded: true,
    }
    const childNode: TreeNodeType = {
      id: childId,
      label: 'Tables',
      type: 'category',
      parentId: parentId,
      hasChildren: true,
      isLoaded: false,
    }
    setNodes({ [parentId]: parentNode, [childId]: childNode }, { expanded: new Set([parentId]) })

    render(
      <div role="tree">
        <TreeNode nodeId={parentId} connectionId={CONN_ID} level={0} />
      </div>
    )
    expect(screen.getByText('Tables')).toBeInTheDocument()
  })

  it('has correct ARIA attributes', () => {
    const node = makeTreeNode({ hasChildren: true })
    setNodes({ [node.id]: node })

    // Set selectedNodeId in the connection state
    const connState = useSchemaStore.getState().connectionStates[CONN_ID]
    useSchemaStore.setState({
      connectionStates: {
        ...useSchemaStore.getState().connectionStates,
        [CONN_ID]: {
          ...connState,
          selectedNodeId: node.id,
        },
      },
    })

    render(
      <div role="tree">
        <TreeNode nodeId={node.id} connectionId={CONN_ID} level={0} />
      </div>
    )

    const treeItem = screen.getByRole('treeitem')
    expect(treeItem).toHaveAttribute('aria-expanded', 'false')
    expect(treeItem).toHaveAttribute('aria-level', '1')
    expect(treeItem).toHaveAttribute('aria-selected', 'true')
  })

  it('keyboard Enter calls toggleExpand for nodes with children', async () => {
    const user = userEvent.setup()
    const node = makeTreeNode({ hasChildren: true })
    setNodes({ [node.id]: node })

    const toggleExpand = vi.fn()
    const selectNode = vi.fn()
    useSchemaStore.setState({ toggleExpand, selectNode })

    render(
      <div role="tree">
        <TreeNode nodeId={node.id} connectionId={CONN_ID} level={0} />
      </div>
    )

    const treeItem = screen.getByRole('treeitem')
    treeItem.focus()
    await user.keyboard('{Enter}')
    expect(toggleExpand).toHaveBeenCalledWith(node.id, CONN_ID)
    expect(selectNode).toHaveBeenCalledWith(node.id, CONN_ID)
  })

  it('keyboard ArrowRight expands a collapsed node', async () => {
    const user = userEvent.setup()
    const node = makeTreeNode({ hasChildren: true })
    setNodes({ [node.id]: node })

    const toggleExpand = vi.fn()
    useSchemaStore.setState({ toggleExpand })

    render(
      <div role="tree">
        <TreeNode nodeId={node.id} connectionId={CONN_ID} level={0} />
      </div>
    )

    const treeItem = screen.getByRole('treeitem')
    treeItem.focus()
    await user.keyboard('{ArrowRight}')
    expect(toggleExpand).toHaveBeenCalledWith(node.id, CONN_ID)
  })

  it('keyboard ArrowLeft collapses an expanded node', async () => {
    const user = userEvent.setup()
    const node = makeTreeNode({ hasChildren: true })
    setNodes({ [node.id]: node }, { expanded: new Set([node.id]) })

    const toggleExpand = vi.fn()
    useSchemaStore.setState({ toggleExpand })

    render(
      <div role="tree">
        <TreeNode nodeId={node.id} connectionId={CONN_ID} level={0} />
      </div>
    )

    const treeItem = screen.getByRole('treeitem')
    treeItem.focus()
    await user.keyboard('{ArrowLeft}')
    expect(toggleExpand).toHaveBeenCalledWith(node.id, CONN_ID)
  })

  it('renders column type annotation for column nodes', () => {
    const colId = makeNodeId('column', 'testdb', 'users.id')
    const colNode: TreeNodeType = {
      id: colId,
      label: 'id',
      type: 'column',
      parentId: null,
      hasChildren: false,
      isLoaded: true,
      metadata: { columnType: 'bigint' },
    }
    setNodes({ [colId]: colNode })

    render(
      <div role="tree">
        <TreeNode nodeId={colId} connectionId={CONN_ID} level={0} />
      </div>
    )
    expect(screen.getByText('bigint')).toBeInTheDocument()
  })

  it('renders nothing when node is not found', () => {
    setNodes({})

    const { container } = render(
      <div role="tree">
        <TreeNode nodeId="nonexistent" connectionId={CONN_ID} level={0} />
      </div>
    )
    // Only the tree wrapper, no tree items
    expect(container.querySelector('[role="treeitem"]')).not.toBeInTheDocument()
  })

  it('right-click calls onContextMenu with node ID', async () => {
    const user = userEvent.setup()
    const node = makeTreeNode()
    setNodes({ [node.id]: node })
    const onContextMenu = vi.fn()

    render(
      <div role="tree">
        <TreeNode nodeId={node.id} connectionId={CONN_ID} level={0} onContextMenu={onContextMenu} />
      </div>
    )

    const treeItem = screen.getByRole('treeitem')
    await user.pointer({ target: treeItem, keys: '[MouseRight]' })
    expect(onContextMenu).toHaveBeenCalledWith(expect.any(Object), node.id)
  })

  it('double-click calls onDoubleClick with node ID', async () => {
    const user = userEvent.setup()
    const node = makeTreeNode()
    setNodes({ [node.id]: node })
    const onDoubleClick = vi.fn()

    render(
      <div role="tree">
        <TreeNode nodeId={node.id} connectionId={CONN_ID} level={0} onDoubleClick={onDoubleClick} />
      </div>
    )

    const treeItem = screen.getByRole('treeitem')
    await user.dblClick(treeItem)
    expect(onDoubleClick).toHaveBeenCalledWith(node.id)
  })
})
