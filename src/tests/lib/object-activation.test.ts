import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activateColumnFromPalette,
  activateObjectFromPalette,
  getTabRevealTarget,
  isObjectTab,
  openObjectDefaultTab,
  revealObjectInTree,
  revealTabInObjectBrowser,
} from '../../lib/object-activation'
import { useConnectionStore } from '../../stores/connection-store'
import { makeNodeId, useSchemaStore } from '../../stores/schema-store'
import { useTableDataStore } from '../../stores/table-data-store'
import { useToastStore } from '../../stores/toast-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import type { ActiveConnection } from '../../types/connection'
import type { WorkspaceTab } from '../../types/schema'
import { expectToast, ipc } from '../ipc-mock'

const CONNECTION_ID = 'conn-1'
const DATABASE = 'app_db'

/** Real store actions, captured before any test swaps them for mocks. */
const INITIAL_SCHEMA_STATE = useSchemaStore.getState()

describe('object-activation', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      tabsByConnection: {},
      activeTabByConnection: {},
    })
    useSchemaStore.setState({
      connectionStates: {},
    })
    useTableDataStore.setState({
      columnJumpRequests: {},
      highlightedColumnByTab: {},
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

  it('requests a column jump on the matching table tab instead of the active query tab', () => {
    const openTab = vi.fn()
    useWorkspaceStore.setState({
      openTab,
      tabsByConnection: {
        [CONNECTION_ID]: [
          {
            id: 'query-tab',
            type: 'query-editor',
            label: 'Query',
            connectionId: CONNECTION_ID,
          },
          {
            id: 'orders-tab',
            type: 'table-data',
            label: 'orders',
            connectionId: CONNECTION_ID,
            databaseName: DATABASE,
            objectName: 'orders',
            objectType: 'table',
            parentQueryTabId: 'query-tab',
          },
          {
            id: 'users-tab',
            type: 'table-data',
            label: 'users',
            connectionId: CONNECTION_ID,
            databaseName: DATABASE,
            objectName: 'users',
            objectType: 'table',
          },
        ],
      },
      activeTabByConnection: { [CONNECTION_ID]: 'query-tab' },
    })

    activateColumnFromPalette(CONNECTION_ID, DATABASE, 'orders', 'shipping_amount')

    expect(openTab).toHaveBeenCalledWith({
      type: 'table-data',
      connectionId: CONNECTION_ID,
      databaseName: DATABASE,
      objectName: 'orders',
      objectType: 'table',
      label: 'orders',
    })
    expect(useTableDataStore.getState().columnJumpRequests).toEqual({
      'orders-tab': { columnKey: 'shipping_amount', nonce: 1 },
    })
  })

  describe('reveal from a workspace tab', () => {
    const base = { id: 'tab-1', label: 'x', connectionId: CONNECTION_ID }
    const tabs: Record<string, WorkspaceTab> = {
      tableData: {
        ...base,
        type: 'table-data',
        databaseName: DATABASE,
        objectName: 'orders',
        objectType: 'table',
      },
      schemaInfo: {
        ...base,
        type: 'schema-info',
        databaseName: DATABASE,
        objectName: 'sp_refund',
        objectType: 'procedure',
      },
      designerAlter: {
        ...base,
        type: 'table-designer',
        mode: 'alter',
        databaseName: DATABASE,
        objectName: 'orders',
      },
      designerCreate: {
        ...base,
        type: 'table-designer',
        mode: 'create',
        databaseName: DATABASE,
        objectName: '__new_table__',
      },
      editorAlter: {
        ...base,
        type: 'object-editor',
        mode: 'alter',
        databaseName: DATABASE,
        objectName: 'v_revenue',
        objectType: 'view',
      },
      editorCreate: {
        ...base,
        type: 'object-editor',
        mode: 'create',
        databaseName: DATABASE,
        objectName: 'new_view',
        objectType: 'view',
      },
      query: { ...base, type: 'query-editor' },
      history: { ...base, type: 'history' },
      processlist: { ...base, type: 'processlist' },
    }

    it('resolves the object behind each tab type', () => {
      expect(getTabRevealTarget(tabs.tableData)).toEqual({
        database: DATABASE,
        objectType: 'table',
        name: 'orders',
      })
      expect(getTabRevealTarget(tabs.schemaInfo)).toEqual({
        database: DATABASE,
        objectType: 'procedure',
        name: 'sp_refund',
      })
      expect(getTabRevealTarget(tabs.designerAlter)).toEqual({
        database: DATABASE,
        objectType: 'table',
        name: 'orders',
      })
      expect(getTabRevealTarget(tabs.editorAlter)).toEqual({
        database: DATABASE,
        objectType: 'view',
        name: 'v_revenue',
      })
      expect(getTabRevealTarget(tabs.designerCreate)).toBeNull()
      expect(getTabRevealTarget(tabs.editorCreate)).toBeNull()
      expect(getTabRevealTarget(tabs.query)).toBeNull()
      expect(getTabRevealTarget(tabs.history)).toBeNull()
      expect(getTabRevealTarget(tabs.processlist)).toBeNull()
    })

    it('classifies object tabs, including create-mode ones', () => {
      expect(isObjectTab(tabs.tableData)).toBe(true)
      expect(isObjectTab(tabs.schemaInfo)).toBe(true)
      expect(isObjectTab(tabs.designerCreate)).toBe(true)
      expect(isObjectTab(tabs.editorCreate)).toBe(true)
      expect(isObjectTab(tabs.query)).toBe(false)
      expect(isObjectTab(tabs.history)).toBe(false)
      expect(isObjectTab(tabs.processlist)).toBe(false)
    })

    function seedTree(withObject: boolean) {
      const databaseNodeId = makeNodeId('database', DATABASE, DATABASE)
      const categoryNodeId = makeNodeId('category', DATABASE, 'table')
      const objectNodeId = makeNodeId('table', DATABASE, 'orders')
      useSchemaStore.setState({
        ...INITIAL_SCHEMA_STATE,
        revealRequest: null,
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
              },
              [categoryNodeId]: {
                id: categoryNodeId,
                label: 'Tables',
                type: 'category',
                parentId: databaseNodeId,
                hasChildren: true,
                isLoaded: true,
                databaseName: DATABASE,
              },
              ...(withObject
                ? {
                    [objectNodeId]: {
                      id: objectNodeId,
                      label: 'orders',
                      type: 'table' as const,
                      parentId: categoryNodeId,
                      hasChildren: true,
                      isLoaded: false,
                      databaseName: DATABASE,
                    },
                  }
                : {}),
            },
            childIdsByParentId: {
              __root__: [databaseNodeId],
              [databaseNodeId]: [categoryNodeId],
              [categoryNodeId]: withObject ? [objectNodeId] : [],
            },
            expandedNodes: new Set(),
            loadingNodes: new Set(),
            selectedNodeId: null,
            filterText: '',
            loadGeneration: 0,
          },
        },
      })
      useConnectionStore.setState({
        activeConnections: {
          [CONNECTION_ID]: {
            id: CONNECTION_ID,
            profile: { id: 'profile-1', name: 'Local', defaultDatabase: null },
            status: 'connected',
            serverVersion: '8.0.35',
            sessionDatabase: 'other_db',
          } as unknown as ActiveConnection,
        },
      })
      useToastStore.setState({ toasts: [] })
      return objectNodeId
    }

    it('selects the object, sets the active database and requests the reveal', async () => {
      const objectNodeId = seedTree(true)

      await revealTabInObjectBrowser(tabs.tableData)

      const connState = useSchemaStore.getState().connectionStates[CONNECTION_ID]
      expect(connState.selectedNodeId).toBe(objectNodeId)
      expect(connState.expandedNodes.has(makeNodeId('category', DATABASE, 'table'))).toBe(true)
      expect(useSchemaStore.getState().revealRequest).toEqual({
        connectionId: CONNECTION_ID,
        nodeId: objectNodeId,
        seq: 1,
      })
      expect(useConnectionStore.getState().activeConnections[CONNECTION_ID].sessionDatabase).toBe(
        DATABASE
      )
      expect(ipc.calls('select_database')).toEqual([
        { connectionId: CONNECTION_ID, databaseName: DATABASE },
      ])
    })

    it('warns and leaves the active database alone when the object is missing', async () => {
      seedTree(false)

      await revealTabInObjectBrowser(tabs.tableData)

      await expectToast('warning', "Couldn't find orders in the object browser")
      expect(useSchemaStore.getState().revealRequest).toBeNull()
      expect(ipc.calls('select_database')).toEqual([])
      expect(useConnectionStore.getState().activeConnections[CONNECTION_ID].sessionDatabase).toBe(
        'other_db'
      )
    })

    it('does nothing for tabs without an object', async () => {
      seedTree(true)

      await revealTabInObjectBrowser(tabs.query)

      expect(useSchemaStore.getState().revealRequest).toBeNull()
      expect(useSchemaStore.getState().connectionStates[CONNECTION_ID].selectedNodeId).toBeNull()
    })
  })
})
