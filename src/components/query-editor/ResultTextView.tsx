/**
 * Monospace text view — renders all query result rows in fixed-width columns.
 *
 * Columns are padded to their max content width (capped at 40 chars) and
 * separated by two spaces. A "Copy All" button copies the entire formatted
 * output to the clipboard.
 *
 * `formatTextOutput` is exported for direct unit testing.
 */

import { useCallback, useMemo } from 'react'
import { CopySimple } from '@phosphor-icons/react'
import { writeClipboardText } from '../../lib/context-menu-utils'
import { formatCellValue } from '../../lib/result-cell-utils'
import type { ColumnMeta } from '../../types/schema'
import styles from './ResultTextView.module.css'

export interface ResultTextViewProps {
  columns: ColumnMeta[]
  rows: Array<Array<unknown>>
}

/** Maximum column width for text alignment (prevents extreme widths). */
const MAX_COL_WIDTH = 40

/** Column separator — two spaces. */
const COL_SEP = '  '

/** Box-drawing horizontal dash for the separator line. */
const DASH = '\u2500' // ─

/** Truncate a string to maxLen, appending '…' if it exceeds the limit. */
const truncate = (s: string, maxLen: number): string =>
  s.length > maxLen ? s.slice(0, maxLen - 1) + '\u2026' : s

/**
 * Format query results as fixed-width text.
 *
 * Exported for direct unit testing.
 */
// eslint-disable-next-line react-refresh/only-export-components
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

export function ResultTextView({ columns, rows }: ResultTextViewProps) {
  const formattedText = useMemo(() => formatTextOutput(columns, rows), [columns, rows])

  const handleCopyAll = useCallback(async () => {
    try {
      await writeClipboardText(formattedText)
    } catch {
      // Silently fail — clipboard unavailable
    }
  }, [formattedText])

  return (
    <div className={styles.container} data-testid="result-text-view">
      <button
        type="button"
        className={styles.copyAllButton}
        onClick={handleCopyAll}
        data-testid="copy-all-button"
      >
        <CopySimple size={14} />
        <span>Copy All</span>
      </button>
      <pre className={styles.pre}>{formattedText}</pre>
    </div>
  )
}
