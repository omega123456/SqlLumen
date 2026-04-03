import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ObjectBrowserContextMenu } from '../../../components/object-browser/ObjectBrowserContextMenu'
import { useSchemaStore, makeNodeId } from '../../../stores/schema-store'
import { useWorkspaceStore, _resetTabIdCounter } from '../../../stores/workspace-store'
import type { TreeNode as TreeNodeType } from '../../../types/schema'

// Mock clipboard
vi.mock('../../../lib/context-menu-utils', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return {
    ...orig,
    writeClipboardText: vi.fn().mockResolvedValue(undefined),
  }
})

import { writeClipboardText } from '../../../lib/context-menu-utils'

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

function makeNodes() {
  const dbId = makeNodeId('database', 'testdb', 'testdb')
  const catId = makeNodeId('category', 'testdb', 'table')
  const tableId = makeNodeId('table', 'testdb', 'users')
  const viewId = makeNodeId('view', 'testdb', 'user_stats')
  const procId = makeNodeId('procedure', 'testdb', 'sp_example')
  const funcId = makeNodeId('function', 'testdb', 'calc_total')
  const triggerId = makeNodeId('trigger', 'testdb', 'before_insert')
  const eventId = makeNodeId('event', 'testdb', 'cleanup_job')
  const colId = makeNodeId('column', 'testdb', 'users.id')

  const nodes: Record<string, TreeNodeType> = {
    [dbId]: {
      id: dbId,
      label: 'testdb',
      type: 'database',
      parentId: null,
      hasChildren: true,
      isLoaded: true,
    },
    [catId]: {
      id: catId,
      label: 'Tables',
      type: 'category',
      parentId: dbId,
      hasChildren: true,
      isLoaded: true,
      metadata: { categoryType: 'table', databaseName: 'testdb' },
    },
    [tableId]: {
      id: tableId,
      label: 'users',
      type: 'table',
      parentId: catId,
      hasChildren: true,
      isLoaded: false,
      metadata: { databaseName: 'testdb' },
    },
    [viewId]: {
      id: viewId,
      label: 'user_stats',
      type: 'view',
      parentId: null,
      hasChildren: false,
      isLoaded: true,
      metadata: { databaseName: 'testdb' },
    },
    [procId]: {
      id: procId,
      label: 'sp_example',
      type: 'procedure',
      parentId: null,
      hasChildren: false,
      isLoaded: true,
      metadata: { databaseName: 'testdb' },
    },
    [funcId]: {
      id: funcId,
      label: 'calc_total',
      type: 'function',
      parentId: null,
      hasChildren: false,
      isLoaded: true,
      metadata: { databaseName: 'testdb' },
    },
    [triggerId]: {
      id: triggerId,
      label: 'before_insert',
      type: 'trigger',
      parentId: null,
      hasChildren: false,
      isLoaded: true,
      metadata: { databaseName: 'testdb' },
    },
    [eventId]: {
      id: eventId,
      label: 'cleanup_job',
      type: 'event',
      parentId: null,
      hasChildren: false,
      isLoaded: true,
      metadata: { databaseName: 'testdb' },
    },
    [colId]: {
      id: colId,
      label: 'id',
      type: 'column',
      parentId: tableId,
      hasChildren: false,
      isLoaded: true,
      metadata: { columnType: 'bigint', databaseName: 'testdb' },
    },
  }

  return { dbId, catId, tableId, viewId, procId, funcId, triggerId, eventId, colId, nodes }
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetTabIdCounter()
  useSchemaStore.setState({
    connectionStates: {},
    refreshDatabase: vi.fn().mockResolvedValue(undefined),
    refreshAll: vi.fn().mockResolvedValue(undefined),
  })
  useWorkspaceStore.setState({
    tabsByConnection: {},
    activeTabByConnection: {},
  })
})

describe('ObjectBrowserContextMenu', () => {
  it('renders when visible=true', () => {
    const { nodes, tableId } = makeNodes()
    setNodes(nodes)

    render(
      <ObjectBrowserContextMenu
        visible
        x={100}
        y={100}
        nodeId={tableId}
        connectionId={CONN_ID}
        isReadOnly={false}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByTestId('object-browser-context-menu')).toBeInTheDocument()
  })

  it('does not render when visible=false', () => {
    const { nodes, tableId } = makeNodes()
    setNodes(nodes)

    render(
      <ObjectBrowserContextMenu
        visible={false}
        x={100}
        y={100}
        nodeId={tableId}
        connectionId={CONN_ID}
        isReadOnly={false}
        onClose={vi.fn()}
      />
    )
    expect(screen.queryByTestId('object-browser-context-menu')).not.toBeInTheDocument()
  })

  it('shows correct items for database node', () => {
    const { nodes, dbId } = makeNodes()
    setNodes(nodes)
    const onCreateTable = vi.fn()

    render(
      <ObjectBrowserContextMenu
        visible
        x={100}
        y={100}
        nodeId={dbId}
        connectionId={CONN_ID}
        isReadOnly={false}
        onClose={vi.fn()}
        onCreateTable={onCreateTable}
      />
    )

    expect(screen.getByText('Create Database...')).toBeInTheDocument()
    expect(screen.getByText('Create Table...')).toBeInTheDocument()
    expect(screen.getByText('Alter Database...')).toBeInTheDocument()
    expect(screen.getByText('Rename Database...')).toBeInTheDocument()
    expect(screen.getByText('Drop Database...')).toBeInTheDocument()
    expect(screen.getByText('Refresh')).toBeInTheDocument()
  })

  it('shows correct items for table node (including enabled designer items)', () => {
    const { nodes, tableId } = makeNodes()
    setNodes(nodes)
    const onDesignTable = vi.fn()
    const onCreateTable = vi.fn()

    render(
      <ObjectBrowserContextMenu
        visible
        x={100}
        y={100}
        nodeId={tableId}
        connectionId={CONN_ID}
        isReadOnly={false}
        onClose={vi.fn()}
        onDesignTable={onDesignTable}
        onCreateTable={onCreateTable}
      />
    )

    // Always-disabled items
    const selectRows = screen.getByText('Select Top 100 Rows')
    expect(selectRows.closest('button')).toBeDisabled()
    expect(screen.getByText('Create Table...').closest('button')).toBeEnabled()
    const designTable = screen.getByText('Design Table...')
    expect(designTable.closest('button')).toBeEnabled()

    // Enabled items
    expect(screen.getByText('Schema Info')).toBeInTheDocument()
    expect(screen.getByText('Copy Table Name')).toBeInTheDocument()
    expect(screen.getByText('Refresh')).toBeInTheDocument()

    // Mutating items disabled when callbacks not provided
    const truncate = screen.getByText('Truncate Table...')
    expect(truncate.closest('button')).toBeDisabled()
    const drop = screen.getByText('Drop Table...')
    expect(drop.closest('button')).toBeDisabled()
    const rename = screen.getByText('Rename Table...')
    expect(rename.closest('button')).toBeDisabled()
  })

  it('shows correct items for column node', () => {
    const { nodes, colId } = makeNodes()
    setNodes(nodes)

    render(
      <ObjectBrowserContextMenu
        visible
        x={100}
        y={100}
        nodeId={colId}
        connectionId={CONN_ID}
        isReadOnly={false}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('Copy Column Name')).toBeInTheDocument()
    // Should not show other items
    expect(screen.queryByText('Schema Info')).not.toBeInTheDocument()
    expect(screen.queryByText('Refresh')).not.toBeInTheDocument()
  })

  it('does not show mutating items for read-only connections (database)', () => {
    const { nodes, dbId } = makeNodes()
    setNodes(nodes)

    render(
      <ObjectBrowserContextMenu
        visible
        x={100}
        y={100}
        nodeId={dbId}
        connectionId={CONN_ID}
        isReadOnly
        onClose={vi.fn()}
      />
    )

    // Only refresh should be visible
    expect(screen.getByText('Refresh')).toBeInTheDocument()
    expect(screen.queryByText('Create Database...')).not.toBeInTheDocument()
    expect(screen.queryByText('Create Table...')).not.toBeInTheDocument()
    expect(screen.queryByText('Drop Database...')).not.toBeInTheDocument()
  })

  it('does not show mutating items for read-only connections (table)', () => {
    const { nodes, tableId } = makeNodes()
    setNodes(nodes)

    render(
      <ObjectBrowserContextMenu
        visible
        x={100}
        y={100}
        nodeId={tableId}
        connectionId={CONN_ID}
        isReadOnly
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('Schema Info')).toBeInTheDocument()
    expect(screen.getByText('Copy Table Name')).toBeInTheDocument()
    expect(screen.getByText('Refresh')).toBeInTheDocument()
    expect(screen.queryByText('Create Table...')).not.toBeInTheDocument()
    expect(screen.queryByText('Design Table...')).not.toBeInTheDocument()
    expect(screen.queryByText('Select Top 100 Rows')).not.toBeInTheDocument()
    expect(screen.queryByText('Truncate Table...')).not.toBeInTheDocument()
    expect(screen.queryByText('Drop Table...')).not.toBeInTheDocument()
  })

  it('"Schema Info" click calls openTab with correct args', async () => {
    const user = userEvent.setup()
    const { nodes, tableId } = makeNodes()
    setNodes(nodes)
    const onClose = vi.fn()

    render(
      <ObjectBrowserContextMenu
        visible
        x={100}
        y={100}
        nodeId={tableId}
        connectionId={CONN_ID}
        isReadOnly={false}
        onClose={onClose}
      />
    )

    await user.click(screen.getByText('Schema Info'))

    const state = useWorkspaceStore.getState()
    const tabs = state.tabsByConnection[CONN_ID]
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toMatchObject({
      type: 'schema-info',
      label: 'users',
      connectionId: CONN_ID,
      databaseName: 'testdb',
      objectName: 'users',
      objectType: 'table',
    })
  })

  it('"Copy Table Name" click calls writeClipboardText', async () => {
    const user = userEvent.setup()
    const { nodes, tableId } = makeNodes()
    setNodes(nodes)

    render(
      <ObjectBrowserContextMenu
        visible
        x={100}
        y={100}
        nodeId={tableId}
        connectionId={CONN_ID}
        isReadOnly={false}
        onClose={vi.fn()}
      />
    )

    await user.click(screen.getByText('Copy Table Name'))

    expect(writeClipboardText).toHaveBeenCalledWith('users')
  })

  it('"Refresh" click calls schema-store refreshDatabase', async () => {
    const user = userEvent.setup()
    const { nodes, dbId } = makeNodes()
    setNodes(nodes)

    render(
      <ObjectBrowserContextMenu
        visible
        x={100}
        y={100}
        nodeId={dbId}
        connectionId={CONN_ID}
        isReadOnly={false}
        onClose={vi.fn()}
      />
    )

    await user.click(screen.getByText('Refresh'))

    const refreshDatabase = useSchemaStore.getState().refreshDatabase
    expect(refreshDatabase).toHaveBeenCalledWith(CONN_ID, 'testdb')
  })

  it('closes on Escape key press', async () => {
    const user = userEvent.setup()
    const { nodes, tableId } = makeNodes()
    setNodes(nodes)
    const onClose = vi.fn()

    render(
      <ObjectBrowserContextMenu
        visible
        x={100}
        y={100}
        nodeId={tableId}
        connectionId={CONN_ID}
        isReadOnly={false}
        onClose={onClose}
      />
    )

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('destructive items have destructive styling', () => {
    const { nodes, tableId } = makeNodes()
    setNodes(nodes)

    render(
      <ObjectBrowserContextMenu
        visible
        x={100}
        y={100}
        nodeId={tableId}
        connectionId={CONN_ID}
        isReadOnly={false}
        onClose={vi.fn()}
      />
    )

    const truncateBtn = screen.getByText('Truncate Table...').closest('button')
    expect(truncateBtn?.className).toContain('ui-context-menu__item--destructive')

    const dropBtn = screen.getByText('Drop Table...').closest('button')
    expect(dropBtn?.className).toContain('ui-context-menu__item--destructive')
  })

  it('shows correct items for view node (writable)', () => {
    const { nodes, viewId } = makeNodes()
    setNodes(nodes)

    render(
      <ObjectBrowserContextMenu
        visible
        x={100}
        y={100}
        nodeId={viewId}
        connectionId={CONN_ID}
        isReadOnly={false}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('Schema Info')).toBeInTheDocument()
    expect(screen.getByText('Copy Name')).toBeInTheDocument()
    expect(screen.getByText('Refresh')).toBeInTheDocument()
    // Disabled future-phase items
    const dropView = screen.getByText('Drop View...')
    expect(dropView.closest('button')).toBeDisabled()
    expect(dropView.closest('button')).toHaveAttribute('title', 'Coming in Phase 8')
  })

  it('shows read-only view menu (no mutating items)', () => {
    const { nodes, viewId } = makeNodes()
    setNodes(nodes)

    render(
      <ObjectBrowserContextMenu
        visible
        x={100}
        y={100}
        nodeId={viewId}
        connectionId={CONN_ID}
        isReadOnly
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('Schema Info')).toBeInTheDocument()
    expect(screen.getByText('Copy Name')).toBeInTheDocument()
    expect(screen.getByText('Refresh')).toBeInTheDocument()
    expect(screen.queryByText('Drop View...')).not.toBeInTheDocument()
  })

  it('shows correct items for procedure node (writable)', () => {
    const { nodes, procId } = makeNodes()
    setNodes(nodes)

    render(
      <ObjectBrowserContextMenu
        visible
        x={100}
        y={100}
        nodeId={procId}
        connectionId={CONN_ID}
        isReadOnly={false}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('Schema Info')).toBeInTheDocument()
    expect(screen.getByText('Copy Name')).toBeInTheDocument()
    expect(screen.getByText('Refresh')).toBeInTheDocument()
    // Disabled future-phase items
    const execute = screen.getByText('Execute')
    expect(execute.closest('button')).toBeDisabled()
    expect(execute.closest('button')).toHaveAttribute('title', 'Coming soon')
    const alterProc = screen.getByText('Alter Procedure...')
    expect(alterProc.closest('button')).toBeDisabled()
    expect(alterProc.closest('button')).toHaveAttribute('title', 'Coming in Phase 8')
    const dropProc = screen.getByText('Drop Procedure...')
    expect(dropProc.closest('button')).toBeDisabled()
    expect(dropProc.closest('button')).toHaveAttribute('title', 'Coming soon')
  })

  it('shows correct items for trigger node (writable)', () => {
    const { nodes, triggerId } = makeNodes()
    setNodes(nodes)

    render(
      <ObjectBrowserContextMenu
        visible
        x={100}
        y={100}
        nodeId={triggerId}
        connectionId={CONN_ID}
        isReadOnly={false}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('Schema Info')).toBeInTheDocument()
    expect(screen.getByText('Copy Name')).toBeInTheDocument()
    expect(screen.getByText('Refresh')).toBeInTheDocument()
    const alterTrigger = screen.getByText('Alter Trigger...')
    expect(alterTrigger.closest('button')).toBeDisabled()
    const dropTrigger = screen.getByText('Drop Trigger...')
    expect(dropTrigger.closest('button')).toBeDisabled()
  })

  it('shows correct items for category node', () => {
    const { nodes, catId } = makeNodes()
    setNodes(nodes)
    const onCreateTable = vi.fn()

    render(
      <ObjectBrowserContextMenu
        visible
        x={100}
        y={100}
        nodeId={catId}
        connectionId={CONN_ID}
        isReadOnly={false}
        onClose={vi.fn()}
        onCreateTable={onCreateTable}
      />
    )

    expect(screen.getByText('Create Table...')).toBeInTheDocument()
    expect(screen.getByText('Refresh')).toBeInTheDocument()
    expect(screen.queryByText('Schema Info')).not.toBeInTheDocument()
  })

  it('does not show create table for non-table category nodes', () => {
    const { nodes } = makeNodes()
    const viewCatId = makeNodeId('category', 'testdb', 'view')
    setNodes({
      ...nodes,
      [viewCatId]: {
        id: viewCatId,
        label: 'Views',
        type: 'category',
        parentId: makeNodeId('database', 'testdb', 'testdb'),
        hasChildren: true,
        isLoaded: true,
        metadata: { categoryType: 'view', databaseName: 'testdb' },
      },
    })

    render(
      <ObjectBrowserContextMenu
        visible
        x={100}
        y={100}
        nodeId={viewCatId}
        connectionId={CONN_ID}
        isReadOnly={false}
        onClose={vi.fn()}
        onCreateTable={vi.fn()}
      />
    )

    expect(screen.queryByText('Create Table...')).not.toBeInTheDocument()
    expect(screen.getByText('Refresh')).toBeInTheDocument()
  })

  it('does not render when nodeId is null', () => {
    render(
      <ObjectBrowserContextMenu
        visible
        x={100}
        y={100}
        nodeId={null}
        connectionId={CONN_ID}
        isReadOnly={false}
        onClose={vi.fn()}
      />
    )
    expect(screen.queryByTestId('object-browser-context-menu')).not.toBeInTheDocument()
  })
})
