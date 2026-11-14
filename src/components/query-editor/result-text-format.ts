import { formatCellValue } from '../../lib/result-cell-utils'
import type { ColumnMeta } from '../../types/schema'

const MAX_COL_WIDTH = 40

const COL_SEP = '  '

const DASH = '\u2500'

const truncate = (text: string, maxLength: number): string =>
  text.length > maxLength ? text.slice(0, maxLength - 1) + '\u2026' : text

export function formatTextOutput(columns: ColumnMeta[], rows: Array<Array<unknown>>): string {
  if (columns.length === 0) return ''

  const toCellText = (value: unknown): string => formatCellValue(value).displayValue

  const maxWidths = columns.map((column, columnIndex) => {
    const headerLength = column.name.length
    const maxValueLength = rows.reduce(
      (max, row) => Math.max(max, toCellText(row[columnIndex]).length),
      0
    )
    return Math.min(Math.max(headerLength, maxValueLength), MAX_COL_WIDTH)
  })

  const header = columns
    .map((column, columnIndex) =>
      truncate(column.name, maxWidths[columnIndex]).padEnd(maxWidths[columnIndex])
    )
    .join(COL_SEP)

  const separator = maxWidths.map((width) => DASH.repeat(width)).join(COL_SEP)

  const dataLines = rows.map((row) =>
    columns
      .map((_, columnIndex) =>
        truncate(toCellText(row[columnIndex]), maxWidths[columnIndex]).padEnd(
          maxWidths[columnIndex]
        )
      )
      .join(COL_SEP)
  )

  return [header, separator, ...dataLines].join('\n')
}
