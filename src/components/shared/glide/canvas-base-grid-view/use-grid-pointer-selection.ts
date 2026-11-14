import { useCallback } from 'react'
import type { CellClickGuardResult } from '../../../../types/shared-data-view'
import type { GridCellPosition } from '../glide-grid-types'
import type { GridRow } from './canvas-grid-types'
import {
  guardTargetCell,
  proceedWithoutGuard,
  restoreFocusAfterRejectedGuard,
} from './grid-hit-testing'
import type { GridSelectionModel, GridViewModel } from './grid-view-model'

export type PointerCellAction = (cell: GridCellPosition, row: GridRow, columnKey: string) => void

interface PointerSelectionInput {
  model: GridViewModel
  selection: GridSelectionModel
  openListEditor: (cell: GridCellPosition) => void
}

function useReportPointerSelection(model: GridViewModel) {
  const { gridColumns, source } = model
  const { onCellSelectionChange } = model.props
  return useCallback(
    (guard: CellClickGuardResult) => {
      const guardedColumn = gridColumns[guard.targetColIdx]
      const guardedRow = source.getRow(guard.targetRowIdx)
      if (!guardedColumn) return
      if (!guardedRow) return
      onCellSelectionChange?.({
        rowIdx: guard.targetRowIdx,
        columnKey: guardedColumn.key,
        rowData: guardedRow,
        source: 'grid-pointer',
      })
    },
    [gridColumns, onCellSelectionChange, source]
  )
}

function useSelectCellFromPointer(input: PointerSelectionInput) {
  const { gridRef } = input.model
  const { onCellClickGuard } = input.model.props
  const { actionPendingRef } = input.model.refs.action
  const { changeSelectedCell, selectRow } = input.selection
  const { openListEditor } = input
  const reportPointerSelection = useReportPointerSelection(input.model)
  return useCallback(
    async (cell: GridCellPosition, row: GridRow, columnKey: string): Promise<void> => {
      if (actionPendingRef.current) return
      const guard = onCellClickGuard
        ? await onCellClickGuard({ rowIdx: cell.rowIdx, columnKey: columnKey, rowData: row })
        : proceedWithoutGuard(cell, false)
      if (!guard.proceed) {
        restoreFocusAfterRejectedGuard(gridRef.current, guard)
        return
      }
      const ok = await changeSelectedCell(guard.targetRowIdx, guard.targetColIdx)
      if (!ok) return
      selectRow(guard.targetRowIdx)
      reportPointerSelection(guard)
      if (guard.enableEditor) openListEditor(guardTargetCell(guard))
    },
    [
      actionPendingRef,
      changeSelectedCell,
      gridRef,
      onCellClickGuard,
      openListEditor,
      reportPointerSelection,
      selectRow,
    ]
  )
}

function useOpenForeignKeyLookupFromPointer(input: PointerSelectionInput): PointerCellAction {
  const { onFkCellAction, onCellSelectionChange, onRowClick } = input.model.props
  const { changeSelectedCell, selectRow } = input.selection
  const runForeignKeyLookupFromPointer = useCallback(
    async (cell: GridCellPosition, row: GridRow, columnKey: string): Promise<void> => {
      const ok = await changeSelectedCell(cell.rowIdx, cell.idx)
      if (!ok) return
      selectRow(cell.rowIdx)
      await onFkCellAction?.({
        rowIdx: cell.rowIdx,
        columnKey: columnKey,
        rowData: row,
        source: 'grid-pointer',
      })
    },
    [changeSelectedCell, onFkCellAction, selectRow]
  )
  return useCallback(
    (cell: GridCellPosition, row: GridRow, columnKey: string): void => {
      void runForeignKeyLookupFromPointer(cell, row, columnKey)
      onCellSelectionChange?.({ rowIdx: cell.rowIdx, columnKey: columnKey, rowData: row })
      onRowClick?.(row, columnKey)
    },
    [onCellSelectionChange, onRowClick, runForeignKeyLookupFromPointer]
  )
}

export function useGridPointerSelection(input: PointerSelectionInput) {
  const selectCellFromPointer = useSelectCellFromPointer(input)
  const openForeignKeyLookupFromPointer = useOpenForeignKeyLookupFromPointer(input)
  return { selectCellFromPointer, openForeignKeyLookupFromPointer }
}
