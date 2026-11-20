import { formatCellValue } from '../../../lib/result-cell-utils'
import type { ColumnMeta } from '../../../types/schema'

const MAX_COL_WIDTH = 40

const COL_SEP = '  '

const DASH = '─'

const ELLIPSIS = '…'

const LINE_SEPARATOR = '\n'

const LINE_BREAK_MARKER = '¶'

const TAB_MARKER = '»'

const CONTROL_CHARACTER_REPLACEMENT = ' '

const CONTROL_CHARACTER_PATTERN = /\r\n|\p{Cc}/gu

const CONTROL_CHARACTER_MARKERS: Record<string, string> = {
  '\r\n': LINE_BREAK_MARKER,
  '\n': LINE_BREAK_MARKER,
  '\r': LINE_BREAK_MARKER,
  '\t': TAB_MARKER,
}

const truncate = (text: string, maxLength: number): string =>
  text.length > maxLength ? text.slice(0, maxLength - 1) + ELLIPSIS : text

const fitToWidth = (text: string, width: number): string => truncate(text, width).padEnd(width)

function markerFor(controlCharacters: string): string {
  return CONTROL_CHARACTER_MARKERS[controlCharacters] ?? CONTROL_CHARACTER_REPLACEMENT
}

function toSingleLine(text: string): string {
  return text.replace(CONTROL_CHARACTER_PATTERN, markerFor)
}

export function singleLineCellText(value: unknown): string {
  return toSingleLine(formatCellValue(value).displayValue)
}

function columnWidth(headerCell: string, rowCells: string[][], columnIndex: number): number {
  const widestValue = rowCells.reduce(
    (widest, cells) => Math.max(widest, cells[columnIndex].length),
    headerCell.length
  )
  return Math.min(widestValue, MAX_COL_WIDTH)
}

function sumOf(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function lineLengthOf(columnWidths: number[]): number {
  if (columnWidths.length === 0) return 0
  const separatorsLength = COL_SEP.length * (columnWidths.length - 1)
  return sumOf(columnWidths) + separatorsLength
}

interface TextTableCells {
  headerCells: string[]
  rowCells: string[][]
  columnWidths: number[]
}

export class TextTableLayout {
  private readonly cells: TextTableCells

  readonly lineLength: number

  private constructor(cells: TextTableCells) {
    this.cells = cells
    this.lineLength = lineLengthOf(cells.columnWidths)
  }

  static fromRows(columns: ColumnMeta[], rows: unknown[][]): TextTableLayout {
    const headerCells = columns.map((column) => toSingleLine(column.name))
    const rowCells = rows.map((row) =>
      columns.map((_, columnIndex) => singleLineCellText(row[columnIndex]))
    )
    const columnWidths = headerCells.map((headerCell, columnIndex) =>
      columnWidth(headerCell, rowCells, columnIndex)
    )
    return new TextTableLayout({ headerCells, rowCells, columnWidths })
  }

  get rowCount(): number {
    return this.cells.rowCells.length
  }

  headerLine(): string {
    return this.formatLine(this.cells.headerCells)
  }

  rowLine(rowIndex: number): string {
    return this.formatLine(this.cells.rowCells[rowIndex])
  }

  separatorLine(): string {
    return this.cells.columnWidths.map((width) => DASH.repeat(width)).join(COL_SEP)
  }

  fullText(): string {
    const hasNoColumns = this.cells.columnWidths.length === 0
    if (hasNoColumns) return ''
    const rowLines = this.cells.rowCells.map((rowCells) => this.formatLine(rowCells))
    return [this.headerLine(), this.separatorLine(), ...rowLines].join(LINE_SEPARATOR)
  }

  private formatLine(lineCells: string[]): string {
    return lineCells
      .map((cell, columnIndex) => fitToWidth(cell, this.cells.columnWidths[columnIndex]))
      .join(COL_SEP)
  }
}
