/**
 * Shared table-data test utilities.
 *
 * Import these helpers instead of re-declaring connection and default
 * table-data tab state builders in each test file.
 */
import { useConnectionStore } from '../../stores/connection-store'
import type { TableDataTabState } from '../../types/schema'

/**
 * Seed the connection store with a canonical test connection for 'conn-1'.
 *
 * @param readOnly - Whether to mark the connection as read-only (default: false).
 */
export function setupTestConnection(readOnly = false): void {
  useConnectionStore.setState({
    activeConnections: {
      'conn-1': {
        id: 'conn-1',
        profile: {
          id: 'conn-1',
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
          readOnly,
          sortOrder: 0,
          connectTimeoutSecs: 10,
          keepaliveIntervalSecs: 30,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        },
        status: 'connected',
        serverVersion: '8.0.35',
      },
    },
    activeTabId: 'conn-1',
  })
}

/**
 * Build a canonical `TableDataTabState` for table-data tests.
 */
export function makeTableDataTabState(
  overrides: Partial<TableDataTabState> = {}
): TableDataTabState {
  return {
    columns: [],
    rows: [],
    currentPage: 1,
    pageSize: 1000,
    primaryKey: null,
    executionTimeMs: 0,
    connectionId: 'conn-1',
    database: 'mydb',
    table: 'users',
    editState: null,
    viewMode: 'grid',
    selectedRowKey: null,
    selectedCell: null,
    filterModel: [],
    sort: null,
    isLoading: false,
    error: null,
    saveError: null,
    isExportDialogOpen: false,
    pendingNavigationAction: null,
    scrollRow: 0,
    scrollCol: 0,
    ...overrides,
  }
}
