/**
 * Tests for connection-store: close-connection guard with dirty non-active query results.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import { useConnectionStore, _resetListenersSetup } from '../../stores/connection-store'
import {
  useWorkspaceStore,
  _resetTabIdCounter,
  _resetQueryTabCounter,
} from '../../stores/workspace-store'
import { useQueryStore, DEFAULT_RESULT_STATE } from '../../stores/query-store'
import { useTableDataStore } from '../../stores/table-data-store'

beforeEach(() => {
  // Reset all stores
  useConnectionStore.setState({
    savedConnections: [],
    connectionGroups: [],
    activeConnections: {},
    activeTabId: null,
    dialogOpen: false,
    error: null,
  })
  useWorkspaceStore.setState({
    tabsByConnection: {},
    activeTabByConnection: {},
  })
  useQueryStore.setState({ tabs: {} })
  useTableDataStore.setState({ tabs: {} })
  _resetTabIdCounter()
  _resetQueryTabCounter()
  _resetListenersSetup()

  // Default IPC mock
  mockIPC((cmd) => {
    switch (cmd) {
      case 'close_connection':
        return null
      case 'evict_results':
        return null
      case 'log_frontend':
        return undefined
      default:
        return null
    }
  })
})

describe('useConnectionStore — closeConnection guard for dirty non-active query results', () => {
  function setupActiveConnection() {
    useConnectionStore.setState({
      activeConnections: {
        'session-1': {
          id: 'session-1',
          profile: {
            id: 'profile-1',
            name: 'Test Connection',
            host: 'localhost',
            port: 3306,
            username: 'root',
            hasPassword: true,
            defaultDatabase: 'testdb',
            sslEnabled: false,
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
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: 'session-1',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'q1',
            },
            {
              ...DEFAULT_RESULT_STATE,
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
            },
          ],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
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
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: 'session-1',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'q1',
            },
            {
              ...DEFAULT_RESULT_STATE,
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
            },
          ],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
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
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: 'session-1',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
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
            },
          ],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
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
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: 'session-1',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
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
            },
            {
              ...DEFAULT_RESULT_STATE,
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
            },
          ],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
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
    expect(saveCurrentRowSpy).toHaveBeenCalledWith(tabId)
    // Connection should have been closed
    expect(useConnectionStore.getState().activeConnections['session-1']).toBeUndefined()

    confirmSpy.mockRestore()
    saveCurrentRowSpy.mockRestore()
  })
})
