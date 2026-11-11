import type {
  OpenConnectionSession,
  SavedConnection,
  TestConnectionResult,
} from '../../types/connection'

export const PLAYWRIGHT_MOCK_TIMESTAMP = '2025-01-01T00:00:00.000Z'
export const PLAYWRIGHT_MOCK_CONNECTION_ID = 'conn-playwright-1'
export const PLAYWRIGHT_MOCK_DATABASE = 'ecommerce_db'
export const PLAYWRIGHT_MOCK_SERVER_VERSION = '8.0.33-mock'
export const NEW_CONNECTION_ID = 'conn-playwright-new'
export const NEW_CONNECTION_GROUP_ID = 'grp-playwright-new'

export const PLAYWRIGHT_MOCK_CONNECTION: SavedConnection = {
  id: PLAYWRIGHT_MOCK_CONNECTION_ID,
  name: 'Sample MySQL',
  host: '127.0.0.1',
  port: 3306,
  username: 'appuser',
  hasPassword: true,
  defaultDatabase: PLAYWRIGHT_MOCK_DATABASE,
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
  createdAt: PLAYWRIGHT_MOCK_TIMESTAMP,
  updatedAt: PLAYWRIGHT_MOCK_TIMESTAMP,
}

export const TEST_CONNECTION_RESULT: TestConnectionResult = {
  success: true,
  serverVersion: PLAYWRIGHT_MOCK_SERVER_VERSION,
  authMethod: 'caching_sha2_password',
  sslStatus: 'Disabled',
  connectionTimeMs: 12,
  errorMessage: null,
}

export const DEFAULT_OPEN_CONNECTION_SESSIONS: OpenConnectionSession[] = []
