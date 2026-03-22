/**
 * Toolbar above the result grid — shows query status, action buttons,
 * and pagination controls.
 */

import {
  FunnelSimple,
  Export,
  ArrowClockwise,
  CheckCircle,
  XCircle,
  CaretLeft,
  CaretRight,
} from '@phosphor-icons/react'
import styles from './ResultToolbar.module.css'

interface ResultToolbarProps {
  status: 'success' | 'error'
  totalRows: number
  affectedRows: number
  columnsCount: number
  executionTimeMs: number | null
  error: string | null
  autoLimitApplied: boolean
  currentPage: number
  totalPages: number
  onPrevPage: () => void
  onNextPage: () => void
}

function getSuccessText(totalRows: number, affectedRows: number, columnsCount: number): string {
  if (columnsCount === 0 && affectedRows > 0) {
    return `${affectedRows} ROWS AFFECTED`
  }
  if (columnsCount === 0 && affectedRows === 0 && totalRows === 0) {
    return 'QUERY OK'
  }
  return `SUCCESS: ${totalRows} ROWS`
}

export function ResultToolbar({
  status,
  totalRows,
  affectedRows,
  columnsCount,
  executionTimeMs,
  error,
  autoLimitApplied,
  currentPage,
  totalPages,
  onPrevPage,
  onNextPage,
}: ResultToolbarProps) {
  const truncatedError = error && error.length > 200 ? error.slice(0, 200) + '\u2026' : error

  // Show pagination only on success with actual result columns (not DML/DDL)
  const showPagination = status === 'success' && columnsCount > 0

  return (
    <div className={styles.toolbar} data-testid="result-toolbar">
      {/* Left: action buttons (disabled placeholders) */}
      <div className={styles.leftActions}>
        <button type="button" className={styles.iconButton} disabled title="Coming soon">
          <FunnelSimple size={14} weight="regular" />
        </button>
        <button type="button" className={styles.iconButton} disabled title="Coming soon">
          <Export size={14} weight="regular" />
        </button>
        <button type="button" className={styles.iconButton} disabled title="Coming soon">
          <ArrowClockwise size={14} weight="regular" />
        </button>
      </div>

      {/* Center-left: status text */}
      <div className={styles.statusArea}>
        {status === 'success' ? (
          <>
            <span className={styles.successStatus}>
              <CheckCircle size={14} weight="fill" />
              <span>{getSuccessText(totalRows, affectedRows, columnsCount)}</span>
            </span>
            {executionTimeMs != null && (
              <span className={styles.executionTime}>({executionTimeMs}ms)</span>
            )}
            {autoLimitApplied && <span className={styles.autoLimit}>(1000 row limit applied)</span>}
          </>
        ) : (
          <span className={styles.errorStatus}>
            <XCircle size={14} weight="fill" />
            <span>{truncatedError}</span>
          </span>
        )}
      </div>

      {/* Right: pagination — only show for SELECT results, not error or DML */}
      {showPagination && (
        <div className={styles.pagination}>
          <button
            type="button"
            className={styles.pageButton}
            disabled={currentPage <= 1}
            onClick={onPrevPage}
            aria-label="Previous page"
          >
            <CaretLeft size={14} weight="bold" />
          </button>
          <span className={styles.pageText}>
            Page {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            className={styles.pageButton}
            disabled={currentPage >= totalPages}
            onClick={onNextPage}
            aria-label="Next page"
          >
            <CaretRight size={14} weight="bold" />
          </button>
        </div>
      )}
    </div>
  )
}
