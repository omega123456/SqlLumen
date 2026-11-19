import type { FilterCondition, SelectedCellInfo, ViewMode } from '../../types/schema'
import { retryFailedWindow, type ViewRange } from '../../lib/result-window-cache'
import { showErrorToast } from '../toast-store'
import { logFrontendError } from '../../lib/app-log-commands'
import { hasResultAt } from './result-lists'
import { DEFAULT_RESULT_STATE, ROW_EDIT_STATE_RESET } from './query-state-defaults'
import { patchSurface, patchTab, resultOf, getQueryState } from './query-store-access'
import type { DataViewSurfaceRef } from '../data-view/data-view-types'
import type { ColumnSortChange, ScrollCell } from './query-state-types'
import { hasUnsavedModifications } from './query-tab-selectors'
import { latestRequestedSpec, requestView, trackerFor } from './result-view-requests'

export function setViewMode(ref: DataViewSurfaceRef, mode: ViewMode) {
  const result = resultOf(ref)

  if (!result) {
    patchTab(ref.tabId, {
      results: [{ ...DEFAULT_RESULT_STATE, viewMode: mode }],
      activeResultIndex: 0,
    })
    return
  }

  const isLeavingUnsavedEditsForText = mode === 'text' && hasUnsavedModifications(result)
  if (isLeavingUnsavedEditsForText) {
    getQueryState()
      .saveCurrentRow(ref)
      .then(() => {
        const afterResult = resultOf(ref)
        const isSavedCleanly = afterResult !== undefined && !afterResult.saveError
        if (!isSavedCleanly) {
          showErrorToast(
            'Cannot switch to text view',
            'Save failed. Fix or discard edits before switching to text view.'
          )
          return
        }
        patchSurface(ref, { viewMode: mode })
      })
      .catch((error) => {
        logFrontendError('[query-store] saveCurrentRow failed while switching to text view:', error)
        showErrorToast(
          'Cannot switch to text view',
          'Save failed. Fix or discard edits before switching to text view.'
        )
      })
    return
  }

  patchSurface(ref, { viewMode: mode })
}

export function setSelectedRow(ref: DataViewSurfaceRef, index: number | null) {
  const result = resultOf(ref)
  if (result?.selectedRowIndex === index) return
  patchSurface(ref, { selectedRowIndex: index })
}

export function setCheckedRanges(ref: DataViewSurfaceRef, ranges: ViewRange[]) {
  const result = resultOf(ref)
  if (!result) return
  const isAlreadyUnchecked = ranges.length === 0 && result.checkedRanges.length === 0
  if (isAlreadyUnchecked) return
  patchSurface(ref, {
    checkedRanges: ranges,
    checkedViewVersion: result.viewVersion,
  })
}

export function retryResultWindow(ref: DataViewSurfaceRef) {
  retryFailedWindow(ref.tabId, ref.resultIndex)
}

export function retryViewChange(ref: DataViewSurfaceRef) {
  const { tabId, resultIndex } = ref
  const result = resultOf(ref)
  if (!result) return
  const tracker = trackerFor(tabId, resultIndex, result)
  const spec = tracker.retrySpec ?? tracker.spec
  const hasFilters = spec.filters.length > 0
  void requestView({
    tabId: tabId,
    resultIndex: resultIndex,
    spec: spec,
    kind: hasFilters ? 'filter' : 'sort',
  })
}

export function setSelectedCell(ref: DataViewSurfaceRef, cell: SelectedCellInfo | null) {
  const currentCell = resultOf(ref)?.selectedCell ?? null
  const isSameCell =
    currentCell?.columnKey === cell?.columnKey && Object.is(currentCell?.value, cell?.value)
  if (isSameCell) return
  patchSurface(ref, { selectedCell: cell })
}

export function setResultScrollCell(ref: DataViewSurfaceRef, scrollCell: ScrollCell) {
  const result = resultOf(ref)
  if (!result) return
  const { scrollRow, scrollColumn } = scrollCell
  const isSameScrollCell = result.scrollRow === scrollRow && result.scrollCol === scrollColumn
  if (isSameScrollCell) return
  patchSurface(ref, { scrollRow: scrollRow, scrollCol: scrollColumn })
}

export function setResultColumnWidth(ref: DataViewSurfaceRef, columnKey: string, width: number) {
  const result = resultOf(ref)
  if (!result) return
  patchSurface(ref, {
    columnWidths: { ...result.columnWidths, [columnKey]: width },
  })
}

export function applyQueryFilters(ref: DataViewSurfaceRef, conditions: FilterCondition[]) {
  const { tabId, resultIndex } = ref
  if (!hasResultAt(getQueryState().tabs[tabId], resultIndex)) return
  const base = latestRequestedSpec(tabId, resultIndex)
  void requestView({
    tabId: tabId,
    resultIndex: resultIndex,
    spec: { sort: base?.sort ?? null, filters: conditions },
    kind: 'filter',
  })
}

export async function sortResults(ref: DataViewSurfaceRef, sort: ColumnSortChange) {
  const { tabId, resultIndex } = ref
  const { column, direction } = sort
  const result = resultOf(ref)
  if (!result) return
  patchSurface(ref, ROW_EDIT_STATE_RESET)
  const base = latestRequestedSpec(tabId, resultIndex)
  await requestView({
    tabId: tabId,
    resultIndex: resultIndex,
    spec: {
      sort: direction ? { column, direction } : null,
      filters: base?.filters ?? result.filterModel,
    },
    kind: 'sort',
  })
}

export function resultViewActions() {
  return {
    setViewMode,
    setSelectedRow,
    setCheckedRanges,
    retryResultWindow,
    retryViewChange,
    setSelectedCell,
    setResultScrollCell,
    setResultColumnWidth,
    applyQueryFilters,
    sortResults,
  }
}
