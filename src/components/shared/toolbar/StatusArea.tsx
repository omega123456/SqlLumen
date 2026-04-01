/**
 * StatusArea — shared toolbar component for displaying query/data status.
 *
 * Shows a loading spinner, success text with row count and timing,
 * an error message, or nothing (idle state).
 * Purely presentational — no store imports.
 */

import { CheckCircle, XCircle } from '@phosphor-icons/react'
import type { StatusAreaProps } from '../../../types/shared-data-view'
import styles from './toolbar-items.module.css'

export function StatusArea({
  status,
  totalRows,
  executionTimeMs,
  errorMessage,
  customContent,
}: StatusAreaProps) {
  return (
    <div className={styles.statusArea} data-testid="status-area">
      {status === 'loading' && (
        <span className={styles.loadingStatus} data-testid="status-loading">
          <span className={styles.miniSpinner} />
          <span>Loading...</span>
        </span>
      )}

      {status === 'success' && (
        <>
          <span className={styles.successStatus} data-testid="status-success">
            <CheckCircle size={14} weight="fill" />
            <span>{totalRows != null ? `${totalRows} Rows` : 'Success'}</span>
          </span>
          {executionTimeMs != null && (
            <span className={styles.executionTime} data-testid="status-execution-time">
              ({executionTimeMs}ms)
            </span>
          )}
        </>
      )}

      {status === 'error' && (
        <span className={styles.errorStatus} data-testid="status-error">
          <XCircle size={14} weight="fill" />
          <span>{errorMessage || 'Error'}</span>
        </span>
      )}

      {/* idle: render nothing */}

      {customContent}
    </div>
  )
}
