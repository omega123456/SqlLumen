import type { FrontendRowResidencyState } from '../../types/schema'
import {
  fetchResultWindow as fetchResultWindowCmd,
  touchResults as touchResultsCmd,
} from '../../lib/query-commands'
import { hasPendingRowChanges } from '../../lib/row-edit-state'
import {
  isResultsExpiredError,
  RESULT_PAGE_SIZE,
  seedResultWindow,
} from '../../lib/result-window-cache'
import { VIEW_REFRESH_WINDOW_ROWS } from '../../lib/data-view-limits'
import { logFrontend } from '../../lib/app-log-commands'
import { toErrorMessage } from '../../lib/error-message'
import type { DataViewPatch, DataViewState, DataViewSurfaceRef } from './data-view-types'
import { slotRefOf } from './data-view-selectors'
import { isSurfaceOpen, readView, routeOf, updateView } from './route-registry'

function isDirtyView(view: DataViewState): boolean {
  return hasPendingRowChanges(view.edit.state)
}

function isEvictableView(view: DataViewState): boolean {
  const isResident = view.residency.rows.status === 'resident'
  if (!isResident) return false
  if (view.residency.isExpired) return false
  return !isDirtyView(view)
}

export function shouldScheduleEviction(view: DataViewState): boolean {
  return isEvictableView(view) && view.slot.viewRowCount !== 0
}

export function canEvictInactiveView(view: DataViewState): boolean {
  return !view.residency.rows.isActive && isEvictableView(view)
}

export function isRestorableEvictedView(view: DataViewState | undefined): view is DataViewState {
  if (!view) return false
  const isEvicted = view.residency.rows.status === 'evicted'
  return isEvicted && !view.residency.isExpired
}

export function residentRows(isActive: boolean): FrontendRowResidencyState {
  return {
    status: 'resident',
    isActive: isActive,
    inactiveSince: isActive ? null : Date.now(),
  }
}

export function residentRowsAfterReload(
  previous: FrontendRowResidencyState
): FrontendRowResidencyState {
  return {
    ...previous,
    status: 'resident',
    inactiveSince: previous.isActive ? null : previous.inactiveSince,
  }
}

export function restoreWindowStart(view: DataViewState): number {
  const lastRowIndex = Math.max(0, view.slot.viewRowCount - 1)
  const anchorRow = Math.min(view.layout.scrollRow, lastRowIndex)
  return Math.floor(anchorRow / RESULT_PAGE_SIZE) * RESULT_PAGE_SIZE
}

export function evictedViewPatch(view: DataViewState, evictedAt: number): DataViewPatch {
  return {
    edit: { rowIndex: null, baseIndex: null, state: null },
    window: { pendingRange: null },
    residency: {
      evictedAt: evictedAt,
      rows: { ...view.residency.rows, status: 'evicted' },
    },
  }
}

function rowsStatusPatch(
  ref: DataViewSurfaceRef,
  status: FrontendRowResidencyState['status']
): DataViewPatch | null {
  const view = readView(ref)
  if (!view) return null
  return { residency: { rows: { ...view.residency.rows, status: status } } }
}

function setRowsStatus(ref: DataViewSurfaceRef, status: FrontendRowResidencyState['status']) {
  const patch = rowsStatusPatch(ref, status)
  if (patch) updateView(ref, patch)
}

function expireEvictedSurface(ref: DataViewSurfaceRef) {
  routeOf(ref).lifecycle.onExpired(ref)
  setRowsStatus(ref, 'evicted')
}

async function reloadEvictedWindow(ref: DataViewSurfaceRef, view: DataViewState) {
  const touchResponse = await touchResultsCmd(view.slot.connectionId, ref.tabId)
  if (!isSurfaceOpen(ref)) return
  const slot = slotRefOf(ref, view)
  const isSlotAvailable = touchResponse.status === 'available' && slot !== null
  if (!isSlotAvailable) {
    expireEvictedSurface(ref)
    return
  }

  const window = await fetchResultWindowCmd({
    ...slot,
    viewVersion: view.slot.viewVersion,
    offset: restoreWindowStart(view),
    limit: VIEW_REFRESH_WINDOW_ROWS,
  })
  const latestView = readView(ref)
  if (!latestView) return
  const isSlotReplaced = latestView.slot.queryId !== slot.queryId
  if (isSlotReplaced) return

  seedResultWindow({
    ...slot,
    route: ref.route,
    viewVersion: window.viewVersion,
    viewRowCount: window.viewRowCount,
    columns: latestView.slot.columns,
    window: window,
  })
  updateView(ref, {
    slot: { viewVersion: window.viewVersion, viewRowCount: window.viewRowCount },
    residency: {
      isExpired: false,
      evictedAt: null,
      rows: residentRowsAfterReload(latestView.residency.rows),
    },
  })
}

function handleRestoreFailure(ref: DataViewSurfaceRef, error: unknown) {
  if (isSurfaceOpen(ref)) setRowsStatus(ref, 'evicted')
  if (isResultsExpiredError(error)) {
    routeOf(ref).lifecycle.onExpired(ref)
    return
  }
  logFrontend(
    'warn',
    `[data-view] restoring evicted rows failed for ${ref.tabId}/${ref.resultIndex}: ${toErrorMessage(error)}`
  )
}

export function hasRestoreSource(view: DataViewState): boolean {
  return Boolean(view.slot.connectionId) && Boolean(view.slot.queryId)
}

export async function restoreEvictedRows(ref: DataViewSurfaceRef): Promise<void> {
  const view = readView(ref)
  if (!isRestorableEvictedView(view)) return
  if (!hasRestoreSource(view)) {
    routeOf(ref).lifecycle.onExpired(ref)
    return
  }
  setRowsStatus(ref, 'restoring')
  try {
    await reloadEvictedWindow(ref, view)
  } catch (error) {
    handleRestoreFailure(ref, error)
  }
}
