/**
 * Read-only form view — displays one row at a time from the query result.
 *
 * Each column is rendered as a labeled field with a per-field copy button.
 * Record navigation (Previous / Next) supports cross-page navigation via
 * the `onNavigate` callback that the parent handles.
 */

import { useCallback } from 'react'
import { CaretLeft, CaretRight, CopySimple } from '@phosphor-icons/react'
import { writeClipboardText } from '../../lib/context-menu-utils'
import { formatCellValue } from '../../lib/result-cell-utils'
import { useQueryStore } from '../../stores/query-store'
import type { ColumnMeta } from '../../types/schema'
import styles from './ResultFormView.module.css'

export interface ResultFormViewProps {
  columns: ColumnMeta[]
  /** Current page rows — array of arrays, indexed by column position. */
  rows: Array<Array<unknown>>
  /** Absolute index within the full result set (0-based), or null for first row. */
  selectedRowIndex: number | null
  totalRows: number
  currentPage: number
  totalPages: number
  /** Called with 'prev' or 'next' — parent handles page fetching + setSelectedRow. */
  onNavigate: (direction: 'prev' | 'next') => void
  tabId: string
}

export function ResultFormView({
  columns,
  rows,
  selectedRowIndex,
  totalRows,
  currentPage,
  totalPages,
  onNavigate,
  tabId,
}: ResultFormViewProps) {
  // Read pageSize from the store to compute the local row offset
  const pageSize = useQueryStore((state) => state.tabs[tabId]?.pageSize ?? 1000)

  const absoluteIndex = selectedRowIndex ?? 0
  const displayRecord = absoluteIndex + 1

  // Map absolute index to local index within the current page
  const pageStartOffset = (currentPage - 1) * pageSize
  const localIndex = absoluteIndex - pageStartOffset
  const clampedLocal = Math.max(0, Math.min(localIndex, rows.length - 1))
  const currentRow = rows.length > 0 ? (rows[clampedLocal] ?? []) : []

  const canGoPrev = absoluteIndex > 0
  const canGoNext = absoluteIndex < totalRows - 1

  // Suppress lint: totalPages is used for display / future guard
  void totalPages

  const handleCopy = useCallback(async (value: unknown) => {
    const { displayValue } = formatCellValue(value)
    try {
      await writeClipboardText(displayValue)
    } catch {
      // Silently fail — clipboard unavailable
    }
  }, [])

  return (
    <div className={styles.container} data-testid="result-form-view">
      {/* Record navigation header */}
      <div className={styles.header}>
        <h2 className={styles.recordTitle}>
          Record {displayRecord} of {totalRows}
        </h2>
        <div className={styles.navigation}>
          <button
            type="button"
            className={styles.navButton}
            disabled={!canGoPrev}
            onClick={() => onNavigate('prev')}
            aria-label="Previous record"
            data-testid="prev-record-button"
          >
            <CaretLeft size={14} weight="bold" />
            <span>Previous</span>
          </button>
          <button
            type="button"
            className={styles.navButton}
            disabled={!canGoNext}
            onClick={() => onNavigate('next')}
            aria-label="Next record"
            data-testid="next-record-button"
          >
            <span>Next</span>
            <CaretRight size={14} weight="bold" />
          </button>
        </div>
      </div>

      {/* Field list — card container */}
      <div className={styles.card}>
        {columns.map((col, i) => {
          const value = currentRow[i]
          const { displayValue, isNull } = formatCellValue(value)
          return (
            <div key={`${col.name}-${i}`} className={styles.field}>
              <label className={styles.fieldLabel}>{col.name.toUpperCase()}</label>
              <div className={styles.fieldValueRow}>
                <span
                  className={`${styles.fieldValue} ${isNull ? styles.nullValue : ''}`}
                  data-testid={`field-value-${i}`}
                >
                  {displayValue}
                </span>
                <button
                  type="button"
                  className={styles.copyButton}
                  onClick={() => handleCopy(value)}
                  title={`Copy ${col.name}`}
                  aria-label={`Copy ${col.name}`}
                  data-testid={`copy-field-${i}`}
                >
                  <CopySimple size={14} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
