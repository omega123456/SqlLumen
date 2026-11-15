import type { ReactNode } from 'react'
import { statusDotClassName } from '../../../lib/class-names-status-dot'
import type { StatusAreaProps } from '../../../types/shared-data-view'

function successCountLabel(props: StatusAreaProps): ReactNode {
  const { countLabel, totalRows } = props
  if (countLabel != null) return countLabel
  if (totalRows == null) return 'Success'
  return `${totalRows} ${totalRows === 1 ? 'row' : 'rows'}`
}

export function StatusArea(props: StatusAreaProps) {
  const { status, loadingLabel, executionTimeMs, errorMessage, customContent } = props
  return (
    <div
      className="ml-1.5 flex max-w-full min-w-22.5 shrink-0 items-center gap-2 overflow-hidden text-row text-light-on-surface-variant dark:text-dark-on-surface-variant"
      data-testid="status-area"
    >
      {status === 'loading' && (
        <span className="flex items-center gap-2 whitespace-nowrap" data-testid="status-loading">
          <span className="size-3 animate-spin-700ms rounded-round border-2 border-y-light-primary border-l-light-primary border-r-transparent window-blurred:animate-spin-700ms-paused dark:border-y-dark-primary dark:border-l-dark-primary" />
          <span>{loadingLabel ?? 'Loading...'}</span>
        </span>
      )}

      {status === 'success' && (
        <>
          <span className="flex items-center gap-2 whitespace-nowrap" data-testid="status-success">
            <span className={statusDotClassName(true)} aria-hidden="true">
              ✓
            </span>
            <b className="font-semibold text-light-on-surface dark:text-dark-on-surface">
              {successCountLabel(props)}
            </b>
          </span>
          {executionTimeMs != null && (
            <span className="whitespace-nowrap" data-testid="status-execution-time">
              {executionTimeMs} ms
            </span>
          )}
        </>
      )}

      {status === 'error' && (
        <span
          className="flex min-w-0 items-center gap-2 overflow-hidden text-ellipsis whitespace-nowrap"
          data-testid="status-error"
        >
          <span className={statusDotClassName(false)} aria-hidden="true">
            ✕
          </span>
          <b className="overflow-hidden text-ellipsis font-semibold text-light-on-surface dark:text-dark-on-surface">
            {errorMessage || 'Error'}
          </b>
        </span>
      )}

      {customContent}
    </div>
  )
}
