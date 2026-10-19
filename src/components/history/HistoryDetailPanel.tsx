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
import dotStyles from '../shared/toolbar/toolbar-items.module.css'
import styles from './HistoryDetailPanel.module.css'

export interface HistoryDetailPanelProps {
  entry: HistoryEntry | null
  onOpenInEditor: (entry: HistoryEntry) => void
  /** Display name of the connection the history belongs to. */
  connectionName?: string
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

function formatRows(entry: HistoryEntry): string {
  if (!entry.success) return '—'
  const n = entry.rowCount ?? entry.affectedRows ?? 0
  return `${n.toLocaleString()} ${n === 1 ? 'row' : 'rows'}`
}

export function HistoryDetailPanel({
  entry,
  onOpenInEditor,
  connectionName,
}: HistoryDetailPanelProps) {
  const [copied, setCopied] = useState(false)
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

  const handleCopy = useCallback(() => {
    if (!entry) return
    void navigator.clipboard.writeText(entry.sqlText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [entry])

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
      <div className={styles.header}>
        <span
          className={`${dotStyles.statusDot} ${entry.success ? dotStyles.statusDotOk : dotStyles.statusDotError}`}
          aria-hidden="true"
        >
          {entry.success ? '✓' : '✕'}
        </span>
        <b>{entry.success ? 'Succeeded' : 'Failed'}</b>
        <span className={styles.time}>{formatTableTimestamp(entry.timestamp)}</span>
      </div>

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

      <div className={styles.kv}>
        <span>Database</span>
        <span>{entry.databaseName ?? '—'}</span>
        <span>Duration</span>
        <span>{formatDuration(entry.durationMs)}</span>
        <span>Rows</span>
        <span>{formatRows(entry)}</span>
        <span>Connection</span>
        <span>{connectionName ?? '—'}</span>
      </div>

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
          {copied ? (
            <CheckIcon size={16} weight="bold" />
          ) : (
            <CopySimpleIcon size={16} weight="regular" />
          )}
          {copied ? 'Copied' : 'Copy SQL'}
        </Button>
      </div>
    </div>
  )
}
