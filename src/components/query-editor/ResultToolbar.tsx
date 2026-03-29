/**
 * Toolbar above the result grid — shows view mode toggle, edit mode dropdown,
 * Save/Discard buttons, query status, export action, page size selector,
 * and pagination controls.
 */

import { useCallback } from 'react'
import {
  Table,
  Rows,
  Code,
  Export,
  CheckCircle,
  XCircle,
  CaretLeft,
  CaretRight,
  FloppyDisk,
} from '@phosphor-icons/react'
import { useQueryStore } from '../../stores/query-store'
import { EditModeDropdown } from './EditModeDropdown'
import type { ViewMode } from '../../types/schema'
import styles from './ResultToolbar.module.css'

interface ResultToolbarProps {
  tabId: string
  connectionId: string
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

export function ResultToolbar({ tabId, connectionId }: ResultToolbarProps) {
  const tabState = useQueryStore((state) => state.tabs[tabId])
  const setViewMode = useQueryStore((state) => state.setViewMode)
  const openExportDialog = useQueryStore((state) => state.openExportDialog)
  const changePageSize = useQueryStore((state) => state.changePageSize)
  const fetchPage = useQueryStore((state) => state.fetchPage)
  const saveCurrentRow = useQueryStore((state) => state.saveCurrentRow)
  const discardCurrentRow = useQueryStore((state) => state.discardCurrentRow)
  const requestNavigationAction = useQueryStore((state) => state.requestNavigationAction)

  const status = tabState?.status ?? 'idle'
  const totalRows = tabState?.totalRows ?? 0
  const affectedRows = tabState?.affectedRows ?? 0
  const columnsCount = (tabState?.columns ?? []).length
  const executionTimeMs = tabState?.executionTimeMs ?? null
  const errorMessage = tabState?.errorMessage ?? null
  const autoLimitApplied = tabState?.autoLimitApplied ?? false
  const currentPage = tabState?.currentPage ?? 1
  const totalPages = tabState?.totalPages ?? 1
  const pageSize = tabState?.pageSize ?? 1000
  const viewMode = tabState?.viewMode ?? 'grid'
  const queryId = tabState?.queryId ?? null

  // Edit state for Save/Discard buttons
  const editState = tabState?.editState ?? null
  const hasModifications = editState !== null && editState.modifiedColumns.size > 0

  const truncatedError =
    errorMessage && errorMessage.length > 200 ? errorMessage.slice(0, 200) + '\u2026' : errorMessage

  // Show pagination only on success with actual result columns (not DML/DDL)
  const showPagination = status === 'success' && columnsCount > 0
  const hasResults = status === 'success'

  const handleViewMode = useCallback(
    (mode: ViewMode) => {
      setViewMode(tabId, mode)
    },
    [setViewMode, tabId]
  )

  const handleExport = useCallback(() => {
    openExportDialog(tabId)
  }, [openExportDialog, tabId])

  const handlePageSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const size = parseInt(e.target.value, 10)
      requestNavigationAction(tabId, () => {
        changePageSize(connectionId, tabId, size)
      })
    },
    [requestNavigationAction, changePageSize, connectionId, tabId]
  )

  const handlePrevPage = useCallback(() => {
    if (queryId && connectionId && currentPage > 1) {
      requestNavigationAction(tabId, () => {
        fetchPage(connectionId, tabId, currentPage - 1)
      })
    }
  }, [queryId, connectionId, currentPage, requestNavigationAction, fetchPage, tabId])

  const handleNextPage = useCallback(() => {
    if (queryId && connectionId && currentPage < totalPages) {
      requestNavigationAction(tabId, () => {
        fetchPage(connectionId, tabId, currentPage + 1)
      })
    }
  }, [queryId, connectionId, currentPage, totalPages, requestNavigationAction, fetchPage, tabId])

  const handleSave = useCallback(() => {
    saveCurrentRow(tabId)
  }, [saveCurrentRow, tabId])

  const handleDiscard = useCallback(() => {
    discardCurrentRow(tabId)
  }, [discardCurrentRow, tabId])

  return (
    <div className={styles.toolbar} data-testid="result-toolbar">
      {/* Left: View mode toggle */}
      <div className={styles.viewModeGroup}>
        <button
          type="button"
          className={`${styles.viewModeButton} ${viewMode === 'grid' ? styles.viewModeActive : ''}`}
          onClick={() => handleViewMode('grid')}
          title="Grid view"
          data-testid="view-mode-grid"
        >
          <Table size={14} weight={viewMode === 'grid' ? 'fill' : 'regular'} />
        </button>
        <button
          type="button"
          className={`${styles.viewModeButton} ${viewMode === 'form' ? styles.viewModeActive : ''}`}
          onClick={() => handleViewMode('form')}
          title="Form view"
          data-testid="view-mode-form"
        >
          <Rows size={14} weight={viewMode === 'form' ? 'fill' : 'regular'} />
        </button>
        <button
          type="button"
          className={`${styles.viewModeButton} ${viewMode === 'text' ? styles.viewModeActive : ''}`}
          onClick={() => handleViewMode('text')}
          title="Text view"
          data-testid="view-mode-text"
        >
          <Code size={14} weight={viewMode === 'text' ? 'fill' : 'regular'} />
        </button>
      </div>

      {/* Edit mode dropdown — between view mode and status area */}
      <EditModeDropdown tabId={tabId} connectionId={connectionId} />

      {/* Save/Discard buttons — visible only during active editing */}
      {editState !== null && (
        <div className={styles.editActionsGroup} data-testid="edit-actions-group">
          {hasModifications && (
            <button
              type="button"
              className={styles.saveButton}
              onClick={handleSave}
              title="Save changes"
              data-testid="query-save-button"
            >
              <FloppyDisk size={14} weight="regular" />
              <span>Save</span>
            </button>
          )}
          <button
            type="button"
            className={styles.discardButton}
            onClick={handleDiscard}
            title="Discard changes"
            data-testid="query-discard-button"
          >
            <span>Discard</span>
          </button>
        </div>
      )}

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
        ) : status === 'error' ? (
          <span className={styles.errorStatus}>
            <XCircle size={14} weight="fill" />
            <span>{truncatedError}</span>
          </span>
        ) : null}
      </div>

      {/* Center-right: Export button */}
      <button
        type="button"
        className={styles.exportButton}
        disabled={!hasResults}
        onClick={handleExport}
        data-testid="export-button"
      >
        <Export size={14} weight="regular" />
        <span>Export</span>
      </button>

      {/* Right: Page size + pagination */}
      {showPagination && (
        <div className={styles.paginationGroup}>
          <select
            className={styles.pageSizeSelect}
            value={pageSize}
            onChange={handlePageSizeChange}
            data-testid="page-size-selector"
            aria-label="Page size"
          >
            <option value={100}>100</option>
            <option value={500}>500</option>
            <option value={1000}>1000</option>
            <option value={5000}>5000</option>
          </select>

          <div className={styles.pagination}>
            <button
              type="button"
              className={styles.pageButton}
              disabled={currentPage <= 1}
              onClick={handlePrevPage}
              aria-label="Previous page"
              data-testid="prev-page-button"
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
              onClick={handleNextPage}
              aria-label="Next page"
              data-testid="next-page-button"
            >
              <CaretRight size={14} weight="bold" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
