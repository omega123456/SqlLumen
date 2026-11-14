import {
  CompactSelection,
  type GridSelection,
  type Item,
  type Rectangle,
} from '@glideapps/glide-data-grid'
import type { GridCellPosition } from '../glide-grid-types'
import type { GlideKeyDownEvent, ScrollCell } from './canvas-grid-types'
import { selectionRowRanges } from './grid-row-ranges'

interface FocusedCellSources {
  selectedCell: GridCellPosition | null | undefined
  selectionCell: Item | undefined
  lastInteractedCell: GridCellPosition | null
}

export interface SelectionRectsInput {
  selection: GridSelection | undefined
  columnCount: number
  rowCount: number
}

const CLIPBOARD_LINE_SEPARATOR = /\r?\n/
const CLIPBOARD_CELL_SEPARATOR = '\t'

export function currentSelectionCell(selection: GridSelection | undefined): Item | undefined {
  return selection?.current?.cell
}

export function toCellPosition(cell: Item | undefined): GridCellPosition | null {
  if (!cell) return null
  return { idx: cell[0], rowIdx: cell[1] }
}

export function resolveFocusedCell(sources: FocusedCellSources): GridCellPosition | null {
  return sources.selectedCell ?? toCellPosition(sources.selectionCell) ?? sources.lastInteractedCell
}

export function resolveKeyboardCell(
  selectionCell: Item | undefined,
  selectedCell: GridCellPosition | null | undefined
): GridCellPosition | null {
  return toCellPosition(selectionCell) ?? selectedCell ?? null
}

export function clampIndex(value: number, lastIndex: number): number {
  return Math.max(0, Math.min(lastIndex, value))
}

export function resolveKeyboardRow(
  currentCell: GridCellPosition | null,
  activeSelectedRowIndex: number | null
): number {
  return currentCell?.rowIdx ?? activeSelectedRowIndex ?? 0
}

export function resolveKeyboardColumn(currentCell: GridCellPosition | null): number {
  return currentCell?.idx ?? 0
}

export function cancelGlideKey(event: GlideKeyDownEvent): void {
  event.preventDefault()
  event.cancel?.()
}

export function isShortcutKey(event: GlideKeyDownEvent, key: string): boolean {
  const isShortcut = event.metaKey || event.ctrlKey
  return isShortcut && event.key.toLowerCase() === key
}

export function isRowInGrid(rowIndex: number, rowCount: number): boolean {
  return rowIndex >= 0 && rowIndex < rowCount
}

export function hasPasteLine(line: readonly string[] | undefined): line is readonly string[] {
  return line !== undefined && line.length > 0
}

export function parseClipboardLines(text: string): string[][] {
  return text.split(CLIPBOARD_LINE_SEPARATOR).map((line) => line.split(CLIPBOARD_CELL_SEPARATOR))
}

export function clampScrollCell(
  scrollCell: ScrollCell,
  maxRow: number,
  maxColumn: number
): ScrollCell {
  return {
    scrollRow: Math.max(0, Math.min(maxRow, Math.floor(scrollCell.scrollRow))),
    scrollCol: Math.max(0, Math.min(maxColumn, Math.floor(scrollCell.scrollCol))),
  }
}

export function isSameScrollCell(left: ScrollCell | null, right: ScrollCell): boolean {
  return left?.scrollRow === right.scrollRow && left.scrollCol === right.scrollCol
}

export function selectionWithFocusedCell(
  selection: GridSelection | undefined,
  position: GridCellPosition
): GridSelection {
  return {
    columns: selection?.columns ?? CompactSelection.empty(),
    rows: selection?.rows ?? CompactSelection.empty(),
    current: {
      cell: [position.idx, position.rowIdx] as [number, number],
      range: {
        x: position.idx,
        y: position.rowIdx,
        width: 1,
        height: 1,
      },
      rangeStack: [],
    },
  }
}

/** Rectangles covered by a selection (row selections become full-width row runs). */
export function selectionRects(input: SelectionRectsInput): Rectangle[] {
  const { selection, columnCount, rowCount } = input
  const rects: Rectangle[] = []
  if (!selection) return rects
  if (selection.current) rects.push(selection.current.range, ...selection.current.rangeStack)
  for (const [start, end] of selectionRowRanges(selection.rows)) {
    rects.push({ x: 0, y: start, width: columnCount, height: end - start })
  }
  for (const columnIndex of selection.columns) {
    rects.push({ x: columnIndex, y: 0, width: 1, height: rowCount })
  }
  return rects
}
