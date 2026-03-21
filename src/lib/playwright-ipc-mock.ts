import type { SavedConnection } from '../types/connection'

const MOCK_TS = '2025-01-01T00:00:00.000Z'

/** Deterministic saved profile for Playwright / VITE_PLAYWRIGHT browser runs. */
export const PLAYWRIGHT_MOCK_CONNECTION: SavedConnection = {
  id: 'conn-playwright-1',
  name: 'Sample MySQL',
  host: '127.0.0.1',
  port: 3306,
  username: 'appuser',
  hasPassword: true,
  defaultDatabase: 'appdb',
  sslEnabled: false,
  sslCaPath: null,
  sslCertPath: null,
  sslKeyPath: null,
  color: '#2563eb',
  groupId: null,
  readOnly: false,
  sortOrder: 0,
  connectTimeoutSecs: 10,
  keepaliveIntervalSecs: 60,
  createdAt: MOCK_TS,
  updatedAt: MOCK_TS,
}

/**
 * IPC handler for `mockIPC` when the app runs under Playwright (VITE_PLAYWRIGHT).
 * Returns stable, deterministic data so UI flows and visual snapshots do not flap.
 */
export function playwrightIpcMockHandler(cmd: string): unknown {
  switch (cmd) {
    case 'get_setting':
      return null
    case 'set_setting':
      return null
    case 'get_all_settings':
      return {}
    case 'list_connections':
      return [PLAYWRIGHT_MOCK_CONNECTION]
    case 'list_connection_groups':
      return []
    case 'open_connection':
      return { serverVersion: '8.0.33-mock' }
    case 'test_connection':
      return {
        success: true,
        serverVersion: '8.0.33-mock',
        authMethod: 'caching_sha2_password',
        sslStatus: 'Disabled',
        connectionTimeMs: 12,
        errorMessage: null,
      }
    case 'save_connection':
      return 'conn-playwright-new'
    case 'update_connection':
      return null
    case 'delete_connection':
      return null
    case 'get_connection':
      return PLAYWRIGHT_MOCK_CONNECTION
    case 'create_connection_group':
      return 'grp-playwright-new'
    case 'update_connection_group':
      return null
    case 'delete_connection_group':
      return null
    case 'close_connection':
      return null
    case 'get_connection_status':
      return 'connected'
    default:
      return null
  }
}
