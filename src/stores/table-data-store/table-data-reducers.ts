import type { TableDataStore } from '../table-data-store'
import { applyViewPatch } from '../data-view/data-view-reducers'
import { withoutKey } from '../../lib/record-utils'
import type { TableDataTabPatch, TableDataTabState } from './table-data-tab-state'

type TableDataTabs = Pick<TableDataStore, 'tabs'>
type ColumnJumpState = Pick<TableDataStore, 'columnJumpRequests' | 'highlightedColumnByTab'>
type TableDataStoreState = TableDataTabs & ColumnJumpState

export interface TableDataTabEntry {
  tabId: string
  tab: TableDataTabState
}

export interface TableDataTabUpdate {
  tabId: string
  patch: TableDataTabPatch
}

export interface ColumnJumpRequest {
  tabId: string
  columnName: string
}

function withTab(state: TableDataTabs, tabId: string, tab: TableDataTabState): TableDataTabs {
  return { tabs: { ...state.tabs, [tabId]: tab } }
}

export function putTableDataTab(state: TableDataTabs, { tabId, tab }: TableDataTabEntry) {
  return withTab(state, tabId, tab)
}

export function patchedTableDataTab(
  tab: TableDataTabState,
  patch: TableDataTabPatch
): TableDataTabState {
  return {
    table: tab.table,
    page: patch.page ? { ...tab.page, ...patch.page } : tab.page,
    meta: patch.meta ? { ...tab.meta, ...patch.meta } : tab.meta,
    view: patch.view ? applyViewPatch(tab.view, patch.view) : tab.view,
  }
}

export function patchTableDataTab(
  state: TableDataTabs,
  { tabId, patch }: TableDataTabUpdate
): TableDataTabs {
  const existing = state.tabs[tabId]
  if (!existing) return state
  return withTab(state, tabId, patchedTableDataTab(existing, patch))
}

export function removeTableDataTab(state: TableDataStoreState, tabId: string): TableDataStoreState {
  return {
    tabs: withoutKey(state.tabs, tabId),
    columnJumpRequests: withoutKey(state.columnJumpRequests, tabId),
    highlightedColumnByTab: withoutKey(state.highlightedColumnByTab, tabId),
  }
}

export function requestTableDataColumnJump(
  state: ColumnJumpState,
  { tabId, columnName }: ColumnJumpRequest
): Pick<ColumnJumpState, 'columnJumpRequests'> {
  const nextNonce = (state.columnJumpRequests[tabId]?.nonce ?? 0) + 1
  return {
    columnJumpRequests: {
      ...state.columnJumpRequests,
      [tabId]: { columnName: columnName, nonce: nextNonce },
    },
  }
}

export function consumeTableDataColumnJump(state: ColumnJumpState, tabId: string): ColumnJumpState {
  const request = state.columnJumpRequests[tabId]
  if (!request) return state
  return {
    columnJumpRequests: withoutKey(state.columnJumpRequests, tabId),
    highlightedColumnByTab: { ...state.highlightedColumnByTab, [tabId]: request.columnName },
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
