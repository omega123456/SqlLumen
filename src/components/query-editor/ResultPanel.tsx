/**
 * Result display panel — shows query results in different states:
 * idle (placeholder), running (spinner), success (toolbar + grid/form/text),
 * or error (toolbar + error message).
 */

import { useCallback } from 'react'
import { Play, CheckCircle } from '@phosphor-icons/react'
import { useQueryStore } from '../../stores/query-store'
import { ResultToolbar } from './ResultToolbar'
import { ResultGridView } from './ResultGridView'
import { ResultFormView } from './ResultFormView'
import { ResultTextView } from './ResultTextView'
import ExportDialog from '../dialogs/ExportDialog'
import type { ColumnMeta } from '../../types/schema'
import styles from './ResultPanel.module.css'

interface ResultPanelProps {
  tabId: string
  connectionId: string
}

export function ResultPanel({ tabId, connectionId }: ResultPanelProps) {
  const tabState = useQueryStore((state) => state.tabs[tabId])
  const store = useQueryStore()

  const status = tabState?.status ?? 'idle'
  const columns = (tabState?.columns ?? []) as ColumnMeta[]
  const rows = (tabState?.rows ?? []) as unknown[][]
  const affectedRows = tabState?.affectedRows ?? 0
  const viewMode = tabState?.viewMode ?? 'grid'
  const sortColumn = tabState?.sortColumn ?? null
  const sortDirection = tabState?.sortDirection ?? null
  const selectedRowIndex = tabState?.selectedRowIndex ?? null
  const exportDialogOpen = tabState?.exportDialogOpen ?? false
  const totalRows = tabState?.totalRows ?? 0
  const currentPage = tabState?.currentPage ?? 1
  const totalPages = tabState?.totalPages ?? 1
  const pageSize = tabState?.pageSize ?? 1000

  const handleSortChanged = useCallback(
    (column: string, direction: 'asc' | 'desc' | null) => {
      // All sort state transitions (reset selection, update sort column/direction,
      // IPC call, row replacement) are handled inside the store action.
      store.sortResults(connectionId, tabId, column, direction)
    },
    [store, connectionId, tabId]
  )

  const handleRowSelected = useCallback(
    (localRowIndex: number) => {
      // Convert page-local index to absolute index across the full result set
      const absoluteIndex = (currentPage - 1) * pageSize + localRowIndex
      store.setSelectedRow(tabId, absoluteIndex)
    },
    [store, tabId, currentPage, pageSize]
  )

  /**
   * Handle form-view record navigation (Previous / Next).
   *
   * Calculates the new absolute index, checks if a page change is needed,
   * fetches the new page if so, and always updates the selected row index.
   */
  const handleFormNavigate = useCallback(
    (direction: 'prev' | 'next') => {
      const currentIndex = selectedRowIndex ?? 0
      const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1

      // Bounds check
      if (newIndex < 0 || newIndex >= totalRows) return

      // Determine if we need a page change
      const pageStart = (currentPage - 1) * pageSize
      const pageEnd = pageStart + pageSize - 1

      if (newIndex < pageStart && currentPage > 1) {
        store.fetchPage(connectionId, tabId, currentPage - 1)
      } else if (newIndex > pageEnd && currentPage < totalPages) {
        store.fetchPage(connectionId, tabId, currentPage + 1)
      }

      store.setSelectedRow(tabId, newIndex)
    },
    [store, connectionId, tabId, selectedRowIndex, totalRows, currentPage, totalPages, pageSize]
  )

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
          <ResultToolbar tabId={tabId} connectionId={connectionId} />
          {columns.length > 0 ? (
            <>
              {viewMode === 'grid' && (
                <ResultGridView
                  columns={columns}
                  rows={rows}
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  onSortChanged={handleSortChanged}
                  onRowSelected={handleRowSelected}
                  selectedRowIndex={selectedRowIndex}
                  currentPage={currentPage}
                  pageSize={pageSize}
                />
              )}
              {viewMode === 'form' && (
                <ResultFormView
                  columns={columns}
                  rows={rows}
                  selectedRowIndex={selectedRowIndex}
                  totalRows={totalRows}
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onNavigate={handleFormNavigate}
                  tabId={tabId}
                />
              )}
              {viewMode === 'text' && <ResultTextView columns={columns} rows={rows} />}
            </>
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
          <ResultToolbar tabId={tabId} connectionId={connectionId} />
          <div className={styles.errorBody}>
            <span className={styles.errorMessage}>{tabState?.errorMessage}</span>
          </div>
        </>
      )}

      {exportDialogOpen && (
        <ExportDialog
          connectionId={connectionId}
          tabId={tabId}
          columnCount={columns.length}
          totalRows={totalRows}
          onClose={() => store.closeExportDialog(tabId)}
        />
      )}
    </div>
  )
}
