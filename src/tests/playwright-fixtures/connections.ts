import type {
  ConnectionGroup,
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
  sslMode: 'disabled',
  lastConnectedAt: null,
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

export interface OpenConnectionDenial {
  kind: 'accessDenied'
  message: string
}

export const NO_OPEN_CONNECTION_DENIAL: OpenConnectionDenial | null = null

export const STAGING_MOCK_CONNECTION: SavedConnection = {
  ...PLAYWRIGHT_MOCK_CONNECTION,
  id: 'conn-playwright-2',
  name: 'Staging MySQL',
  host: '10.0.0.5',
  port: 3307,
  username: 'staging',
  defaultDatabase: null,
  color: '#d97706',
  sortOrder: 1,
}

export const DEFAULT_SAVED_CONNECTIONS: SavedConnection[] = [PLAYWRIGHT_MOCK_CONNECTION]
export const DEFAULT_CONNECTION_GROUPS: ConnectionGroup[] = []

const PRODUCTION_GROUP_ID = 'grp-production'
const STAGING_GROUP_ID = 'grp-staging'

const BOARD_GROUPS: ConnectionGroup[] = [
  {
    id: PRODUCTION_GROUP_ID,
    name: 'Production',
    color: '#e0474c',
    parentId: null,
    sortOrder: 0,
    createdAt: PLAYWRIGHT_MOCK_TIMESTAMP,
  },
  {
    id: STAGING_GROUP_ID,
    name: 'Staging',
    color: '#b86e00',
    parentId: null,
    sortOrder: 1,
    createdAt: PLAYWRIGHT_MOCK_TIMESTAMP,
  },
  {
    id: 'grp-archive',
    name: 'Archive',
    color: null,
    parentId: null,
    sortOrder: 2,
    createdAt: PLAYWRIGHT_MOCK_TIMESTAMP,
  },
]

function boardProfile(profile: Partial<SavedConnection>): SavedConnection {
  return { ...PLAYWRIGHT_MOCK_CONNECTION, hasPassword: true, defaultDatabase: null, ...profile }
}

const BOARD_PROFILES: SavedConnection[] = [
  boardProfile({
    id: PLAYWRIGHT_MOCK_CONNECTION_ID,
    name: 'Sample MySQL',
    username: 'root',
    defaultDatabase: PLAYWRIGHT_MOCK_DATABASE,
    lastConnectedAt: '2026-06-08T11:36:00.000000+00:00',
  }),
  boardProfile({
    id: 'conn-board-orders',
    name: 'Orders primary',
    host: 'orders-db.eu-west-1.rds.amazonaws.com',
    username: 'app_rw',
    defaultDatabase: 'orders',
    sslMode: 'verify_ca',
    sslCaPath: '/Users/me/certs/rds-eu-west-1-bundle.pem',
    color: null,
    groupId: PRODUCTION_GROUP_ID,
    lastConnectedAt: '2026-06-08T10:00:00.000000+00:00',
  }),
  boardProfile({
    id: 'conn-board-orders-replica',
    name: 'Orders read replica',
    host: 'orders-ro.eu-west-1.rds.amazonaws.com',
    username: 'report',
    sslMode: 'required',
    color: null,
    readOnly: true,
    groupId: PRODUCTION_GROUP_ID,
    lastConnectedAt: '2026-06-07T12:00:00.000000+00:00',
  }),
  boardProfile({
    id: 'conn-board-analytics',
    name: 'Analytics warehouse',
    host: 'analytics.internal',
    port: 3307,
    username: 'analyst',
    color: '#a266d6',
    groupId: PRODUCTION_GROUP_ID,
    lastConnectedAt: '2026-05-31T12:00:00.000000+00:00',
  }),
  boardProfile({
    id: 'conn-board-staging',
    name: 'Staging MariaDB',
    host: 'staging-maria.internal',
    username: 'root',
    color: null,
    groupId: STAGING_GROUP_ID,
    lastConnectedAt: '2026-06-08T07:00:00.000000+00:00',
  }),
  boardProfile({
    id: 'conn-board-crm',
    name: 'Staging legacy CRM',
    host: '10.20.4.17',
    username: 'crm',
    color: null,
    groupId: STAGING_GROUP_ID,
    lastConnectedAt: '2026-05-10T12:00:00.000000+00:00',
  }),
  boardProfile({
    id: 'conn-board-local',
    name: 'Local development',
    host: 'localhost',
    username: 'dev',
    hasPassword: false,
    color: '#0f766e',
    lastConnectedAt: null,
  }),
  boardProfile({
    id: 'conn-board-sandbox',
    name: 'Reporting sandbox',
    host: 'sandbox.reporting.internal',
    username: 'sandbox',
    color: null,
    lastConnectedAt: '2026-04-09T12:00:00.000000+00:00',
  }),
]

export const CONNECTIONS_BOARD_SCREENSHOT = {
  savedConnections: BOARD_PROFILES,
  connectionGroups: BOARD_GROUPS,
}
