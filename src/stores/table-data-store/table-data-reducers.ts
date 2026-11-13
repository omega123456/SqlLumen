import type { FrontendRowResidencyState, TableDataTabState } from '../../types/schema'
import type { TableDataStore } from '../table-data-store'
import {
  canEvictInactiveTableDataTab,
  createResidentRowState,
  tabRowResidency,
} from './table-data-residency'
import { withoutKey } from '../../lib/record-utils'

type TableDataTabs = Pick<TableDataStore, 'tabs'>
type ColumnJumpState = Pick<TableDataStore, 'columnJumpRequests' | 'highlightedColumnByTab'>
type TableDataStoreState = TableDataTabs & ColumnJumpState

export interface TableDataTabPatch {
  tabId: string
  partial: Partial<TableDataTabState>
}

export interface TableDataResidencyPatch {
  tabId: string
  partial: Partial<FrontendRowResidencyState>
}

export interface TableDataTabEntry {
  tabId: string
  tab: TableDataTabState
}

export interface TableDataEviction {
  tabId: string
  evictedAt: number
}

export interface ColumnJumpRequest {
  tabId: string
  columnKey: string
}

function withTab(state: TableDataTabs, tabId: string, tab: TableDataTabState): TableDataTabs {
  return { tabs: { ...state.tabs, [tabId]: tab } }
}

export function putTableDataTab(state: TableDataTabs, { tabId, tab }: TableDataTabEntry) {
  return withTab(state, tabId, tab)
}

export function patchTableDataTab(
  state: TableDataTabs,
  { tabId, partial }: TableDataTabPatch
): TableDataTabs {
  const existing = state.tabs[tabId]
  if (!existing) return state
  return withTab(state, tabId, { ...existing, ...partial })
}

export function patchTableDataResidency(
  state: TableDataTabs,
  { tabId, partial }: TableDataResidencyPatch
): TableDataTabs {
  const existing = state.tabs[tabId]
  if (!existing) return state
  const rowResidency = {
    ...(existing.rowResidency ?? createResidentRowState(false)),
    ...partial,
  }
  return withTab(state, tabId, { ...existing, rowResidency: rowResidency })
}

export function removeTableDataTab(state: TableDataStoreState, tabId: string): TableDataStoreState {
  return {
    tabs: withoutKey(state.tabs, tabId),
    columnJumpRequests: withoutKey(state.columnJumpRequests, tabId),
    highlightedColumnByTab: withoutKey(state.highlightedColumnByTab, tabId),
  }
}

export function evictTableDataRows(
  state: TableDataTabs,
  { tabId, evictedAt }: TableDataEviction
): TableDataTabs {
  const tab = state.tabs[tabId]
  if (!tab) return state
  if (!canEvictInactiveTableDataTab(tab)) return state

  return withTab(state, tabId, {
    ...tab,
    rows: [],
    rowsEvictedAt: evictedAt,
    selectedRowKey: null,
    checkedRowKeys: [],
    selectedCell: null,
    editState: null,
    saveError: null,
    rowResidency: { ...tabRowResidency(tab), status: 'evicted' },
  })
}

export function requestTableDataColumnJump(
  state: ColumnJumpState,
  { tabId, columnKey }: ColumnJumpRequest
): Pick<ColumnJumpState, 'columnJumpRequests'> {
  const nextNonce = (state.columnJumpRequests[tabId]?.nonce ?? 0) + 1
  return {
    columnJumpRequests: {
      ...state.columnJumpRequests,
      [tabId]: { columnKey: columnKey, nonce: nextNonce },
    },
  }
}

export function consumeTableDataColumnJump(state: ColumnJumpState, tabId: string): ColumnJumpState {
  const request = state.columnJumpRequests[tabId]
  if (!request) return state
  return {
    columnJumpRequests: withoutKey(state.columnJumpRequests, tabId),
    highlightedColumnByTab: { ...state.highlightedColumnByTab, [tabId]: request.columnKey },
  }
}

export function clearTableDataColumnHighlight(
  state: ColumnJumpState,
  tabId: string
): ColumnJumpState | Pick<ColumnJumpState, 'highlightedColumnByTab'> {
  const highlightedColumn = state.highlightedColumnByTab[tabId]
  if (highlightedColumn == null) return state
  return { highlightedColumnByTab: { ...state.highlightedColumnByTab, [tabId]: null } }
}
