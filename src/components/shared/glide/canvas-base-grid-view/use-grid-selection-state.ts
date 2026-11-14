import { useCallback, useLayoutEffect, useMemo, useState, type RefObject } from 'react'
import type { GridSelection } from '@glideapps/glide-data-grid'
import type { GridCellPosition, GridHandle } from '../glide-grid-types'
import type { GridRowSource } from '../grid-row-source'
import type { CanvasBaseGridViewProps, GridRow } from './canvas-grid-types'
import { withoutCheckedRows } from './grid-row-ranges'
import { selectionWithFocusedCell } from './grid-selection-helpers'
import { NO_MARKED_RANGES_KEY, type GridSelectionModel } from './grid-view-model'

interface GridSelectionStateInput {
  props: CanvasBaseGridViewProps
  gridRef: RefObject<GridHandle | null>
  source: GridRowSource<GridRow>
  previousMarkedRangesKeyRef: RefObject<string>
}

interface ResetCheckedRowsInput {
  resetSelectionKey: number | undefined
  previousMarkedRangesKeyRef: RefObject<string>
  setGridSelection: GridSelectionModel['setGridSelection']
}

function useResetCheckedRowsOnKeyChange(input: ResetCheckedRowsInput): void {
  const { resetSelectionKey, previousMarkedRangesKeyRef, setGridSelection } = input
  const [lastResetSelectionKey, setLastResetSelectionKey] = useState<number | undefined>(
    resetSelectionKey
  )
  const hasNewResetSelectionKey =
    resetSelectionKey != null && lastResetSelectionKey !== resetSelectionKey
  if (hasNewResetSelectionKey) {
    setLastResetSelectionKey(resetSelectionKey)
    setGridSelection(withoutCheckedRows)
  }
  useLayoutEffect(() => {
    if (resetSelectionKey == null) return
    previousMarkedRangesKeyRef.current = NO_MARKED_RANGES_KEY
  }, [previousMarkedRangesKeyRef, resetSelectionKey])
}

function useActiveGridSelection(
  gridSelection: GridSelection | undefined,
  selectedCellPosition: GridCellPosition | null | undefined
): GridSelection | undefined {
  return useMemo<GridSelection | undefined>(() => {
    if (!selectedCellPosition) return gridSelection
    return selectionWithFocusedCell(gridSelection, selectedCellPosition)
  }, [gridSelection, selectedCellPosition])
}

export function useGridSelectionState(input: GridSelectionStateInput): GridSelectionModel {
  const { props, gridRef, source, previousMarkedRangesKeyRef } = input
  const { selectedRowIndex, selectedCellPosition, onRowChanging, onSelectedCellChange } = props
  const { onSelectedRowChange } = props
  const [internalSelectedRowIndex, setInternalSelectedRowIndex] = useState<number | null>(null)
  const [gridSelection, setGridSelection] = useState<GridSelection | undefined>(undefined)
  const activeSelectedRowIndex = selectedRowIndex ?? internalSelectedRowIndex
  const activeGridSelection = useActiveGridSelection(gridSelection, selectedCellPosition)
  useResetCheckedRowsOnKeyChange({
    resetSelectionKey: props.resetSelectionKey,
    previousMarkedRangesKeyRef: previousMarkedRangesKeyRef,
    setGridSelection: setGridSelection,
  })

  const changeSelectedCell = useCallback(
    async (rowIndex: number, columnIndex: number): Promise<boolean> => {
      const fromRow = selectedCellPosition?.rowIdx ?? activeSelectedRowIndex
      const isLeavingRow = fromRow != null && fromRow !== rowIndex
      const shouldAskBeforeLeaving = isLeavingRow && onRowChanging !== undefined
      const canLeave = shouldAskBeforeLeaving ? await onRowChanging(fromRow, rowIndex) : true
      if (!canLeave) {
        if (selectedCellPosition) {
          gridRef.current?.selectCell(selectedCellPosition, { shouldFocusCell: true })
        }
        return false
      }
      onSelectedCellChange?.({ rowIdx: rowIndex, idx: columnIndex })
      return true
    },
    [activeSelectedRowIndex, gridRef, onRowChanging, onSelectedCellChange, selectedCellPosition]
  )

  const selectRow = useCallback(
    (rowIndex: number | null) => {
      const row = rowIndex == null ? null : (source.getRow(rowIndex) ?? null)
      const nextIndex = row == null ? null : rowIndex
      setInternalSelectedRowIndex(nextIndex)
      onSelectedRowChange?.(row, nextIndex)
    },
    [onSelectedRowChange, source]
  )

  return {
    gridSelection: gridSelection,
    setGridSelection: setGridSelection,
    activeGridSelection: activeGridSelection,
    activeSelectedRowIndex: activeSelectedRowIndex,
    selectRow: selectRow,
    changeSelectedCell: changeSelectedCell,
  }
}
