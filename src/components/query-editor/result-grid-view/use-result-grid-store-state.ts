import { useCallback, useEffect, useMemo } from 'react'
import { countRanges, useQueryStore, type QueryState } from '../../../stores/query-store'
import type { RowRange } from '../../shared/glide/grid-row-source'
import { useSelectionResetKey } from '../../shared/use-selection-reset-key'

function activeResultOf(state: QueryState, tabId: string) {
  const tab = state.tabs[tabId]
  const activeResultIndex = tab?.activeResultIndex ?? 0
  return tab?.results[activeResultIndex]
}

function useScrollCell(tabId: string) {
  const storeSetResultScrollCell = useQueryStore((state) => state.setResultScrollCell)
  const storeScrollRow = useQueryStore((state) => activeResultOf(state, tabId)?.scrollRow ?? 0)
  const storeScrollColumn = useQueryStore((state) => activeResultOf(state, tabId)?.scrollCol ?? 0)
  const initialScrollCell = useMemo(
    () => ({ scrollRow: storeScrollRow, scrollCol: storeScrollColumn }),
    [storeScrollRow, storeScrollColumn]
  )
  const handleScrollCellChange = useCallback(
    (scrollRow: number, scrollColumn: number) => {
      storeSetResultScrollCell(tabId, scrollRow, scrollColumn)
    },
    [storeSetResultScrollCell, tabId]
  )
  return { initialScrollCell, handleScrollCellChange }
}

const NO_COLUMN_WIDTHS: Record<string, number> = {}

function useColumnWidths(tabId: string) {
  const storeSetResultColumnWidth = useQueryStore((state) => state.setResultColumnWidth)
  const columnWidths = useQueryStore(
    (state) => activeResultOf(state, tabId)?.columnWidths ?? NO_COLUMN_WIDTHS
  )
  const handleColumnResize = useCallback(
    (columnKey: string, width: number) => storeSetResultColumnWidth(tabId, columnKey, width),
    [storeSetResultColumnWidth, tabId]
  )
  return { columnWidths, handleColumnResize }
}

function useCheckedRows(tabId: string, viewRowCount: number) {
  const storeSetCheckedRanges = useQueryStore((state) => state.setCheckedRanges)
  const checkedRowCount = useQueryStore((state) =>
    countRanges(activeResultOf(state, tabId)?.checkedRanges ?? [])
  )

  const handleRowMarkerRangesChange = useCallback(
    (ranges: RowRange[]) => {
      const clampedToViewRows = ranges
        .map(([start, end]) => [start, Math.min(end, viewRowCount)] as const)
        .filter(([start, end]) => end > start)
      storeSetCheckedRanges(tabId, clampedToViewRows)
    },
    [storeSetCheckedRanges, tabId, viewRowCount]
  )

  useEffect(() => {
    storeSetCheckedRanges(tabId, [])
  }, [storeSetCheckedRanges, tabId])

  return {
    handleRowMarkerRangesChange: handleRowMarkerRangesChange,
    resetSelectionKey: useSelectionResetKey(checkedRowCount),
  }
}

export function useResultGridStoreState(tabId: string, viewRowCount: number) {
  const selectedCell = useQueryStore((state) => activeResultOf(state, tabId)?.selectedCell ?? null)
  return {
    selectedCell: selectedCell,
    ...useScrollCell(tabId),
    ...useColumnWidths(tabId),
    ...useCheckedRows(tabId, viewRowCount),
  }
}
