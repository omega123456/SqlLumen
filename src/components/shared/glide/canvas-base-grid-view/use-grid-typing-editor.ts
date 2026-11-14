import { useCallback } from 'react'
import type { CellClickGuardResult } from '../../../../types/shared-data-view'
import type { GridCellPosition } from '../glide-grid-types'
import type { GlideKeyDownEvent } from './canvas-grid-types'
import {
  canStartTypedEdit,
  resolveEditorBaselineValue,
  type TypingActivationRequest,
} from './grid-cell-editing'
import { isListSelectionColumn } from './grid-columns'
import {
  proceedWithoutGuard,
  restoreFocusAfterRejectedGuard,
  selectGuardTarget,
} from './grid-hit-testing'
import { cancelGlideKey } from './grid-selection-helpers'
import type { GridEditorRefs, GridSelectionModel, GridViewModel } from './grid-view-model'

export type TypingActivationHandler = (
  event: GlideKeyDownEvent,
  currentCell: GridCellPosition
) => void

interface TypingEditorInput {
  model: GridViewModel
  selection: GridSelectionModel
}

function rememberTypingActivation(
  editorRefs: GridEditorRefs,
  guard: CellClickGuardResult,
  request: TypingActivationRequest
): void {
  editorRefs.pendingTypingActivationRef.current = {
    rowIndex: guard.targetRowIdx,
    columnKey: request.columnKey,
    value: request.typedValue,
    cancelRestoreValue: request.cancelRestoreValue,
  }
}

function useStartTypingEditor(input: TypingEditorInput) {
  const { gridRef, gridColumns } = input.model
  const { onCellClickGuard, editableColumnKeys } = input.model.props
  const editorRefs = input.model.refs.editor
  const { changeSelectedCell, selectRow } = input.selection
  return useCallback(
    async (request: TypingActivationRequest): Promise<void> => {
      const guard = onCellClickGuard
        ? await onCellClickGuard({
            rowIdx: request.cell.rowIdx,
            columnKey: request.columnKey,
            rowData: request.row,
            source: 'keyboard-typing',
          })
        : proceedWithoutGuard(request.cell, true)
      if (!guard.proceed) {
        restoreFocusAfterRejectedGuard(gridRef.current, guard)
        return
      }
      const ok = await changeSelectedCell(guard.targetRowIdx, guard.targetColIdx)
      if (!ok) return
      selectRow(guard.targetRowIdx)
      const targetColumn = gridColumns[guard.targetColIdx]
      if (canStartTypedEdit(guard, targetColumn, editableColumnKeys)) {
        rememberTypingActivation(editorRefs, guard, { ...request, columnKey: targetColumn.key })
      }
      selectGuardTarget(gridRef.current, guard)
    },
    [
      changeSelectedCell,
      editableColumnKeys,
      editorRefs,
      gridColumns,
      gridRef,
      onCellClickGuard,
      selectRow,
    ]
  )
}

export function useGridTypingEditor(input: TypingEditorInput): TypingActivationHandler {
  const { gridColumns, source } = input.model
  const { editState } = input.model.props
  const { actionPendingRef } = input.model.refs.action
  const startTypingEditor = useStartTypingEditor(input)
  return useCallback(
    (event: GlideKeyDownEvent, currentCell: GridCellPosition) => {
      if (actionPendingRef.current) {
        cancelGlideKey(event)
        return
      }
      const currentRow = source.getRow(currentCell.rowIdx)
      const currentColumn = gridColumns[currentCell.idx]
      if (!currentRow) return
      if (!currentColumn) return
      cancelGlideKey(event)
      if (isListSelectionColumn(currentColumn)) return
      void startTypingEditor({
        cell: currentCell,
        row: currentRow,
        columnKey: currentColumn.key,
        typedValue: event.key,
        cancelRestoreValue: resolveEditorBaselineValue(currentRow, currentColumn.key, editState),
      })
    },
    [actionPendingRef, editState, gridColumns, source, startTypingEditor]
  )
}
