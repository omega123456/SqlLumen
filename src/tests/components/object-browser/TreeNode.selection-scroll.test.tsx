import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TreeNode } from '../../../components/object-browser/TreeNode'
import { makeNodeId, useSchemaStore } from '../../../stores/schema-store'
import type { TreeNode as TreeNodeType } from '../../../types/schema'

const CONNECTION_ID = 'conn-test'

function setNodes(nodes: Record<string, TreeNodeType>, selectedNodeId: string | null = null) {
  const childIdsByParentId: Record<string, string[]> = {}

  for (const [id, node] of Object.entries(nodes)) {
    const parentId = node.parentId ?? '__root__'
    if (!childIdsByParentId[parentId]) childIdsByParentId[parentId] = []
    childIdsByParentId[parentId].push(id)
  }

  useSchemaStore.setState({
    connectionStates: {
      [CONNECTION_ID]: {
        nodes,
        childIdsByParentId,
        expandedNodes: new Set(),
        loadingNodes: new Set(),
        selectedNodeId,
        filterText: '',
        loadGeneration: 0,
      },
    },
  })
}

describe('TreeNode selection scroll', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useSchemaStore.setState({
      connectionStates: {},
    })
  })

  it('scrolls a node into view when it becomes selected', () => {
    const nodeId = makeNodeId('view', 'testdb', 'active_users')
    const nodes: Record<string, TreeNodeType> = {
      [nodeId]: {
        id: nodeId,
        label: 'active_users',
        type: 'view',
        parentId: null,
        hasChildren: false,
        isLoaded: true,
      },
    }

    setNodes(nodes)

    const scrollIntoView = vi.fn()
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(scrollIntoView)

    const { rerender } = render(
      <div role="tree">
        <TreeNode nodeId={nodeId} connectionId={CONNECTION_ID} level={0} />
      </div>
    )

    expect(scrollIntoView).not.toHaveBeenCalled()

    act(() => {
      setNodes(nodes, nodeId)
    })

    rerender(
      <div role="tree">
        <TreeNode nodeId={nodeId} connectionId={CONNECTION_ID} level={0} />
      </div>
    )

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('scrolls a node into view when it mounts already selected', () => {
    const nodeId = makeNodeId('table', 'testdb', 'users')
    const nodes: Record<string, TreeNodeType> = {
      [nodeId]: {
        id: nodeId,
        label: 'users',
        type: 'table',
        parentId: null,
        hasChildren: false,
        isLoaded: true,
      },
    }

    setNodes(nodes, nodeId)

    const scrollIntoView = vi.fn()
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(scrollIntoView)

    render(
      <div role="tree">
        <TreeNode nodeId={nodeId} connectionId={CONNECTION_ID} level={0} />
      </div>
    )

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })
})
