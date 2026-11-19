import {
  setWindowExpiredHandler,
  setWindowStatusHandler,
  type WindowStatusUpdate,
} from '../../lib/result-window-cache'
import { formatRowRange } from '../../lib/format-row-count'
import { showErrorToast } from '../toast-store'
import { readView, routeOf, updateView } from './route-registry'
import type { DataViewSurfaceRef } from './data-view-types'

function applyWindowStatus({ surface, patch, failure }: WindowStatusUpdate) {
  if (!readView(surface)) return
  updateView(surface, { window: patch })
  if (!failure) return
  if (!patch.failedRange) return
  const [start, end] = patch.failedRange
  showErrorToast(`Couldn't load rows ${formatRowRange(start + 1, end)}`, failure.message)
}

function expireSurface(surface: DataViewSurfaceRef) {
  if (!readView(surface)) return
  routeOf(surface).lifecycle.onExpired(surface)
}

export function registerDataViewWindowHandlers() {
  setWindowStatusHandler(applyWindowStatus)
  setWindowExpiredHandler(expireSurface)
}
