import { useCallback } from 'react'
import type { GridSelection, Rectangle } from '@glideapps/glide-data-grid'
import { writeClipboardText } from '../../../../lib/context-menu-utils'
import type { RowLookup } from './canvas-grid-types'
import { cellCopyData } from './grid-cell-builders'
import { reportClipboardWriteFailure } from './grid-row-action-feedback'
import { rectRowRanges } from './grid-row-ranges'
import { selectionRects } from './grid-selection-helpers'
import type { GridViewModel } from './grid-view-model'
import type { CellForRowBuilder } from './use-grid-cell-content'
import type { CellRangeClearer } from './use-grid-clear'
import type { RowActionRunner } from './use-grid-row-action-runner'

type CopyVerb = 'Copying' | 'Cutting'
type CopyRects = (
  rects: Rectangle[],
  verb: CopyVerb,
  afterWrite?: (rowAt: RowLookup) => void
) => Promise<boolean>

interface GridCopyInput {
  model: GridViewModel
  activeGridSelection: GridSelection | undefined
  operations: GridCopyOperations
}

interface GridCopyOperations {
  buildCellForRow: CellForRowBuilder
  runRowAction: RowActionRunner
  clearCellsWithRows: CellRangeClearer
}

interface RectTextRequest {
  rects: Rectangle[]
  rowAt: RowLookup
  buildCellForRow: CellForRowBuilder
}

const COPY_CELL_SEPARATOR = '\t'
const COPY_LINE_SEPARATOR = '\n'

function rectLines(rect: Rectangle, request: RectTextRequest): string[] {
  return Array.from({ length: rect.height }, (_, rowOffset) => {
    const rowIndex = rect.y + rowOffset
    const row = request.rowAt(rowIndex)
    return Array.from({ length: rect.width }, (_, columnOffset) =>
      row ? cellCopyData(request.buildCellForRow(row, rect.x + columnOffset, rowIndex)) : ''
    ).join(COPY_CELL_SEPARATOR)
  })
}

function rectsCopyText(request: RectTextRequest): string {
  return request.rects.flatMap((rect) => rectLines(rect, request)).join(COPY_LINE_SEPARATOR)
}

async function writeCopyText(text: string, verb: CopyVerb): Promise<boolean> {
  try {
    await writeClipboardText(text)
  } catch (error) {
    reportClipboardWriteFailure(verb, error)
    return false
  }
  return true
}

function useCopyRects(operations: GridCopyOperations): CopyRects {
  const { buildCellForRow, runRowAction } = operations
  return useCallback(
    async (rects, verb, afterWrite) => {
      if (rects.length === 0) return false
      return runRowAction(verb, rectRowRanges(rects), async (rowAt) => {
        const text = rectsCopyText({ rects, rowAt, buildCellForRow })
        if (!text) return false
        const written = await writeCopyText(text, verb)
        if (!written) return false
        afterWrite?.(rowAt)
        return true
      })
    },
    [buildCellForRow, runRowAction]
  )
}

/**
 * Copy `rects` to the clipboard (Cmd/Ctrl+C in windowed mode, the context
 * menu, and Cut). Unloaded rows are fetched first. Cut clears only once the
 * text reached the clipboard, so a failed fetch or write keeps the cells.
 */
export function useGridCopy(input: GridCopyInput) {
  const { model, activeGridSelection, operations } = input
  const { rowCount } = model
  const columnCount = model.gridColumns.length
  const { actionPendingRef } = model.refs.action
  const { clearCellsWithRows } = operations
  const copyRects = useCopyRects(operations)

  const copySelectionToClipboard = useCallback(async (): Promise<void> => {
    if (actionPendingRef.current) return
    const rects = selectionRects({
      selection: activeGridSelection,
      columnCount: columnCount,
      rowCount: rowCount,
    })
    await copyRects(rects, 'Copying')
  }, [actionPendingRef, activeGridSelection, columnCount, copyRects, rowCount])

  const cutSelectionToClipboard = useCallback(async (): Promise<void> => {
    if (actionPendingRef.current) return
    const rects = selectionRects({
      selection: activeGridSelection,
      columnCount: columnCount,
      rowCount: rowCount,
    })
    await copyRects(rects, 'Cutting', (rowAt) =>
      rects.forEach((rect) => clearCellsWithRows(rect, rowAt))
    )
  }, [actionPendingRef, activeGridSelection, clearCellsWithRows, columnCount, copyRects, rowCount])

  return { copySelectionToClipboard, cutSelectionToClipboard }
}
