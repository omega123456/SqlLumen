/**
 * Toolbar above the result grid — shows view mode toggle, edit mode dropdown,
 * Save/Discard buttons, query status, export action, page size selector,
 * and pagination controls.
 *
 * Composes shared toolbar item components (ViewModeGroup, PaginationGroup,
 * ExportButton, StatusArea) for view mode, pagination, export, and status
 * display while keeping query-specific controls inline.
 */

import { useCallback } from 'react'
import { FloppyDisk } from '@phosphor-icons/react'
import { useQueryStore } from '../../stores/query-store'
import { EditModeDropdown } from './EditModeDropdown'
import { ViewModeGroup } from '../shared/toolbar/ViewModeGroup'
import { PaginationGroup } from '../shared/toolbar/PaginationGroup'
import { ExportButton } from '../shared/toolbar/ExportButton'
import { StatusArea } from '../shared/toolbar/StatusArea'
import type { ViewMode, StatusType } from '../../types/shared-data-view'
import styles from './ResultToolbar.module.css'

interface ResultToolbarProps {
  tabId: string
  connectionId: string
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

  // Map query status to StatusArea status type
  const statusAreaStatus: StatusType =
    status === 'success' ? 'success' : status === 'error' ? 'error' : 'idle'

  // Map totalRows for StatusArea based on result type
  let statusTotalRows: number | undefined = undefined
  if (status === 'success') {
    if (columnsCount > 0) {
      statusTotalRows = totalRows
    } else if (affectedRows > 0) {
      statusTotalRows = affectedRows
    }
    // DDL (no columns, no affected rows) → undefined → shows "Success"
  }

  // Auto-limit custom content
  const autoLimitContent = autoLimitApplied ? (
    <span className={styles.autoLimit}>(1000 row limit applied)</span>
  ) : undefined

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
    (size: number) => {
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
      {/* Left: View mode toggle — shared component */}
      <ViewModeGroup
        currentMode={viewMode}
        availableModes={['grid', 'form', 'text']}
        onModeChange={handleViewMode}
        testIdPrefix="view-mode"
      />

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

      {/* Center-left: status — shared component */}
      <div className={styles.statusWrapper}>
        <StatusArea
          status={statusAreaStatus}
          totalRows={statusTotalRows}
          executionTimeMs={
            executionTimeMs != null && executionTimeMs > 0 ? executionTimeMs : undefined
          }
          errorMessage={truncatedError || undefined}
          customContent={autoLimitContent}
        />
      </div>

      {/* Center-right: Export — shared component */}
      <ExportButton disabled={!hasResults} onClick={handleExport} testId="export-button" />

      {/* Right: Page size + pagination — shared component */}
      {showPagination && (
        <PaginationGroup
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          onPageSizeChange={handlePageSizeChange}
          onPrevPage={handlePrevPage}
          onNextPage={handleNextPage}
        />
      )}
    </div>
  )
}
