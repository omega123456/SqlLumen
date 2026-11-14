import { useCallback } from 'react'
import type { GridSelection, Rectangle } from '@glideapps/glide-data-grid'
import type { GridColumn } from '../glide-grid-types'
import type { GridRow, RowLookup } from './canvas-grid-types'
import { buildClearedCell, clearedValueFor } from './grid-cell-builders'
import { isClearableColumn } from './grid-columns'
import { rectRowRanges } from './grid-row-ranges'
import { selectionRects } from './grid-selection-helpers'
import type { GridViewModel } from './grid-view-model'
import type { CellEditHandler } from './use-grid-cell-edit-commit'
import type { RowActionRunner } from './use-grid-row-action-runner'

export type CellRangeClearer = (range: Rectangle, rowAt: RowLookup) => void

interface RowClearRequest {
  rowIndex: number
  range: Rectangle
  gridColumns: GridColumn<GridRow>[]
  handleCellEdited: CellEditHandler
  nextRows: GridRow[]
}

interface GridClearInput {
  model: GridViewModel
  handleCellEdited: CellEditHandler
  runRowAction: RowActionRunner
}

function clearCellsInRow(request: RowClearRequest): boolean {
  const { rowIndex, range, gridColumns, nextRows } = request
  let changed = false
  for (let columnIndex = range.x; columnIndex < range.x + range.width; columnIndex += 1) {
    const column = gridColumns[columnIndex]
    if (!isClearableColumn(column)) continue
    const clearedValue = clearedValueFor(column)
    const clearedCell = buildClearedCell(column, clearedValue)
    if (!clearedCell) continue
    request.handleCellEdited([columnIndex, rowIndex], clearedCell)
    nextRows[rowIndex] = { ...nextRows[rowIndex], [column.key]: clearedValue }
    changed = true
  }
  return changed
}

function useClearCellsWithRows(input: GridClearInput): CellRangeClearer {
  const { gridColumns, isWindowed } = input.model
  const { onRowsChange, rows: rowsProp } = input.model.props
  const { handleCellEdited } = input
  return useCallback(
    (range: Rectangle, rowAt: RowLookup) => {
      const nextRows = isWindowed ? [] : rowsProp.slice()
      const changedIndexes = new Set<number>()
      for (let rowIndex = range.y; rowIndex < range.y + range.height; rowIndex += 1) {
        if (!rowAt(rowIndex)) continue
        const request = { rowIndex, range, gridColumns, handleCellEdited, nextRows }
        if (clearCellsInRow(request)) changedIndexes.add(rowIndex)
      }
      const shouldReportRows = changedIndexes.size > 0 && !isWindowed
      if (shouldReportRows) {
        onRowsChange?.(nextRows, { indexes: [...changedIndexes], column: gridColumns[range.x] })
      }
    },
    [gridColumns, handleCellEdited, isWindowed, onRowsChange, rowsProp]
  )
}

export function useGridClear(input: GridClearInput) {
  const { gridColumns, isWindowed, rowCount } = input.model
  const { isEditMode } = input.model.props
  const { actionPendingRef } = input.model.refs.action
  const { runRowAction } = input
  const clearCellsWithRows = useClearCellsWithRows(input)

  const clearSelection = useCallback(
    (selection: GridSelection): boolean => {
      if (actionPendingRef.current) return false
      const rects = selectionRects({
        selection: selection,
        columnCount: gridColumns.length,
        rowCount: rowCount,
      })
      if (rects.length === 0) return false
      const isReadOnlyWindow = isWindowed && isEditMode !== true
      if (isReadOnlyWindow) return false
      void runRowAction('Clearing', rectRowRanges(rects), (rowAt) => {
        rects.forEach((rect) => clearCellsWithRows(rect, rowAt))
        return true
      })
      return false
    },
    [
      actionPendingRef,
      clearCellsWithRows,
      gridColumns.length,
      isEditMode,
      isWindowed,
      rowCount,
      runRowAction,
    ]
  )

  return { clearCellsWithRows, clearSelection }
}
