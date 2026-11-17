import { describe, it, expect, beforeEach } from 'vitest'
import { useAiFeedbackStore } from '../../stores/ai-feedback-store'
import {
  dropExpiredEntries,
  recordAcceptedTables,
  weightedAcceptedTables,
} from '../../stores/ai-feedback-store/accepted-entries'
import { milliseconds } from 'date-fns'

describe('ai-feedback-store', () => {
  beforeEach(() => {
    // Reset the store between tests
    useAiFeedbackStore.setState({ entries: [] })
  })

  it('records accepted tables and retrieves them with weight', () => {
    const store = useAiFeedbackStore.getState()

    store.recordAccepted('conn-1', [
      { dbName: 'db1', tableName: 'users' },
      { dbName: 'db1', tableName: 'orders' },
    ])

    const tables = store.getAcceptedTables('conn-1')
    expect(tables).toHaveLength(2)
    expect(tables[0].dbName).toBe('db1')
    expect(tables[0].tableName).toBe('users')
    // Weight should be close to 1.0 (just created)
    expect(tables[0].weight).toBeGreaterThan(0.99)
  })

  it('entries for different connections are isolated', () => {
    const store = useAiFeedbackStore.getState()

    store.recordAccepted('conn-1', [{ dbName: 'db1', tableName: 'users' }])
    store.recordAccepted('conn-2', [{ dbName: 'db2', tableName: 'products' }])

    expect(store.getAcceptedTables('conn-1')).toHaveLength(1)
    expect(store.getAcceptedTables('conn-2')).toHaveLength(1)
    expect(store.getAcceptedTables('conn-3')).toHaveLength(0)
  })

  it('entries age out after 30 minutes', () => {
    const store = useAiFeedbackStore.getState()

    // Insert an entry with a timestamp from 31 minutes ago
    useAiFeedbackStore.setState({
      entries: [
        {
          dbName: 'db1',
          tableName: 'old_table',
          connectionId: 'conn-1',
          lastSeenAt: Date.now() - 31 * 60 * 1000,
        },
      ],
    })

    const tables = store.getAcceptedTables('conn-1')
    expect(tables).toHaveLength(0)
  })

  it('weight decays with age', () => {
    // Insert entry from 15 minutes ago (half of 30 min expiry)
    useAiFeedbackStore.setState({
      entries: [
        {
          dbName: 'db1',
          tableName: 'mid_age',
          connectionId: 'conn-1',
          lastSeenAt: Date.now() - 15 * 60 * 1000,
        },
      ],
    })

    const tables = useAiFeedbackStore.getState().getAcceptedTables('conn-1')
    expect(tables).toHaveLength(1)
    // Should be roughly 0.5 (half of expiry elapsed)
    expect(tables[0].weight).toBeGreaterThan(0.4)
    expect(tables[0].weight).toBeLessThan(0.6)
  })

  it('cleanup removes expired entries from state', () => {
    useAiFeedbackStore.setState({
      entries: [
        {
          dbName: 'db1',
          tableName: 'expired',
          connectionId: 'conn-1',
          lastSeenAt: Date.now() - 31 * 60 * 1000,
        },
        {
          dbName: 'db1',
          tableName: 'fresh',
          connectionId: 'conn-1',
          lastSeenAt: Date.now(),
        },
      ],
    })

    useAiFeedbackStore.getState().cleanup()
    expect(useAiFeedbackStore.getState().entries).toHaveLength(1)
    expect(useAiFeedbackStore.getState().entries[0].tableName).toBe('fresh')
  })

  it('recordAccepted updates lastSeenAt for duplicate entries', () => {
    const store = useAiFeedbackStore.getState()

    // Record once
    store.recordAccepted('conn-1', [{ dbName: 'db1', tableName: 'users' }])
    const firstTimestamp = useAiFeedbackStore.getState().entries[0].lastSeenAt

    // Record again (same call, timestamp may be same or later)
    store.recordAccepted('conn-1', [{ dbName: 'db1', tableName: 'users' }])

    const entries = useAiFeedbackStore.getState().entries
    expect(entries).toHaveLength(1)
    expect(entries[0].lastSeenAt).toBeGreaterThanOrEqual(firstTimestamp)
  })
})

describe('accepted entries', () => {
  const SEEN_AT = 1_700_000_000_000

  const EXPIRY_MINUTES = 30

  const EXPIRY_MS = milliseconds({ minutes: EXPIRY_MINUTES })

  const HALF_EXPIRY_MS = EXPIRY_MS / 2

  const HALF_WEIGHT = 0.5

  const USERS = { dbName: 'shop', tableName: 'users' }

  const ORDERS = { dbName: 'shop', tableName: 'orders' }

  describe('accepted entries', () => {
    it('records tables once per connection and refreshes a repeated table', () => {
      const first = recordAcceptedTables(
        { entries: [] },
        { connectionId: 'conn-1', tables: [USERS, ORDERS], seenAt: SEEN_AT }
      )
      const refreshed = recordAcceptedTables(first, {
        connectionId: 'conn-1',
        tables: [USERS],
        seenAt: SEEN_AT + 1,
      })
      expect(refreshed.entries).toEqual([
        { ...USERS, connectionId: 'conn-1', lastSeenAt: SEEN_AT + 1 },
        { ...ORDERS, connectionId: 'conn-1', lastSeenAt: SEEN_AT },
      ])
    })

    it('keeps the same table of another connection as its own entry', () => {
      const first = recordAcceptedTables(
        { entries: [] },
        { connectionId: 'conn-1', tables: [USERS], seenAt: SEEN_AT }
      )
      const second = recordAcceptedTables(first, {
        connectionId: 'conn-2',
        tables: [USERS],
        seenAt: SEEN_AT,
      })
      expect(second.entries).toHaveLength(2)
    })

    it('drops entries once they reach the expiry age', () => {
      const state = recordAcceptedTables(
        { entries: [] },
        { connectionId: 'conn-1', tables: [USERS], seenAt: SEEN_AT }
      )
      expect(dropExpiredEntries(state, SEEN_AT + EXPIRY_MS - 1).entries).toHaveLength(1)
      expect(dropExpiredEntries(state, SEEN_AT + EXPIRY_MS).entries).toEqual([])
    })

    it('weights the live tables of one connection by recency', () => {
      const { entries } = recordAcceptedTables(
        { entries: [] },
        { connectionId: 'conn-1', tables: [USERS], seenAt: SEEN_AT }
      )
      expect(
        weightedAcceptedTables(entries, { connectionId: 'conn-1', now: SEEN_AT + HALF_EXPIRY_MS })
      ).toEqual([{ ...USERS, weight: HALF_WEIGHT }])
      expect(weightedAcceptedTables(entries, { connectionId: 'conn-2', now: SEEN_AT })).toEqual([])
      expect(
        weightedAcceptedTables(entries, { connectionId: 'conn-1', now: SEEN_AT + EXPIRY_MS })
      ).toEqual([])
    })
  })
})
