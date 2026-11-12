import { formatCellValue } from '../../lib/result-cell-utils'
import type { ColumnMeta } from '../../types/schema'

/** Maximum column width for text alignment (prevents extreme widths). */
const MAX_COL_WIDTH = 40

/** Column separator — two spaces. */
const COL_SEP = '  '

/** Box-drawing horizontal dash for the separator line. */
const DASH = '\u2500' // ─

/** Truncate a string to maxLen, appending '…' if it exceeds the limit. */
const truncate = (text: string, maxLength: number): string =>
  text.length > maxLength ? text.slice(0, maxLength - 1) + '\u2026' : text

/** Format query results as fixed-width text. */
export function formatTextOutput(columns: ColumnMeta[], rows: Array<Array<unknown>>): string {
  if (columns.length === 0) return ''

  // Stringify helper using shared utility
  const toCellText = (value: unknown): string => formatCellValue(value).displayValue

  // 1. Calculate max width per column (capped at MAX_COL_WIDTH)
  const maxWidths = columns.map((column, columnIndex) => {
    const headerLength = column.name.length
    const maxValueLength = rows.reduce(
      (max, row) => Math.max(max, toCellText(row[columnIndex]).length),
      0
    )
    return Math.min(Math.max(headerLength, maxValueLength), MAX_COL_WIDTH)
  })

  // 2. Header line (truncate names that exceed the capped width)
  const header = columns
    .map((column, columnIndex) =>
      truncate(column.name, maxWidths[columnIndex]).padEnd(maxWidths[columnIndex])
    )
    .join(COL_SEP)

  // 3. Separator line (─ repeated to column width)
  const separator = maxWidths.map((width) => DASH.repeat(width)).join(COL_SEP)

  // 4. Data rows (truncate values that exceed the capped width)
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
