import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ObjectBrowser } from '../../../components/object-browser/ObjectBrowser'
import * as objectActivation from '../../../lib/object-activation'
import { useConnectionStore } from '../../../stores/connection-store'
import { makeNodeId, useSchemaStore } from '../../../stores/schema-store'
import type { ActiveConnection, SavedConnection } from '../../../types/connection'
import type { TreeNode as TreeNodeType } from '../../../types/schema'

const CONNECTION_ID = 'conn-1'

function makeSavedConnection(overrides: Partial<SavedConnection> = {}): SavedConnection {
  return {
    id: CONNECTION_ID,
    name: 'Test DB',
    host: '127.0.0.1',
    port: 3306,
    username: 'root',
    hasPassword: true,
    defaultDatabase: null,
    sslEnabled: false,
    sslCaPath: null,
    sslCertPath: null,
    sslKeyPath: null,
    color: '#3b82f6',
    groupId: null,
    readOnly: false,
    sortOrder: 0,
    connectTimeoutSecs: 10,
    keepaliveIntervalSecs: 30,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeActiveConnection(overrides: Partial<ActiveConnection> = {}): ActiveConnection {
  return {
    id: CONNECTION_ID,
    profile: makeSavedConnection(),
    status: 'connected',
    serverVersion: '8.0.35',
    ...overrides,
  }
}

function buildChildIndex(nodes: Record<string, TreeNodeType>): Record<string, string[]> {
  const index: Record<string, string[]> = {}
  for (const [id, node] of Object.entries(nodes)) {
    const parentId = node.parentId ?? '__root__'
    if (!index[parentId]) index[parentId] = []
    index[parentId].push(id)
  }
  return index
}

describe('ObjectBrowser activation delegation', () => {
  beforeEach(() => {
    act(() => {
      useConnectionStore.setState({
        activeConnections: {
          [CONNECTION_ID]: makeActiveConnection(),
        },
        activeTabId: CONNECTION_ID,
      })
      useSchemaStore.setState({
        connectionStates: {},
      })
    })
  })

  it('delegates object activation to the shared default-tab helper', async () => {
    const user = userEvent.setup()
    const databaseId = makeNodeId('database', 'ecommerce_db', 'ecommerce_db')
    const categoryId = makeNodeId('category', 'ecommerce_db', 'view')
    const objectId = makeNodeId('view', 'ecommerce_db', 'user_stats')
    const openObjectDefaultTab = vi
      .spyOn(objectActivation, 'openObjectDefaultTab')
      .mockImplementation(() => {})
    const loadDatabases = vi.fn().mockResolvedValue(undefined)

    const nodes: Record<string, TreeNodeType> = {
      [databaseId]: {
        id: databaseId,
        label: 'ecommerce_db',
        type: 'database',
        parentId: null,
        hasChildren: true,
        isLoaded: true,
      },
      [categoryId]: {
        id: categoryId,
        label: 'Views',
        type: 'category',
        parentId: databaseId,
        hasChildren: true,
        isLoaded: true,
        metadata: { categoryType: 'view', databaseName: 'ecommerce_db' },
      },
      [objectId]: {
        id: objectId,
        label: 'user_stats',
        type: 'view',
        parentId: categoryId,
        hasChildren: false,
        isLoaded: true,
        metadata: { databaseName: 'ecommerce_db' },
      },
    }

    act(() => {
      useSchemaStore.setState({
        loadDatabases,
        connectionStates: {
          [CONNECTION_ID]: {
            nodes,
            childIdsByParentId: buildChildIndex(nodes),
            expandedNodes: new Set([databaseId, categoryId]),
            loadingNodes: new Set(),
            selectedNodeId: null,
            filterText: '',
            loadGeneration: 0,
          },
        },
      })
    })

    await act(async () => {
      render(
        <ObjectBrowser
          connectionId={CONNECTION_ID}
          favouritesOpen={false}
          onToggleFavourites={() => {}}
        />
      )
    })

    await act(async () => {
      await user.click(screen.getByRole('treeitem', { name: 'user_stats' }))
    })

    expect(openObjectDefaultTab).toHaveBeenCalledWith(
      CONNECTION_ID,
      'ecommerce_db',
      'view',
      'user_stats',
      'user_stats'
    )
    expect(loadDatabases).toHaveBeenCalledWith(CONNECTION_ID)
  })
})
