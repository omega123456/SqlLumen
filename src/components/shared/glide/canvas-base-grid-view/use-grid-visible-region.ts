import { useCallback, useEffect, type RefObject } from 'react'
import type { Rectangle } from '@glideapps/glide-data-grid'
import type { GridHandle } from '../glide-grid-types'
import type { ScrollCell } from './canvas-grid-types'
import { cellsInRowSpan, visibleRepaintRange } from './grid-row-ranges'
import { clampScrollCell, isSameScrollCell } from './grid-selection-helpers'
import type { GridScrollRefs, GridViewModel } from './grid-view-model'

interface PendingRestoreRetry {
  gridRef: RefObject<GridHandle | null>
  scrollRefs: GridScrollRefs
}

function regionScrollCell(range: Rectangle): ScrollCell {
  return clampScrollCell(
    { scrollRow: range.y, scrollCol: range.x },
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER
  )
}

function retryPendingScrollRestore(retry: PendingRestoreRetry): void {
  const { gridRef, scrollRefs } = retry
  const pending = scrollRefs.pendingInitialScrollRestoreRef.current
  if (!pending) return
  requestAnimationFrame(() => {
    if (isSameScrollCell(scrollRefs.pendingInitialScrollRestoreRef.current, pending)) {
      gridRef.current?.scrollToCell({ rowIdx: pending.scrollRow, idx: pending.scrollCol })
    }
  })
}

function recordReportedScrollCell(scrollRefs: GridScrollRefs, scrollCell: ScrollCell): void {
  scrollRefs.pendingInitialScrollRestoreRef.current = null
  scrollRefs.lastReportedScrollCellRef.current = scrollCell
}

function resolvePendingScrollRestore(scrollRefs: GridScrollRefs): void {
  scrollRefs.pendingInitialScrollRestoreRef.current = null
  scrollRefs.suppressScrollPersistenceRef.current = false
}

function rememberVisibleRegion(regionRef: RefObject<Rectangle | null>, range: Rectangle): void {
  regionRef.current = range
}

function useRepaintLoadedRows(model: GridViewModel): void {
  const { source, gridRef } = model
  const { lastVisibleRegionRef } = model.refs.action
  const gridColumnCount = model.gridColumns.length
  useEffect(() => {
    if (!source.subscribe) return undefined
    return source.subscribe((loadedRange, info) => {
      const region = lastVisibleRegionRef.current
      if (info?.reseeded && region) {
        source.onVisibleRangeChange?.([region.y, region.y + region.height])
      }
      const [from, to] = visibleRepaintRange(loadedRange, region)
      if (to <= from) return
      gridRef.current?.updateCells?.(cellsInRowSpan([from, to], gridColumnCount))
    })
  }, [gridColumnCount, gridRef, lastVisibleRegionRef, source])
}

export function useGridVisibleRegion(model: GridViewModel, cancelActiveEditor: () => void) {
  const { source, gridRef } = model
  const { onScrollCellChange } = model.props
  const scrollRefs = model.refs.scroll
  const { lastVisibleRegionRef } = model.refs.action
  useRepaintLoadedRows(model)

  return useCallback(
    (range: Rectangle) => {
      rememberVisibleRegion(lastVisibleRegionRef, range)
      source.onVisibleRangeChange?.([range.y, range.y + range.height])
      cancelActiveEditor()
      const scrollCell = regionScrollCell(range)
      if (isSameScrollCell(scrollRefs.pendingInitialScrollRestoreRef.current, scrollCell)) {
        resolvePendingScrollRestore(scrollRefs)
        return
      }
      if (scrollRefs.suppressScrollPersistenceRef.current) {
        retryPendingScrollRestore({ gridRef: gridRef, scrollRefs: scrollRefs })
        return
      }
      recordReportedScrollCell(scrollRefs, scrollCell)
      onScrollCellChange?.(scrollCell.scrollRow, scrollCell.scrollCol)
    },
    [cancelActiveEditor, gridRef, lastVisibleRegionRef, onScrollCellChange, scrollRefs, source]
  )
}
