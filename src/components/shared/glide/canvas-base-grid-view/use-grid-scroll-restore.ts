import { useEffect, useImperativeHandle, useLayoutEffect, type RefObject } from 'react'
import { isPresentIndex } from '../../../../lib/value-checks'
import type { GridHandle } from '../glide-grid-types'
import type { ScrollCell } from './canvas-grid-types'
import { clampScrollCell, isSameScrollCell } from './grid-selection-helpers'
import type { GridScrollRefs, GridViewModel } from './grid-view-model'

interface ScrollRestoreRequest {
  target: ScrollCell
  gridRef: RefObject<GridHandle | null>
  scrollRefs: GridScrollRefs
}

function releaseScrollRestore(scrollRefs: GridScrollRefs): void {
  scrollRefs.pendingInitialScrollRestoreRef.current = null
  scrollRefs.suppressScrollPersistenceRef.current = false
}

function acceptReportedScrollCell(scrollRefs: GridScrollRefs, reported: ScrollCell): void {
  scrollRefs.lastAppliedInitialScrollRef.current = reported
  releaseScrollRestore(scrollRefs)
}

function scheduleScrollRestore(request: ScrollRestoreRequest): () => void {
  const { target, gridRef, scrollRefs } = request
  const { pendingInitialScrollRestoreRef, suppressScrollPersistenceRef } = scrollRefs
  scrollRefs.lastAppliedInitialScrollRef.current = target
  pendingInitialScrollRestoreRef.current = target
  suppressScrollPersistenceRef.current = true

  let releaseSuppressionFrameId = 0
  const restoreFrameId = requestAnimationFrame(() => {
    if (!isSameScrollCell(pendingInitialScrollRestoreRef.current, target)) return
    gridRef.current?.scrollToCell({ rowIdx: target.scrollRow, idx: target.scrollCol })
    releaseSuppressionFrameId = requestAnimationFrame(() => {
      // Only release suppression if the pending restore already resolved
      // (handleVisibleRegionChanged saw the target position). When the
      // DataEditor was not yet mounted during the scrollToCell call above,
      // pendingInitialScrollRestoreRef is still set and suppression must stay
      // active so handleVisibleRegionChanged can retry the scroll.
      if (pendingInitialScrollRestoreRef.current === null) {
        suppressScrollPersistenceRef.current = false
      }
    })
  })

  return () => {
    cancelAnimationFrame(restoreFrameId)
    if (releaseSuppressionFrameId !== 0) {
      cancelAnimationFrame(releaseSuppressionFrameId)
    }
    if (isSameScrollCell(pendingInitialScrollRestoreRef.current, target)) {
      pendingInitialScrollRestoreRef.current = null
    }
    suppressScrollPersistenceRef.current = false
  }
}

function useInitialScrollRestore(model: GridViewModel): void {
  const { gridRef, rowCount } = model
  const { initialScrollCell } = model.props
  const scrollRefs = model.refs.scroll
  const columnCount = model.gridColumns.length

  useLayoutEffect(() => {
    const hasCells = rowCount > 0 && columnCount > 0
    if (!initialScrollCell) return
    if (!hasCells) return
    const normalized = clampScrollCell(initialScrollCell, rowCount - 1, columnCount - 1)
    if (isSameScrollCell(scrollRefs.lastAppliedInitialScrollRef.current, normalized)) return
    if (isSameScrollCell(scrollRefs.lastReportedScrollCellRef.current, normalized)) {
      acceptReportedScrollCell(scrollRefs, normalized)
      return
    }
    return scheduleScrollRestore({ target: normalized, gridRef: gridRef, scrollRefs: scrollRefs })
  }, [columnCount, gridRef, initialScrollCell, rowCount, scrollRefs])
}

export function useGridImperativeHandle(ref: React.Ref<GridHandle>, model: GridViewModel): void {
  const { gridRef } = model
  const scrollRefs = model.refs.scroll
  useImperativeHandle(
    ref,
    () => ({
      scrollToCell: (position, axis) => {
        releaseScrollRestore(scrollRefs)
        gridRef.current?.scrollToCell(position, axis)
      },
      selectCell: (position, options) => {
        releaseScrollRestore(scrollRefs)
        gridRef.current?.selectCell(position, options)
      },
      get element() {
        return gridRef.current?.element ?? null
      },
    }),
    [gridRef, scrollRefs]
  )
}

export function useGridScrollRestore(model: GridViewModel): void {
  const { gridRef } = model
  const { scrollToRowIndex } = model.props
  useInitialScrollRestore(model)
  useEffect(() => {
    if (!isPresentIndex(scrollToRowIndex)) return
    requestAnimationFrame(() => {
      gridRef.current?.selectCell({ rowIdx: scrollToRowIndex, idx: 0 }, { shouldFocusCell: true })
    })
  }, [gridRef, scrollToRowIndex])
}
