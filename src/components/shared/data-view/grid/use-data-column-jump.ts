import { useCallback, useEffect, useMemo, type RefObject } from 'react'
import { columnKey } from '../../../../lib/col-key-utils'
import type { CellClickGuardArgs } from '../../../../types/shared-data-view'
import type { ColumnMeta } from '../../../../types/schema'
import type { DataViewSurfaceRef } from '../../../../stores/data-view/data-view-types'
import { rowAt } from '../../../../stores/data-view/data-view-selectors'
import { currentView } from '../../../../stores/data-view/use-data-view'
import { setSelectedCell } from '../../../../stores/data-view/view-actions'
import type { GridHandle } from '../../glide/glide-grid-types'
import type { ColumnJumpTarget, DataViewColumnJump } from '../data-view-source'

type CellSelectionChange = (args: CellClickGuardArgs) => void

function columnIndexOfName(columns: ColumnMeta[], columnName: string | null): number {
  if (columnName === null) return -1
  return columns.findIndex((column) => column.name === columnName)
}

function selectedRowOf(ref: DataViewSurfaceRef) {
  const view = currentView(ref)
  const selectedRowIndex = view.selection.rowIndex
  if (selectedRowIndex === null) return undefined
  return rowAt(ref, view, selectedRowIndex)?.row
}

function movesSelectedCell(ref: DataViewSurfaceRef, target: ColumnJumpTarget): boolean {
  const selectedCell = currentView(ref).selection.cell
  if (!selectedCell) return false
  return selectedCell.columnKey !== target.columnName
}

interface ColumnJumpRun {
  ref: DataViewSurfaceRef
  gridRef: RefObject<GridHandle | null>
  target: ColumnJumpTarget
  columnIndex: number
}

function runColumnJump({ ref, gridRef, target, columnIndex }: ColumnJumpRun) {
  const selectedRow = selectedRowOf(ref)
  const shouldMoveSelection = selectedRow !== undefined && movesSelectedCell(ref, target)
  if (shouldMoveSelection) {
    setSelectedCell(ref, { columnKey: target.columnName, value: selectedRow[columnIndex] })
    return
  }
  gridRef.current?.scrollToCell({ idx: columnIndex }, 'horizontal')
}

function isPointerOrUnknownSource(source: CellClickGuardArgs['source']): boolean {
  return !source || source === 'grid-pointer'
}

export interface DataColumnJumpInputs {
  ref: DataViewSurfaceRef
  gridRef: RefObject<GridHandle | null>
  columns: ColumnMeta[]
  columnJump: DataViewColumnJump | null
  onCellSelectionChange: CellSelectionChange | undefined
}

export function useDataColumnJump(inputs: DataColumnJumpInputs) {
  const { ref, gridRef, columns, columnJump, onCellSelectionChange } = inputs
  const target = columnJump?.target ?? null
  const consume = columnJump?.consume
  const clearHighlight = columnJump?.clearHighlight
  const highlightedColumn = columnJump?.highlightedColumn ?? null

  useEffect(() => {
    if (!target) return
    const columnIndex = columnIndexOfName(columns, target.columnName)
    if (columnIndex < 0) return
    runColumnJump({ ref: ref, gridRef: gridRef, target: target, columnIndex: columnIndex })
    consume?.()
  }, [columns, consume, gridRef, ref, target])

  const highlightColumnKey = useMemo(() => {
    const columnIndex = columnIndexOfName(columns, highlightedColumn)
    return columnIndex < 0 ? undefined : columnKey(columnIndex)
  }, [columns, highlightedColumn])

  const clearingCellSelectionChange = useCallback(
    (args: CellClickGuardArgs) => {
      if (isPointerOrUnknownSource(args.source)) clearHighlight?.()
      onCellSelectionChange?.(args)
    },
    [clearHighlight, onCellSelectionChange]
  )
  const handleCellSelectionChange = columnJump ? clearingCellSelectionChange : onCellSelectionChange

  return { highlightColumnKey, handleCellSelectionChange }
}
