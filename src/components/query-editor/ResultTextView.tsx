/**
 * Monospace text view — renders the first 5,000 rows of the current view in
 * fixed-width columns (fetched from the Rust cache in chunks). When the view
 * has more rows, a caption strip says so and the copy button becomes
 * "Copy first 5,000"; the full result needs an export.
 *
 * Columns are padded to their max content width (capped at 40 chars) and
 * separated by two spaces.
 *
 * `formatTextOutput` is exported for direct unit testing.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CopySimple, WarningCircle } from '@phosphor-icons/react'
import { Button } from '../common/Button'
import { writeClipboardText } from '../../lib/context-menu-utils'
import { CLIPBOARD_ACTION_FAILURES } from '../../lib/clipboard-action-failures'
import { formatCellValue } from '../../lib/result-cell-utils'
import { formatCount } from '../../lib/format-row-count'
import { logFrontend } from '../../lib/app-log-commands'
import { isResultsExpiredError, readViewRange } from '../../lib/result-window-cache'
import { TEXT_VIEW_ROW_CAP, useQueryStore } from '../../stores/query-store'
import { showErrorToast } from '../../stores/toast-store'
import type { ColumnMeta } from '../../types/schema'
import styles from './ResultTextView.module.css'

export interface ResultTextViewProps {
  columns: ColumnMeta[]
  tabId: string
  /** Result index within the tab (page-cache surface). */
  resultIndex: number
  /** Query id of the cached result. */
  queryId: string | null
  /** View version of the current view. */
  viewVersion: number
  /** Rows in the current view. */
  viewRowCount: number
  /** True when the result hit the row ceiling. */
  truncated?: boolean
  /** True when filter conditions are active. */
  isFiltered?: boolean
}

const EMPTY_ROWS: unknown[][] = []

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

export function ResultTextView({
  columns,
  tabId,
  resultIndex,
  queryId,
  viewVersion,
  viewRowCount,
  truncated = false,
  isFiltered = false,
}: ResultTextViewProps) {
  const markResultsExpired = useQueryStore((state) => state.markResultsExpired)
  const shownCount = Math.min(viewRowCount, TEXT_VIEW_ROW_CAP)
  const isCapped = viewRowCount > TEXT_VIEW_ROW_CAP
  const loadKey = `${queryId ?? ''}:${viewVersion}:${shownCount}`
  const [loaded, setLoaded] = useState<{ key: string; rows: unknown[][] } | null>(null)

  // Fetch the first rows of the current view (in 2,000-row chunks).
  useEffect(() => {
    if (shownCount === 0 || loaded?.key === loadKey) return
    let cancelled = false
    readViewRange(tabId, resultIndex, [0, shownCount])
      .then((rows) => {
        if (!cancelled) setLoaded({ key: loadKey, rows: rows.map((row) => row.row) })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (isResultsExpiredError(error)) {
          markResultsExpired(tabId)
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        logFrontend('warn', `[result-text-view] could not load rows: ${message}`)
        showErrorToast("Couldn't load rows", message)
      })
    return () => {
      cancelled = true
    }
  }, [loadKey, loaded, markResultsExpired, resultIndex, shownCount, tabId])

  const rows = shownCount === 0 ? EMPTY_ROWS : loaded?.key === loadKey ? loaded.rows : null
  const formattedText = useMemo(
    () => (rows ? formatTextOutput(columns, rows) : ''),
    [columns, rows]
  )

  const handleCopyAll = useCallback(async () => {
    try {
      await writeClipboardText(formattedText)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logFrontend('warn', `[result-text-view] clipboard write failed: ${message}`)
      showErrorToast(CLIPBOARD_ACTION_FAILURES.copy.title, CLIPBOARD_ACTION_FAILURES.copy.message)
    }
  }, [formattedText])

  const copyButton = (
    <Button
      size="sm"
      onClick={() => void handleCopyAll()}
      disabled={rows === null}
      title={isCapped ? 'Copies the rows shown. Export all rows for the full result.' : undefined}
      data-testid="copy-all-button"
    >
      <CopySimple size={14} aria-hidden="true" />
      <span>{isCapped ? `Copy first ${formatCount(TEXT_VIEW_ROW_CAP)}` : 'Copy all'}</span>
    </Button>
  )

  const showTruncatedCopy = truncated && !isFiltered

  return (
    <div className={styles.container} data-testid="result-text-view">
      {isCapped ? (
        <div className={styles.capStrip} data-testid="result-text-view-cap-strip">
          <span className={styles.capText}>
            {showTruncatedCopy ? (
              <>
                Showing first {formatCount(TEXT_VIEW_ROW_CAP)} of{' '}
                <WarningCircle
                  size={12}
                  weight="fill"
                  className={styles.capWarning}
                  aria-hidden="true"
                />{' '}
                {formatCount(viewRowCount)}+ rows · truncated
              </>
            ) : (
              <>
                Showing first {formatCount(TEXT_VIEW_ROW_CAP)} of {formatCount(viewRowCount)} rows
                in this view.
              </>
            )}
          </span>
          {copyButton}
        </div>
      ) : (
        <div className={styles.copyAllSlot}>{copyButton}</div>
      )}
      <pre
        className={isCapped ? `${styles.pre} ${styles.preBelowStrip}` : styles.pre}
        aria-busy={rows === null}
      >
        {formattedText}
      </pre>
    </div>
  )
}
