/**
 * Result display panel — shows query results in different states:
 * idle (placeholder), running (spinner), success (toolbar + grid),
 * or error (toolbar + error message).
 */

import { useState, useCallback } from 'react'
import { Play, CheckCircle } from '@phosphor-icons/react'
import { useQueryStore } from '../../stores/query-store'
import { ResultToolbar } from './ResultToolbar'
import { ResultGrid } from './ResultGrid'
import type { ColumnMeta } from '../../types/schema'
import styles from './ResultPanel.module.css'

interface ResultPanelProps {
  tabId: string
  connectionId: string
}

export function ResultPanel({ tabId, connectionId }: ResultPanelProps) {
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null)

  const tabState = useQueryStore((state) => state.tabs[tabId])
  const fetchPage = useQueryStore((state) => state.fetchPage)

  const status = tabState?.status ?? 'idle'
  const columns = (tabState?.columns ?? []) as ColumnMeta[]
  const rows = (tabState?.rows ?? []) as (string | null)[][]
  const totalRows = tabState?.totalRows ?? 0
  const affectedRows = tabState?.affectedRows ?? 0
  const executionTimeMs = tabState?.executionTimeMs ?? null
  const errorMessage = tabState?.errorMessage ?? null
  const autoLimitApplied = tabState?.autoLimitApplied ?? false
  const currentPage = tabState?.currentPage ?? 1
  const totalPages = tabState?.totalPages ?? 1
  const queryId = tabState?.queryId ?? null

  const handlePrevPage = useCallback(() => {
    if (queryId && connectionId && currentPage > 1) {
      fetchPage(connectionId, tabId, currentPage - 1)
    }
  }, [queryId, connectionId, currentPage, fetchPage, tabId])

  const handleNextPage = useCallback(() => {
    if (queryId && connectionId && currentPage < totalPages) {
      fetchPage(connectionId, tabId, currentPage + 1)
    }
  }, [queryId, connectionId, currentPage, totalPages, fetchPage, tabId])

  const handleRowSelect = useCallback((index: number) => {
    setSelectedRowIndex(index)
  }, [])

  return (
    <div className={styles.container} data-testid="result-panel">
      {status === 'idle' && (
        <div className={styles.emptyState}>
          <Play size={32} weight="duotone" className={styles.emptyIcon} />
          <span>Run a query to see results</span>
        </div>
      )}

      {status === 'running' && (
        <div className={styles.emptyState}>
          <div className={styles.spinner} />
          <span>Executing query...</span>
        </div>
      )}

      {status === 'success' && (
        <>
          <ResultToolbar
            status="success"
            totalRows={totalRows}
            affectedRows={affectedRows}
            columnsCount={columns.length}
            executionTimeMs={executionTimeMs}
            error={null}
            autoLimitApplied={autoLimitApplied}
            currentPage={currentPage}
            totalPages={totalPages}
            onPrevPage={handlePrevPage}
            onNextPage={handleNextPage}
          />
          {columns.length > 0 ? (
            <ResultGrid
              columns={columns}
              rows={rows}
              selectedRowIndex={selectedRowIndex}
              onRowSelect={handleRowSelect}
            />
          ) : (
            <div className={styles.emptyState} data-testid="dml-success">
              <CheckCircle size={32} weight="duotone" className={styles.successIcon} />
              <span>
                {affectedRows > 0
                  ? `Query executed: ${affectedRows} rows affected`
                  : 'Query executed successfully'}
              </span>
            </div>
          )}
        </>
      )}

      {status === 'error' && (
        <>
          <ResultToolbar
            status="error"
            totalRows={0}
            affectedRows={0}
            columnsCount={0}
            executionTimeMs={executionTimeMs}
            error={errorMessage}
            autoLimitApplied={false}
            currentPage={1}
            totalPages={1}
            onPrevPage={handlePrevPage}
            onNextPage={handleNextPage}
          />
          <div className={styles.errorBody}>
            <span className={styles.errorMessage}>{errorMessage}</span>
          </div>
        </>
      )}
    </div>
  )
}
