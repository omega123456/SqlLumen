import { describe, expect, it } from 'vitest'
import { DEFAULT_DATA_VIEW_STATE } from '../../../stores/data-view/data-view-defaults'
import { applyViewPatch } from '../../../stores/data-view/data-view-reducers'
import type { DataViewPatch, DataViewState } from '../../../stores/data-view/data-view-types'
import { canEvictInactiveView, shouldScheduleEviction } from '../../../stores/data-view/residency'

const residentView = applyViewPatch(DEFAULT_DATA_VIEW_STATE, { slot: { viewRowCount: 5 } })

function viewWith(patch: DataViewPatch): DataViewState {
  return applyViewPatch(residentView, patch)
}

const dirtyEditState = {
  rowKey: {},
  originalValues: {},
  currentValues: {},
  modifiedColumns: new Set(['name']),
  isNewRow: false,
}

const inactiveResidency = { status: 'resident' as const, isActive: false, inactiveSince: 1 }

describe('data-view residency predicates', () => {
  it('schedules eviction for clean resident views with rows', () => {
    expect(shouldScheduleEviction(residentView)).toBe(true)
    expect(shouldScheduleEviction(viewWith({ slot: { viewRowCount: 0 } }))).toBe(false)
    expect(shouldScheduleEviction(viewWith({ residency: { isExpired: true } }))).toBe(false)
    expect(shouldScheduleEviction(viewWith({ edit: { state: dirtyEditState } }))).toBe(false)
  })

  it('evicts only inactive, resident, clean views', () => {
    expect(canEvictInactiveView(viewWith({ residency: { rows: inactiveResidency } }))).toBe(true)
    const activeResidency = { ...inactiveResidency, isActive: true }
    expect(canEvictInactiveView(viewWith({ residency: { rows: activeResidency } }))).toBe(false)
    const evictedResidency = { ...inactiveResidency, status: 'evicted' as const }
    expect(canEvictInactiveView(viewWith({ residency: { rows: evictedResidency } }))).toBe(false)
  })
})
