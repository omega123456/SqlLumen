import { formatCellValue } from '../../lib/result-cell-utils'
import type { ColumnMeta } from '../../types/schema'

/** Maximum column width for text alignment (prevents extreme widths). */
const MAX_COL_WIDTH = 40

/** Column separator — two spaces. */
const COL_SEP = '  '

/** Box-drawing horizontal dash for the separator line. */
const DASH = '\u2500' // ─

/** Truncate a string to maxLen, appending '…' if it exceeds the limit. */
const truncate = (s: string, maxLen: number): string =>
  s.length > maxLen ? s.slice(0, maxLen - 1) + '\u2026' : s

/** Format query results as fixed-width text. */
export function formatTextOutput(columns: ColumnMeta[], rows: Array<Array<unknown>>): string {
  if (columns.length === 0) return ''

  // Stringify helper using shared utility
  const asStr = (v: unknown): string => formatCellValue(v).displayValue

  // 1. Calculate max width per column (capped at MAX_COL_WIDTH)
  const maxWidths = columns.map((col, i) => {
    const headerLen = col.name.length
    const maxValueLen = rows.reduce((max, row) => Math.max(max, asStr(row[i]).length), 0)
    return Math.min(Math.max(headerLen, maxValueLen), MAX_COL_WIDTH)
  })

  // 2. Header line (truncate names that exceed the capped width)
  const header = columns
    .map((col, i) => truncate(col.name, maxWidths[i]).padEnd(maxWidths[i]))
    .join(COL_SEP)

  // 3. Separator line (─ repeated to column width)
  const separator = maxWidths.map((w) => DASH.repeat(w)).join(COL_SEP)

  // 4. Data rows (truncate values that exceed the capped width)
  const dataLines = rows.map((row) =>
    columns.map((_, i) => truncate(asStr(row[i]), maxWidths[i]).padEnd(maxWidths[i])).join(COL_SEP)
  )

  return [header, separator, ...dataLines].join('\n')
}
