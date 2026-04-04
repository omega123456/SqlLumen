/**
 * Running indicator shown in place of Execute/Execute All buttons
 * while a query is executing. Displays a spinner, "RUNNING" label,
 * elapsed timer, and a Cancel button.
 */

import { useState, useEffect } from 'react'
import { Stop } from '@phosphor-icons/react'
import { useQueryStore } from '../../stores/query-store'
import { formatElapsedTime } from '../../lib/elapsed-time'
import styles from './RunningIndicator.module.css'

interface RunningIndicatorProps {
  connectionId: string
  tabId: string
}

export function RunningIndicator({ connectionId, tabId }: RunningIndicatorProps) {
  const executionStartedAt = useQueryStore((state) => state.tabs[tabId]?.executionStartedAt ?? null)
  const isCancelling = useQueryStore((state) => state.tabs[tabId]?.isCancelling ?? false)
  const cancelQuery = useQueryStore((state) => state.cancelQuery)

  const [elapsed, setElapsed] = useState(executionStartedAt ? Date.now() - executionStartedAt : 0)

  useEffect(() => {
    if (executionStartedAt === null) {
      setElapsed(0)
      return
    }

    const interval = setInterval(() => {
      setElapsed(Date.now() - executionStartedAt)
    }, 1000)

    return () => clearInterval(interval)
  }, [executionStartedAt])

  return (
    <div className={styles.container} data-testid="running-indicator">
      {/* One-time accessibility announcement — just announce running state */}
      <div
        role="status"
        aria-live="polite"
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}
      >
        Running
      </div>
      {/* Visual elements — timer is aria-hidden to prevent per-second re-announcement */}
      <span className={styles.spinner} aria-hidden="true" />
      <span className={styles.label}>RUNNING</span>
      <span className={styles.timer} data-testid="running-timer" aria-hidden="true">
        {formatElapsedTime(elapsed)}
      </span>
      <button
        type="button"
        className={`${styles.cancelButton}${isCancelling ? ` ${styles.cancelling}` : ''}`}
        onClick={() => cancelQuery(connectionId, tabId)}
        disabled={isCancelling}
        data-testid="cancel-query-button"
      >
        <Stop size={14} weight="fill" />
        <span>{isCancelling ? 'Cancelling...' : 'Cancel'}</span>
      </button>
    </div>
  )
}
