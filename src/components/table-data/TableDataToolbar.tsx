/**
 * TableDataToolbar — toolbar for the table data browser/editor.
 *
 * Shows status, CRUD action buttons, view mode toggle, export,
 * page size selector, and pagination controls.
 */

import { useCallback, useState } from 'react'
import {
  Table,
  Rows,
  Plus,
  Trash,
  FloppyDisk,
  ArrowCounterClockwise,
  Export,
  CheckCircle,
  CaretLeft,
  CaretRight,
  Funnel,
} from '@phosphor-icons/react'
import { useTableDataStore, isSameRowKey } from '../../stores/table-data-store'
import { useConnectionStore } from '../../stores/connection-store'
import { useToastStore } from '../../stores/toast-store'
import { getTemporalValidationResult } from '../../lib/table-data-save-utils'
import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { FilterDialog } from '../dialogs/FilterDialog'
import type { FilterCondition } from '../../types/schema'
import styles from './TableDataToolbar.module.css'

interface TableDataToolbarProps {
  tabId: string
}

export function TableDataToolbar({ tabId }: TableDataToolbarProps) {
  const tabState = useTableDataStore((state) => state.tabs[tabId])

  const requestNavigationAction = useTableDataStore((state) => state.requestNavigationAction)
  const applyFilters = useTableDataStore((state) => state.applyFilters)
  const fetchPage = useTableDataStore((state) => state.fetchPage)
  const insertNewRow = useTableDataStore((state) => state.insertNewRow)
  const deleteRow = useTableDataStore((state) => state.deleteRow)
  const saveCurrentRow = useTableDataStore((state) => state.saveCurrentRow)
  const discardCurrentRow = useTableDataStore((state) => state.discardCurrentRow)
  const refreshData = useTableDataStore((state) => state.refreshData)
  const setViewMode = useTableDataStore((state) => state.setViewMode)
  const openExportDialog = useTableDataStore((state) => state.openExportDialog)
  const setPageSize = useTableDataStore((state) => state.setPageSize)

  // Get connection info for read-only check
  const connectionId = tabState?.connectionId ?? ''
  const activeConnection = useConnectionStore((state) => state.activeConnections[connectionId])
  const isConnectionReadOnly = activeConnection?.profile?.readOnly ?? false

  const totalRows = tabState?.totalRows ?? 0
  const executionTimeMs = tabState?.executionTimeMs ?? 0
  const isLoading = tabState?.isLoading ?? false
  const primaryKey = tabState?.primaryKey ?? null
  const editState = tabState?.editState ?? null
  const viewMode = tabState?.viewMode ?? 'grid'
  const currentPage = tabState?.currentPage ?? 1
  const totalPages = tabState?.totalPages ?? 1
  const pageSize = tabState?.pageSize ?? 1000
  const selectedRowKey = tabState?.selectedRowKey ?? null
  const columns = tabState?.columns ?? []
  const filterModel: FilterCondition[] = tabState?.filterModel ?? []

  const showError = useToastStore((s) => s.showError)
  const showSuccess = useToastStore((s) => s.showSuccess)

  // Navigation guard helper — wraps an action with unsaved-changes check.
  const withNavigationGuard = useCallback(
    (action: () => void) => {
      requestNavigationAction(tabId, action)
    },
    [tabId, requestNavigationAction]
  )

  const hasPk = primaryKey !== null
  const isMutationDisabled = isConnectionReadOnly || !hasPk
  const hasModifications =
    editState !== null && (editState.modifiedColumns.size > 0 || editState.isNewRow)

  // Delete targets the visually selected row; disable for unsaved new rows
  const selectedIsNewRow = selectedRowKey !== null && '__tempId' in selectedRowKey
  const isEditingNewRow = editState?.isNewRow ?? false

  // --- Filter dialog state (only open/close is local) ---

  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false)

  // --- Delete confirmation state ---

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // --- Handlers ---

  const handleAddRow = useCallback(() => {
    withNavigationGuard(() => {
      insertNewRow(tabId)
    })
  }, [withNavigationGuard, insertNewRow, tabId])

  const handleDeleteRow = useCallback(() => {
    if (!selectedRowKey) return
    setShowDeleteConfirm(true)
  }, [selectedRowKey])

  const handleConfirmDelete = useCallback(async () => {
    setShowDeleteConfirm(false)

    // Always delete the visually selected row, not editState.rowKey
    if (!selectedRowKey) return

    // If we're editing this row, discard unsaved changes first
    if (editState && isSameRowKey(editState.rowKey, selectedRowKey)) {
      discardCurrentRow(tabId)
    }

    await deleteRow(tabId, selectedRowKey, {})

    // Show success toast if no error occurred
    const newState = useTableDataStore.getState().tabs[tabId]
    if (newState && !newState.error) {
      showSuccess('Row deleted', 'Row deleted successfully.')
    }
  }, [selectedRowKey, editState, discardCurrentRow, deleteRow, tabId, showSuccess])

  const handleCancelDelete = useCallback(() => {
    setShowDeleteConfirm(false)
  }, [])

  const handleSave = useCallback(async () => {
    const validationError = getTemporalValidationResult(editState, columns)
    if (validationError) {
      showError('Invalid date value', `${validationError.columnName}: ${validationError.error}`)
      return
    }

    await saveCurrentRow(tabId)
    const newState = useTableDataStore.getState().tabs[tabId]
    if (newState?.saveError) {
      showError('Save failed', newState.saveError)
      return
    }

    if (newState && !newState.saveError && !newState.editState) {
      showSuccess('Row saved', 'Changes saved successfully.')
    }
  }, [saveCurrentRow, tabId, editState, columns, showError, showSuccess])

  const handleDiscard = useCallback(() => {
    discardCurrentRow(tabId)
  }, [discardCurrentRow, tabId])

  const handleRefresh = useCallback(() => {
    withNavigationGuard(() => {
      refreshData(tabId)
    })
  }, [withNavigationGuard, refreshData, tabId])

  const handleViewMode = useCallback(
    (mode: 'grid' | 'form') => {
      withNavigationGuard(() => {
        setViewMode(tabId, mode)
      })
    },
    [withNavigationGuard, setViewMode, tabId]
  )

  const handleExport = useCallback(() => {
    openExportDialog(tabId)
  }, [openExportDialog, tabId])

  const handlePageSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newSize = parseInt(e.target.value, 10)
      withNavigationGuard(() => {
        setPageSize(tabId, newSize)
      })
    },
    [withNavigationGuard, setPageSize, tabId]
  )

  const handlePrevPage = useCallback(() => {
    if (currentPage > 1) {
      withNavigationGuard(() => {
        fetchPage(tabId, currentPage - 1)
      })
    }
  }, [currentPage, withNavigationGuard, fetchPage, tabId])

  const handleNextPage = useCallback(() => {
    if (currentPage < totalPages) {
      withNavigationGuard(() => {
        fetchPage(tabId, currentPage + 1)
      })
    }
  }, [currentPage, totalPages, withNavigationGuard, fetchPage, tabId])

  const handleFilterApply = useCallback(
    (conditions: FilterCondition[]) => {
      withNavigationGuard(() => {
        setIsFilterDialogOpen(false)
        applyFilters(tabId, conditions)
      })
    },
    [withNavigationGuard, applyFilters, tabId]
  )

  const canDelete = !isMutationDisabled && selectedRowKey !== null && !selectedIsNewRow

  return (
    <div className={styles.toolbar} data-testid="table-data-toolbar">
      {/* Left section: Status + action buttons */}
      <div className={styles.leftSection}>
        {/* Status */}
        <div className={styles.statusArea}>
          {isLoading ? (
            <span className={styles.loadingStatus}>
              <span className={styles.miniSpinner} />
              <span>Loading...</span>
            </span>
          ) : (
            <>
              <span className={styles.successStatus}>
                <CheckCircle size={14} weight="fill" />
                <span>{totalRows} Rows</span>
              </span>
              {executionTimeMs > 0 && (
                <span className={styles.executionTime}>({executionTimeMs}ms)</span>
              )}
            </>
          )}
        </div>

        {/* Read-only badge */}
        {isConnectionReadOnly && (
          <span className={styles.readonlyBadge} data-testid="readonly-badge">
            &#x1F512; READ-ONLY
          </span>
        )}

        {/* No-PK badge */}
        {!hasPk && !isLoading && tabState?.columns?.length > 0 && (
          <span className={styles.nopkBadge} data-testid="nopk-badge">
            NO KEY
          </span>
        )}

        {/* Divider */}
        <div className={styles.divider} />

        {/* Action buttons */}
        <button
          type="button"
          className={styles.toolbarButton}
          disabled={isMutationDisabled || isEditingNewRow || isLoading}
          onClick={handleAddRow}
          title="Add row"
          data-testid="btn-add-row"
        >
          <Plus size={14} weight="bold" />
          <span>Add</span>
        </button>

        <button
          type="button"
          className={styles.toolbarButton}
          disabled={!canDelete || isLoading}
          onClick={handleDeleteRow}
          title="Delete row"
          data-testid="btn-delete-row"
        >
          <Trash size={14} weight="regular" />
          <span>Delete</span>
        </button>

        <button
          type="button"
          className={styles.toolbarButton}
          disabled={!hasModifications || isLoading}
          onClick={handleSave}
          title="Save changes"
          data-testid="btn-save"
        >
          <FloppyDisk size={14} weight="regular" />
          <span>Save</span>
        </button>

        <button
          type="button"
          className={styles.toolbarButton}
          disabled={editState === null || isLoading}
          onClick={handleDiscard}
          title="Discard changes"
          data-testid="btn-discard"
        >
          <span>Discard</span>
        </button>

        <button
          type="button"
          className={styles.iconButton}
          onClick={handleRefresh}
          disabled={isLoading}
          title="Refresh data"
          data-testid="btn-refresh"
        >
          <ArrowCounterClockwise size={14} weight="bold" />
        </button>
      </div>

      {/* Right section: Filter + View mode + Export + Pagination */}
      <div className={styles.rightSection}>
        {/* Filter button */}
        <div
          className={`${styles.filterButtonWrapper} ${filterModel.length > 0 ? styles.filterButtonActive : ''}`}
        >
          <button
            type="button"
            className={styles.toolbarButton}
            onClick={() => setIsFilterDialogOpen(true)}
            disabled={columns.length === 0}
            title="Filter"
            data-testid="btn-filter"
          >
            <Funnel size={14} weight={filterModel.length > 0 ? 'fill' : 'regular'} />
            <span>Filter</span>
          </button>
          {filterModel.length > 0 && (
            <span className={styles.filterBadge} data-testid="filter-badge">
              {filterModel.length}
            </span>
          )}
        </div>

        {/* Divider */}
        <div className={styles.divider} />
        {/* View mode toggle */}
        <div className={styles.viewModeGroup}>
          <button
            type="button"
            className={`${styles.viewModeButton} ${viewMode === 'grid' ? styles.viewModeActive : ''}`}
            onClick={() => handleViewMode('grid')}
            title="Grid view"
            data-testid="btn-grid-view"
          >
            <Table size={14} weight={viewMode === 'grid' ? 'fill' : 'regular'} />
          </button>
          <button
            type="button"
            className={`${styles.viewModeButton} ${viewMode === 'form' ? styles.viewModeActive : ''}`}
            onClick={() => handleViewMode('form')}
            title="Form view"
            data-testid="btn-form-view"
          >
            <Rows size={14} weight={viewMode === 'form' ? 'fill' : 'regular'} />
          </button>
        </div>

        {/* Export */}
        <button
          type="button"
          className={styles.toolbarButton}
          onClick={handleExport}
          disabled={isLoading || totalRows === 0}
          data-testid="btn-export"
        >
          <Export size={14} weight="regular" />
          <span>Export</span>
        </button>

        {/* Pagination group */}
        <div className={styles.paginationGroup}>
          <select
            className={styles.pageSizeSelect}
            value={pageSize}
            onChange={handlePageSizeChange}
            data-testid="page-size-select"
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
              disabled={currentPage <= 1 || isLoading}
              onClick={handlePrevPage}
              aria-label="Previous page"
              data-testid="pagination-prev"
            >
              <CaretLeft size={14} weight="bold" />
            </button>
            <span className={styles.pageText} data-testid="page-indicator">
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              className={styles.pageButton}
              disabled={currentPage >= totalPages || isLoading}
              onClick={handleNextPage}
              aria-label="Next page"
              data-testid="pagination-next"
            >
              <CaretRight size={14} weight="bold" />
            </button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Row"
        message="Are you sure you want to delete this row?"
        confirmLabel="Delete"
        isDestructive={true}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />

      {/* Filter Dialog */}
      <FilterDialog
        isOpen={isFilterDialogOpen}
        initialConditions={filterModel}
        columns={columns.map((c) => c.name)}
        onApply={handleFilterApply}
        onCancel={() => setIsFilterDialogOpen(false)}
      />
    </div>
  )
}
