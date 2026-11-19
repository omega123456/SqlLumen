import type { ViewMode } from '../../types/shared-data-view'
import type { DataViewSurfaceRef } from '../data-view/data-view-types'
import {
  applyFilters,
  retryViewChange,
  retryWindow,
  setCheckedRanges,
  setColumnWidth,
  setScrollCell,
  setSelectedCell,
  setSelectedRow,
  setViewMode,
  sortView,
} from '../data-view/view-actions'
import { DEFAULT_RESULT_STATE } from './query-state-defaults'
import { patchedResult } from './query-tab-reducers'
import { patchTab, resultOf } from './query-store-access'

function setQueryViewMode(ref: DataViewSurfaceRef, mode: ViewMode) {
  if (resultOf(ref)) {
    setViewMode(ref, mode)
    return
  }
  patchTab(ref.tabId, {
    results: [patchedResult(DEFAULT_RESULT_STATE, { view: { mode: mode } })],
    activeResultIndex: 0,
  })
}

export function resultViewActions() {
  return {
    setViewMode: setQueryViewMode,
    setSelectedRow: setSelectedRow,
    setCheckedRanges: setCheckedRanges,
    retryResultWindow: retryWindow,
    retryViewChange: retryViewChange,
    setSelectedCell: setSelectedCell,
    setResultScrollCell: setScrollCell,
    setResultColumnWidth: setColumnWidth,
    applyQueryFilters: applyFilters,
    sortResults: sortView,
  }
}
