import { describe, expect, it } from 'vitest'
import {
  canEvictInactiveTableDataTab,
  createResidentRowState,
  shouldScheduleTableDataEviction,
  tabRowResidency,
} from '../../../stores/table-data-store/table-data-residency'
import { makeTableDataTabState } from '../../helpers/table-data-test-utils'

const dirtyEditState = {
  rowKey: { id: 1 },
  originalValues: {},
  currentValues: {},
  modifiedColumns: new Set(['name']),
  isNewRow: false,
}

describe('table data residency', () => {
  it('creates a resident row state', () => {
    expect(createResidentRowState()).toEqual({
      status: 'resident',
      isActive: false,
      inactiveSince: null,
    })
    expect(createResidentRowState(true).isActive).toBe(true)
  })

  it('falls back to a resident state when the tab has none', () => {
    const tab = { ...makeTableDataTabState(), rowResidency: undefined }
    expect(tabRowResidency(tab)).toEqual(createResidentRowState(false))
  })

  it('schedules eviction for clean resident tabs with rows', () => {
    expect(shouldScheduleTableDataEviction(makeTableDataTabState({ rows: [[1]] }))).toBe(true)
    expect(shouldScheduleTableDataEviction(makeTableDataTabState({ rows: [] }))).toBe(false)
    const dirtyTab = makeTableDataTabState({ rows: [[1]], editState: dirtyEditState })
    expect(shouldScheduleTableDataEviction(dirtyTab)).toBe(false)
  })

  it('evicts only inactive resident tabs', () => {
    expect(canEvictInactiveTableDataTab(makeTableDataTabState())).toBe(true)
    const activeTab = makeTableDataTabState({ rowResidency: createResidentRowState(true) })
    expect(canEvictInactiveTableDataTab(activeTab)).toBe(false)
    const evictedTab = makeTableDataTabState({
      rowResidency: { status: 'evicted', isActive: false, inactiveSince: 1 },
    })
    expect(canEvictInactiveTableDataTab(evictedTab)).toBe(false)
  })
})
