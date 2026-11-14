import type { TableDataTabState, FrontendRowResidencyState } from '../../types/schema'
import { frontendCacheLifecycle } from '../../lib/frontend-cache-lifecycle'
import { toErrorMessage } from '../../lib/error-message'
import { createResidentRowState } from './table-data-residency'
import { patchTableDataResidency, patchTableDataTab } from './table-data-reducers'
import { getTableDataSurfaceKey } from './table-data-tab-state'
import { useTableDataStore } from '../table-data-store'

export function patchTab(tabId: string, partial: Partial<TableDataTabState>) {
  useTableDataStore.setState((state) =>
    patchTableDataTab(state, { tabId: tabId, partial: partial })
  )
}

export function patchTabResidency(tabId: string, partial: Partial<FrontendRowResidencyState>) {
  useTableDataStore.setState((state) =>
    patchTableDataResidency(state, { tabId: tabId, partial: partial })
  )
}

export function cancelTableDataLifecycleTimer(tabId: string) {
  frontendCacheLifecycle.cancel(getTableDataSurfaceKey(tabId))
}

export function markTableDataResident(
  tabId: string,
  partial: Partial<TableDataTabState> = {},
  options?: { preserveActiveState?: boolean }
) {
  const current = useTableDataStore.getState().tabs[tabId]
  const currentResidency = current?.rowResidency ?? createResidentRowState(false)
  const preserveActiveState = options?.preserveActiveState === true
  const keepsInactiveSince = preserveActiveState && !currentResidency.isActive
  patchTab(tabId, {
    ...partial,
    rowsEvictedAt: null,
    rowResidency: {
      status: 'resident',
      isActive: preserveActiveState ? currentResidency.isActive : false,
      inactiveSince: keepsInactiveSince ? currentResidency.inactiveSince : null,
    },
  })
}

export function recordSaveError(tabId: string, error: unknown): false {
  if (useTableDataStore.getState().tabs[tabId]) {
    patchTab(tabId, { saveError: toErrorMessage(error) })
  }
  return false
}

export function recordTabError(tabId: string, error: unknown): void {
  if (!useTableDataStore.getState().tabs[tabId]) return
  patchTab(tabId, { error: toErrorMessage(error) })
}
