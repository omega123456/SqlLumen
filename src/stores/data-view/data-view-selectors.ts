import type { QueryTableEditInfo } from '../../types/schema'
import { getLoadedRow, getResultSurface, type CachedRow } from '../../lib/result-window-cache'
import type { ResultSlotRef } from '../../lib/query-commands'
import type { ViewRange } from '../../lib/result-window-cache'
import type { DataViewState, DataViewSurfaceRef } from './data-view-types'

export const DRAFT_ROW_BASE_INDEX = -1

export function hasUnsavedModifications(view: DataViewState | undefined): boolean {
  const modifiedColumnCount = view?.edit.state?.modifiedColumns.size ?? 0
  return modifiedColumnCount > 0
}

export function isSelectedRowInView(view: DataViewState): boolean {
  const selectedRowIndex = view.selection.rowIndex
  if (selectedRowIndex === null) return false
  const isAtOrAfterFirstRow = selectedRowIndex >= 0
  const isBeforeLastRow = selectedRowIndex < view.slot.viewRowCount
  return isAtOrAfterFirstRow && isBeforeLastRow
}

export function hasStaleCheckedRows(view: DataViewState): boolean {
  const hasCheckedRows = view.checked.ranges.length > 0
  return hasCheckedRows && view.checked.viewVersion !== view.slot.viewVersion
}

export function editTableOf(view: DataViewState): QueryTableEditInfo | null {
  const tableName = view.editTarget.tableName
  if (!tableName) return null
  return view.editTarget.tables[tableName] ?? null
}

export function boundColumnIndexOf(view: DataViewState, columnName: string): number | undefined {
  return view.editTarget.boundIndexByName.get(columnName.toLowerCase())
}

function draftRowAt(view: DataViewState, position: number): unknown[] | null {
  const isDraftRowPosition = position === view.slot.viewRowCount
  return isDraftRowPosition ? view.edit.draftRow : null
}

export function rowAt(
  ref: DataViewSurfaceRef,
  view: DataViewState,
  position: number
): CachedRow | null {
  const draftRow = draftRowAt(view, position)
  if (draftRow) {
    return { row: draftRow, baseIndex: DRAFT_ROW_BASE_INDEX }
  }
  return getLoadedRow(ref.tabId, ref.resultIndex, position) ?? null
}

export function storedBaseIndexOf(cached: CachedRow): number | null {
  return cached.baseIndex >= 0 ? cached.baseIndex : null
}

export function slotRefOf(ref: DataViewSurfaceRef, view: DataViewState): ResultSlotRef | null {
  const queryId = view.slot.queryId
  if (!queryId) return null
  const surfaceConnectionId = getResultSurface(ref.tabId, ref.resultIndex)?.slot.connectionId
  return {
    connectionId: surfaceConnectionId || view.slot.connectionId,
    tabId: ref.tabId,
    resultIndex: ref.resultIndex,
    queryId: queryId,
  }
}

export function selectedRowRanges(view: DataViewState): ViewRange[] {
  const selectedRowIndex = view.selection.rowIndex
  if (selectedRowIndex === null) return []
  if (!isSelectedRowInView(view)) return []
  return [[selectedRowIndex, selectedRowIndex + 1]]
}

export function deleteTargetRangesOf(view: DataViewState): ViewRange[] {
  const hasCheckedRows = view.checked.ranges.length > 0
  if (hasCheckedRows) return view.checked.ranges
  return selectedRowRanges(view)
}
