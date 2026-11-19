import { useCallback, useMemo } from 'react'
import { countRanges, useQueryStore, type QueryState } from '../../../stores/query-store'
import type { DataViewSurfaceRef } from '../../../stores/data-view/data-view-types'
import type { RowRange } from '../../shared/glide/grid-row-source'
import { useSelectionResetKey } from '../../shared/use-selection-reset-key'

function surfaceResultOf(state: QueryState, ref: DataViewSurfaceRef) {
  return state.tabs[ref.tabId]?.results[ref.resultIndex]
}

function useScrollCell(ref: DataViewSurfaceRef) {
  const storeSetResultScrollCell = useQueryStore((state) => state.setResultScrollCell)
  const storeScrollRow = useQueryStore((state) => surfaceResultOf(state, ref)?.scrollRow ?? 0)
  const storeScrollColumn = useQueryStore((state) => surfaceResultOf(state, ref)?.scrollCol ?? 0)
  const initialScrollCell = useMemo(
    () => ({ scrollRow: storeScrollRow, scrollCol: storeScrollColumn }),
    [storeScrollRow, storeScrollColumn]
  )
  const handleScrollCellChange = useCallback(
    (scrollRow: number, scrollColumn: number) => {
      storeSetResultScrollCell(ref, { scrollRow: scrollRow, scrollColumn: scrollColumn })
    },
    [storeSetResultScrollCell, ref]
  )
  return { initialScrollCell, handleScrollCellChange }
}

const NO_COLUMN_WIDTHS: Record<string, number> = {}
const NO_CHECKED_RANGES: RowRange[] = []

function useColumnWidths(ref: DataViewSurfaceRef) {
  const storeSetResultColumnWidth = useQueryStore((state) => state.setResultColumnWidth)
  const columnWidths = useQueryStore(
    (state) => surfaceResultOf(state, ref)?.columnWidths ?? NO_COLUMN_WIDTHS
  )
  const handleColumnResize = useCallback(
    (columnKey: string, width: number) => storeSetResultColumnWidth(ref, columnKey, width),
    [storeSetResultColumnWidth, ref]
  )
  return { columnWidths, handleColumnResize }
}

function useCheckedRows(ref: DataViewSurfaceRef, viewRowCount: number) {
  const storeSetCheckedRanges = useQueryStore((state) => state.setCheckedRanges)
  const checkedRanges = useQueryStore(
    (state) => surfaceResultOf(state, ref)?.checkedRanges ?? NO_CHECKED_RANGES
  )
  const checkedRowCount = countRanges(checkedRanges)

  const handleRowMarkerRangesChange = useCallback(
    (ranges: RowRange[]) => {
      const clampedToViewRows = ranges
        .map(([start, end]) => [start, Math.min(end, viewRowCount)] as const)
        .filter(([start, end]) => end > start)
      storeSetCheckedRanges(ref, clampedToViewRows)
    },
    [storeSetCheckedRanges, ref, viewRowCount]
  )

  return {
    initialCheckedRanges: checkedRanges,
    handleRowMarkerRangesChange: handleRowMarkerRangesChange,
    resetSelectionKey: useSelectionResetKey(checkedRowCount),
  }
}

export function useResultGridStoreState(ref: DataViewSurfaceRef, viewRowCount: number) {
  const selectedCell = useQueryStore((state) => surfaceResultOf(state, ref)?.selectedCell ?? null)
  return {
    selectedCell: selectedCell,
    ...useScrollCell(ref),
    ...useColumnWidths(ref),
    ...useCheckedRows(ref, viewRowCount),
  }
}
