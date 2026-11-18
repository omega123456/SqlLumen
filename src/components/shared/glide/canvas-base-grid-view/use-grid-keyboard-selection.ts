import { useCallback } from 'react'
import type { Item } from '@glideapps/glide-data-grid'
import type { CellClickGuardArgs, CellClickGuardResult } from '../../../../types/shared-data-view'
import type { GridCellPosition } from '../glide-grid-types'
import { restoreFocusAfterRejectedGuard, selectGuardTarget } from './grid-hit-testing'
import {
  clampIndex,
  currentSelectionCell,
  resolveKeyboardCell,
  resolveKeyboardColumn,
  resolveKeyboardRow,
} from './grid-selection-helpers'
import type { GridSelectionModel, GridViewModel } from './grid-view-model'

type SelectionStep = -1 | 1

export type SelectionMove = (delta: SelectionStep, currentCell: GridCellPosition | null) => void
export type EditorExitMove = (movement: Item) => void

interface KeyboardSelectionInput {
  model: GridViewModel
  selection: GridSelectionModel
}

type KeyboardSelectionApplier = (request: CellClickGuardArgs, columnIndex: number) => Promise<void>

function useSelectCellWithoutEditor(model: GridViewModel) {
  const { gridRef } = model
  return useCallback(
    (cell: GridCellPosition) => {
      gridRef.current?.selectCell(cell, { shouldFocusCell: true, enableEditor: false })
    },
    [gridRef]
  )
}

function useApplyGuardedKeyboardSelection(input: KeyboardSelectionInput) {
  const { gridRef, gridColumns, source } = input.model
  const { onCellSelectionChange } = input.model.props
  const { changeSelectedCell, selectRow } = input.selection
  return useCallback(
    async (guard: CellClickGuardResult, request: CellClickGuardArgs): Promise<void> => {
      if (!guard.proceed) {
        restoreFocusAfterRejectedGuard(gridRef.current, guard)
        return
      }
      const ok = await changeSelectedCell(guard.targetRowIdx, guard.targetColIdx)
      if (!ok) return
      selectRow(guard.targetRowIdx)
      selectGuardTarget(gridRef.current, guard)
      onCellSelectionChange?.({
        rowIdx: guard.targetRowIdx,
        columnKey: gridColumns[guard.targetColIdx]?.key ?? request.columnKey,
        rowData: source.getRow(guard.targetRowIdx) ?? request.rowData,
        source: 'keyboard',
      })
    },
    [changeSelectedCell, gridColumns, gridRef, onCellSelectionChange, selectRow, source]
  )
}

function useApplyKeyboardSelection(input: KeyboardSelectionInput): KeyboardSelectionApplier {
  const { onCellClickGuard, onCellSelectionChange } = input.model.props
  const { runCellClickGuardOnKeyboardSelection } = input.model.flags
  const { changeSelectedCell, selectRow } = input.selection
  const selectCellWithoutEditor = useSelectCellWithoutEditor(input.model)
  const applyGuardedKeyboardSelection = useApplyGuardedKeyboardSelection(input)
  return useCallback(
    async (request: CellClickGuardArgs, columnIndex: number): Promise<void> => {
      const shouldGuardKeyboardSelection =
        runCellClickGuardOnKeyboardSelection && onCellClickGuard !== undefined
      if (shouldGuardKeyboardSelection) {
        const guard = await onCellClickGuard(request)
        await applyGuardedKeyboardSelection(guard, request)
        return
      }
      const ok = await changeSelectedCell(request.rowIdx, columnIndex)
      if (!ok) return
      selectRow(request.rowIdx)
      selectCellWithoutEditor({ rowIdx: request.rowIdx, idx: columnIndex })
      onCellSelectionChange?.(request)
    },
    [
      applyGuardedKeyboardSelection,
      changeSelectedCell,
      onCellClickGuard,
      onCellSelectionChange,
      runCellClickGuardOnKeyboardSelection,
      selectCellWithoutEditor,
      selectRow,
    ]
  )
}

function useMoveSelectionVertically(input: KeyboardSelectionInput): SelectionMove {
  const { gridColumns, rowCount, source } = input.model
  const { activeSelectedRowIndex, selectRow } = input.selection
  const selectCellWithoutEditor = useSelectCellWithoutEditor(input.model)
  const applyKeyboardSelection = useApplyKeyboardSelection(input)
  return useCallback(
    (delta: -1 | 1, currentCell: GridCellPosition | null) => {
      const currentRow = resolveKeyboardRow(currentCell, activeSelectedRowIndex)
      const nextRow = clampIndex(currentRow + delta, rowCount - 1)
      const nextColumnIndex = resolveKeyboardColumn(currentCell)
      const isAtGridEdge = nextRow === currentRow && currentCell !== null
      if (isAtGridEdge) {
        if (activeSelectedRowIndex !== nextRow) selectRow(nextRow)
        selectCellWithoutEditor({ rowIdx: nextRow, idx: nextColumnIndex })
        return
      }
      const nextRowData = source.getRow(nextRow)
      const nextColumn = gridColumns[nextColumnIndex]
      if (!nextRowData) return
      if (!nextColumn) return
      const request: CellClickGuardArgs = {
        rowIdx: nextRow,
        columnKey: nextColumn.key,
        rowData: nextRowData,
        source: 'keyboard',
      }
      void applyKeyboardSelection(request, nextColumnIndex)
    },
    [
      activeSelectedRowIndex,
      applyKeyboardSelection,
      gridColumns,
      rowCount,
      selectCellWithoutEditor,
      selectRow,
      source,
    ]
  )
}

function useMoveSelectionHorizontally(input: KeyboardSelectionInput): SelectionMove {
  const columnCount = input.model.gridColumns.length
  const { activeSelectedRowIndex, changeSelectedCell } = input.selection
  const selectCellWithoutEditor = useSelectCellWithoutEditor(input.model)
  return useCallback(
    (delta: -1 | 1, currentCell: GridCellPosition | null) => {
      const currentRow = resolveKeyboardRow(currentCell, activeSelectedRowIndex)
      const currentColumn = resolveKeyboardColumn(currentCell)
      const nextColumn = clampIndex(currentColumn + delta, columnCount - 1)
      if (nextColumn !== currentColumn) {
        void changeSelectedCell(currentRow, nextColumn)
      }
      selectCellWithoutEditor({ rowIdx: currentRow, idx: nextColumn })
    },
    [activeSelectedRowIndex, changeSelectedCell, columnCount, selectCellWithoutEditor]
  )
}

function horizontalStepOf(movement: Item): SelectionStep | null {
  const [columnDelta] = movement
  if (columnDelta > 0) return 1
  if (columnDelta < 0) return -1
  return null
}

function useMoveSelectionAfterEditing(
  input: KeyboardSelectionInput,
  moveSelectionHorizontally: SelectionMove
): EditorExitMove {
  const { selectedCellPosition } = input.model.props
  const gridSelectionCell = currentSelectionCell(input.selection.gridSelection)
  return useCallback(
    (movement: Item) => {
      const step = horizontalStepOf(movement)
      if (step === null) return
      const editedCell = resolveKeyboardCell(gridSelectionCell, selectedCellPosition)
      moveSelectionHorizontally(step, editedCell)
    },
    [gridSelectionCell, moveSelectionHorizontally, selectedCellPosition]
  )
}

export function useGridKeyboardSelection(input: KeyboardSelectionInput) {
  const moveSelectionVertically = useMoveSelectionVertically(input)
  const moveSelectionHorizontally = useMoveSelectionHorizontally(input)
  const moveSelectionAfterEditing = useMoveSelectionAfterEditing(input, moveSelectionHorizontally)
  return { moveSelectionVertically, moveSelectionHorizontally, moveSelectionAfterEditing }
}
