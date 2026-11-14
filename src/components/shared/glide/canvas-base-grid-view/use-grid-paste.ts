import { useCallback, type RefObject } from 'react'
import type { Item } from '@glideapps/glide-data-grid'
import { readClipboardText } from '../../../../lib/context-menu-utils'
import { showWarningToast } from '../../../../stores/toast-store'
import type { GridColumn } from '../glide-grid-types'
import type { GridRowSource } from '../grid-row-source'
import type { GridRow } from './canvas-grid-types'
import { isReadOnlyCell } from './grid-cell-builders'
import { isInfoColumn, isListSelectionColumn } from './grid-columns'
import { pasteTextIntoCell } from './grid-list-cells'
import { reportClipboardReadFailure } from './grid-row-action-feedback'
import { hasPasteLine, isRowInGrid, parseClipboardLines } from './grid-selection-helpers'
import type { GridViewModel } from './grid-view-model'
import type { CellEditHandler } from './use-grid-cell-edit-commit'
import type { CellForRowBuilder } from './use-grid-cell-content'
import type { RowActionRunner } from './use-grid-row-action-runner'

type PasteValues = readonly (readonly string[])[]
type PasteHandler = (target: Item, values: PasteValues) => boolean

interface RowPasteLine {
  rowIndex: number
  row: GridRow
  targetColumn: number
  line: readonly string[]
}

interface GridPasteOperations {
  buildCellForRow: CellForRowBuilder
  handleCellEdited: CellEditHandler
  runRowAction: RowActionRunner
}

interface GridPasteInput {
  model: GridViewModel
  activeSelectionCell: Item | undefined
  operations: GridPasteOperations
}

interface PasteTargetContext {
  gridColumns: GridColumn<GridRow>[]
  buildCellForRow: CellForRowBuilder
  paste: RowPasteLine
}

interface RemainingPasteRequest extends PasteTargetContext {
  firstPastedOffset: number
  handleCellEdited: CellEditHandler
}

function isPasteTarget(context: PasteTargetContext, columnIndex: number): boolean {
  const column = context.gridColumns[columnIndex]
  if (!column) return false
  if (isListSelectionColumn(column)) return false
  if (isInfoColumn(column)) return false
  const cell = context.buildCellForRow(context.paste.row, columnIndex, context.paste.rowIndex)
  return !isReadOnlyCell(cell)
}

function pasteRemainingLine(request: RemainingPasteRequest): void {
  const { paste, gridColumns, buildCellForRow, firstPastedOffset } = request
  paste.line.forEach((text, offset) => {
    const columnIndex = paste.targetColumn + offset
    const isPastedByFirstCell = offset <= firstPastedOffset
    const isBeyondLastColumn = columnIndex >= gridColumns.length
    if (isPastedByFirstCell || isBeyondLastColumn) return
    const pasted = pasteTextIntoCell(buildCellForRow(paste.row, columnIndex, paste.rowIndex), text)
    if (pasted) request.handleCellEdited([columnIndex, paste.rowIndex], pasted)
  })
}

function warnAboutSkippedLines(values: PasteValues): void {
  showWarningToast(
    'Pasted one row',
    `Rows are edited one at a time, so only the first of ${values.length.toLocaleString()} lines was pasted.`
  )
}

/**
 * Paste one line of values into a row, starting at column `targetColumn`. The
 * first editable cell goes through `onCellClipboardEdit`, which saves the row
 * being edited (if any) and starts editing this one; the rest of the line is
 * applied only once that resolved `true`, so no value lands in another row.
 */
function usePasteLineIntoRow(
  model: GridViewModel,
  operations: GridPasteOperations
): (paste: RowPasteLine) => Promise<boolean> {
  const { gridColumns } = model
  const { onCellClipboardEdit } = model.props
  const { buildCellForRow, handleCellEdited } = operations
  return useCallback(
    async (paste: RowPasteLine): Promise<boolean> => {
      const context = { gridColumns, buildCellForRow, paste }
      const first = paste.line.findIndex((_, offset) =>
        isPasteTarget(context, paste.targetColumn + offset)
      )
      if (first < 0) return false
      const started = await onCellClipboardEdit?.({
        rowIdx: paste.rowIndex,
        rowData: paste.row,
        columnKey: gridColumns[paste.targetColumn + first].key,
        action: 'paste',
        text: paste.line[first],
      })
      if (started !== true) return false
      pasteRemainingLine({
        ...context,
        firstPastedOffset: first,
        handleCellEdited: handleCellEdited,
      })
      return true
    },
    [buildCellForRow, gridColumns, handleCellEdited, onCellClipboardEdit]
  )
}

interface PasteGuardInput {
  gridColumns: GridColumn<GridRow>[]
  rowCount: number
  isWindowed: boolean
  source: GridRowSource<GridRow>
  isEditMode: boolean | undefined
  actionPendingRef: RefObject<boolean>
}

function isUnloadedRowOutsideEditMode(guard: PasteGuardInput, rowIndex: number): boolean {
  return guard.isWindowed && !guard.source.isLoaded(rowIndex) && guard.isEditMode !== true
}

function canPasteAt(guard: PasteGuardInput, target: Item, values: PasteValues): boolean {
  const [columnIndex, rowIndex] = target
  const column = guard.gridColumns[columnIndex]
  if (!column) return false
  if (!hasPasteLine(values[0])) return false
  if (!isRowInGrid(rowIndex, guard.rowCount)) return false
  if (isListSelectionColumn(column)) return false
  if (guard.actionPendingRef.current) return false
  return !isUnloadedRowOutsideEditMode(guard, rowIndex)
}

/**
 * Paste a block at `target`. Rows are edited one at a time, so only the
 * first pasted line is applied, to the target row, and a warning says the
 * other lines were skipped. Glide's own block paste is never used (it would
 * write every line into the row being edited); an unloaded target row is
 * fetched first.
 */
function usePasteHandler(model: GridViewModel, operations: GridPasteOperations): PasteHandler {
  const { gridColumns, isWindowed, rowCount, source } = model
  const { isEditMode } = model.props
  const { actionPendingRef } = model.refs.action
  const { runRowAction } = operations
  const pasteLineIntoRow = usePasteLineIntoRow(model, operations)
  return useCallback(
    (target: Item, values: PasteValues) => {
      const guard = { gridColumns, rowCount, isWindowed, source, isEditMode, actionPendingRef }
      if (!canPasteAt(guard, target, values)) return false
      const [columnIndex, rowIndex] = target
      const line = values[0]
      void runRowAction('Pasting', [[rowIndex, rowIndex + 1]], async (rowAt) => {
        const row = rowAt(rowIndex)
        if (!row) return false
        const pasted = await pasteLineIntoRow({
          rowIndex: rowIndex,
          row: row,
          targetColumn: columnIndex,
          line: line,
        })
        const hasSkippedLines = values.length > 1
        if (pasted && hasSkippedLines) warnAboutSkippedLines(values)
        return pasted
      })
      return false
    },
    [
      actionPendingRef,
      gridColumns,
      isEditMode,
      isWindowed,
      pasteLineIntoRow,
      rowCount,
      runRowAction,
      source,
    ]
  )
}

export function useGridPaste(input: GridPasteInput) {
  const { model, activeSelectionCell, operations } = input
  const { actionPendingRef } = model.refs.action
  const handlePaste = usePasteHandler(model, operations)

  const pasteClipboardAtSelection = useCallback(async (): Promise<void> => {
    const target = activeSelectionCell
    if (!target) return
    if (actionPendingRef.current) return
    let text: string
    try {
      text = await readClipboardText()
    } catch (error) {
      reportClipboardReadFailure(error)
      return
    }
    handlePaste(target, parseClipboardLines(text))
  }, [actionPendingRef, activeSelectionCell, handlePaste])

  return { handlePaste, pasteClipboardAtSelection }
}
