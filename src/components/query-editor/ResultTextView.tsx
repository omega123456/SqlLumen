/**
 * Monospace text view — renders the first 5,000 rows of the current view in
 * fixed-width columns (fetched from the Rust cache in chunks). When the view
 * has more rows, a caption strip says so and the copy button becomes
 * "Copy first 5,000"; the full result needs an export.
 *
 * Columns are padded to their max content width (capped at 40 chars) and
 * separated by two spaces.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CopySimple, WarningCircle } from '@phosphor-icons/react'
import { Button } from '../common/Button'
import { writeClipboardText } from '../../lib/context-menu-utils'
import { CLIPBOARD_ACTION_FAILURES } from '../../lib/clipboard-action-failures'
import { formatCount } from '../../lib/format-row-count'
import { logFrontend } from '../../lib/app-log-commands'
import { isResultsExpiredError, readViewRange } from '../../lib/result-window-cache'
import { TEXT_VIEW_ROW_CAP, useQueryStore } from '../../stores/query-store'
import { showErrorToast } from '../../stores/toast-store'
import type { ColumnMeta } from '../../types/schema'
import { formatTextOutput } from './result-text-format'
import styles from './ResultTextView.module.css'
import { toErrorMessage } from '../../lib/error-message'

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

interface LoadedRows {
  key: string
  rows: unknown[][]
}

function visibleTextRows(
  shownCount: number,
  loaded: LoadedRows | null,
  loadKey: string
): unknown[][] | null {
  if (shownCount === 0) return EMPTY_ROWS
  if (loaded?.key !== loadKey) return null
  return loaded.rows
}

function CapStripText({
  showTruncatedCopy,
  viewRowCount,
}: {
  showTruncatedCopy: boolean
  viewRowCount: number
}) {
  if (!showTruncatedCopy) {
    return (
      <>
        Showing first {formatCount(TEXT_VIEW_ROW_CAP)} of {formatCount(viewRowCount)} rows in this
        view.
      </>
    )
  }
  return (
    <>
      Showing first {formatCount(TEXT_VIEW_ROW_CAP)} of{' '}
      <WarningCircle size={12} weight="fill" className={styles.capWarning} aria-hidden="true" />{' '}
      {formatCount(viewRowCount)}+ rows · truncated
    </>
  )
}

interface CopyAllButtonProps {
  isCapped: boolean
  disabled: boolean
  onCopy: () => void
}

function CopyAllButton({ isCapped, disabled, onCopy }: CopyAllButtonProps) {
  return (
    <Button
      size="sm"
      onClick={onCopy}
      disabled={disabled}
      title={isCapped ? 'Copies the rows shown. Export all rows for the full result.' : undefined}
      data-testid="copy-all-button"
    >
      <CopySimple size={14} aria-hidden="true" />
      <span>{isCapped ? `Copy first ${formatCount(TEXT_VIEW_ROW_CAP)}` : 'Copy all'}</span>
    </Button>
  )
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
  const [loaded, setLoaded] = useState<LoadedRows | null>(null)

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
        const message = toErrorMessage(error)
        logFrontend('warn', `[result-text-view] could not load rows: ${message}`)
        showErrorToast("Couldn't load rows", message)
      })
    return () => {
      cancelled = true
    }
  }, [loadKey, loaded, markResultsExpired, resultIndex, shownCount, tabId])

  const rows = visibleTextRows(shownCount, loaded, loadKey)
  const formattedText = useMemo(
    () => (rows ? formatTextOutput(columns, rows) : ''),
    [columns, rows]
  )

  const handleCopyAll = useCallback(async () => {
    try {
      await writeClipboardText(formattedText)
    } catch (error) {
      const message = toErrorMessage(error)
      logFrontend('warn', `[result-text-view] clipboard write failed: ${message}`)
      showErrorToast(CLIPBOARD_ACTION_FAILURES.copy.title, CLIPBOARD_ACTION_FAILURES.copy.message)
    }
  }, [formattedText])

  const copyButton = (
    <CopyAllButton
      isCapped={isCapped}
      disabled={rows === null}
      onCopy={() => void handleCopyAll()}
    />
  )

  const showTruncatedCopy = truncated && !isFiltered

  return (
    <div className={styles.container} data-testid="result-text-view">
      {isCapped ? (
        <div className={styles.capStrip} data-testid="result-text-view-cap-strip">
          <span className={styles.capText}>
            <CapStripText showTruncatedCopy={showTruncatedCopy} viewRowCount={viewRowCount} />
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
