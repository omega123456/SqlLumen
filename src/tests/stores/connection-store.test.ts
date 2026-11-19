import { resultState } from '../helpers/legacy-result-fields'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  isConnectionOfProfile,
  useConnectionStore,
  _resetListenersSetup,
} from '../../stores/connection-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { resetWorkspaceStore, seedVisibleConnection } from '../helpers/workspace-test-utils'
import { useQueryStore, querySurfaceRef } from '../../stores/query-store'
import { useTableDataStore } from '../../stores/table-data-store'
import { useObjectEditorStore } from '../../stores/object-editor-store'
import { ipc, expectToast } from '../ipc-mock'
import type { ActiveConnection, SavedConnection, ConnectionGroup } from '../../types/connection'
import { useToastStore, _resetToastTimeoutsForTests } from '../../stores/toast-store'
import { makeTabState } from '../helpers/query-test-utils'
import { makeTableDataTabState } from '../helpers/table-data-test-utils'
import { makeTableColumnMeta } from '../helpers/column-meta-fixtures'
import { tableEditTargetOf } from '../../stores/table-data-store/table-data-edit-target'

/**
 * Tests for connection-store: close-connection guard with dirty non-active query results.
 */

function makeActiveConnection(
  sessionId: string,
  profileId: string,
  name: string
): ActiveConnection {
  return {
    id: sessionId,
    profile: {
      id: profileId,
      name,
      host: 'localhost',
      port: 3306,
      username: 'root',
      hasPassword: true,
      defaultDatabase: 'testdb',
      sslMode: 'disabled',
      lastConnectedAt: null,
      sslCaPath: null,
      sslCertPath: null,
      sslKeyPath: null,
      color: null,
      groupId: null,
      readOnly: false,
      sortOrder: 0,
      connectTimeoutSecs: 10,
      keepaliveIntervalSecs: 60,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    sessionDatabase: 'testdb',
    status: 'connected',
    serverVersion: '8.0.0',
  }
}

function dirtyQueryResult(queryId: string) {
  return resultState({
    resultStatus: 'success' as const,
    queryId,
    editState: {
      rowKey: { id: 1 },
      originalValues: { name: 'Alice' },
      currentValues: { name: 'Bob' },
      modifiedColumns: new Set(['name']),
      isNewRow: false,
    },
    editingRowIndex: 0,
  })
}

beforeEach(() => {
  // Reset all stores
  useConnectionStore.setState({
    savedConnections: [],
    connectionGroups: [],
    activeConnections: {},
    activeConnectionOrder: [],
    activeTabId: null,
    error: null,
  })
  resetWorkspaceStore()
  useQueryStore.setState({ tabs: {} })
  useTableDataStore.setState({ tabs: {} })
  useObjectEditorStore.setState({ tabs: {} })
  _resetListenersSetup()

  ipc.override('close_connection', () => null)
  ipc.override('evict_results', () => null)
  ipc.override('log_frontend', () => undefined)
  ipc.override('build_schema_index', () => undefined)
  ipc.override('get_index_status', () => ({ status: 'ready' }))
  ipc.override('invalidate_schema_index', () => undefined)
  ipc.override('semantic_search', () => [])
  ipc.override('list_indexed_tables', () => [])
})

describe('useConnectionStore — closeConnection guard for dirty non-active query results', () => {
  function setupActiveConnection() {
    useConnectionStore.setState({
      activeConnections: {
        'session-1': {
          id: 'session-1',
          profile: {
            id: 'profile-1',
            name: 'Test connection',
            host: 'localhost',
            port: 3306,
            username: 'root',
            hasPassword: true,
            defaultDatabase: 'testdb',
            sslMode: 'disabled',
            lastConnectedAt: null,
            sslCaPath: null,
            sslCertPath: null,
            sslKeyPath: null,
            color: null,
            groupId: null,
            readOnly: false,
            sortOrder: 0,
            connectTimeoutSecs: 10,
            keepaliveIntervalSecs: 60,
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
          sessionDatabase: 'testdb',
          status: 'connected',
          serverVersion: '8.0.0',
        },
      },
      activeTabId: 'session-1',
    })
  }

  it('prompts the user when a query tab has dirty non-active result', async () => {
    setupActiveConnection()

    // Open a query-editor tab
    const tabId = useWorkspaceStore.getState().openQueryTab('session-1')

    // Set up query store with dirty non-active result (index 1 is dirty, active is 0)
    useQueryStore.setState({
      tabs: {
        [tabId]: {
          content: 'SELECT 1; SELECT 2',
          selectedText: '',
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: 'session-1',
          results: [
            resultState({ resultStatus: 'success', queryId: 'q1' }),
            resultState({
              resultStatus: 'success',
              queryId: 'q2',
              editState: {
                rowKey: { id: 1 },
                originalValues: { name: 'Alice' },
                currentValues: { name: 'Bob' },
                modifiedColumns: new Set(['name']),
                isNewRow: false,
              },
              editingRowIndex: 0,
            }),
          ],
          activeResultIndex: 0,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
          runExport: null,
          activeBottomPanelItem: { type: 'result' },
        },
      },
    })

    // Mock confirm to reject
    const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(false)

    await useConnectionStore.getState().closeConnection('session-1')

    // Connection should NOT have been closed
    expect(useConnectionStore.getState().activeConnections['session-1']).toBeDefined()
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('unsaved changes in non-active query results')
    )

    confirmSpy.mockRestore()
  })

  it('proceeds with close when user confirms dirty non-active result prompt', async () => {
    setupActiveConnection()

    const tabId = useWorkspaceStore.getState().openQueryTab('session-1')

    useQueryStore.setState({
      tabs: {
        [tabId]: {
          content: 'SELECT 1; SELECT 2',
          selectedText: '',
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: 'session-1',
          results: [
            resultState({ resultStatus: 'success', queryId: 'q1' }),
            resultState({
              resultStatus: 'success',
              queryId: 'q2',
              editState: {
                rowKey: { id: 1 },
                originalValues: { name: 'Alice' },
                currentValues: { name: 'Bob' },
                modifiedColumns: new Set(['name']),
                isNewRow: false,
              },
              editingRowIndex: 0,
            }),
          ],
          activeResultIndex: 0,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
          runExport: null,
          activeBottomPanelItem: { type: 'result' },
        },
      },
    })

    // Mock confirm to accept
    const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true)

    await useConnectionStore.getState().closeConnection('session-1')

    // Connection should have been closed
    expect(useConnectionStore.getState().activeConnections['session-1']).toBeUndefined()
    expect(confirmSpy).toHaveBeenCalled()

    confirmSpy.mockRestore()
  })

  it('does not prompt when only the active result is dirty (saves it instead)', async () => {
    setupActiveConnection()

    const tabId = useWorkspaceStore.getState().openQueryTab('session-1')

    // Set up query store with dirty ACTIVE result with no actual modifications
    // (empty modifiedColumns means save is a no-op)
    useQueryStore.setState({
      tabs: {
        [tabId]: {
          content: 'SELECT 1',
          selectedText: '',
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: 'session-1',
          results: [
            resultState({
              resultStatus: 'success',
              queryId: 'q1',
              editState: {
                rowKey: { id: 1 },
                originalValues: { name: 'Alice' },
                currentValues: { name: 'Alice' },
                modifiedColumns: new Set<string>(),
                isNewRow: false,
              },
              editingRowIndex: 0,
              editConnectionId: 'session-1',
            }),
          ],
          activeResultIndex: 0,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
          runExport: null,
          activeBottomPanelItem: { type: 'result' },
        },
      },
    })

    // No confirm needed
    const confirmSpy = vi.spyOn(globalThis, 'confirm')

    await useConnectionStore.getState().closeConnection('session-1')

    // Connection should have been closed (save succeeded — no modifications)
    expect(useConnectionStore.getState().activeConnections['session-1']).toBeUndefined()
    // confirm should NOT have been called
    expect(confirmSpy).not.toHaveBeenCalled()

    confirmSpy.mockRestore()
  })

  it('saves active dirty result even when non-active dirty results also exist', async () => {
    setupActiveConnection()

    const tabId = useWorkspaceStore.getState().openQueryTab('session-1')

    // Both active (index 0) and non-active (index 1) are dirty
    useQueryStore.setState({
      tabs: {
        [tabId]: {
          content: 'SELECT 1; SELECT 2',
          selectedText: '',
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: 'session-1',
          results: [
            resultState({
              resultStatus: 'success',
              queryId: 'q1',
              editMode: 'users',
              editConnectionId: 'session-1',
              editState: {
                rowKey: { id: 1 },
                originalValues: { name: 'Alice' },
                currentValues: { name: 'Modified' },
                modifiedColumns: new Set(['name']),
                isNewRow: false,
              },
              editingRowIndex: 0,
            }),
            resultState({
              resultStatus: 'success',
              queryId: 'q2',
              editState: {
                rowKey: { id: 2 },
                originalValues: { email: 'a@b.com' },
                currentValues: { email: 'x@y.com' },
                modifiedColumns: new Set(['email']),
                isNewRow: false,
              },
              editingRowIndex: 0,
            }),
          ],
          activeResultIndex: 0,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
          runExport: null,
          activeBottomPanelItem: { type: 'result' },
        },
      },
    })

    // User confirms losing non-active dirty results
    const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true)

    // Mock saveCurrentRow to succeed (avoids needing full edit metadata)
    const saveCurrentRowSpy = vi
      .spyOn(useQueryStore.getState(), 'saveCurrentRow')
      .mockResolvedValue(true)

    await useConnectionStore.getState().closeConnection('session-1')

    // confirm should have been called for the non-active dirty result
    expect(confirmSpy).toHaveBeenCalled()
    // saveCurrentRow should ALSO have been called for the active dirty result
    expect(saveCurrentRowSpy).toHaveBeenCalledWith(querySurfaceRef(tabId, 0))
    // Connection should have been closed
    expect(useConnectionStore.getState().activeConnections['session-1']).toBeUndefined()

    confirmSpy.mockRestore()
    saveCurrentRowSpy.mockRestore()
  })
})

describe('useConnectionStore — attachExistingConnection', () => {
  it('hydrates an existing runtime session without opening a new pool', async () => {
    const profile = makeActiveConnection('unused', 'profile-1', 'Existing Connection').profile
    useConnectionStore.setState({ savedConnections: [profile] })

    const attached = useConnectionStore.getState().attachExistingConnection({
      sessionId: 'session-existing',
      profileId: 'profile-1',
      status: 'reconnecting',
      serverVersion: '8.0.36',
      sessionDatabase: 'reporting',
    })

    expect(attached).toBe(true)
    expect(ipc.calls('open_connection')).toEqual([])
    expect(useConnectionStore.getState().activeConnections['session-existing']).toMatchObject({
      status: 'reconnecting',
      serverVersion: '8.0.36',
      sessionDatabase: 'reporting',
      profile: { id: 'profile-1' },
    })
    expect(
      useWorkspaceStore.getState().tabsByConnection['session-existing'].map((tab) => tab.type)
    ).toEqual(['history', 'processlist'])
  })

  it('leaves an unknown saved profile unattached', () => {
    expect(
      useConnectionStore.getState().attachExistingConnection({
        sessionId: 'orphan-session',
        profileId: 'missing-profile',
        status: 'connected',
        serverVersion: '8.0.36',
        sessionDatabase: null,
      })
    ).toBe(false)
    expect(useConnectionStore.getState().activeConnections).toEqual({})
  })
})

describe('useConnectionStore — Process List integration', () => {
  function setupActiveConnection() {
    useConnectionStore.setState({
      activeConnections: {
        'session-1': {
          id: 'session-1',
          profile: {
            id: 'profile-1',
            name: 'Test connection',
            host: 'localhost',
            port: 3306,
            username: 'root',
            hasPassword: true,
            defaultDatabase: 'testdb',
            sslMode: 'disabled',
            lastConnectedAt: null,
            sslCaPath: null,
            sslCertPath: null,
            sslKeyPath: null,
            color: null,
            groupId: null,
            readOnly: false,
            sortOrder: 0,
            connectTimeoutSecs: 10,
            keepaliveIntervalSecs: 60,
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
          sessionDatabase: 'testdb',
          status: 'connected',
          serverVersion: '8.0.0',
        },
      },
      activeTabId: 'session-1',
    })
  }

  it('closeConnection resets processlist store state', async () => {
    setupActiveConnection()
    // Open processlist tab and set some state
    useWorkspaceStore.getState().openProcessListTab('session-1')

    const { useProcessListStore } = await import('../../stores/processlist-store')
    useProcessListStore.setState({
      rowsByConnection: {
        'session-1': [
          {
            id: 1,
            user: 'root',
            host: 'localhost',
            db: 'test',
            command: 'Query',
            time: 10,
            state: 'executing',
            info: 'SELECT 1',
          },
        ],
      },
      selectedIdsByConnection: { 'session-1': new Set([1]) },
    })

    await useConnectionStore.getState().closeConnection('session-1')

    expect(useProcessListStore.getState().rowsByConnection['session-1']).toBeUndefined()
    expect(useProcessListStore.getState().selectedIdsByConnection['session-1']).toBeUndefined()
  })
})

describe('useConnectionStore — openConnection creates default workspace tabs', () => {
  it('opens History, Process list and one blank, active query tab', async () => {
    // Set up a saved connection profile
    useConnectionStore.setState({
      savedConnections: [
        {
          id: 'profile-1',
          name: 'Test connection',
          host: 'localhost',
          port: 3306,
          username: 'root',
          hasPassword: true,
          defaultDatabase: 'testdb',
          sslMode: 'disabled',
          lastConnectedAt: null,
          sslCaPath: null,
          sslCertPath: null,
          sslKeyPath: null,
          color: null,
          groupId: null,
          readOnly: false,
          sortOrder: 0,
          connectTimeoutSecs: 10,
          keepaliveIntervalSecs: 60,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ],
    })

    ipc.override('open_connection', () => ({ sessionId: 'session-1', serverVersion: '8.0.0' }))

    await useConnectionStore.getState().openConnection('profile-1')

    const tabs = useWorkspaceStore.getState().tabsByConnection['session-1']
    expect(tabs).toBeDefined()
    expect(tabs!.map((tab) => tab.type)).toEqual(['history', 'processlist', 'query-editor'])
    expect(useWorkspaceStore.getState().activeTabByConnection['session-1']).toBe(tabs![2].id)
  })

  it('skips the blank query tab when asked not to open one', async () => {
    useConnectionStore.setState({
      savedConnections: [makeActiveConnection('session-1', 'profile-1', 'Test connection').profile],
    })
    ipc.override('open_connection', () => ({ sessionId: 'session-1', serverVersion: '8.0.0' }))

    await useConnectionStore.getState().openConnection('profile-1', { openQueryTab: false })

    const tabs = useWorkspaceStore.getState().tabsByConnection['session-1']
    expect(tabs!.map((tab) => tab.type)).toEqual(['history', 'processlist'])
  })
})

describe('useConnectionStore — explicit active connection order lifecycle', () => {
  it('removes closed sessions from explicit order and activates next by order', async () => {
    useConnectionStore.setState({
      activeConnections: {
        'session-1': {
          id: 'session-1',
          profile: {
            id: 'profile-1',
            name: 'A',
            host: 'localhost',
            port: 3306,
            username: 'root',
            hasPassword: true,
            defaultDatabase: 'testdb',
            sslMode: 'disabled',
            lastConnectedAt: null,
            sslCaPath: null,
            sslCertPath: null,
            sslKeyPath: null,
            color: null,
            groupId: null,
            readOnly: false,
            sortOrder: 0,
            connectTimeoutSecs: 10,
            keepaliveIntervalSecs: 60,
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
          sessionDatabase: 'testdb',
          status: 'connected',
          serverVersion: '8.0.0',
        },
        'session-2': {
          id: 'session-2',
          profile: {
            id: 'profile-2',
            name: 'B',
            host: 'localhost',
            port: 3306,
            username: 'root',
            hasPassword: true,
            defaultDatabase: 'testdb',
            sslMode: 'disabled',
            lastConnectedAt: null,
            sslCaPath: null,
            sslCertPath: null,
            sslKeyPath: null,
            color: null,
            groupId: null,
            readOnly: false,
            sortOrder: 0,
            connectTimeoutSecs: 10,
            keepaliveIntervalSecs: 60,
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
          sessionDatabase: 'testdb',
          status: 'connected',
          serverVersion: '8.0.0',
        },
      },
      activeConnectionOrder: ['session-2', 'session-1'],
      activeTabId: 'session-2',
    })

    await useConnectionStore.getState().closeConnection('session-2')

    expect(useConnectionStore.getState().activeConnectionOrder).toEqual(['session-1'])
    expect(useConnectionStore.getState().activeTabId).toBe('session-1')
  })

  it('reorders active sessions by insert index', () => {
    useConnectionStore.setState({
      activeConnections: {
        'session-1': {
          id: 'session-1',
          profile: {
            id: 'profile-1',
            name: 'A',
            host: 'localhost',
            port: 3306,
            username: 'root',
            hasPassword: true,
            defaultDatabase: 'testdb',
            sslMode: 'disabled',
            lastConnectedAt: null,
            sslCaPath: null,
            sslCertPath: null,
            sslKeyPath: null,
            color: null,
            groupId: null,
            readOnly: false,
            sortOrder: 0,
            connectTimeoutSecs: 10,
            keepaliveIntervalSecs: 60,
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
          sessionDatabase: 'testdb',
          status: 'connected',
          serverVersion: '8.0.0',
        },
        'session-2': {
          id: 'session-2',
          profile: {
            id: 'profile-2',
            name: 'B',
            host: 'localhost',
            port: 3306,
            username: 'root',
            hasPassword: true,
            defaultDatabase: 'testdb',
            sslMode: 'disabled',
            lastConnectedAt: null,
            sslCaPath: null,
            sslCertPath: null,
            sslKeyPath: null,
            color: null,
            groupId: null,
            readOnly: false,
            sortOrder: 0,
            connectTimeoutSecs: 10,
            keepaliveIntervalSecs: 60,
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
          sessionDatabase: 'testdb',
          status: 'connected',
          serverVersion: '8.0.0',
        },
      },
      activeConnectionOrder: ['session-1', 'session-2'],
      activeTabId: 'session-1',
    })

    useConnectionStore.getState().reorderActiveConnection('session-2', 0)

    expect(useConnectionStore.getState().activeConnectionOrder).toEqual(['session-2', 'session-1'])
    expect(useConnectionStore.getState().activeTabId).toBe('session-1')
  })
})

describe('useConnectionStore — closeAllConnections', () => {
  it('closes every active connection and leaves no residual workspace tabs', async () => {
    useConnectionStore.setState({
      activeConnections: {
        'session-1': makeActiveConnection('session-1', 'profile-1', 'A'),
        'session-2': makeActiveConnection('session-2', 'profile-2', 'B'),
      },
      activeConnectionOrder: ['session-1', 'session-2'],
      activeTabId: 'session-1',
    })
    useWorkspaceStore.getState().openQueryTab('session-1')
    useWorkspaceStore.getState().openQueryTab('session-2')

    await useConnectionStore.getState().closeAllConnections()

    const state = useConnectionStore.getState()
    expect(state.activeConnections).toEqual({})
    expect(state.activeConnectionOrder).toEqual([])
    expect(state.activeTabId).toBeNull()
    expect(useWorkspaceStore.getState().tabsByConnection['session-1']).toBeUndefined()
    expect(useWorkspaceStore.getState().tabsByConnection['session-2']).toBeUndefined()
  })

  it('reports failure when not every targeted connection closes', async () => {
    useConnectionStore.setState({
      activeConnections: {
        'session-1': makeActiveConnection('session-1', 'profile-1', 'A'),
        'session-2': makeActiveConnection('session-2', 'profile-2', 'B'),
      },
      activeConnectionOrder: ['session-1', 'session-2'],
      activeTabId: 'session-1',
    })

    const originalCloseConnection = useConnectionStore.getState().closeConnection
    const closeConnectionSpy = vi
      .fn(originalCloseConnection)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    useConnectionStore.setState({
      closeConnection: closeConnectionSpy,
    })

    const allClosed = await useConnectionStore.getState().closeAllConnections({ force: true })

    expect(allClosed).toBe(false)
    expect(closeConnectionSpy).toHaveBeenNthCalledWith(1, 'session-1', { force: true })
    expect(closeConnectionSpy).toHaveBeenNthCalledWith(2, 'session-2', { force: true })
  })
})

describe('useConnectionStore — force close', () => {
  it('closes without prompting via globalThis.confirm even with dirty edits', async () => {
    useConnectionStore.setState({
      activeConnections: {
        'session-1': makeActiveConnection('session-1', 'profile-1', 'A'),
      },
      activeConnectionOrder: ['session-1'],
      activeTabId: 'session-1',
    })

    const tabId = useWorkspaceStore.getState().openQueryTab('session-1')
    useQueryStore.setState({
      tabs: {
        [tabId]: {
          content: 'SELECT 1; SELECT 2',
          selectedText: '',
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: 'session-1',
          results: [dirtyQueryResult('q1'), dirtyQueryResult('q2')],
          activeResultIndex: 0,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
          runExport: null,
          activeBottomPanelItem: { type: 'result' },
        },
      },
    })

    const confirmSpy = vi.spyOn(globalThis, 'confirm')
    const saveCurrentRowSpy = vi.spyOn(useQueryStore.getState(), 'saveCurrentRow')

    await useConnectionStore.getState().closeConnection('session-1', { force: true })

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(saveCurrentRowSpy).not.toHaveBeenCalled()
    expect(useConnectionStore.getState().activeConnections['session-1']).toBeUndefined()

    confirmSpy.mockRestore()
    saveCurrentRowSpy.mockRestore()
  })
})

describe('useConnectionStore — connectionsWithUnsavedEdits', () => {
  it('returns nothing when no edits are pending', () => {
    useConnectionStore.setState({
      activeConnections: {
        'session-1': makeActiveConnection('session-1', 'profile-1', 'A'),
      },
      activeConnectionOrder: ['session-1'],
      activeTabId: 'session-1',
    })
    useWorkspaceStore.getState().openQueryTab('session-1')

    expect(useConnectionStore.getState().connectionsWithUnsavedEdits()).toEqual([])
  })

  it('identifies a connection with a dirty query-result tab', () => {
    useConnectionStore.setState({
      activeConnections: {
        'session-1': makeActiveConnection('session-1', 'profile-1', 'A'),
      },
      activeConnectionOrder: ['session-1'],
      activeTabId: 'session-1',
    })
    const tabId = useWorkspaceStore.getState().openQueryTab('session-1')
    useQueryStore.setState({
      tabs: {
        [tabId]: {
          content: 'SELECT 1',
          selectedText: '',
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: 'session-1',
          results: [dirtyQueryResult('q1')],
          activeResultIndex: 0,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
          runExport: null,
          activeBottomPanelItem: { type: 'result' },
        },
      },
    })

    expect(useConnectionStore.getState().connectionsWithUnsavedEdits()).toEqual(['session-1'])
  })

  it('identifies a connection with a dirty table-data tab', () => {
    useConnectionStore.setState({
      activeConnections: {
        'session-1': makeActiveConnection('session-1', 'profile-1', 'A'),
      },
      activeConnectionOrder: ['session-1'],
      activeTabId: 'session-1',
    })
    const tabId = useWorkspaceStore.getState().restoreTableDataTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'session-1',
      databaseName: 'testdb',
      objectName: 'users',
      objectType: 'table',
    })
    useTableDataStore.setState({
      tabs: {
        [tabId]: makeTableDataTabState({
          view: {
            edit: {
              rowIndex: 0,
              state: {
                rowKey: { id: 1 },
                originalValues: { name: 'Alice' },
                currentValues: { name: 'Bob' },
                modifiedColumns: new Set(['name']),
                isNewRow: false,
              },
            },
          },
        }),
      },
    })

    expect(useConnectionStore.getState().connectionsWithUnsavedEdits()).toEqual(['session-1'])
  })

  it('identifies a connection with a dirty object-editor tab', () => {
    useConnectionStore.setState({
      activeConnections: {
        'session-1': makeActiveConnection('session-1', 'profile-1', 'A'),
      },
      activeConnectionOrder: ['session-1'],
      activeTabId: 'session-1',
    })
    useWorkspaceStore.setState((state) => ({
      tabsByConnection: {
        ...state.tabsByConnection,
        'session-1': [
          {
            id: 'oe-tab-1',
            type: 'object-editor',
            label: 'my_view',
            connectionId: 'session-1',
            databaseName: 'testdb',
            objectName: 'my_view',
            objectType: 'view',
            mode: 'alter',
          },
        ],
      },
    }))
    useObjectEditorStore.setState({
      tabs: {
        'oe-tab-1': {
          connectionId: 'session-1',
          database: 'testdb',
          objectName: 'my_view',
          objectType: 'view',
          mode: 'alter',
          content: 'SELECT 2',
          originalContent: 'SELECT 1',
          isLoading: false,
          isSaving: false,
          error: null,
          pendingNavigationAction: null,
          savedObjectName: null,
        },
      },
    })

    expect(useConnectionStore.getState().connectionsWithUnsavedEdits()).toEqual(['session-1'])
  })
})

describe('isConnectionOfProfile', () => {
  it('matches a session to the profile it was opened from', () => {
    const connection = makeActiveConnection('session-1', 'profile-1', 'Local')
    expect(isConnectionOfProfile(connection, 'profile-1')).toBe(true)
    expect(isConnectionOfProfile(connection, 'profile-2')).toBe(false)
  })
})

describe('connection store sessions', () => {
  // --- Test fixtures ---

  const mockSavedConnection: SavedConnection = {
    id: 'conn-1',
    name: 'Test DB',
    host: 'localhost',
    port: 3306,
    username: 'root',
    hasPassword: true,
    defaultDatabase: 'mydb',
    sslMode: 'disabled',
    lastConnectedAt: null,
    sslCaPath: null,
    sslCertPath: null,
    sslKeyPath: null,
    color: null,
    groupId: null,
    readOnly: false,
    sortOrder: 0,
    connectTimeoutSecs: 10,
    keepaliveIntervalSecs: 60,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  }

  const mockSavedConnection2: SavedConnection = {
    ...mockSavedConnection,
    id: 'conn-2',
    name: 'Staging DB',
  }

  const mockGroup: ConnectionGroup = {
    id: 'grp-1',
    name: 'Production',
    parentId: null,
    sortOrder: 0,
    createdAt: '2025-01-01T00:00:00Z',
    color: null,
  }

  // --- Reset store between tests ---

  beforeEach(() => {
    useConnectionStore.setState({
      savedConnections: [],
      connectionGroups: [],
      activeConnections: {},
      activeConnectionOrder: [],
      activeTabId: null,
      error: null,
    })
    resetWorkspaceStore()
    useToastStore.setState({ toasts: [] })
    _resetToastTimeoutsForTests()
    _resetListenersSetup()
    const tauriInternals = (
      window as unknown as Window & {
        __TAURI_INTERNALS__?: {
          transformCallback?: (cb: unknown, once?: boolean) => string
        }
      }
    ).__TAURI_INTERNALS__
    if (!tauriInternals?.transformCallback) {
      ;(
        window as unknown as Window & {
          __TAURI_INTERNALS__?: {
            transformCallback?: (cb: unknown, once?: boolean) => string
          }
        }
      ).__TAURI_INTERNALS__ = {
        ...tauriInternals,
        transformCallback: () => 'mock-callback-id',
      }
    }
  })

  // --- Tests ---

  describe('useConnectionStore — initial state', () => {
    it('has correct initial state', () => {
      const state = useConnectionStore.getState()
      expect(state.savedConnections).toEqual([])
      expect(state.connectionGroups).toEqual([])
      expect(state.activeConnections).toEqual({})
      expect(state.activeConnectionOrder).toEqual([])
      expect(state.activeTabId).toBeNull()
      expect(state.error).toBeNull()
    })
  })

  describe('useConnectionStore — fetchSavedConnections', () => {
    it('loads connections and groups from backend', async () => {
      ipc.override('list_connections', () => [mockSavedConnection])
      ipc.override('list_connection_groups', () => [mockGroup])

      await useConnectionStore.getState().fetchSavedConnections()

      const state = useConnectionStore.getState()
      expect(state.savedConnections).toEqual([mockSavedConnection])
      expect(state.connectionGroups).toEqual([mockGroup])
      expect(state.error).toBeNull()
    })

    it('sets error on IPC failure', async () => {
      ipc.override('list_connections', () => {
        throw new Error('Database error')
      })

      await useConnectionStore.getState().fetchSavedConnections()

      const state = useConnectionStore.getState()
      expect(state.error).toBe('Database error')
    })

    it('clears previous error on success', async () => {
      useConnectionStore.setState({ error: 'previous error' })
      ipc.override('list_connections', () => [])
      ipc.override('list_connection_groups', () => [])

      await useConnectionStore.getState().fetchSavedConnections()
      expect(useConnectionStore.getState().error).toBeNull()
    })
  })

  describe('useConnectionStore — openConnection', () => {
    it('adds to activeConnections and sets activeTabId', async () => {
      useConnectionStore.setState({ savedConnections: [mockSavedConnection] })
      ipc.override('open_connection', () => ({
        sessionId: 'sess-1',
        serverVersion: '8.0.35',
        lastConnectedAt: null,
      }))

      await useConnectionStore.getState().openConnection('conn-1')

      const state = useConnectionStore.getState()
      expect(state.activeConnections['sess-1']).toEqual({
        id: 'sess-1',
        profile: mockSavedConnection,
        sessionDatabase: mockSavedConnection.defaultDatabase,
        status: 'connected',
        serverVersion: '8.0.35',
      })
      expect(state.activeTabId).toBe('sess-1')
      expect(state.activeConnectionOrder).toEqual(['sess-1'])
      expect(state.error).toBeNull()
    })

    it('opens multiple sessions for the same saved profile', async () => {
      useConnectionStore.setState({ savedConnections: [mockSavedConnection] })
      let n = 0
      ipc.override('open_connection', () => {
        n += 1
        return { sessionId: `sess-${n}`, serverVersion: '8.0.35' }
      })

      await useConnectionStore.getState().openConnection('conn-1')
      await useConnectionStore.getState().openConnection('conn-1')

      const state = useConnectionStore.getState()
      expect(Object.keys(state.activeConnections).sort()).toEqual(['sess-1', 'sess-2'])
      expect(state.activeConnections['sess-1'].profile.id).toBe('conn-1')
      expect(state.activeConnections['sess-2'].profile.id).toBe('conn-1')
      expect(state.activeTabId).toBe('sess-2')
      expect(state.activeConnectionOrder).toEqual(['sess-1', 'sess-2'])
    })

    it('sets error when profile not found in savedConnections', async () => {
      useConnectionStore.setState({ savedConnections: [] })

      await expect(useConnectionStore.getState().openConnection('missing-id')).rejects.toThrow(
        "Connection profile 'missing-id' not found"
      )

      const state = useConnectionStore.getState()
      expect(state.error).toBe("Connection profile 'missing-id' not found")
      expect(state.activeConnections).toEqual({})
    })

    it('sets error on IPC failure', async () => {
      useConnectionStore.setState({ savedConnections: [mockSavedConnection] })
      ipc.override('open_connection', () => {
        throw new Error('Connection refused')
      })

      await expect(useConnectionStore.getState().openConnection('conn-1')).rejects.toThrow(
        'Connection refused'
      )

      const state = useConnectionStore.getState()
      expect(state.error).toBe('Connection refused')
      expect(state.activeConnections).toEqual({})
    })
  })

  describe('useConnectionStore — closeConnection', () => {
    it('removes from activeConnections', async () => {
      useConnectionStore.setState({
        activeConnections: {
          'sess-1': {
            id: 'sess-1',
            profile: mockSavedConnection,
            status: 'connected',
            serverVersion: '8.0.35',
          },
        },
        activeConnectionOrder: ['sess-1'],
        activeTabId: 'sess-1',
      })
      ipc.override('close_connection', () => null)

      await useConnectionStore.getState().closeConnection('sess-1')

      const state = useConnectionStore.getState()
      expect(state.activeConnections).toEqual({})
    })

    it('switches activeTabId to another connection when closing active tab', async () => {
      useConnectionStore.setState({
        activeConnections: {
          'sess-1': {
            id: 'sess-1',
            profile: mockSavedConnection,
            status: 'connected',
            serverVersion: '8.0.35',
          },
          'sess-2': {
            id: 'sess-2',
            profile: mockSavedConnection2,
            status: 'connected',
            serverVersion: '8.0.35',
          },
        },
        activeConnectionOrder: ['sess-1', 'sess-2'],
        activeTabId: 'sess-1',
      })
      ipc.override('close_connection', () => null)

      await useConnectionStore.getState().closeConnection('sess-1')

      const state = useConnectionStore.getState()
      expect(state.activeTabId).toBe('sess-2')
    })

    it('sets activeTabId to null when closing the last connection', async () => {
      useConnectionStore.setState({
        activeConnections: {
          'sess-1': {
            id: 'sess-1',
            profile: mockSavedConnection,
            status: 'connected',
            serverVersion: '8.0.35',
          },
        },
        activeConnectionOrder: ['sess-1'],
        activeTabId: 'sess-1',
      })
      ipc.override('close_connection', () => null)

      await useConnectionStore.getState().closeConnection('sess-1')

      const state = useConnectionStore.getState()
      expect(state.activeTabId).toBeNull()
    })

    it('does not change activeTabId when closing a non-active tab', async () => {
      useConnectionStore.setState({
        activeConnections: {
          'sess-1': {
            id: 'sess-1',
            profile: mockSavedConnection,
            status: 'connected',
            serverVersion: '8.0.35',
          },
          'sess-2': {
            id: 'sess-2',
            profile: mockSavedConnection2,
            status: 'connected',
            serverVersion: '8.0.35',
          },
        },
        activeConnectionOrder: ['sess-1', 'sess-2'],
        activeTabId: 'sess-1',
      })
      ipc.override('close_connection', () => null)

      await useConnectionStore.getState().closeConnection('sess-2')

      const state = useConnectionStore.getState()
      expect(state.activeTabId).toBe('sess-1')
    })

    it('sets error on IPC failure', async () => {
      useConnectionStore.setState({
        activeConnections: {
          'sess-1': {
            id: 'sess-1',
            profile: mockSavedConnection,
            status: 'connected',
            serverVersion: '8.0.35',
          },
        },
        activeConnectionOrder: ['sess-1'],
        activeTabId: 'sess-1',
      })
      ipc.override('close_connection', () => {
        throw new Error('Close failed')
      })

      await useConnectionStore.getState().closeConnection('sess-1')

      const state = useConnectionStore.getState()
      expect(state.error).toBe('Close failed')
      // Connection should still be in activeConnections since IPC failed
      expect(state.activeConnections['sess-1']).toBeDefined()
    })
  })

  describe('useConnectionStore — switchTab', () => {
    it('sets activeTabId', () => {
      useConnectionStore.getState().switchTab('sess-2')
      expect(useConnectionStore.getState().activeTabId).toBe('sess-2')
    })

    it('marks the switched-to session as the globally visible workspace', () => {
      useConnectionStore.getState().switchTab('sess-2')
      expect(useWorkspaceStore.getState().visibleConnectionSessionId).toBe('sess-2')
    })
  })

  describe('useConnectionStore — visible workspace coordination', () => {
    it('marks a newly opened session as the globally visible workspace', async () => {
      useConnectionStore.setState({ savedConnections: [mockSavedConnection] })
      ipc.override('open_connection', () => ({ sessionId: 'sess-1', serverVersion: '8.0.35' }))

      await useConnectionStore.getState().openConnection('conn-1')

      expect(useWorkspaceStore.getState().visibleConnectionSessionId).toBe('sess-1')
    })

    it('moves visibility to the most recently opened session', async () => {
      useConnectionStore.setState({ savedConnections: [mockSavedConnection] })
      let n = 0
      ipc.override('open_connection', () => {
        n += 1
        return { sessionId: `sess-${n}`, serverVersion: '8.0.35' }
      })

      await useConnectionStore.getState().openConnection('conn-1')
      await useConnectionStore.getState().openConnection('conn-1')

      expect(useWorkspaceStore.getState().visibleConnectionSessionId).toBe('sess-2')
    })

    it('reveals the fallback session as visible when closing the active session', async () => {
      useConnectionStore.setState({
        activeConnections: {
          'sess-1': {
            id: 'sess-1',
            profile: mockSavedConnection,
            status: 'connected',
            serverVersion: '8.0.35',
          },
          'sess-2': {
            id: 'sess-2',
            profile: mockSavedConnection2,
            status: 'connected',
            serverVersion: '8.0.35',
          },
        },
        activeConnectionOrder: ['sess-1', 'sess-2'],
        activeTabId: 'sess-1',
      })
      seedVisibleConnection('sess-1')
      ipc.override('close_connection', () => null)

      await useConnectionStore.getState().closeConnection('sess-1')

      expect(useConnectionStore.getState().activeTabId).toBe('sess-2')
      expect(useWorkspaceStore.getState().visibleConnectionSessionId).toBe('sess-2')
    })

    it('clears the visible workspace when closing the last session', async () => {
      useConnectionStore.setState({
        activeConnections: {
          'sess-1': {
            id: 'sess-1',
            profile: mockSavedConnection,
            status: 'connected',
            serverVersion: '8.0.35',
          },
        },
        activeConnectionOrder: ['sess-1'],
        activeTabId: 'sess-1',
      })
      seedVisibleConnection('sess-1')
      ipc.override('close_connection', () => null)

      await useConnectionStore.getState().closeConnection('sess-1')

      expect(useConnectionStore.getState().activeTabId).toBeNull()
      expect(useWorkspaceStore.getState().visibleConnectionSessionId).toBe('')
    })

    it('does not change the visible workspace when closing a background session', async () => {
      useConnectionStore.setState({
        activeConnections: {
          'sess-1': {
            id: 'sess-1',
            profile: mockSavedConnection,
            status: 'connected',
            serverVersion: '8.0.35',
          },
          'sess-2': {
            id: 'sess-2',
            profile: mockSavedConnection2,
            status: 'connected',
            serverVersion: '8.0.35',
          },
        },
        activeConnectionOrder: ['sess-1', 'sess-2'],
        activeTabId: 'sess-1',
      })
      seedVisibleConnection('sess-1')
      ipc.override('close_connection', () => null)

      await useConnectionStore.getState().closeConnection('sess-2')

      expect(useConnectionStore.getState().activeTabId).toBe('sess-1')
      expect(useWorkspaceStore.getState().visibleConnectionSessionId).toBe('sess-1')
    })
  })

  describe('useConnectionStore — active connection order normalization', () => {
    it('normalizes missing order values and renders every active session once', () => {
      useConnectionStore.setState({
        activeConnections: {
          'sess-1': {
            id: 'sess-1',
            profile: mockSavedConnection,
            status: 'connected',
            serverVersion: '8.0.35',
          },
          'sess-2': {
            id: 'sess-2',
            profile: mockSavedConnection2,
            status: 'connected',
            serverVersion: '8.0.35',
          },
        },
        activeConnectionOrder: [],
      })

      useConnectionStore.getState().normalizeActiveConnectionOrder()

      expect(useConnectionStore.getState().activeConnectionOrder).toEqual(['sess-1', 'sess-2'])
    })

    it('drops stale and duplicate ids during normalization', () => {
      useConnectionStore.setState({
        activeConnections: {
          'sess-1': {
            id: 'sess-1',
            profile: mockSavedConnection,
            status: 'connected',
            serverVersion: '8.0.35',
          },
          'sess-2': {
            id: 'sess-2',
            profile: mockSavedConnection2,
            status: 'connected',
            serverVersion: '8.0.35',
          },
        },
        activeConnectionOrder: ['stale', 'sess-2', 'sess-2', 'sess-1'],
      })

      useConnectionStore.getState().normalizeActiveConnectionOrder()

      expect(useConnectionStore.getState().activeConnectionOrder).toEqual(['sess-2', 'sess-1'])
    })

    it('reorders without changing active selection', () => {
      useConnectionStore.setState({
        activeConnections: {
          'sess-1': {
            id: 'sess-1',
            profile: mockSavedConnection,
            status: 'connected',
            serverVersion: '8.0.35',
          },
          'sess-2': {
            id: 'sess-2',
            profile: mockSavedConnection2,
            status: 'connected',
            serverVersion: '8.0.35',
          },
        },
        activeConnectionOrder: ['sess-1', 'sess-2'],
        activeTabId: 'sess-1',
      })

      useConnectionStore.getState().reorderActiveConnection('sess-2', 0)

      expect(useConnectionStore.getState().activeConnectionOrder).toEqual(['sess-2', 'sess-1'])
      expect(useConnectionStore.getState().activeTabId).toBe('sess-1')
    })
  })

  describe('useConnectionStore — updateConnectionStatus', () => {
    it('updates the status of a matching active connection', () => {
      useConnectionStore.setState({
        activeConnections: {
          'sess-1': {
            id: 'sess-1',
            profile: mockSavedConnection,
            status: 'connected',
            serverVersion: '8.0.35',
          },
        },
      })

      useConnectionStore.getState().updateConnectionStatus({
        connectionId: 'sess-1',
        status: 'reconnecting',
      })

      expect(useConnectionStore.getState().activeConnections['sess-1'].status).toBe('reconnecting')
    })

    it('does nothing for unknown connection id', () => {
      useConnectionStore.setState({
        activeConnections: {
          'sess-1': {
            id: 'sess-1',
            profile: mockSavedConnection,
            status: 'connected',
            serverVersion: '8.0.35',
          },
        },
      })

      useConnectionStore.getState().updateConnectionStatus({
        connectionId: 'unknown-id',
        status: 'disconnected',
      })

      // sess-1 should be unchanged
      expect(useConnectionStore.getState().activeConnections['sess-1'].status).toBe('connected')
    })
  })

  describe('useConnectionStore — clearError', () => {
    it('sets error to null', () => {
      useConnectionStore.setState({ error: 'some error' })
      useConnectionStore.getState().clearError()
      expect(useConnectionStore.getState().error).toBeNull()
    })
  })

  describe('useConnectionStore — setupEventListeners', () => {
    it('returns an unlisten function', async () => {
      const unlisten = await useConnectionStore.getState().setupEventListeners()
      expect(unlisten).toEqual(expect.any(Function))
    })

    it('is idempotent — calling twice only registers once', async () => {
      await useConnectionStore.getState().setupEventListeners()

      const firstUnlisten = await useConnectionStore.getState().setupEventListeners()
      expect(firstUnlisten).toBeUndefined()
    })

    it('event handler calls updateConnectionStatus with event payload', async () => {
      // Set up an active connection so updateConnectionStatus has something to update
      useConnectionStore.setState({
        activeConnections: {
          'sess-1': {
            id: 'sess-1',
            profile: mockSavedConnection,
            status: 'connected',
            serverVersion: '8.0.35',
          },
        },
      })

      await useConnectionStore.getState().setupEventListeners()

      await ipc.emit('connection-status-changed', {
        connectionId: 'sess-1',
        status: 'disconnected',
        message: 'Lost connection',
      })

      expect(useConnectionStore.getState().activeConnections['sess-1'].status).toBe('disconnected')
    })
  })

  describe('useConnectionStore — updateDefaultDatabase', () => {
    it('updates defaultDatabase in-memory and persists via IPC', async () => {
      useConnectionStore.setState({
        savedConnections: [mockSavedConnection],
        activeConnections: {
          'sess-1': {
            id: 'sess-1',
            profile: mockSavedConnection,
            status: 'connected',
            serverVersion: '8.0.35',
          },
        },
      })
      ipc.override('update_connection', () => null)

      await useConnectionStore.getState().updateDefaultDatabase('sess-1', 'new_db')

      const state = useConnectionStore.getState()
      expect(state.activeConnections['sess-1'].profile.defaultDatabase).toBe('new_db')
      expect(state.savedConnections[0].defaultDatabase).toBe('new_db')
    })

    it('updates all active sessions sharing the same profile', async () => {
      useConnectionStore.setState({
        savedConnections: [mockSavedConnection],
        activeConnections: {
          'sess-1': {
            id: 'sess-1',
            profile: mockSavedConnection,
            status: 'connected',
            serverVersion: '8.0.35',
          },
          'sess-2': {
            id: 'sess-2',
            profile: mockSavedConnection,
            status: 'connected',
            serverVersion: '8.0.35',
          },
        },
      })
      ipc.override('update_connection', () => null)

      await useConnectionStore.getState().updateDefaultDatabase('sess-1', 'new_db')

      const state = useConnectionStore.getState()
      expect(state.activeConnections['sess-1'].profile.defaultDatabase).toBe('new_db')
      expect(state.activeConnections['sess-2'].profile.defaultDatabase).toBe('new_db')
    })

    it('reverts in-memory state when IPC persistence fails', async () => {
      useConnectionStore.setState({
        savedConnections: [mockSavedConnection],
        activeConnections: {
          'sess-1': {
            id: 'sess-1',
            profile: mockSavedConnection,
            status: 'connected',
            serverVersion: '8.0.35',
          },
        },
      })

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      ipc.override('update_connection', () => {
        throw new Error('IPC write failed')
      })

      await useConnectionStore.getState().updateDefaultDatabase('sess-1', 'new_db')

      // Should revert to the original default database
      const state = useConnectionStore.getState()
      expect(state.activeConnections['sess-1'].profile.defaultDatabase).toBe(
        mockSavedConnection.defaultDatabase
      )
      expect(state.savedConnections[0].defaultDatabase).toBe(mockSavedConnection.defaultDatabase)
      expect(consoleSpy).not.toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })

  describe('useConnectionStore — setActiveDatabase', () => {
    it('updates only the targeted active session and calls select_database IPC', async () => {
      useConnectionStore.setState({
        activeConnections: {
          'sess-1': {
            id: 'sess-1',
            profile: mockSavedConnection,
            status: 'connected',
            serverVersion: '8.0.35',
          },
          'sess-2': {
            id: 'sess-2',
            profile: mockSavedConnection,
            status: 'connected',
            serverVersion: '8.0.35',
          },
        },
      })

      const selectDatabaseSpy = vi.fn()
      ipc.override('select_database', () => {
        selectDatabaseSpy()
        return null
      })

      await useConnectionStore.getState().setActiveDatabase('sess-1', 'analytics_db')

      const state = useConnectionStore.getState()
      expect(state.activeConnections['sess-1'].sessionDatabase).toBe('analytics_db')
      expect(state.activeConnections['sess-1'].profile.defaultDatabase).toBe(
        mockSavedConnection.defaultDatabase
      )
      expect(state.activeConnections['sess-2'].sessionDatabase).toBeUndefined()
      expect(selectDatabaseSpy).toHaveBeenCalledTimes(1)
    })

    it('reverts the session database when select_database IPC fails', async () => {
      useConnectionStore.setState({
        activeConnections: {
          'sess-1': {
            id: 'sess-1',
            profile: mockSavedConnection,
            status: 'connected',
            serverVersion: '8.0.35',
          },
        },
      })

      ipc.override('select_database', () => {
        throw new Error('USE failed')
      })

      await useConnectionStore.getState().setActiveDatabase('sess-1', 'analytics_db')

      expect(useConnectionStore.getState().activeConnections['sess-1'].sessionDatabase).toBe(
        mockSavedConnection.defaultDatabase
      )
    })
  })

  // ---------------------------------------------------------------------------
  // closeConnection — aborts when save fails
  // ---------------------------------------------------------------------------

  describe('useConnectionStore — closeConnection aborts on failed save', () => {
    it('does not close connection when query-editor saveCurrentRow fails', async () => {
      const closeConnectionSpy = vi.fn()
      ipc.override('close_connection', () => {
        closeConnectionSpy()
        return null
      })

      // Set up active connection
      useConnectionStore.setState({
        activeConnections: {
          'sess-1': {
            id: 'sess-1',
            profile: mockSavedConnection,
            status: 'connected',
            serverVersion: '8.0.35',
          },
        },
        activeTabId: 'sess-1',
      })

      // Set up workspace tab
      seedVisibleConnection('sess-1')
      useWorkspaceStore.setState({
        tabsByConnection: {
          'sess-1': [
            { id: 'qt-1', type: 'query-editor', label: 'Query 1', connectionId: 'sess-1' },
          ],
        },
      })

      // Set up query store with pending edits that will fail to save
      useQueryStore.setState({
        tabs: {
          'qt-1': makeTabState({
            editMode: 'testdb.users',
            editConnectionId: 'sess-1',
            editingRowIndex: 0,
            editState: {
              rowKey: { id: 1 },
              originalValues: { id: 1, name: 'Alice' },
              currentValues: { id: 1, name: 'Changed' },
              modifiedColumns: new Set(['name']),
              isNewRow: false,
            },
            editTableMetadata: {
              'testdb.users': {
                database: 'testdb',
                table: 'users',
                columns: [],
                primaryKey: null, // No PK → save will fail
                foreignKeys: [],
              },
            },
          }),
        },
      })

      await useConnectionStore.getState().closeConnection('sess-1')

      // Connection should NOT have been closed
      expect(closeConnectionSpy).not.toHaveBeenCalled()
      expect(useConnectionStore.getState().activeConnections['sess-1']).toBeDefined()
      await expectToast('error', 'Connection not closed')
    })

    it('does not close connection when table-data saveCurrentRow fails', async () => {
      const closeConnectionSpy = vi.fn()
      ipc.override('close_connection', () => {
        closeConnectionSpy()
        return null
      })

      // Set up active connection
      useConnectionStore.setState({
        activeConnections: {
          'sess-1': {
            id: 'sess-1',
            profile: mockSavedConnection,
            status: 'connected',
            serverVersion: '8.0.35',
          },
        },
        activeTabId: 'sess-1',
      })

      // Set up workspace tab (table-data type)
      seedVisibleConnection('sess-1')
      useWorkspaceStore.setState({
        tabsByConnection: {
          'sess-1': [
            {
              id: 'td-1',
              type: 'table-data' as const,
              label: 'users',
              connectionId: 'sess-1',
              databaseName: 'testdb',
              objectName: 'users',
              objectType: 'table' as const,
            },
          ],
        },
      })

      ipc.override('update_table_row', () => {
        throw new Error('Lost connection to MySQL server')
      })
      const table = { connectionId: 'sess-1', database: 'testdb', table: 'users', isView: false }
      const meta = {
        columns: [
          makeTableColumnMeta({ name: 'id', dataType: 'INT', isPrimaryKey: true }),
          makeTableColumnMeta({ name: 'name', dataType: 'VARCHAR' }),
        ],
        primaryKey: { keyColumns: ['id'], hasAutoIncrement: false, isUniqueKeyFallback: false },
        foreignKeys: [],
      }
      useTableDataStore.setState({
        tabs: {
          'td-1': makeTableDataTabState(
            {
              meta: meta,
              view: {
                editTarget: tableEditTargetOf(table, meta),
                edit: {
                  rowIndex: 0,
                  state: {
                    rowKey: { id: 1 },
                    originalValues: { id: 1, name: 'Alice' },
                    currentValues: { id: 1, name: 'Changed' },
                    modifiedColumns: new Set(['name']),
                    isNewRow: false,
                  },
                },
              },
            },
            table
          ),
        },
      })

      await useConnectionStore.getState().closeConnection('sess-1')

      // Connection should NOT have been closed
      expect(closeConnectionSpy).not.toHaveBeenCalled()
      expect(useConnectionStore.getState().activeConnections['sess-1']).toBeDefined()
      await expectToast('error', 'Connection not closed')
    })

    it('proceeds with close when saveCurrentRow succeeds', async () => {
      ipc.override('close_connection', () => null)
      ipc.override('update_table_row', () => null)
      ipc.override('update_result_cell', () => null)
      ipc.override('evict_results', () => null)

      // Set up active connection
      useConnectionStore.setState({
        activeConnections: {
          'sess-1': {
            id: 'sess-1',
            profile: mockSavedConnection,
            status: 'connected',
            serverVersion: '8.0.35',
          },
        },
        activeTabId: 'sess-1',
      })

      // Set up workspace tab
      seedVisibleConnection('sess-1')
      useWorkspaceStore.setState({
        tabsByConnection: {
          'sess-1': [
            { id: 'qt-1', type: 'query-editor', label: 'Query 1', connectionId: 'sess-1' },
          ],
        },
      })

      // Set up query store with pending edits that will succeed
      useQueryStore.setState({
        tabs: {
          'qt-1': makeTabState({
            editMode: 'testdb.users',
            editConnectionId: 'sess-1',
            editingRowIndex: 0,
            columns: [
              { name: 'id', dataType: 'INT' },
              { name: 'name', dataType: 'VARCHAR' },
            ],
            rows: [[1, 'Alice']],
            rowLimit: 1000,
            editState: {
              rowKey: { id: 1 },
              originalValues: { id: 1, name: 'Alice' },
              currentValues: { id: 1, name: 'Updated' },
              modifiedColumns: new Set(['name']),
              isNewRow: false,
            },
            editTableMetadata: {
              'testdb.users': {
                database: 'testdb',
                table: 'users',
                columns: [],
                primaryKey: {
                  keyColumns: ['id'],
                  hasAutoIncrement: true,
                  isUniqueKeyFallback: false,
                },
                foreignKeys: [],
              },
            },
          }),
        },
      })

      await useConnectionStore.getState().closeConnection('sess-1')

      // Connection should have been closed
      expect(useConnectionStore.getState().activeConnections['sess-1']).toBeUndefined()
    })
  })
})
