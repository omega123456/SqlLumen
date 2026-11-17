import { describe, expect, it } from 'vitest'
import {
  clearTableDataColumnHighlight,
  consumeTableDataColumnJump,
  evictTableDataRows,
  patchTableDataResidency,
  patchTableDataTab,
  putTableDataTab,
  removeTableDataTab,
  requestTableDataColumnJump,
} from '../../../stores/table-data-store/table-data-reducers'
import type { TableDataTabState } from '../../../types/schema'

function createTab(overrides: Partial<TableDataTabState> = {}): TableDataTabState {
  return {
    columns: [],
    rows: [[1]],
    currentPage: 1,
    pageSize: 100,
    primaryKey: null,
    executionTimeMs: 0,
    rowsEvictedAt: null,
    connectionId: 'conn-1',
    database: 'shop',
    table: 'users',
    editState: null,
    viewMode: 'grid',
    selectedRowKey: { id: 1 },
    selectedCell: null,
    checkedRowKeys: [{ id: 1 }],
    filterModel: [],
    sort: null,
    isLoading: false,
    error: null,
    saveError: null,
    isExportDialogOpen: false,
    scrollRow: 0,
    scrollCol: 0,
    pendingNavigationAction: null,
    ...overrides,
  }
}

const EVICTED_AT = 1_700_000_000_000

describe('table data reducers', () => {
  it('puts and patches a tab', () => {
    const state = putTableDataTab({ tabs: {} }, { tabId: 'tab-1', tab: createTab() })
    const patched = patchTableDataTab(state, { tabId: 'tab-1', partial: { isLoading: true } })
    expect(patched.tabs['tab-1'].isLoading).toBe(true)
    expect(patchTableDataTab(state, { tabId: 'missing', partial: { isLoading: true } })).toBe(state)
  })

  it('patches residency, seeding a resident state when none exists', () => {
    const state = { tabs: { 'tab-1': createTab() } }
    const patched = patchTableDataResidency(state, { tabId: 'tab-1', partial: { isActive: true } })
    expect(patched.tabs['tab-1'].rowResidency).toEqual({
      status: 'resident',
      isActive: true,
      inactiveSince: null,
    })
    expect(patchTableDataResidency(state, { tabId: 'missing', partial: {} })).toBe(state)
  })

  it('removes a tab with its column jump state', () => {
    const state = {
      tabs: { 'tab-1': createTab() },
      columnJumpRequests: { 'tab-1': { columnKey: 'id', nonce: 1 } },
      highlightedColumnByTab: { 'tab-1': 'id' },
    }
    expect(removeTableDataTab(state, 'tab-1')).toEqual({
      tabs: {},
      columnJumpRequests: {},
      highlightedColumnByTab: {},
    })
  })

  it('evicts an inactive clean tab', () => {
    const inactiveTab = createTab({
      rowResidency: { status: 'resident', isActive: false, inactiveSince: 1 },
    })
    const evicted = evictTableDataRows(
      { tabs: { 'tab-1': inactiveTab } },
      { tabId: 'tab-1', evictedAt: EVICTED_AT }
    )
    const evictedTab = evicted.tabs['tab-1']
    expect(evictedTab.rows).toEqual([])
    expect(evictedTab.rowsEvictedAt).toBe(EVICTED_AT)
    expect(evictedTab.selectedRowKey).toBeNull()
    expect(evictedTab.checkedRowKeys).toEqual([])
    expect(evictedTab.rowResidency?.status).toBe('evicted')
  })

  it('keeps an active or missing tab when evicting', () => {
    const activeState = {
      tabs: {
        'tab-1': createTab({
          rowResidency: { status: 'resident', isActive: true, inactiveSince: null },
        }),
      },
    }
    const eviction = { tabId: 'tab-1', evictedAt: EVICTED_AT }
    expect(evictTableDataRows(activeState, eviction)).toBe(activeState)
    expect(evictTableDataRows(activeState, { ...eviction, tabId: 'missing' })).toBe(activeState)
  })

  it('requests, consumes and clears a column jump', () => {
    const empty = { columnJumpRequests: {}, highlightedColumnByTab: {} }
    const requested = {
      ...empty,
      ...requestTableDataColumnJump(empty, { tabId: 't', columnKey: 'id' }),
    }
    expect(requested.columnJumpRequests).toEqual({ t: { columnKey: 'id', nonce: 1 } })
    const again = requestTableDataColumnJump(requested, { tabId: 't', columnKey: 'name' })
    expect(again.columnJumpRequests.t.nonce).toBe(2)

    const consumed = consumeTableDataColumnJump(requested, 't')
    expect(consumed).toEqual({ columnJumpRequests: {}, highlightedColumnByTab: { t: 'id' } })
    expect(consumeTableDataColumnJump(empty, 't')).toBe(empty)

    expect(clearTableDataColumnHighlight(consumed, 't')).toEqual({
      highlightedColumnByTab: { t: null },
    })
    expect(clearTableDataColumnHighlight(empty, 't')).toBe(empty)
  })
})
