import { describe, expect, it } from 'vitest'
import { DEFAULT_RESULT_STATE, type SingleResultState } from '../../../stores/query-store'
import {
  canEvictInactiveResult,
  shouldScheduleResultEviction,
} from '../../../stores/query-store/result-residency'

function resultWith(overrides: Partial<SingleResultState>): SingleResultState {
  return { ...DEFAULT_RESULT_STATE, viewRowCount: 5, ...overrides }
}

const dirtyEditState = {
  rowKey: {},
  originalValues: {},
  currentValues: {},
  modifiedColumns: new Set(['name']),
  isNewRow: false,
}

const inactiveResidency = { status: 'resident' as const, isActive: false, inactiveSince: 1 }

describe('result residency predicates', () => {
  it('schedules eviction for clean resident results with rows', () => {
    expect(shouldScheduleResultEviction(resultWith({}))).toBe(true)
    expect(shouldScheduleResultEviction(resultWith({ viewRowCount: 0 }))).toBe(false)
    expect(shouldScheduleResultEviction(resultWith({ isExpired: true }))).toBe(false)
    expect(shouldScheduleResultEviction(resultWith({ editState: dirtyEditState }))).toBe(false)
  })

  it('evicts only inactive, resident, clean results', () => {
    expect(canEvictInactiveResult(resultWith({ rowResidency: inactiveResidency }))).toBe(true)
    const activeResidency = { ...inactiveResidency, isActive: true }
    expect(canEvictInactiveResult(resultWith({ rowResidency: activeResidency }))).toBe(false)
    const evictedResidency = { ...inactiveResidency, status: 'evicted' as const }
    expect(canEvictInactiveResult(resultWith({ rowResidency: evictedResidency }))).toBe(false)
  })
})
