import { useState, useEffect } from 'react'
import { Stop } from '@phosphor-icons/react'
import { useQueryStore } from '../../stores/query-store'
import { formatElapsedTime } from '../../lib/elapsed-time'
import { Button } from '../common/Button'
import { MILLISECONDS_PER_SECOND } from '../../lib/units'
import { joinClassNames, PRIMARY_RING_SPINNER } from '../../lib/class-names'
import { FOCUS_RING } from '../../lib/focus-ring'

interface RunningIndicatorProps {
  connectionId: string
  tabId: string
}

interface CancelButtonProps {
  isCancelling: boolean
  onCancel: () => void
}

function CancelButton({ isCancelling, onCancel }: CancelButtonProps) {
  return (
    <Button
      variant="bare"
      className={joinClassNames([
        'flex min-h-11 items-center gap-1 rounded-control border border-light-stroke-card bg-light-surface-container-highest px-3.5 py-1.5 font-body text-size-caption font-semibold whitespace-nowrap text-light-on-surface-variant cursor-pointer transition-color-border-bg-opacity duration-150 not-disabled:hover:border-light-error not-disabled:hover:text-light-error disabled:cursor-not-allowed disabled:opacity-40 dark:border-dark-stroke-card dark:bg-dark-surface-container-highest dark:text-dark-on-surface-variant dark:not-disabled:hover:border-dark-error dark:not-disabled:hover:text-dark-error',
        FOCUS_RING,
      ])}
      onClick={onCancel}
      disabled={isCancelling}
      data-testid="cancel-query-button"
    >
      <Stop size={14} weight="fill" />
      <span>{isCancelling ? 'Cancelling...' : 'Cancel'}</span>
    </Button>
  )
}

export function RunningIndicator({ connectionId, tabId }: RunningIndicatorProps) {
  const executionStartedAt = useQueryStore((state) => state.tabs[tabId]?.executionStartedAt ?? null)
  const isCancelling = useQueryStore((state) => state.tabs[tabId]?.isCancelling ?? false)
  const cancelQuery = useQueryStore((state) => state.cancelQuery)

  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (executionStartedAt === null) {
      const resetTimer = setTimeout(() => {
        setElapsed(0)
      }, 0)

      return () => clearTimeout(resetTimer)
    }

    const updateElapsed = () => {
      setElapsed(Date.now() - executionStartedAt)
    }

    const initialTimer = setTimeout(updateElapsed, 0)
    const interval = setInterval(updateElapsed, MILLISECONDS_PER_SECOND)

    return () => {
      clearTimeout(initialTimer)
      clearInterval(interval)
    }
  }, [executionStartedAt])

  return (
    <div className="flex items-center gap-2" data-testid="running-indicator">
      <div role="status" aria-live="polite" className="absolute size-px overflow-hidden">
        Running
      </div>
      <span className={joinClassNames([PRIMARY_RING_SPINNER, 'size-3'])} aria-hidden="true" />
      <span className="font-body text-size-caption font-semibold text-light-primary dark:text-dark-primary">
        Running
      </span>
      <span
        className="min-w-elapsed-timer font-mono text-size-caption text-light-on-surface-variant dark:text-dark-on-surface-variant"
        data-testid="running-timer"
        aria-hidden="true"
      >
        {formatElapsedTime(elapsed)}
      </span>
      <CancelButton isCancelling={isCancelling} onCancel={() => cancelQuery(connectionId, tabId)} />
    </div>
  )
}
