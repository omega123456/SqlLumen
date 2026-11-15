import type { FilterCondition, SelectedCellInfo, ViewMode } from '../../types/schema'
import { retryFailedWindow, type ViewRange } from '../../lib/result-window-cache'
import { showErrorToast } from '../toast-store'
import { logFrontendError } from '../../lib/app-log-commands'
import { hasResultAt } from './result-lists'
import { DEFAULT_RESULT_STATE, ROW_EDIT_STATE_RESET } from './query-state-defaults'
import {
  getActiveIndex,
  patchResultByIndex,
  patchTab,
  resultAt,
  getQueryState,
} from './query-store-access'
import { hasUnsavedModifications } from './query-tab-selectors'
import { latestRequestedSpec, requestView, trackerFor } from './result-view-requests'

export function setViewMode(tabId: string, mode: ViewMode) {
  const tab = getQueryState().tabs[tabId]
  const resultIndex = getActiveIndex(tabId)
  const result = tab?.results[resultIndex]

  if (!result) {
    patchTab(tabId, {
      results: [{ ...DEFAULT_RESULT_STATE, viewMode: mode }],
      activeResultIndex: 0,
    })
    return
  }

  const isLeavingUnsavedEditsForText = mode === 'text' && hasUnsavedModifications(result)
  if (isLeavingUnsavedEditsForText) {
    getQueryState()
      .saveCurrentRow(tabId)
      .then(() => {
        const afterResult = resultAt(tabId, resultIndex)
        const isSavedCleanly = afterResult !== undefined && !afterResult.saveError
        if (!isSavedCleanly) {
          showErrorToast(
            'Cannot switch to text view',
            'Save failed. Fix or discard edits before switching to text view.'
          )
          return
        }
        patchResultByIndex(tabId, resultIndex, { viewMode: mode })
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

  patchResultByIndex(tabId, resultIndex, { viewMode: mode })
}

export function setSelectedRow(tabId: string, index: number | null) {
  const resultIndex = getActiveIndex(tabId)
  const result = resultAt(tabId, resultIndex)
  if (result?.selectedRowIndex === index) return
  patchResultByIndex(tabId, resultIndex, { selectedRowIndex: index })
}

export function setCheckedRanges(tabId: string, ranges: ViewRange[]) {
  const resultIndex = getActiveIndex(tabId)
  const result = resultAt(tabId, resultIndex)
  if (!result) return
  const isAlreadyUnchecked = ranges.length === 0 && result.checkedRanges.length === 0
  if (isAlreadyUnchecked) return
  patchResultByIndex(tabId, resultIndex, {
    checkedRanges: ranges,
    checkedViewVersion: result.viewVersion,
  })
}

export function retryResultWindow(tabId: string) {
  retryFailedWindow(tabId, getActiveIndex(tabId))
}

export function retryViewChange(tabId: string) {
  const resultIndex = getActiveIndex(tabId)
  const result = resultAt(tabId, resultIndex)
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

export function setSelectedCell(tabId: string, cell: SelectedCellInfo | null) {
  const resultIndex = getActiveIndex(tabId)
  const currentCell = resultAt(tabId, resultIndex)?.selectedCell ?? null
  const isSameCell =
    currentCell?.columnKey === cell?.columnKey && Object.is(currentCell?.value, cell?.value)
  if (isSameCell) return
  patchResultByIndex(tabId, resultIndex, { selectedCell: cell })
}

export function setResultScrollCell(tabId: string, scrollRow: number, scrollColumn: number) {
  const resultIndex = getActiveIndex(tabId)
  const result = resultAt(tabId, resultIndex)
  if (!result) return
  const isSameScrollCell = result.scrollRow === scrollRow && result.scrollCol === scrollColumn
  if (isSameScrollCell) return
  patchResultByIndex(tabId, resultIndex, { scrollRow: scrollRow, scrollCol: scrollColumn })
}

export function setResultColumnWidth(tabId: string, columnKey: string, width: number) {
  const resultIndex = getActiveIndex(tabId)
  const result = resultAt(tabId, resultIndex)
  if (!result) return
  patchResultByIndex(tabId, resultIndex, {
    columnWidths: { ...result.columnWidths, [columnKey]: width },
  })
}

export function applyQueryFilters(
  tabId: string,
  resultIndex: number,
  conditions: FilterCondition[]
) {
  if (!hasResultAt(getQueryState().tabs[tabId], resultIndex)) return
  const base = latestRequestedSpec(tabId, resultIndex)
  void requestView({
    tabId: tabId,
    resultIndex: resultIndex,
    spec: { sort: base?.sort ?? null, filters: conditions },
    kind: 'filter',
  })
}

export async function sortResults(tabId: string, column: string, direction: 'asc' | 'desc' | null) {
  const resultIndex = getActiveIndex(tabId)
  const result = resultAt(tabId, resultIndex)
  if (!result) return
  patchResultByIndex(tabId, resultIndex, ROW_EDIT_STATE_RESET)
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
