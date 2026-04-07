import { useCallback, useState } from 'react'
import {
  ClockCounterClockwise,
  CheckCircle,
  XCircle,
  ArrowSquareOut,
  CopySimple,
  Check,
} from '@phosphor-icons/react'
import { ElevatedCodePanel } from '../common/ElevatedCodePanel'
import type { HistoryEntry } from '../../types/schema'
import styles from './HistoryDetailPanel.module.css'

export interface HistoryDetailPanelProps {
  entry: HistoryEntry | null
  onOpenInEditor: (entry: HistoryEntry) => void
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function HistoryDetailPanel({ entry, onOpenInEditor }: HistoryDetailPanelProps) {
  const [copied, setCopied] = useState(false)

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
          <ClockCounterClockwise size={48} weight="regular" className={styles.emptyIcon} />
          <span className={styles.emptyText}>Select a query to preview</span>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.panel} data-testid="history-detail-panel">
      <h4 className={styles.sectionHeading}>Statement Preview</h4>

      <ElevatedCodePanel
        label="SQL"
        className={styles.codeBlock}
        headerActions={
          <button
            type="button"
            className={styles.copyButton}
            onClick={handleCopy}
            aria-label="Copy SQL"
            title="Copy SQL"
            data-testid="history-copy-sql"
          >
            {copied ? <Check size={14} weight="bold" /> : <CopySimple size={14} weight="regular" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        }
      >
        {entry.sqlText}
      </ElevatedCodePanel>

      <h4 className={styles.sectionHeading}>Details</h4>

      <div className={styles.metaGrid}>
        <span className={styles.metaLabel}>Duration</span>
        <span className={styles.metaValue}>{formatDuration(entry.durationMs)}</span>

        <span className={styles.metaLabel}>Rows Affected</span>
        <span className={styles.metaValue}>{entry.rowCount ?? entry.affectedRows ?? 0}</span>

        <span className={styles.metaLabel}>Status</span>
        <span className={styles.metaValue}>
          {entry.success ? (
            <span className={styles.statusSuccess}>
              <CheckCircle size={14} weight="fill" />
              Success
            </span>
          ) : (
            <span className={styles.statusError}>
              <XCircle size={14} weight="fill" />
              <span className={styles.errorMessage} title={entry.errorMessage ?? undefined}>
                {entry.errorMessage ?? 'Error'}
              </span>
            </span>
          )}
        </span>
      </div>

      <button
        type="button"
        className={styles.openButton}
        onClick={() => onOpenInEditor(entry)}
        data-testid="history-open-in-editor"
      >
        <ArrowSquareOut size={14} weight="regular" />
        Open in Editor
      </button>
    </div>
  )
}
