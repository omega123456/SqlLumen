import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { CopySimple, WarningCircle } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import { writeClipboardText } from '../../../lib/context-menu-utils'
import { CLIPBOARD_ACTION_FAILURES } from '../../../lib/clipboard-action-failures'
import { formatCount } from '../../../lib/format-row-count'
import { logFrontend } from '../../../lib/app-log-commands'
import { isResultsExpiredError, readViewRange } from '../../../lib/result-window-cache'
import { TEXT_VIEW_ROW_CAP } from '../../../lib/data-view-limits'
import { showErrorToast } from '../../../stores/toast-store'
import type { DataViewSurfaceRef } from '../../../stores/data-view/data-view-types'
import { routeOf } from '../../../stores/data-view/route-registry'
import { useDataView } from '../../../stores/data-view/use-data-view'
import type { DataViewSource } from './data-view-source'
import { formatTextOutput } from './text-format'
import { toErrorMessage } from '../../../lib/error-message'
import { joinClassNames, SCROLLBAR } from '../../../lib/class-names'

export interface DataTextViewProps {
  source: DataViewSource
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
      <WarningCircle
        size={12}
        weight="fill"
        className="flex-none text-light-warning dark:text-dark-warning"
        aria-hidden="true"
      />{' '}
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

interface TextHeaderProps {
  isCapped: boolean
  showTruncatedCopy: boolean
  viewRowCount: number
  copyButton: ReactNode
}

function TextHeader(props: TextHeaderProps) {
  if (!props.isCapped) {
    return <div className="absolute top-2 right-2 z-1">{props.copyButton}</div>
  }
  return (
    <div
      className="flex flex-none items-center justify-between gap-3 border-b border-b-light-stroke-divider bg-light-surface-container py-1.5 pr-2 pl-4 text-caption text-light-on-surface-variant dark:border-b-dark-stroke-divider dark:bg-dark-surface-container dark:text-dark-on-surface-variant"
      data-testid="result-text-view-cap-strip"
    >
      <span className="inline-flex min-w-0 items-center gap-0.5 truncate">
        <CapStripText
          showTruncatedCopy={props.showTruncatedCopy}
          viewRowCount={props.viewRowCount}
        />
      </span>
      {props.copyButton}
    </div>
  )
}

interface TextRowsRequest {
  ref: DataViewSurfaceRef
  loadKey: string
  shownCount: number
}

function reportTextRowsFailure(error: unknown, onExpired: () => void): void {
  if (isResultsExpiredError(error)) {
    onExpired()
    return
  }
  const message = toErrorMessage(error)
  logFrontend('warn', `[data-text-view] could not load rows: ${message}`)
  showErrorToast("Couldn't load rows", message)
}

function useTextViewRows({ ref, loadKey, shownCount }: TextRowsRequest) {
  const { tabId, resultIndex } = ref
  const [loaded, setLoaded] = useState<LoadedRows | null>(null)

  useEffect(() => {
    if (shownCount === 0) return
    if (loaded?.key === loadKey) return
    let cancelled = false
    readViewRange({ tabId: tabId, resultIndex: resultIndex, range: [0, shownCount] })
      .then((rows) => {
        if (!cancelled) setLoaded({ key: loadKey, rows: rows.map((row) => row.row) })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        reportTextRowsFailure(error, () => routeOf(ref).lifecycle.onExpired(ref))
      })
    return () => {
      cancelled = true
    }
  }, [loadKey, loaded, ref, resultIndex, shownCount, tabId])

  return visibleTextRows(shownCount, loaded, loadKey)
}

function useCopyText(formattedText: string) {
  return useCallback(async () => {
    try {
      await writeClipboardText(formattedText)
    } catch (error) {
      const message = toErrorMessage(error)
      logFrontend('warn', `[data-text-view] clipboard write failed: ${message}`)
      showErrorToast(CLIPBOARD_ACTION_FAILURES.copy.title, CLIPBOARD_ACTION_FAILURES.copy.message)
    }
  }, [formattedText])
}

export function DataTextView({ source }: DataTextViewProps) {
  const ref = source.ref
  const slot = useDataView(ref, (view) => view.slot)
  const isFiltered = useDataView(ref, (view) => view.spec.filters.length > 0)
  const { columns, queryId, viewVersion, viewRowCount } = slot
  const shownCount = Math.min(viewRowCount, TEXT_VIEW_ROW_CAP)
  const isCapped = viewRowCount > TEXT_VIEW_ROW_CAP
  const loadKey = `${queryId ?? ''}:${viewVersion}:${shownCount}`
  const rows = useTextViewRows({
    ref: ref,
    loadKey: loadKey,
    shownCount: shownCount,
  })
  const formattedText = useMemo(
    () => (rows ? formatTextOutput(columns, rows) : ''),
    [columns, rows]
  )
  const handleCopyAll = useCopyText(formattedText)

  const copyButton = (
    <CopyAllButton
      isCapped={isCapped}
      disabled={rows === null}
      onCopy={() => void handleCopyAll()}
    />
  )

  const showTruncatedCopy = source.isTruncated && !isFiltered

  return (
    <div
      className="relative flex h-full flex-col bg-light-surface-container-low dark:bg-dark-surface-container-low"
      data-testid={source.testIds.text}
    >
      <TextHeader
        isCapped={isCapped}
        showTruncatedCopy={showTruncatedCopy}
        viewRowCount={viewRowCount}
        copyButton={copyButton}
      />
      <pre
        className={joinClassNames([
          'm-0 flex-1 overflow-auto px-4 pb-4 font-mono text-size-row leading-loose whitespace-pre text-light-on-surface tab-4 dark:text-dark-on-surface',
          SCROLLBAR,
          isCapped ? 'pt-4' : 'pt-11',
        ])}
        aria-busy={rows === null}
      >
        {formattedText}
      </pre>
    </div>
  )
}
