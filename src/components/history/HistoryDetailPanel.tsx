import { Fragment, useCallback, useMemo, useState } from 'react'
import {
  CheckIcon,
  ClockCounterClockwiseIcon,
  CodeIcon,
  CopySimpleIcon,
} from '@phosphor-icons/react'
import { formatTableTimestamp } from '../../lib/format-utils'
import { SqlSyntaxHighlighter } from '../../lib/sql-syntax-highlighter'
import { Button } from '../common/Button'
import type { HistoryEntry } from '../../types/schema'
import { statusDotClassName } from '../../lib/class-names-status-dot'
import { formatSpacedDuration } from '../../lib/elapsed-time'
import { joinClassNames, SCROLLBAR } from '../../lib/class-names'
import { SQL_HIGHLIGHT_CLASS_NAMES } from '../../lib/sql-highlight-class-names'

const COPIED_FEEDBACK_DURATION_MS = 1500

export interface HistoryDetailPanelProps {
  entry: HistoryEntry | null
  onOpenInEditor: (entry: HistoryEntry) => void
  connectionName?: string
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  return formatSpacedDuration(ms)
}

function formatRows(entry: HistoryEntry): string {
  if (!entry.success) return '—'
  const rowCount = entry.rowCount ?? entry.affectedRows ?? 0
  return `${rowCount.toLocaleString()} ${rowCount === 1 ? 'row' : 'rows'}`
}

const MISSING_VALUE_PLACEHOLDER = '—'

const DETAIL_PANEL_CLASS_NAME = joinClassNames([
  'flex h-full min-h-0 flex-col gap-3.5 overflow-auto p-4 font-body text-body text-light-on-surface dark:text-dark-on-surface',
  SCROLLBAR,
])

const FACT_LABEL_CLASS_NAME = 'text-light-on-surface-variant dark:text-dark-on-surface-variant'

const HISTORY_HIGHLIGHT_CLASS_NAMES = {
  keyword: SQL_HIGHLIGHT_CLASS_NAMES.keyword,
  type: SQL_HIGHLIGHT_CLASS_NAMES.type,
  string: SQL_HIGHLIGHT_CLASS_NAMES.string,
  number: SQL_HIGHLIGHT_CLASS_NAMES.number,
}

function HistoryStatusHeader({ entry }: { entry: HistoryEntry }) {
  return (
    <div className="flex items-center gap-2">
      <span className={statusDotClassName(entry.success)} aria-hidden="true">
        {entry.success ? '✓' : '✕'}
      </span>
      <b className="font-semibold">{entry.success ? 'Succeeded' : 'Failed'}</b>
      <span className="ml-auto text-size-caption text-light-on-surface-variant dark:text-dark-on-surface-variant">
        {formatTableTimestamp(entry.timestamp)}
      </span>
    </div>
  )
}

function HistoryEntryFacts({
  entry,
  connectionName,
}: {
  entry: HistoryEntry
  connectionName: string | undefined
}) {
  const facts = [
    { label: 'Database', value: entry.databaseName ?? MISSING_VALUE_PLACEHOLDER },
    { label: 'Duration', value: formatDuration(entry.durationMs) },
    { label: 'Rows', value: formatRows(entry) },
    { label: 'Connection', value: connectionName ?? MISSING_VALUE_PLACEHOLDER },
  ]
  return (
    <div className="grid grid-cols-kv-facts gap-x-3 gap-y-2 text-size-row leading-4.5 wrap-anywhere">
      {facts.map((fact) => (
        <Fragment key={fact.label}>
          <span className={FACT_LABEL_CLASS_NAME}>{fact.label}</span>
          <span>{fact.value}</span>
        </Fragment>
      ))}
    </div>
  )
}

function CopySqlButtonContent({ copied }: { copied: boolean }) {
  if (copied) {
    return (
      <>
        <CheckIcon size={16} weight="bold" />
        Copied
      </>
    )
  }
  return (
    <>
      <CopySimpleIcon size={16} weight="regular" />
      Copy SQL
    </>
  )
}

interface HistoryEntryActionsProps {
  entry: HistoryEntry
  onOpenInEditor: (entry: HistoryEntry) => void
}

function HistoryEntryActions({ entry, onOpenInEditor }: HistoryEntryActionsProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(entry.sqlText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), COPIED_FEEDBACK_DURATION_MS)
    })
  }, [entry])

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="accent"
        onClick={() => onOpenInEditor(entry)}
        data-testid="history-open-in-editor"
      >
        <CodeIcon size={16} weight="regular" />
        Open in editor
      </Button>
      <Button onClick={handleCopy} data-testid="history-copy-sql">
        <CopySqlButtonContent copied={copied} />
      </Button>
    </div>
  )
}

export function HistoryDetailPanel({
  entry,
  onOpenInEditor,
  connectionName,
}: HistoryDetailPanelProps) {
  const highlighted = useMemo(
    () =>
      entry
        ? SqlSyntaxHighlighter.highlightSql(entry.sqlText, HISTORY_HIGHLIGHT_CLASS_NAMES)
        : null,
    [entry]
  )

  if (!entry) {
    return (
      <div className={DETAIL_PANEL_CLASS_NAME} data-testid="history-detail-panel">
        <div
          className="flex flex-1 flex-col items-center justify-center gap-2.5 text-size-row text-light-on-surface-variant dark:text-dark-on-surface-variant"
          data-testid="history-detail-empty"
        >
          <ClockCounterClockwiseIcon
            size={40}
            weight="light"
            className="text-light-outline dark:text-dark-outline"
          />
          <span>Select a query to see its details</span>
        </div>
      </div>
    )
  }

  return (
    <div className={DETAIL_PANEL_CLASS_NAME} data-testid="history-detail-panel">
      <HistoryStatusHeader entry={entry} />

      {!entry.success && (
        <div
          className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 rounded-card border border-light-stroke-card bg-light-error-container px-3 py-2.5 wrap-anywhere select-text dark:border-dark-stroke-card dark:bg-dark-error-container"
          role="alert"
        >
          <b className="font-semibold">Error</b>
          {entry.errorMessage && <span>{entry.errorMessage}</span>}
        </div>
      )}

      <div className="shrink-0 overflow-hidden rounded-card border border-light-stroke-card bg-light-surface-container-lowest dark:border-dark-stroke-card dark:bg-dark-surface-container-lowest">
        <div className="flex h-8.5 items-center border-b border-light-stroke-divider bg-light-surface-container-high pr-1 pl-3 text-size-caption text-light-on-surface-variant dark:border-dark-stroke-divider dark:bg-dark-surface-container-high dark:text-dark-on-surface-variant">
          SQL
        </div>
        <pre className="px-3 py-2.5 font-mono text-size-code-block leading-4.75 whitespace-pre-wrap wrap-anywhere text-light-token-text select-text dark:text-dark-token-text">
          <code className="font-generic-mono">{highlighted}</code>
        </pre>
      </div>

      <HistoryEntryFacts entry={entry} connectionName={connectionName} />

      <HistoryEntryActions entry={entry} onOpenInEditor={onOpenInEditor} />
    </div>
  )
}
