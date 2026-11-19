import { columnKey } from '../../../../lib/col-key-utils'
import type { CachedRow } from '../../../../lib/result-window-cache'
import type { DataViewEditSession } from '../../../../stores/data-view/data-view-types'
import { rekeyByBoundColumn } from '../grid/data-grid-model'

export interface FormRowPosition {
  totalRows: number
  currentIndex: number
  clampedIndex: number
  isDraftPosition: boolean
}

export interface FormRowPositionInputs {
  viewRowCount: number
  draftRow: unknown[] | null
  selectedRowIndex: number | null
}

export function resolveFormRowPosition({
  viewRowCount,
  draftRow,
  selectedRowIndex,
}: FormRowPositionInputs): FormRowPosition {
  const hasDraftRow = draftRow !== null
  const totalRows = viewRowCount + (hasDraftRow ? 1 : 0)
  const currentIndex = selectedRowIndex ?? 0
  const clampedIndex = Math.max(0, Math.min(currentIndex, totalRows - 1))
  const isAtDraftRow = clampedIndex === viewRowCount
  return {
    totalRows: totalRows,
    currentIndex: currentIndex,
    clampedIndex: clampedIndex,
    isDraftPosition: hasDraftRow && isAtDraftRow,
  }
}

export interface FetchedRow {
  key: string
  row: CachedRow
}

export function fetchedRowFor(fetched: FetchedRow | null, fetchKey: string): CachedRow | null {
  if (fetched?.key !== fetchKey) return null
  return fetched.row
}

export function patchFetchedRow(
  current: FetchedRow | null,
  baseIndex: number,
  apply: (row: unknown[]) => unknown[]
): FetchedRow | null {
  if (!isFetchedRowAt(current, baseIndex)) return current
  return { ...current, row: { baseIndex: baseIndex, row: apply(current.row.row) } }
}

function isFetchedRowAt(current: FetchedRow | null, baseIndex: number): current is FetchedRow {
  if (!current) return false
  return current.row.baseIndex === baseIndex
}

export function isEditingFormRow(edit: DataViewEditSession, clampedIndex: number): boolean {
  if (!edit.state) return false
  return edit.rowIndex === clampedIndex
}

interface FormRowDataInputs {
  currentCached: CachedRow | null
  columnCount: number
  clampedIndex: number
  edit: DataViewEditSession
  boundColumnIndexLookup: Map<string, number>
}

function editedValuesOf(inputs: FormRowDataInputs): Record<string, unknown> {
  const { edit, boundColumnIndexLookup, clampedIndex } = inputs
  if (!edit.state) return {}
  if (!isEditingFormRow(edit, clampedIndex)) return {}
  return rekeyByBoundColumn(edit.state.currentValues, boundColumnIndexLookup)
}

export function buildFormRowData(inputs: FormRowDataInputs): Record<string, unknown> | null {
  const currentRow = inputs.currentCached?.row ?? null
  if (currentRow === null) return null

  const rowData: Record<string, unknown> = {
    __rowIdx: inputs.clampedIndex,
    __baseIdx: inputs.currentCached?.baseIndex ?? -1,
  }
  for (let columnIndex = 0; columnIndex < inputs.columnCount; columnIndex++) {
    rowData[columnKey(columnIndex)] = currentRow[columnIndex] ?? null
  }
  return { ...rowData, ...editedValuesOf(inputs) }
}
