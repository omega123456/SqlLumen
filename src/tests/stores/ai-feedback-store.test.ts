import { describe, it, expect, beforeEach } from 'vitest'
import { useAiFeedbackStore } from '../../stores/ai-feedback-store'

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
