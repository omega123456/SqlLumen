import { useCallback, useMemo } from 'react'
import { countRanges } from '../../../../lib/view-ranges'
import type { DataViewSurfaceRef } from '../../../../stores/data-view/data-view-types'
import { useDataView } from '../../../../stores/data-view/use-data-view'
import {
  setCheckedRanges,
  setColumnWidth,
  setScrollCell,
} from '../../../../stores/data-view/view-actions'
import type { RowRange } from '../../glide/grid-row-source'
import { useSelectionResetKey } from '../../use-selection-reset-key'

function useScrollCell(ref: DataViewSurfaceRef) {
  const scrollRow = useDataView(ref, (view) => view.layout.scrollRow)
  const scrollColumn = useDataView(ref, (view) => view.layout.scrollCol)
  const initialScrollCell = useMemo(
    () => ({ scrollRow: scrollRow, scrollCol: scrollColumn }),
    [scrollRow, scrollColumn]
  )
  const handleScrollCellChange = useCallback(
    (nextScrollRow: number, nextScrollColumn: number) => {
      setScrollCell(ref, { scrollRow: nextScrollRow, scrollColumn: nextScrollColumn })
    },
    [ref]
  )
  return { initialScrollCell, handleScrollCellChange }
}

function useColumnWidths(ref: DataViewSurfaceRef) {
  const columnWidths = useDataView(ref, (view) => view.layout.columnWidths)
  const handleColumnResize = useCallback(
    (columnKey: string, width: number) => setColumnWidth(ref, columnKey, width),
    [ref]
  )
  return { columnWidths, handleColumnResize }
}

function clampedToViewRows(ranges: RowRange[], viewRowCount: number): RowRange[] {
  return ranges
    .map(([start, end]) => [start, Math.min(end, viewRowCount)] as const)
    .filter(([start, end]) => end > start)
}

function useCheckedRows(ref: DataViewSurfaceRef, viewRowCount: number) {
  const checkedRanges = useDataView(ref, (view) => view.checked.ranges)
  const checkedRowCount = countRanges(checkedRanges)

  const handleRowMarkerRangesChange = useCallback(
    (ranges: RowRange[]) => setCheckedRanges(ref, clampedToViewRows(ranges, viewRowCount)),
    [ref, viewRowCount]
  )

  return {
    initialCheckedRanges: checkedRanges,
    handleRowMarkerRangesChange: handleRowMarkerRangesChange,
    resetSelectionKey: useSelectionResetKey(checkedRowCount),
  }
}

export function useDataGridLayout(ref: DataViewSurfaceRef, viewRowCount: number) {
  const selectedCell = useDataView(ref, (view) => view.selection.cell)
  return {
    selectedCell: selectedCell,
    ...useScrollCell(ref),
    ...useColumnWidths(ref),
    ...useCheckedRows(ref, viewRowCount),
  }
}
