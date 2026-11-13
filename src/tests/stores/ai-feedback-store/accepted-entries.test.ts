import { describe, expect, it } from 'vitest'
import {
  dropExpiredEntries,
  recordAcceptedTables,
  weightedAcceptedTables,
} from '../../../stores/ai-feedback-store/accepted-entries'
import { MILLISECONDS_PER_MINUTE } from '../../../lib/units'

const SEEN_AT = 1_700_000_000_000
const EXPIRY_MINUTES = 30
const HALF_EXPIRY_MS = (EXPIRY_MINUTES / 2) * MILLISECONDS_PER_MINUTE
const EXPIRY_MS = EXPIRY_MINUTES * MILLISECONDS_PER_MINUTE
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
