/**
 * Shared table-data test utilities.
 *
 * Import these helpers instead of re-declaring connection and default
 * table-data tab state builders in each test file.
 */
import { useConnectionStore } from '../../stores/connection-store'
import { useTableDataStore } from '../../stores/table-data-store'
import type { TableDataSource, TableDataTabState } from '../../stores/table-data-store'
import { createDefaultTabState } from '../../stores/table-data-store/table-data-tab-state'
import { patchedTableDataTab } from '../../stores/table-data-store/table-data-reducers'
import type { TableDataTabPatch } from '../../stores/table-data-store/table-data-tab-state'
import type { PrimaryKeyInfo, TableDataColumnMeta, TablePageResult } from '../../types/schema'
import { ipc } from '../ipc-mock'
import { seedVisibleConnection } from './workspace-test-utils'

/**
 * Seed the connection store with a canonical test connection for 'conn-1'.
 *
 * Also marks 'conn-1' as the globally visible workspace connection so
 * table-data tests that rely on a visible, active surface align with strict
 * visible-connection semantics.
 *
 * @param readOnly - Whether to mark the connection as read-only (default: false).
 */
export function setupTestConnection(readOnly = false): void {
  seedVisibleConnection('conn-1')
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
          sslMode: 'disabled',
          lastConnectedAt: null,
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

export const TEST_TABLE: TableDataSource = {
  connectionId: 'conn-1',
  database: 'mydb',
  table: 'users',
  isView: false,
}

const TEST_PAGE_SIZE = 1000

/**
 * Build a canonical `TableDataTabState` for table-data tests.
 */
export function makeTableDataTabState(
  patch: TableDataTabPatch = {},
  table: TableDataSource = TEST_TABLE
): TableDataTabState {
  const tab = createDefaultTabState(table)
  return patchedTableDataTab(tab, {
    ...patch,
    page: { pageSize: TEST_PAGE_SIZE, ...patch.page },
  })
}

export interface TablePageFixture {
  columns: TableDataColumnMeta[]
  rows: unknown[][]
  primaryKey?: PrimaryKeyInfo | null
  currentPage?: number
  pageSize?: number
  queryId?: string
}

/** A `fetch_table_page` response for `rows` (identity view, base indices 0..n-1). */
export function tablePageResponse(fixture: TablePageFixture): TablePageResult {
  return {
    queryId: fixture.queryId ?? 'table-page-1',
    columns: fixture.columns,
    primaryKey: fixture.primaryKey ?? null,
    currentPage: fixture.currentPage ?? 1,
    pageSize: fixture.pageSize ?? TEST_PAGE_SIZE,
    executionTimeMs: 5,
    viewRowCount: fixture.rows.length,
    viewVersion: 1,
    totalRows: fixture.rows.length,
    rowCeiling: 100_000,
    firstWindow: {
      offset: 0,
      rows: fixture.rows,
      baseIndices: fixture.rows.map((_, index) => index),
    },
  }
}

/**
 * Open a table-data tab in the real store and load `fixture` through the
 * `fetch_table_page` IPC fixture, so the page lands in the real window cache.
 */
export async function loadTablePage(
  tabId: string,
  fixture: TablePageFixture,
  table: TableDataSource = TEST_TABLE
): Promise<void> {
  ipc.override('fetch_table_page', () => tablePageResponse(fixture))
  useTableDataStore.getState().initTab(tabId, table)
  await useTableDataStore.getState().loadTableData(tabId)
}
