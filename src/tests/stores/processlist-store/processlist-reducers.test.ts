import { describe, expect, it } from 'vitest'
import { resetProcessListConnection } from '../../../stores/processlist-store/processlist-reducers'

const REFRESH_INTERVAL_MS = 2000
const REFRESHED_AT = 1_700_000_000_000

function connectionRecord<TValue>(value: TValue): Record<string, TValue> {
  return { 'conn-1': value, 'conn-2': value }
}

describe('process list reducers', () => {
  it('forgets one connection and bumps its fetch generation', () => {
    const state = {
      rowsByConnection: connectionRecord([]),
      lastRefreshedAtByConnection: connectionRecord<number | null>(REFRESHED_AT),
      selectedIdsByConnection: connectionRecord(new Set<number>()),
      refreshIntervalMsByConnection: connectionRecord(REFRESH_INTERVAL_MS),
      excludeIdleConnectionsByConnection: connectionRecord(true),
      isConfirmDialogOpenByConnection: connectionRecord(false),
      isSummaryDialogOpenByConnection: connectionRecord(false),
      sortColumnByConnection: connectionRecord(null),
      lastErrorToastAtByConnection: connectionRecord<number | null>(null),
      fetchErrorByConnection: connectionRecord<string | null>(null),
      isFetchingByConnection: connectionRecord(false),
      hasFetchedByConnection: connectionRecord(true),
      fetchGenerationByConnection: { 'conn-1': 2, 'conn-2': 5 },
    }
    const reset = resetProcessListConnection(state, 'conn-1')
    expect(Object.keys(reset.rowsByConnection)).toEqual(['conn-2'])
    expect(Object.keys(reset.hasFetchedByConnection)).toEqual(['conn-2'])
    expect(reset.fetchGenerationByConnection).toEqual({ 'conn-1': 3, 'conn-2': 5 })
  })
})
