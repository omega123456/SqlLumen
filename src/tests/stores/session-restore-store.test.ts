/**
 * Tests for session-restore-store: save/restore session, isEnabled, error handling.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import { useSessionRestoreStore } from '../../stores/session-restore-store'
import { useConnectionStore, _resetListenersSetup } from '../../stores/connection-store'
import {
  useWorkspaceStore,
  _resetTabIdCounter,
  _resetQueryTabCounter,
} from '../../stores/workspace-store'
import { useQueryStore } from '../../stores/query-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useTableDataStore } from '../../stores/table-data-store'

function setupDefaultIpc() {
  mockIPC((cmd, args) => {
    const a = args as Record<string, unknown> | undefined
    switch (cmd) {
      case 'log_frontend':
        return undefined
      case 'get_all_settings':
        return {
          theme: 'system',
          'session.restore': 'true',
          'session.state': 'null',
        }
      case 'get_setting':
        return null
      case 'set_setting':
        return null
      case 'list_connections':
        return [
          {
            id: 'profile-1',
            name: 'Test MySQL',
            host: '127.0.0.1',
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
        ]
      case 'list_connection_groups':
        return []
      case 'open_connection':
        return { sessionId: `session-${a?.id ?? 'unknown'}`, serverVersion: '8.0.0' }
      case 'close_connection':
        return null
      case 'evict_results':
        return null
      case 'plugin:event|listen':
        return () => {}
      case 'plugin:event|unlisten':
        return undefined
      default:
        return null
    }
  })
}

beforeEach(() => {
  // Reset all stores
  useSessionRestoreStore.setState({
    isRestoring: false,
    restoreError: null,
  })
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
  useSettingsStore.setState({
    settings: { 'session.restore': 'true' },
    pendingChanges: {},
    isLoading: false,
    isDirty: false,
    activeSection: 'general',
  })
  _resetTabIdCounter()
  _resetQueryTabCounter()
  _resetListenersSetup()

  setupDefaultIpc()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useSessionRestoreStore — isEnabled', () => {
  it('returns true when session.restore setting is "true"', () => {
    useSettingsStore.setState({
      settings: { 'session.restore': 'true' },
      pendingChanges: {},
    })
    expect(useSessionRestoreStore.getState().isEnabled()).toBe(true)
  })

  it('returns false when session.restore setting is "false"', () => {
    useSettingsStore.setState({
      settings: { 'session.restore': 'false' },
      pendingChanges: {},
    })
    expect(useSessionRestoreStore.getState().isEnabled()).toBe(false)
  })

  it('returns true by default (SETTINGS_DEFAULTS fallback)', () => {
    // When settings are empty, getSetting falls back to SETTINGS_DEFAULTS
    useSettingsStore.setState({
      settings: {},
      pendingChanges: {},
    })
    expect(useSessionRestoreStore.getState().isEnabled()).toBe(true)
  })
})

describe('useSessionRestoreStore — saveSession', () => {
  it('serializes active connections and their tabs', async () => {
    let savedValue: string | null = null

    mockIPC((cmd, args) => {
      const a = args as Record<string, unknown> | undefined
      if (cmd === 'set_setting' && a?.key === 'session.state') {
        savedValue = a.value as string
        return null
      }
      if (cmd === 'log_frontend') return undefined
      return null
    })

    // Set up an active connection with a query tab
    useConnectionStore.setState({
      activeConnections: {
        'session-1': {
          id: 'session-1',
          profile: {
            id: 'profile-1',
            name: 'Test MySQL',
            host: '127.0.0.1',
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
    })

    const tabId = useWorkspaceStore.getState().openQueryTab('session-1', 'My Query')
    useQueryStore.getState().setContent(tabId, 'SELECT * FROM users')
    useQueryStore.getState().setCursorPosition(tabId, { lineNumber: 1, column: 10 })

    await useSessionRestoreStore.getState().saveSession()

    expect(savedValue).not.toBeNull()
    const parsed = JSON.parse(savedValue!)
    expect(parsed.version).toBe(1)
    expect(parsed.connections).toHaveLength(1)
    expect(parsed.connections[0].profileId).toBe('profile-1')
    expect(parsed.connections[0].tabs).toHaveLength(1)
    expect(parsed.connections[0].tabs[0].type).toBe('query-editor')
    expect(parsed.connections[0].tabs[0].sql).toBe('SELECT * FROM users')
    expect(parsed.connections[0].tabs[0].cursorLine).toBe(1)
    expect(parsed.connections[0].tabs[0].cursorColumn).toBe(10)
    expect(parsed.connections[0].tabs[0].label).toBe('My Query')
  })

  it('skips table-designer and object-editor tabs', async () => {
    let savedValue: string | null = null

    mockIPC((cmd, args) => {
      const a = args as Record<string, unknown> | undefined
      if (cmd === 'set_setting' && a?.key === 'session.state') {
        savedValue = a.value as string
        return null
      }
      if (cmd === 'log_frontend') return undefined
      return null
    })

    useConnectionStore.setState({
      activeConnections: {
        'session-1': {
          id: 'session-1',
          profile: {
            id: 'profile-1',
            name: 'Test MySQL',
            host: '127.0.0.1',
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
    })

    // Open a query tab (serializable) and a table-designer tab (not serializable)
    useWorkspaceStore.getState().openQueryTab('session-1', 'Query 1')
    useWorkspaceStore.getState().openTab({
      type: 'table-designer',
      label: 'users',
      connectionId: 'session-1',
      mode: 'alter',
      databaseName: 'testdb',
      objectName: 'users',
    })

    await useSessionRestoreStore.getState().saveSession()

    const parsed = JSON.parse(savedValue!)
    // Only the query tab should be serialized
    expect(parsed.connections[0].tabs).toHaveLength(1)
    expect(parsed.connections[0].tabs[0].type).toBe('query-editor')
  })

  it('does nothing when session restore is disabled', async () => {
    useSettingsStore.setState({
      settings: { 'session.restore': 'false' },
      pendingChanges: {},
    })

    let setCalled = false
    mockIPC((cmd) => {
      if (cmd === 'set_setting') {
        setCalled = true
        return null
      }
      if (cmd === 'log_frontend') return undefined
      return null
    })

    await useSessionRestoreStore.getState().saveSession()
    expect(setCalled).toBe(false)
  })

  it('serializes table-data tabs', async () => {
    let savedValue: string | null = null

    mockIPC((cmd, args) => {
      const a = args as Record<string, unknown> | undefined
      if (cmd === 'set_setting' && a?.key === 'session.state') {
        savedValue = a.value as string
        return null
      }
      if (cmd === 'log_frontend') return undefined
      return null
    })

    useConnectionStore.setState({
      activeConnections: {
        'session-1': {
          id: 'session-1',
          profile: {
            id: 'profile-1',
            name: 'Test',
            host: '127.0.0.1',
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
    })

    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'testdb.users',
      connectionId: 'session-1',
      databaseName: 'testdb',
      objectName: 'users',
      objectType: 'table',
    })

    await useSessionRestoreStore.getState().saveSession()

    const parsed = JSON.parse(savedValue!)
    expect(parsed.connections[0].tabs).toHaveLength(1)
    expect(parsed.connections[0].tabs[0].type).toBe('table-data')
    expect(parsed.connections[0].tabs[0].databaseName).toBe('testdb')
    expect(parsed.connections[0].tabs[0].tableName).toBe('users')
  })

  it('serializes history-favorites tabs', async () => {
    let savedValue: string | null = null

    mockIPC((cmd, args) => {
      const a = args as Record<string, unknown> | undefined
      if (cmd === 'set_setting' && a?.key === 'session.state') {
        savedValue = a.value as string
        return null
      }
      if (cmd === 'log_frontend') return undefined
      return null
    })

    useConnectionStore.setState({
      activeConnections: {
        'session-1': {
          id: 'session-1',
          profile: {
            id: 'profile-1',
            name: 'Test',
            host: '127.0.0.1',
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
    })

    useWorkspaceStore.getState().openHistoryFavoritesTab('session-1')

    await useSessionRestoreStore.getState().saveSession()

    const parsed = JSON.parse(savedValue!)
    expect(parsed.connections[0].tabs).toHaveLength(1)
    expect(parsed.connections[0].tabs[0].type).toBe('history-favorites')
  })
})

describe('useSessionRestoreStore — restoreSession', () => {
  it('restores connections and query tabs from saved state', async () => {
    const savedState = {
      version: 1,
      connections: [
        {
          profileId: 'profile-1',
          activeTabIndex: 0,
          tabs: [
            {
              type: 'query-editor',
              tabId: 'old-tab-1',
              sql: 'SELECT * FROM users',
              cursorLine: 2,
              cursorColumn: 5,
              label: 'Restored Query',
            },
          ],
        },
      ],
    }

    mockIPC((cmd, args) => {
      const a = args as Record<string, unknown> | undefined
      switch (cmd) {
        case 'log_frontend':
          return undefined
        case 'get_setting':
          if (a?.key === 'session.state') return JSON.stringify(savedState)
          return null
        case 'list_connections':
          return [
            {
              id: 'profile-1',
              name: 'Test MySQL',
              host: '127.0.0.1',
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
          ]
        case 'list_connection_groups':
          return []
        case 'open_connection':
          return { sessionId: 'session-profile-1', serverVersion: '8.0.0' }
        default:
          return null
      }
    })

    await useSessionRestoreStore.getState().restoreSession()

    expect(useSessionRestoreStore.getState().isRestoring).toBe(false)
    expect(useSessionRestoreStore.getState().restoreError).toBeNull()

    // Connection should be open
    const connStore = useConnectionStore.getState()
    expect(Object.keys(connStore.activeConnections)).toContain('session-profile-1')

    // Query tab should be restored with content
    const workspaceTabs = useWorkspaceStore.getState().tabsByConnection['session-profile-1'] ?? []
    expect(workspaceTabs.length).toBeGreaterThanOrEqual(1)
    const queryTab = workspaceTabs.find((t) => t.type === 'query-editor')
    expect(queryTab).toBeDefined()

    // Check query content was restored
    const queryState = useQueryStore.getState().tabs[queryTab!.id]
    expect(queryState).toBeDefined()
    expect(queryState.content).toBe('SELECT * FROM users')
    expect(queryState.cursorPosition).toEqual({ lineNumber: 2, column: 5 })
  })

  it('does nothing when session restore is disabled', async () => {
    useSettingsStore.setState({
      settings: { 'session.restore': 'false' },
      pendingChanges: {},
    })

    await useSessionRestoreStore.getState().restoreSession()
    expect(useSessionRestoreStore.getState().isRestoring).toBe(false)

    // No connections should be open
    const connStore = useConnectionStore.getState()
    expect(Object.keys(connStore.activeConnections)).toHaveLength(0)
  })

  it('does nothing when no saved state exists', async () => {
    mockIPC((cmd) => {
      if (cmd === 'log_frontend') return undefined
      if (cmd === 'get_setting') return null
      if (cmd === 'list_connections') return []
      if (cmd === 'list_connection_groups') return []
      return null
    })

    await useSessionRestoreStore.getState().restoreSession()
    expect(useSessionRestoreStore.getState().isRestoring).toBe(false)
    expect(Object.keys(useConnectionStore.getState().activeConnections)).toHaveLength(0)
  })

  it('shows error toast when connection fails but does not crash', async () => {
    const savedState = {
      version: 1,
      connections: [
        {
          profileId: 'nonexistent-profile',
          activeTabIndex: 0,
          tabs: [{ type: 'query-editor', tabId: 'tab-1', sql: 'SELECT 1' }],
        },
      ],
    }

    mockIPC((cmd, args) => {
      const a = args as Record<string, unknown> | undefined
      switch (cmd) {
        case 'log_frontend':
          return undefined
        case 'get_setting':
          if (a?.key === 'session.state') return JSON.stringify(savedState)
          return null
        case 'list_connections':
          return [] // Profile not found
        case 'list_connection_groups':
          return []
        default:
          return null
      }
    })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await useSessionRestoreStore.getState().restoreSession()

    // Should not crash
    expect(useSessionRestoreStore.getState().isRestoring).toBe(false)
    expect(Object.keys(useConnectionStore.getState().activeConnections)).toHaveLength(0)

    warnSpy.mockRestore()
  })

  it('handles connection failure with error toast gracefully', async () => {
    const savedState = {
      version: 1,
      connections: [
        {
          profileId: 'profile-1',
          activeTabIndex: 0,
          tabs: [{ type: 'query-editor', tabId: 'tab-1', sql: 'SELECT 1' }],
        },
      ],
    }

    mockIPC((cmd, args) => {
      const a = args as Record<string, unknown> | undefined
      switch (cmd) {
        case 'log_frontend':
          return undefined
        case 'get_setting':
          if (a?.key === 'session.state') return JSON.stringify(savedState)
          return null
        case 'list_connections':
          return [
            {
              id: 'profile-1',
              name: 'Test MySQL',
              host: '127.0.0.1',
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
          ]
        case 'list_connection_groups':
          return []
        case 'open_connection':
          throw new Error('Connection refused')
        default:
          return null
      }
    })

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await useSessionRestoreStore.getState().restoreSession()

    // Should not crash — isRestoring should be false
    expect(useSessionRestoreStore.getState().isRestoring).toBe(false)
    // No connections should be open
    expect(Object.keys(useConnectionStore.getState().activeConnections)).toHaveLength(0)

    errorSpy.mockRestore()
  })

  it('does not open duplicate connections when called twice concurrently (StrictMode guard)', async () => {
    let openConnectionCount = 0

    const savedState = {
      version: 1,
      connections: [
        {
          profileId: 'profile-1',
          activeTabIndex: 0,
          tabs: [{ type: 'query-editor', tabId: 'old-tab-1', sql: 'SELECT 1', label: 'Tab 1' }],
        },
      ],
    }

    mockIPC((cmd, args) => {
      const a = args as Record<string, unknown> | undefined
      switch (cmd) {
        case 'log_frontend':
          return undefined
        case 'get_setting':
          if (a?.key === 'session.state') return JSON.stringify(savedState)
          return null
        case 'list_connections':
          return [
            {
              id: 'profile-1',
              name: 'Test MySQL',
              host: '127.0.0.1',
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
          ]
        case 'list_connection_groups':
          return []
        case 'open_connection':
          openConnectionCount++
          return { sessionId: `session-profile-1-${openConnectionCount}`, serverVersion: '8.0.0' }
        default:
          return null
      }
    })

    // Simulate React StrictMode double-invocation: call restoreSession twice
    // without awaiting the first — exactly what `void restoreSession()` x2 does.
    const first = useSessionRestoreStore.getState().restoreSession()
    const second = useSessionRestoreStore.getState().restoreSession()
    await Promise.all([first, second])

    // open_connection should have been called exactly once
    expect(openConnectionCount).toBe(1)

    // Only one active connection should exist
    const activeIds = Object.keys(useConnectionStore.getState().activeConnections)
    expect(activeIds).toHaveLength(1)
  })

  it('tracks activeTabIndex correctly when restoring multiple tabs', async () => {
    const savedState = {
      version: 1,
      connections: [
        {
          profileId: 'profile-1',
          activeTabIndex: 1,
          tabs: [
            { type: 'query-editor', tabId: 'old-tab-1', sql: 'SELECT 1', label: 'Tab 1' },
            { type: 'query-editor', tabId: 'old-tab-2', sql: 'SELECT 2', label: 'Tab 2' },
          ],
        },
      ],
    }

    mockIPC((cmd, args) => {
      const a = args as Record<string, unknown> | undefined
      switch (cmd) {
        case 'log_frontend':
          return undefined
        case 'get_setting':
          if (a?.key === 'session.state') return JSON.stringify(savedState)
          return null
        case 'list_connections':
          return [
            {
              id: 'profile-1',
              name: 'Test MySQL',
              host: '127.0.0.1',
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
          ]
        case 'list_connection_groups':
          return []
        case 'open_connection':
          return { sessionId: 'session-profile-1', serverVersion: '8.0.0' }
        default:
          return null
      }
    })

    await useSessionRestoreStore.getState().restoreSession()

    // The second tab (index 1) should be active
    const workspaceTabs = useWorkspaceStore.getState().tabsByConnection['session-profile-1'] ?? []
    expect(workspaceTabs).toHaveLength(2)
    const activeTabId =
      useWorkspaceStore.getState().activeTabByConnection['session-profile-1'] ?? null
    expect(activeTabId).toBe(workspaceTabs[1].id)
  })
})

describe('useSessionRestoreStore — restoreSession for non-query tab types', () => {
  function restoreIpc(savedState: unknown) {
    mockIPC((cmd, args) => {
      const a = args as Record<string, unknown> | undefined
      switch (cmd) {
        case 'log_frontend':
          return undefined
        case 'get_setting':
          if (a?.key === 'session.state') return JSON.stringify(savedState)
          return null
        case 'list_connections':
          return [
            {
              id: 'profile-1',
              name: 'Test MySQL',
              host: '127.0.0.1',
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
          ]
        case 'list_connection_groups':
          return []
        case 'open_connection':
          return { sessionId: 'session-profile-1', serverVersion: '8.0.0' }
        default:
          return null
      }
    })
  }

  it('restores table-data tabs', async () => {
    restoreIpc({
      version: 1,
      connections: [
        {
          profileId: 'profile-1',
          activeTabIndex: 0,
          tabs: [
            {
              type: 'table-data',
              tabId: 'old-td-1',
              databaseName: 'testdb',
              tableName: 'users',
            },
          ],
        },
      ],
    })

    await useSessionRestoreStore.getState().restoreSession()

    const tabs = useWorkspaceStore.getState().tabsByConnection['session-profile-1'] ?? []
    // openConnection creates a default query tab, plus the restored table-data tab
    const tableDataTab = tabs.find((t) => t.type === 'table-data')
    expect(tableDataTab).toBeDefined()
    expect(tableDataTab!.databaseName).toBe('testdb')
    expect(tableDataTab!.objectName).toBe('users')
  })

  it('restores schema-info tabs', async () => {
    restoreIpc({
      version: 1,
      connections: [
        {
          profileId: 'profile-1',
          activeTabIndex: 0,
          tabs: [
            {
              type: 'schema-info',
              tabId: 'old-si-1',
              databaseName: 'testdb',
              objectName: 'orders',
              objectType: 'table',
            },
          ],
        },
      ],
    })

    await useSessionRestoreStore.getState().restoreSession()

    const tabs = useWorkspaceStore.getState().tabsByConnection['session-profile-1'] ?? []
    const schemaTab = tabs.find((t) => t.type === 'schema-info')
    expect(schemaTab).toBeDefined()
    expect(schemaTab!.databaseName).toBe('testdb')
    expect(schemaTab!.objectName).toBe('orders')
  })

  it('restores history-favorites tabs', async () => {
    restoreIpc({
      version: 1,
      connections: [
        {
          profileId: 'profile-1',
          activeTabIndex: 0,
          tabs: [
            {
              type: 'history-favorites',
              tabId: 'old-hf-1',
            },
          ],
        },
      ],
    })

    await useSessionRestoreStore.getState().restoreSession()

    const tabs = useWorkspaceStore.getState().tabsByConnection['session-profile-1'] ?? []
    const hfTab = tabs.find((t) => t.type === 'history-favorites')
    expect(hfTab).toBeDefined()
  })

  it('restores mixed tab types and sets correct active tab', async () => {
    restoreIpc({
      version: 1,
      connections: [
        {
          profileId: 'profile-1',
          activeTabIndex: 1,
          tabs: [
            {
              type: 'query-editor',
              tabId: 'old-qe-1',
              sql: 'SELECT 1',
              label: 'Query 1',
            },
            {
              type: 'table-data',
              tabId: 'old-td-1',
              databaseName: 'testdb',
              tableName: 'products',
            },
            {
              type: 'schema-info',
              tabId: 'old-si-1',
              databaseName: 'testdb',
              objectName: 'orders',
              objectType: 'view',
            },
            {
              type: 'history-favorites',
              tabId: 'old-hf-1',
            },
          ],
        },
      ],
    })

    await useSessionRestoreStore.getState().restoreSession()

    const tabs = useWorkspaceStore.getState().tabsByConnection['session-profile-1'] ?? []
    // Should have at least the 4 restored tabs (openConnection may also add a default query tab)
    const queryTabs = tabs.filter((t) => t.type === 'query-editor')
    const tableDataTabs = tabs.filter((t) => t.type === 'table-data')
    const schemaInfoTabs = tabs.filter((t) => t.type === 'schema-info')
    const historyTabs = tabs.filter((t) => t.type === 'history-favorites')
    expect(queryTabs.length).toBeGreaterThanOrEqual(1)
    expect(tableDataTabs).toHaveLength(1)
    expect(schemaInfoTabs).toHaveLength(1)
    expect(historyTabs).toHaveLength(1)

    // Active tab should be the table-data tab (index 1 in the restored list)
    const activeTabId =
      useWorkspaceStore.getState().activeTabByConnection['session-profile-1'] ?? null
    expect(activeTabId).toBe(tableDataTabs[0].id)
  })
})

describe('useSessionRestoreStore — saveSession with schema-info tabs', () => {
  it('serializes schema-info tabs correctly', async () => {
    let savedValue: string | null = null

    mockIPC((cmd, args) => {
      const a = args as Record<string, unknown> | undefined
      if (cmd === 'set_setting' && a?.key === 'session.state') {
        savedValue = a.value as string
        return null
      }
      if (cmd === 'log_frontend') return undefined
      return null
    })

    useConnectionStore.setState({
      activeConnections: {
        'session-1': {
          id: 'session-1',
          profile: {
            id: 'profile-1',
            name: 'Test',
            host: '127.0.0.1',
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
    })

    useWorkspaceStore.getState().openTab({
      type: 'schema-info',
      label: 'testdb.users',
      connectionId: 'session-1',
      databaseName: 'testdb',
      objectName: 'users',
      objectType: 'table',
    })

    await useSessionRestoreStore.getState().saveSession()

    const parsed = JSON.parse(savedValue!)
    expect(parsed.connections[0].tabs).toHaveLength(1)
    expect(parsed.connections[0].tabs[0].type).toBe('schema-info')
    expect(parsed.connections[0].tabs[0].databaseName).toBe('testdb')
    expect(parsed.connections[0].tabs[0].objectName).toBe('users')
    expect(parsed.connections[0].tabs[0].objectType).toBe('table')
  })
})
