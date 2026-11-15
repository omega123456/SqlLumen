import { useCallback, useMemo, useState } from 'react'
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
import styles from './HistoryDetailPanel.module.css'
import { MILLISECONDS_PER_SECOND } from '../../lib/units'

const COPIED_FEEDBACK_DURATION_MS = 1500

export interface HistoryDetailPanelProps {
  entry: HistoryEntry | null
  onOpenInEditor: (entry: HistoryEntry) => void
  connectionName?: string
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < MILLISECONDS_PER_SECOND) return `${ms} ms`
  return `${(ms / MILLISECONDS_PER_SECOND).toFixed(1)} s`
}

function formatRows(entry: HistoryEntry): string {
  if (!entry.success) return '—'
  const rowCount = entry.rowCount ?? entry.affectedRows ?? 0
  return `${rowCount.toLocaleString()} ${rowCount === 1 ? 'row' : 'rows'}`
}

const MISSING_VALUE_PLACEHOLDER = '—'

function HistoryStatusHeader({ entry }: { entry: HistoryEntry }) {
  return (
    <div className={styles.header}>
      <span className={statusDotClassName(entry.success)} aria-hidden="true">
        {entry.success ? '✓' : '✕'}
      </span>
      <b>{entry.success ? 'Succeeded' : 'Failed'}</b>
      <span className={styles.time}>{formatTableTimestamp(entry.timestamp)}</span>
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
  return (
    <div className={styles.kv}>
      <span>Database</span>
      <span>{entry.databaseName ?? MISSING_VALUE_PLACEHOLDER}</span>
      <span>Duration</span>
      <span>{formatDuration(entry.durationMs)}</span>
      <span>Rows</span>
      <span>{formatRows(entry)}</span>
      <span>Connection</span>
      <span>{connectionName ?? MISSING_VALUE_PLACEHOLDER}</span>
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
    <div className={styles.actions}>
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
        ? SqlSyntaxHighlighter.highlightSql(entry.sqlText, {
            keyword: styles.keyword,
            type: styles.keyword,
            string: styles.string,
            number: styles.number,
          })
        : null,
    [entry]
  )

  if (!entry) {
    return (
      <div className={styles.panel} data-testid="history-detail-panel">
        <div className={styles.emptyState} data-testid="history-detail-empty">
          <ClockCounterClockwiseIcon size={40} weight="light" className={styles.emptyIcon} />
          <span>Select a query to see its details</span>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.panel} data-testid="history-detail-panel">
      <HistoryStatusHeader entry={entry} />

      {!entry.success && (
        <div className={styles.errorBox} role="alert">
          <b>Error</b>
          {entry.errorMessage && <span>{entry.errorMessage}</span>}
        </div>
      )}

      <div className={styles.code}>
        <div className={styles.codeHeader}>SQL</div>
        <pre className={styles.pre}>
          <code>{highlighted}</code>
        </pre>
      </div>

      <HistoryEntryFacts entry={entry} connectionName={connectionName} />

      <HistoryEntryActions entry={entry} onOpenInEditor={onOpenInEditor} />
    </div>
  )
}
