import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cellsInDirection,
  sameCellsBelow,
  type ActiveCell,
  type TraversalDirection,
} from '../column-editor-model'
import { cellSelector, isDisabledFormControl, isTextEntryInput } from './column-editor-dom'

export function useColumnCellFocus(columnCount: number) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [pendingFocusCell, setPendingFocusCell] = useState<ActiveCell | null>(null)

  const getCellElement = useCallback(
    (cell: ActiveCell) =>
      containerRef.current?.querySelector<HTMLElement>(cellSelector(cell)) ?? null,
    []
  )

  const isCellFocusable = (cell: ActiveCell): boolean => {
    const element = getCellElement(cell)
    if (!element) return false
    return !isDisabledFormControl(element)
  }

  const focusCell = useCallback(
    (target: ActiveCell) => {
      const element = getCellElement(target)
      if (!element) {
        setPendingFocusCell(target)
        return
      }
      element.focus()
      if (isTextEntryInput(element)) {
        element.select()
      }
    },
    [getCellElement]
  )

  const findAdjacentCell = (from: ActiveCell, direction: TraversalDirection) => {
    const candidates = cellsInDirection({
      from: from,
      direction: direction,
      columnCount: columnCount,
    })
    return candidates.find(isCellFocusable) ?? null
  }

  const findSameCellInNextRow = (from: ActiveCell) =>
    sameCellsBelow(from, columnCount).find(isCellFocusable) ?? null

  useEffect(() => {
    if (!pendingFocusCell) return
    const handle = requestAnimationFrame(() => {
      focusCell(pendingFocusCell)
      setPendingFocusCell(null)
    })
    return () => cancelAnimationFrame(handle)
  }, [columnCount, focusCell, pendingFocusCell])

  return {
    containerRef,
    setPendingFocusCell,
    focusCell,
    findAdjacentCell,
    findSameCellInNextRow,
  }
}
