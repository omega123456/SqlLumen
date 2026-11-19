import { frontendCacheLifecycle } from '../../lib/frontend-cache-lifecycle'
import { patchTableDataTab } from './table-data-reducers'
import {
  getTableDataSurfaceKey,
  type TableDataTabPatch,
  type TableDataTabState,
} from './table-data-tab-state'
import { useTableDataStore } from '../table-data-store'

export function tableTabOf(tabId: string): TableDataTabState | undefined {
  return useTableDataStore.getState().tabs[tabId]
}

export function isTableTabOpen(tabId: string): boolean {
  return tableTabOf(tabId) !== undefined
}

export function patchTableTab(tabId: string, patch: TableDataTabPatch) {
  useTableDataStore.setState((state) => patchTableDataTab(state, { tabId: tabId, patch: patch }))
}

export function cancelTableDataLifecycleTimer(tabId: string) {
  frontendCacheLifecycle.cancel(getTableDataSurfaceKey(tabId))
}
