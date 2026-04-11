/**
 * TableDataToolbar — toolbar for the table data browser/editor.
 *
 * Shows status, CRUD action buttons, view mode toggle, export,
 * page size selector, and pagination controls.
 *
 * Composes shared toolbar item components (ViewModeGroup, PaginationGroup,
 * ExportButton, StatusArea) for view mode, pagination, export, and status
 * display while keeping table-data-specific controls inline.
 */

import { useCallback, useMemo, useState } from 'react'
import { Plus, Trash, FloppyDisk, ArrowCounterClockwise } from '@phosphor-icons/react'
import { useTableDataStore, isSameRowKey } from '../../stores/table-data-store'
import { useConnectionStore } from '../../stores/connection-store'
import { useToastStore } from '../../stores/toast-store'
import { getTemporalValidationResult } from '../../lib/table-data-save-utils'
import { buildInitialConditionsFromCell } from '../../lib/filter-utils'
import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { FilterDialog } from '../dialogs/FilterDialog'
import { ViewModeGroup } from '../shared/toolbar/ViewModeGroup'
import { PaginationGroup } from '../shared/toolbar/PaginationGroup'
import { ExportButton } from '../shared/toolbar/ExportButton'
import { StatusArea } from '../shared/toolbar/StatusArea'
import { FilterToolbarButton } from '../shared/FilterToolbarButton'
import type { ViewMode } from '../../types/shared-data-view'
import type { FilterCondition } from '../../types/schema'
import styles from './TableDataToolbar.module.css'

interface TableDataToolbarProps {
  tabId: string
  isView?: boolean
}

export function TableDataToolbar({ tabId, isView = false }: TableDataToolbarProps) {
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
  const columns = useMemo(() => tabState?.columns ?? [], [tabState?.columns])
  const filterModel: FilterCondition[] = tabState?.filterModel ?? []
  const selectedCell = tabState?.selectedCell ?? null

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

  // --- Clear filter confirmation state ---

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
    (mode: ViewMode) => {
      withNavigationGuard(() => {
        setViewMode(tabId, mode as 'grid' | 'form')
      })
    },
    [withNavigationGuard, setViewMode, tabId]
  )

  const handleExport = useCallback(() => {
    openExportDialog(tabId)
  }, [openExportDialog, tabId])

  const handlePageSizeChange = useCallback(
    (newSize: number) => {
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

  const filterDialogInitialConditions: FilterCondition[] = useMemo(
    () => buildInitialConditionsFromCell(selectedCell, filterModel),
    [filterModel, selectedCell]
  )

  const handleFilterApply = useCallback(
    (conditions: FilterCondition[]) => {
      withNavigationGuard(() => {
        setIsFilterDialogOpen(false)
        applyFilters(tabId, conditions)
      })
    },
    [withNavigationGuard, applyFilters, tabId]
  )

  const handleClearFilter = useCallback(() => {
    withNavigationGuard(() => {
      applyFilters(tabId, [])
      showSuccess('Filters cleared')
    })
  }, [withNavigationGuard, applyFilters, tabId, showSuccess])

  const canDelete = !isMutationDisabled && selectedRowKey !== null && !selectedIsNewRow

  return (
    <div className={styles.toolbar} data-testid="table-data-toolbar">
      {/* Left section: Status + action buttons */}
      <div className={styles.leftSection}>
        {/* Status — shared component */}
        <StatusArea
          status={isLoading ? 'loading' : 'success'}
          totalRows={totalRows}
          executionTimeMs={executionTimeMs > 0 ? executionTimeMs : undefined}
        />

        {/* View badge — for SQL view objects */}
        {isView && (
          <span className={styles.viewBadge} data-testid="view-badge">
            VIEW
          </span>
        )}

        {/* Read-only badge */}
        {isConnectionReadOnly && (
          <span className={styles.readonlyBadge} data-testid="readonly-badge">
            &#x1F512; READ-ONLY
          </span>
        )}

        {/* No-PK badge — only for tables without a primary key */}
        {!isView && !hasPk && !isLoading && tabState?.columns?.length > 0 && (
          <span className={styles.nopkBadge} data-testid="nopk-badge">
            NO KEY
          </span>
        )}

        {/* Divider */}
        <div className={styles.divider} />

        {/* Action buttons — hidden for views (read-only) */}
        {!isView && (
          <>
            <button
              type="button"
              className={styles.toolbarButton}
              disabled={isMutationDisabled || isEditingNewRow || isLoading}
              onClick={handleAddRow}
              title="Add row"
              data-testid="btn-add-row"
            >
              <Plus size={16} weight="bold" />
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
              <Trash size={16} weight="regular" />
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
              <FloppyDisk size={16} weight="regular" />
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
          </>
        )}

        <button
          type="button"
          className={styles.iconButton}
          onClick={handleRefresh}
          disabled={isLoading}
          title="Refresh data"
          data-testid="btn-refresh"
        >
          <ArrowCounterClockwise size={16} weight="bold" />
        </button>
      </div>

      {/* Right section: Filter + View mode + Export + Pagination */}
      <div className={styles.rightSection}>
        {/* Filter button */}
        <FilterToolbarButton
          isActive={filterModel.length > 0}
          activeCount={filterModel.length}
          onFilterClick={() => setIsFilterDialogOpen(true)}
          onClearClick={handleClearFilter}
          isDisabled={columns.length === 0}
        />

        {/* Divider */}
        <div className={styles.divider} />

        {/* View mode toggle — shared component */}
        <ViewModeGroup
          currentMode={viewMode}
          availableModes={['grid', 'form']}
          onModeChange={handleViewMode}
          testIdPrefix="view-mode"
        />

        {/* Export — shared component */}
        <ExportButton disabled={isLoading || totalRows === 0} onClick={handleExport} />

        {/* Pagination — shared component */}
        <PaginationGroup
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          disabled={isLoading}
          onPageSizeChange={handlePageSizeChange}
          onPrevPage={handlePrevPage}
          onNextPage={handleNextPage}
        />
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
        initialConditions={filterDialogInitialConditions}
        columns={columns.map((c) => c.name)}
        onApply={handleFilterApply}
        onCancel={() => setIsFilterDialogOpen(false)}
      />
    </div>
  )
}
