import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activateObjectFromPalette,
  openObjectDefaultTab,
  revealObjectInTree,
} from '../../lib/object-activation'
import { makeNodeId, useSchemaStore } from '../../stores/schema-store'
import { useWorkspaceStore } from '../../stores/workspace-store'

const CONNECTION_ID = 'conn-1'
const DATABASE = 'app_db'

describe('object-activation', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      tabsByConnection: {},
      activeTabByConnection: {},
    })
    useSchemaStore.setState({
      connectionStates: {},
    })
  })

  it.each([
    ['table', 'table-data'],
    ['view', 'table-data'],
    ['procedure', 'schema-info'],
    ['function', 'schema-info'],
    ['trigger', 'schema-info'],
    ['event', 'schema-info'],
  ] as const)('opens %s objects in the %s default tab', (objectType, expectedTabType) => {
    const openTab = vi.fn()
    useWorkspaceStore.setState({ openTab })

    openObjectDefaultTab(CONNECTION_ID, DATABASE, objectType, 'users', 'Users')

    expect(openTab).toHaveBeenCalledWith({
      type: expectedTabType,
      connectionId: CONNECTION_ID,
      databaseName: DATABASE,
      objectName: 'users',
      objectType,
      label: 'Users',
    })
  })

  it('loads the database and category path before selecting the object node', async () => {
    const databaseNodeId = makeNodeId('database', DATABASE, DATABASE)
    const categoryNodeId = makeNodeId('category', DATABASE, 'trigger')
    const objectNodeId = makeNodeId('trigger', DATABASE, 'trg_users_audit')

    const loadDatabases = vi.fn(async () => {
      useSchemaStore.setState({
        connectionStates: {
          [CONNECTION_ID]: {
            nodes: {
              [databaseNodeId]: {
                id: databaseNodeId,
                label: DATABASE,
                type: 'database',
                parentId: null,
                hasChildren: true,
                isLoaded: false,
                databaseName: DATABASE,
                objectName: DATABASE,
              },
            },
            childIdsByParentId: { __root__: [databaseNodeId] },
            expandedNodes: new Set(),
            loadingNodes: new Set(),
            selectedNodeId: null,
            filterText: '',
            loadGeneration: 0,
          },
        },
      })
    })

    const loadChildren = vi.fn(async (_connectionId: string, nodeId: string) => {
      const current = useSchemaStore.getState().connectionStates[CONNECTION_ID]

      if (nodeId === databaseNodeId) {
        useSchemaStore.setState({
          connectionStates: {
            [CONNECTION_ID]: {
              ...current,
              nodes: {
                ...current.nodes,
                [databaseNodeId]: {
                  ...current.nodes[databaseNodeId],
                  isLoaded: true,
                },
                [categoryNodeId]: {
                  id: categoryNodeId,
                  label: 'Triggers',
                  type: 'category',
                  parentId: databaseNodeId,
                  hasChildren: true,
                  isLoaded: false,
                  databaseName: DATABASE,
                  metadata: { categoryType: 'trigger', databaseName: DATABASE },
                },
              },
              childIdsByParentId: {
                __root__: [databaseNodeId],
                [databaseNodeId]: [categoryNodeId],
              },
            },
          },
        })
        return
      }

      if (nodeId === categoryNodeId) {
        useSchemaStore.setState({
          connectionStates: {
            [CONNECTION_ID]: {
              ...current,
              nodes: {
                ...current.nodes,
                [categoryNodeId]: {
                  ...current.nodes[categoryNodeId],
                  isLoaded: true,
                },
                [objectNodeId]: {
                  id: objectNodeId,
                  label: 'trg_users_audit',
                  type: 'trigger',
                  parentId: categoryNodeId,
                  hasChildren: false,
                  isLoaded: true,
                  databaseName: DATABASE,
                  objectName: 'trg_users_audit',
                  metadata: { databaseName: DATABASE },
                },
              },
              childIdsByParentId: {
                ...current.childIdsByParentId,
                [categoryNodeId]: [objectNodeId],
              },
            },
          },
        })
      }
    })

    const ensurePathExpanded = vi.fn()
    const selectNode = vi.fn()

    useSchemaStore.setState({
      loadDatabases,
      loadChildren,
      ensurePathExpanded,
      selectNode,
    })

    await revealObjectInTree(CONNECTION_ID, DATABASE, 'trigger', 'trg_users_audit')

    expect(loadDatabases).toHaveBeenCalledWith(CONNECTION_ID)
    expect(loadChildren).toHaveBeenNthCalledWith(1, CONNECTION_ID, databaseNodeId)
    expect(loadChildren).toHaveBeenNthCalledWith(2, CONNECTION_ID, categoryNodeId)
    expect(ensurePathExpanded).toHaveBeenCalledWith(CONNECTION_ID, objectNodeId)
    expect(selectNode).toHaveBeenCalledWith(objectNodeId, CONNECTION_ID)
  })

  it('composes the default tab open with the tree reveal for palette activation', async () => {
    const openTab = vi.fn()
    const databaseNodeId = makeNodeId('database', DATABASE, DATABASE)
    const categoryNodeId = makeNodeId('category', DATABASE, 'view')
    const objectNodeId = makeNodeId('view', DATABASE, 'active_users')
    const loadDatabases = vi.fn()
    const loadChildren = vi.fn()
    const ensurePathExpanded = vi.fn()
    const selectNode = vi.fn()

    useWorkspaceStore.setState({ openTab })
    useSchemaStore.setState({
      loadDatabases,
      loadChildren,
      ensurePathExpanded,
      selectNode,
      connectionStates: {
        [CONNECTION_ID]: {
          nodes: {
            [databaseNodeId]: {
              id: databaseNodeId,
              label: DATABASE,
              type: 'database',
              parentId: null,
              hasChildren: true,
              isLoaded: true,
              databaseName: DATABASE,
              objectName: DATABASE,
            },
            [categoryNodeId]: {
              id: categoryNodeId,
              label: 'Views',
              type: 'category',
              parentId: databaseNodeId,
              hasChildren: true,
              isLoaded: true,
              databaseName: DATABASE,
              metadata: { categoryType: 'view', databaseName: DATABASE },
            },
            [objectNodeId]: {
              id: objectNodeId,
              label: 'active_users',
              type: 'view',
              parentId: categoryNodeId,
              hasChildren: false,
              isLoaded: true,
              databaseName: DATABASE,
              objectName: 'active_users',
              metadata: { databaseName: DATABASE },
            },
          },
          childIdsByParentId: {
            __root__: [databaseNodeId],
            [databaseNodeId]: [categoryNodeId],
            [categoryNodeId]: [objectNodeId],
          },
          expandedNodes: new Set(),
          loadingNodes: new Set(),
          selectedNodeId: null,
          filterText: '',
          loadGeneration: 0,
        },
      },
    })

    await activateObjectFromPalette(CONNECTION_ID, DATABASE, 'view', 'active_users')

    expect(openTab).toHaveBeenCalledWith({
      type: 'table-data',
      connectionId: CONNECTION_ID,
      databaseName: DATABASE,
      objectName: 'active_users',
      objectType: 'view',
      label: 'active_users',
    })
    expect(loadDatabases).not.toHaveBeenCalled()
    expect(loadChildren).not.toHaveBeenCalled()
    expect(ensurePathExpanded).toHaveBeenCalledWith(CONNECTION_ID, objectNodeId)
    expect(selectNode).toHaveBeenCalledWith(objectNodeId, CONNECTION_ID)
  })
})
