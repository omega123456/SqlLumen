import type { FavoriteEntry, HistoryPage } from '../../types/schema'
import { PLAYWRIGHT_MOCK_CONNECTION_ID, PLAYWRIGHT_MOCK_DATABASE } from './connections'

export const HISTORY_PAGE: HistoryPage = {
  entries: [
    {
      id: 1,
      connectionId: PLAYWRIGHT_MOCK_CONNECTION_ID,
      databaseName: PLAYWRIGHT_MOCK_DATABASE,
      sqlText: "SELECT * FROM users WHERE status = 'active'",
      timestamp: '2025-01-01T12:00:00.000Z',
      durationMs: 42,
      rowCount: 5,
      affectedRows: 0,
      success: true,
      errorMessage: null,
    },
    {
      id: 2,
      connectionId: PLAYWRIGHT_MOCK_CONNECTION_ID,
      databaseName: PLAYWRIGHT_MOCK_DATABASE,
      sqlText: 'SELECT COUNT(*) FROM orders',
      timestamp: '2025-01-01T11:30:00.000Z',
      durationMs: 8,
      rowCount: 1,
      affectedRows: 0,
      success: true,
      errorMessage: null,
    },
    {
      id: 3,
      connectionId: PLAYWRIGHT_MOCK_CONNECTION_ID,
      databaseName: PLAYWRIGHT_MOCK_DATABASE,
      sqlText: 'SELECT * FROM nonexistent_table',
      timestamp: '2025-01-01T11:00:00.000Z',
      durationMs: 0,
      rowCount: 0,
      affectedRows: 0,
      success: false,
      errorMessage: `Table '${PLAYWRIGHT_MOCK_DATABASE}.nonexistent_table' doesn't exist`,
    },
  ],
  total: 3,
  page: 1,
  pageSize: 50,
}

export const CREATED_FAVORITE_ID = 1

export const FAVORITES: FavoriteEntry[] = [
  {
    id: 1,
    name: 'Active Users',
    sqlText: "SELECT * FROM users WHERE status = 'active'",
    description: 'Frequently used query for monitoring',
    category: 'Monitoring',
    connectionId: PLAYWRIGHT_MOCK_CONNECTION_ID,
    createdAt: '2025-01-01T10:00:00.000Z',
    updatedAt: '2025-01-01T10:00:00.000Z',
  },
  {
    id: 2,
    name: 'Order Summary',
    sqlText: 'SELECT status, COUNT(*) as cnt FROM orders GROUP BY status',
    description: null,
    category: null,
    connectionId: PLAYWRIGHT_MOCK_CONNECTION_ID,
    createdAt: '2025-01-01T09:00:00.000Z',
    updatedAt: '2025-01-01T09:00:00.000Z',
  },
]
