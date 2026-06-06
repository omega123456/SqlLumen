import type { SnapshotSummary } from '../../lib/session-snapshot-commands'

/**
 * Playwright fixture data for session snapshot list / get / create / delete.
 *
 * All data lives here (not inline in the mock router). The registry in
 * `index.ts` exposes lookups and override hooks so individual specs can replace
 * the snapshot list, the fetched state JSON, the created id, or the empty state
 * without editing the mock switch.
 */

/** Default fixture snapshot summaries, newest first. */
export const DEFAULT_SNAPSHOT_SUMMARIES: SnapshotSummary[] = [
  {
    id: 3,
    createdAt: '2026-06-05T14:32:00.000Z',
    triggerType: 'manual',
    connectionCount: 3,
    tabCount: 7,
    connections: [
      { name: 'ProdDB', tabCount: 4 },
      { name: 'Staging', tabCount: 2 },
      { name: 'Analytics', tabCount: 1 },
    ],
  },
  {
    id: 2,
    createdAt: '2026-06-05T09:00:00.000Z',
    triggerType: 'daily',
    connectionCount: 2,
    tabCount: 5,
    connections: [
      { name: 'ProdDB', tabCount: 3 },
      { name: 'Staging', tabCount: 2 },
    ],
  },
  {
    id: 1,
    createdAt: '2026-06-04T18:11:00.000Z',
    triggerType: 'onClose',
    connectionCount: 1,
    tabCount: 2,
    connections: [{ name: 'ProdDB', tabCount: 2 }],
  },
]

/** Sample full `state_json` returned by the get command at restore time. */
export const DEFAULT_SNAPSHOT_STATE_JSON: string = JSON.stringify({
  version: 1,
  activeConnectionIndex: 0,
  connections: [
    {
      profileId: 'conn-playwright-1',
      activeTabIndex: 0,
      tabs: [
        {
          type: 'query-editor',
          tabId: 'tab-snapshot-1',
          sql: 'SELECT * FROM users LIMIT 100;',
        },
        {
          type: 'table-data',
          tabId: 'tab-snapshot-2',
          databaseName: 'ecommerce_db',
          tableName: 'orders',
          objectType: 'table',
        },
      ],
    },
  ],
})

/** New snapshot id returned by the create command. */
export const DEFAULT_CREATED_SNAPSHOT_ID = 4
