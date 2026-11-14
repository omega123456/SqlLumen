import { Play, ClockCountdown } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import type { DisplayStatus } from './result-panel-model'
import styles from '../ResultPanel.module.css'

export function EmptyResultState({ isRunning }: { isRunning: boolean }) {
  if (isRunning) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.spinner} />
        <span>Executing query...</span>
      </div>
    )
  }
  return (
    <div className={styles.emptyState}>
      <Play size={32} weight="duotone" className={styles.emptyIcon} />
      <span>Run a query to see results</span>
    </div>
  )
}

function ResultStatusOverlay({ testId, label }: { testId: string; label: string }) {
  return (
    <div
      className={styles.restoringOverlay}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid={testId}
    >
      <div className={styles.spinner} aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

export function ResultActivityOverlay({
  displayStatus,
  isSorting,
}: {
  displayStatus: DisplayStatus
  isSorting: boolean
}) {
  if (displayStatus === 'restoring') {
    return (
      <ResultStatusOverlay
        testId="query-result-restore-overlay"
        label="Restoring cached results…"
      />
    )
  }
  if (!isSorting) return null
  return <ResultStatusOverlay testId="query-result-sort-overlay" label="Sorting…" />
}

export function ExpiredResultState({
  isRestoring,
  onRetry,
}: {
  isRestoring: boolean
  onRetry: () => void
}) {
  return (
    <div className={styles.emptyState} style={{ height: '100%' }}>
      <ClockCountdown
        weight="duotone"
        size={32}
        aria-hidden="true"
        style={{ opacity: 0.35, color: 'var(--on-surface-variant)' }}
      />
      <div style={{ maxWidth: 320, textAlign: 'center' }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--on-surface)',
          }}
        >
          Results expired
        </div>
        <div
          style={{
            fontSize: 12,
            opacity: 0.6,
            color: 'var(--on-surface-variant)',
            marginTop: 4,
          }}
        >
          Cached results are no longer available.
        </div>
      </div>
      <Button
        onClick={onRetry}
        disabled={isRestoring}
        style={{ marginTop: 8 }}
        data-testid="retry-expired-button"
      >
        Re-run query
      </Button>
    </div>
  )
}
