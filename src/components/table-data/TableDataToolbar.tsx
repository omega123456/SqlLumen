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
import { Plus, Copy, Trash, FloppyDisk, ArrowCounterClockwise, Stop } from '@phosphor-icons/react'
import {
  useTableDataStore,
  isSameRowKey,
  findRowIndexByKey as findStoreRowIndexByKey,
} from '../../stores/table-data-store'
import { useConnectionStore } from '../../stores/connection-store'
import { useToastStore } from '../../stores/toast-store'
import { getTemporalValidationResult } from '../../lib/table-data-save-utils'
import { buildInitialConditionsFromCell } from '../../lib/filter-utils'
import { serializeCsv } from '../../lib/csv-utils'
import { writeClipboardText } from '../../lib/context-menu-utils'
import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { FilterDialog } from '../dialogs/FilterDialog'
import { ViewModeGroup } from '../shared/toolbar/ViewModeGroup'
import { PaginationGroup } from '../shared/toolbar/PaginationGroup'
import { ExportButton } from '../shared/toolbar/ExportButton'
import { CopySelectedRowsButton } from '../shared/toolbar/CopySelectedRowsButton'
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
  const cloneSelectedRow = useTableDataStore((state) => state.cloneSelectedRow)
  const deleteRow = useTableDataStore((state) => state.deleteRow)
  const deleteRows = useTableDataStore((state) => state.deleteRows)
  const setCheckedRowKeys = useTableDataStore((state) => state.setCheckedRowKeys)
  const saveCurrentRow = useTableDataStore((state) => state.saveCurrentRow)
  const discardCurrentRow = useTableDataStore((state) => state.discardCurrentRow)
  const refreshData = useTableDataStore((state) => state.refreshData)
  const cancelLoad = useTableDataStore((state) => state.cancelLoad)
  const setViewMode = useTableDataStore((state) => state.setViewMode)
  const openExportDialog = useTableDataStore((state) => state.openExportDialog)
  const setPageSize = useTableDataStore((state) => state.setPageSize)

  // Get connection info for read-only check
  const connectionId = tabState?.connectionId ?? ''
  const activeConnection = useConnectionStore((state) => state.activeConnections[connectionId])
  const isConnectionReadOnly = activeConnection?.profile?.readOnly ?? false

  const executionTimeMs = tabState?.executionTimeMs ?? 0
  const isLoading = tabState?.isLoading ?? false
  const isCancelling = tabState?.isCancelling ?? false
  const rowResidencyStatus = tabState?.rowResidency?.status ?? 'resident'
  const primaryKey = tabState?.primaryKey ?? null
  const editState = tabState?.editState ?? null
  const viewMode = tabState?.viewMode ?? 'grid'
  const currentPage = tabState?.currentPage ?? 1
  const pageSize = tabState?.pageSize ?? 1000
  const selectedRowKey = tabState?.selectedRowKey ?? null
  const checkedRowKeys = useMemo(() => tabState?.checkedRowKeys ?? [], [tabState?.checkedRowKeys])
  const columns = useMemo(() => tabState?.columns ?? [], [tabState?.columns])
  const rows = useMemo(() => tabState?.rows ?? [], [tabState?.rows])
  const filterModel = useMemo<FilterCondition[]>(() => tabState?.filterModel ?? [], [tabState])
  const selectedCell = tabState?.selectedCell ?? null
  const hasLoadedTableData = columns.length > 0
  const isRestoring = rowResidencyStatus === 'restoring'
  const isBusy = isLoading || isRestoring

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
  const canClone =
    !isMutationDisabled && selectedRowKey !== null && !selectedIsNewRow && !isEditingNewRow

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

  // Bulk delete targets checked rows when any are checked; otherwise the single
  // visually selected row.
  const deleteTargetCount =
    checkedRowKeys.length > 0 ? checkedRowKeys.length : selectedRowKey ? 1 : 0

  const handleDeleteRow = useCallback(() => {
    if (deleteTargetCount === 0) return
    setShowDeleteConfirm(true)
  }, [deleteTargetCount])

  const handleCloneRow = useCallback(() => {
    withNavigationGuard(() => {
      cloneSelectedRow(tabId)
    })
  }, [withNavigationGuard, cloneSelectedRow, tabId])

  const handleConfirmDelete = useCallback(async () => {
    setShowDeleteConfirm(false)

    // Bulk delete: delete every checked row.
    if (checkedRowKeys.length > 0) {
      let rowKeysToDelete = checkedRowKeys
      let discardedDraftCount = 0

      // If we're editing one of the targeted rows, discard unsaved changes first.
      // For a draft row this already removes it from `rows`, so drop it from the
      // list handed to deleteRows to avoid removing the same slot twice (which
      // would otherwise pop a real persisted row out of the grid).
      if (editState && checkedRowKeys.some((key) => isSameRowKey(editState.rowKey, key))) {
        discardCurrentRow(tabId)
        if (editState.isNewRow) {
          discardedDraftCount = 1
          rowKeysToDelete = checkedRowKeys.filter((key) => !isSameRowKey(editState.rowKey, key))
        }
      }

      const deletedCount = (await deleteRows(tabId, rowKeysToDelete)) + discardedDraftCount
      setCheckedRowKeys(tabId, [])

      const newState = useTableDataStore.getState().tabs[tabId]
      if (newState && !newState.error && deletedCount > 0) {
        showSuccess(
          'Rows deleted',
          `${deletedCount} row${deletedCount === 1 ? '' : 's'} deleted successfully.`
        )
      }
      return
    }

    // Single delete: always delete the visually selected row, not editState.rowKey
    if (!selectedRowKey) return

    // If we're editing this row, discard unsaved changes first
    if (editState && isSameRowKey(editState.rowKey, selectedRowKey)) {
      discardCurrentRow(tabId)
    }

    await deleteRow(tabId, selectedRowKey)

    // Show success toast if no error occurred
    const newState = useTableDataStore.getState().tabs[tabId]
    if (newState && !newState.error) {
      showSuccess('Row deleted', 'Row deleted successfully.')
    }
  }, [
    checkedRowKeys,
    selectedRowKey,
    editState,
    discardCurrentRow,
    deleteRow,
    deleteRows,
    setCheckedRowKeys,
    tabId,
    showSuccess,
  ])

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

  const handleCancelLoad = useCallback(() => {
    cancelLoad(tabId)
  }, [cancelLoad, tabId])

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

  const handleCopySelectedRows = useCallback(async () => {
    const selectedRowIndices = new Set(
      checkedRowKeys.map((rowKey) =>
        typeof rowKey.__rowIndex === 'number'
          ? rowKey.__rowIndex
          : rowKey.__tempId === editState?.tempId
            ? rows.length - 1
            : findStoreRowIndexByKey(rows, columns, rowKey)
      )
    )
    const selectedRows = rows.filter((_, index) => selectedRowIndices.has(index))

    try {
      await writeClipboardText(
        serializeCsv(
          columns.map((column) => column.name),
          selectedRows
        )
      )
      showSuccess('Selected rows copied', `${selectedRows.length} row(s) copied to clipboard.`)
    } catch (error) {
      showError('Copy failed', error instanceof Error ? error.message : String(error))
    }
  }, [checkedRowKeys, columns, editState?.tempId, rows, showError, showSuccess])

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
    withNavigationGuard(() => {
      fetchPage(tabId, currentPage + 1)
    })
  }, [currentPage, withNavigationGuard, fetchPage, tabId])

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

  const canDelete =
    !isMutationDisabled && deleteTargetCount > 0 && (checkedRowKeys.length > 0 || !selectedIsNewRow)

  return (
    <div className={styles.toolbar} data-testid="table-data-toolbar">
      {/* Left section: Status + action buttons */}
      <div className={styles.leftSection}>
        {/* Status — shared component */}
        <StatusArea
          status={isBusy ? 'loading' : 'success'}
          executionTimeMs={executionTimeMs > 0 ? executionTimeMs : undefined}
          customContent={
            isRestoring ? (
              <span className={styles.statusHint} data-testid="table-data-restoring-status">
                Restoring cached rows...
              </span>
            ) : undefined
          }
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
              disabled={isMutationDisabled || isEditingNewRow || isBusy}
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
              disabled={!canClone || isBusy}
              onClick={handleCloneRow}
              title="Clone selected row; primary key fields are left blank."
              data-testid="btn-clone-row"
            >
              <Copy size={16} weight="regular" />
              <span>Clone</span>
            </button>

            <button
              type="button"
              className={styles.toolbarButton}
              disabled={!canDelete || isBusy}
              onClick={handleDeleteRow}
              title={deleteTargetCount > 1 ? `Delete ${deleteTargetCount} rows` : 'Delete row'}
              data-testid="btn-delete-row"
            >
              <Trash size={16} weight="regular" />
              <span>{deleteTargetCount > 1 ? `Delete (${deleteTargetCount})` : 'Delete'}</span>
            </button>

            <button
              type="button"
              className={styles.toolbarButton}
              disabled={!hasModifications || isBusy}
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
              disabled={editState === null || isBusy}
              onClick={handleDiscard}
              title="Discard changes"
              data-testid="btn-discard"
            >
              <span>Discard</span>
            </button>
          </>
        )}

        {isLoading && !isRestoring ? (
          <button
            type="button"
            className={`${styles.cancelButton}${isCancelling ? ` ${styles.cancelling}` : ''}`}
            onClick={handleCancelLoad}
            disabled={isCancelling}
            title="Cancel the running query"
            data-testid="btn-cancel-load"
          >
            <Stop size={14} weight="fill" />
            <span>{isCancelling ? 'Cancelling...' : 'Cancel'}</span>
          </button>
        ) : (
          <button
            type="button"
            className={styles.iconButton}
            onClick={handleRefresh}
            disabled={isBusy}
            title="Refresh data"
            data-testid="btn-refresh"
          >
            <ArrowCounterClockwise size={16} weight="bold" />
          </button>
        )}
      </div>

      {/* Right section: Filter + View mode + Export + Pagination */}
      <div className={styles.rightSection}>
        {/* Filter button */}
        <FilterToolbarButton
          isActive={filterModel.length > 0}
          activeCount={filterModel.length}
          onFilterClick={() => setIsFilterDialogOpen(true)}
          onClearClick={handleClearFilter}
          isDisabled={columns.length === 0 || isBusy}
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
        <ExportButton disabled={isBusy || !hasLoadedTableData} onClick={handleExport} />

        <CopySelectedRowsButton
          disabled={isBusy || checkedRowKeys.length === 0}
          onClick={() => void handleCopySelectedRows()}
        />

        {/* Pagination — shared component */}
        <PaginationGroup
          currentPage={currentPage}
          paginationMode="unknown"
          pageSize={pageSize}
          disabled={isBusy}
          onPageSizeChange={handlePageSizeChange}
          onPageSubmit={(page) => {
            withNavigationGuard(() => {
              fetchPage(tabId, page)
            })
          }}
          onPrevPage={handlePrevPage}
          onNextPage={handleNextPage}
        />
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title={deleteTargetCount > 1 ? 'Delete Rows' : 'Delete Row'}
        message={
          deleteTargetCount > 1
            ? `Are you sure you want to delete these ${deleteTargetCount} rows?`
            : 'Are you sure you want to delete this row?'
        }
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
