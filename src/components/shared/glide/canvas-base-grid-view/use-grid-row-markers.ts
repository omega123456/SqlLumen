import { useCallback } from 'react'
import { CompactSelection, type GridSelection } from '@glideapps/glide-data-grid'
import type { GridColumn } from '../glide-grid-types'
import type { GridRow } from './canvas-grid-types'
import { isListSelectionColumn } from './grid-columns'
import { haveSameRowIndexes, selectionRowRanges, withoutUnloadedRowCheck } from './grid-row-ranges'
import { currentSelectionCell, toCellPosition } from './grid-selection-helpers'
import {
  markedRangesKeyOf,
  type GridSelectionModel,
  type GridSelectionRefs,
  type GridViewModel,
} from './grid-view-model'

interface RowMarkersInput {
  model: GridViewModel
  selection: GridSelectionModel
}

function rememberSelectedCell(
  selectionRefs: GridSelectionRefs,
  selection: GridSelection,
  gridColumns: GridColumn<GridRow>[]
): void {
  const selectedCell = toCellPosition(currentSelectionCell(selection))
  if (!selectedCell) return
  selectionRefs.lastInteractedCellRef.current = selectedCell
  const column = gridColumns[selectedCell.idx]
  selectionRefs.lastSelectedListCellRef.current = isListSelectionColumn(column)
    ? selectedCell
    : null
}

function useReportRowMarkerRanges(model: GridViewModel) {
  const { onRowMarkerRangesChange } = model.props
  const { previousMarkedRangesKeyRef } = model.refs.selection
  return useCallback(
    (rows: CompactSelection) => {
      const ranges = selectionRowRanges(rows)
      const key = markedRangesKeyOf(ranges)
      if (key === previousMarkedRangesKeyRef.current) return
      previousMarkedRangesKeyRef.current = key
      onRowMarkerRangesChange?.(ranges)
    },
    [onRowMarkerRangesChange, previousMarkedRangesKeyRef]
  )
}

function useReportMarkedRows(model: GridViewModel) {
  const { source } = model
  const { onRowMarkersChange } = model.props
  const { previousMarkedRowsRef } = model.refs.selection
  return useCallback(
    (rows: CompactSelection) => {
      if (!onRowMarkersChange) return
      const selectedRowIndices = [...rows]
      if (haveSameRowIndexes(selectedRowIndices, previousMarkedRowsRef.current)) return
      previousMarkedRowsRef.current = selectedRowIndices
      const selected = selectedRowIndices
        .map((rowIndex) => source.getRow(rowIndex))
        .filter((row): row is GridRow => row != null)
      onRowMarkersChange(selected)
    },
    [onRowMarkersChange, previousMarkedRowsRef, source]
  )
}

export function useGridRowMarkers(input: RowMarkersInput) {
  const { gridColumns, isWindowed, source } = input.model
  const { onRowMarkerRangesChange } = input.model.props
  const selectionRefs = input.model.refs.selection
  const { gridSelection, setGridSelection } = input.selection
  const reportRowMarkerRanges = useReportRowMarkerRanges(input.model)
  const reportMarkedRows = useReportMarkedRows(input.model)
  return useCallback(
    (nextSelection: GridSelection) => {
      const previousRows = gridSelection?.rows ?? CompactSelection.empty()
      const selection = isWindowed
        ? withoutUnloadedRowCheck(nextSelection, previousRows, source)
        : nextSelection
      setGridSelection(selection)
      rememberSelectedCell(selectionRefs, selection, gridColumns)
      const reportsRanges = isWindowed && onRowMarkerRangesChange !== undefined
      if (reportsRanges) {
        reportRowMarkerRanges(selection.rows)
        return
      }
      reportMarkedRows(selection.rows)
    },
    [
      gridColumns,
      gridSelection,
      isWindowed,
      onRowMarkerRangesChange,
      reportMarkedRows,
      reportRowMarkerRanges,
      selectionRefs,
      setGridSelection,
      source,
    ]
  )
}
