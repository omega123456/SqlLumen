import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { Play, ClockCountdown } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import type { DisplayStatus } from './result-panel-model'

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-size-row text-light-on-surface-variant dark:text-dark-on-surface-variant">
      {children}
    </div>
  )
}

function ResultSpinner(attributes: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className="size-6 animate-spin-800ms rounded-round border-2 border-transparent border-t-light-primary window-blurred:animate-spin-800ms-paused dark:border-t-dark-primary"
      {...attributes}
    />
  )
}

export function EmptyResultState({ isRunning }: { isRunning: boolean }) {
  if (isRunning) {
    return (
      <EmptyState>
        <ResultSpinner />
        <span>Executing query...</span>
      </EmptyState>
    )
  }
  return (
    <EmptyState>
      <Play size={32} weight="duotone" className="opacity-20" />
      <span>Run a query to see results</span>
    </EmptyState>
  )
}

function ResultStatusOverlay({ testId, label }: { testId: string; label: string }) {
  return (
    <div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-light-surface-container-lowest text-size-row text-light-on-surface-variant opacity-85 dark:bg-dark-surface-container-lowest dark:text-dark-on-surface-variant"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid={testId}
    >
      <ResultSpinner aria-hidden="true" />
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
    <EmptyState>
      <ClockCountdown
        weight="duotone"
        size={32}
        aria-hidden="true"
        className="opacity-35 text-light-on-surface-variant dark:text-dark-on-surface-variant"
      />
      <div className="max-w-80 text-center">
        <div className="text-size-body font-semibold text-light-on-surface dark:text-dark-on-surface">
          Results expired
        </div>
        <div className="mt-1 text-size-caption text-light-on-surface-variant opacity-60 dark:text-dark-on-surface-variant">
          Cached results are no longer available.
        </div>
      </div>
      <Button
        onClick={onRetry}
        disabled={isRestoring}
        className="mt-2"
        data-testid="retry-expired-button"
      >
        Re-run query
      </Button>
    </EmptyState>
  )
}
