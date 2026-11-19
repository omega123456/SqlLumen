import type { FilterCondition, SelectedCellInfo } from '../../types/schema'
import type { ViewMode } from '../../types/shared-data-view'
import { retryFailedWindow, type ViewRange } from '../../lib/result-window-cache'
import { showErrorToast } from '../toast-store'
import type { DataViewPatch, DataViewSurfaceRef, ExportRowScope } from './data-view-types'
import { mergeViewPatches } from './data-view-reducers'
import { hasUnsavedModifications } from './data-view-selectors'
import { saveCurrentRow } from './row-save'
import { readView, routeOf, updateView, type ViewPaintRequest } from './route-registry'

export interface ScrollCell {
  scrollRow: number
  scrollColumn: number
}

export interface ColumnSortChange {
  column: string
  direction: 'asc' | 'desc' | null
}

export const RESET_EDIT_FOR_VIEW_CHANGE: DataViewPatch = {
  edit: { state: null, rowIndex: null, baseIndex: null, draftRow: null, saveError: null },
}

function reportTextViewSwitchFailure() {
  showErrorToast(
    'Cannot switch to text view',
    'Save failed. Fix or discard edits before switching to text view.'
  )
}

async function saveThenSwitchToText(ref: DataViewSurfaceRef) {
  await saveCurrentRow(ref)
  const viewAfterSave = readView(ref)
  const isSavedCleanly = viewAfterSave !== undefined && !viewAfterSave.edit.saveError
  if (!isSavedCleanly) {
    reportTextViewSwitchFailure()
    return
  }
  updateView(ref, { mode: 'text' })
}

export function setViewMode(ref: DataViewSurfaceRef, mode: ViewMode) {
  const view = readView(ref)
  if (!view) return
  const isLeavingUnsavedEditsForText = mode === 'text' && hasUnsavedModifications(view)
  if (isLeavingUnsavedEditsForText) {
    void saveThenSwitchToText(ref)
    return
  }
  updateView(ref, { mode: mode })
}

export function setSelectedRow(ref: DataViewSurfaceRef, index: number | null) {
  const selectedRowIndex = readView(ref)?.selection.rowIndex
  if (selectedRowIndex === index) return
  updateView(ref, { selection: { rowIndex: index } })
}

export function setCheckedRanges(ref: DataViewSurfaceRef, ranges: ViewRange[]) {
  const view = readView(ref)
  if (!view) return
  const isAlreadyUnchecked = ranges.length === 0 && view.checked.ranges.length === 0
  if (isAlreadyUnchecked) return
  updateView(ref, { checked: { ranges: ranges, viewVersion: view.slot.viewVersion } })
}

function isSameCell(left: SelectedCellInfo | null, right: SelectedCellInfo | null): boolean {
  const isSameColumn = left?.columnKey === right?.columnKey
  return isSameColumn && Object.is(left?.value, right?.value)
}

export function setSelectedCell(ref: DataViewSurfaceRef, cell: SelectedCellInfo | null) {
  const currentCell = readView(ref)?.selection.cell ?? null
  if (isSameCell(currentCell, cell)) return
  updateView(ref, { selection: { cell: cell } })
}

export function setScrollCell(ref: DataViewSurfaceRef, { scrollRow, scrollColumn }: ScrollCell) {
  const view = readView(ref)
  if (!view) return
  const isSameRow = view.layout.scrollRow === scrollRow
  const isSameScrollCell = isSameRow && view.layout.scrollCol === scrollColumn
  if (isSameScrollCell) return
  updateView(ref, { layout: { scrollRow: scrollRow, scrollCol: scrollColumn } })
}

export function setColumnWidth(ref: DataViewSurfaceRef, columnKey: string, width: number) {
  const view = readView(ref)
  if (!view) return
  updateView(ref, {
    layout: { columnWidths: { ...view.layout.columnWidths, [columnKey]: width } },
  })
}

export function applyFilters(ref: DataViewSurfaceRef, conditions: FilterCondition[]) {
  if (!readView(ref)) return
  const route = routeOf(ref)
  const base = route.viewRequests.latestRequested(ref)
  void route.viewRequests.apply(ref, {
    spec: { sort: base?.sort ?? null, filters: conditions },
    kind: 'filter',
  })
}

export async function sortView(ref: DataViewSurfaceRef, { column, direction }: ColumnSortChange) {
  const view = readView(ref)
  if (!view) return
  const route = routeOf(ref)
  updateView(ref, RESET_EDIT_FOR_VIEW_CHANGE)
  const base = route.viewRequests.latestRequested(ref)
  await route.viewRequests.apply(ref, {
    spec: {
      sort: direction ? { column, direction } : null,
      filters: base?.filters ?? view.spec.filters,
    },
    kind: 'sort',
  })
}

export function retryViewChange(ref: DataViewSurfaceRef) {
  if (!readView(ref)) return
  routeOf(ref).viewRequests.retry(ref)
}

export function retryWindow(ref: DataViewSurfaceRef) {
  retryFailedWindow(ref.tabId, ref.resultIndex)
}

export function paintedViewPatch({ spec, view, extra = {} }: ViewPaintRequest): DataViewPatch {
  const paintPatch: DataViewPatch = {
    slot: {
      viewVersion: view.viewVersion,
      viewRowCount: view.viewRowCount,
      totalRows: view.totalRows,
    },
    selection: { rowIndex: null, cell: null },
    checked: { ranges: [], viewVersion: view.viewVersion },
    spec: { sort: spec.sort, filters: spec.filters, applying: null, error: null },
    window: { pendingRange: null, failedRange: null },
  }
  return mergeViewPatches(paintPatch, extra)
}

export function openExportDialog(ref: DataViewSurfaceRef, scope: ExportRowScope = 'currentView') {
  updateView(ref, { prompts: { isExportOpen: true, exportScope: scope } })
}
