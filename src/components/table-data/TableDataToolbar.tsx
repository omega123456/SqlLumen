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
  isEditingRowKey,
  isSameRowKey,
  findRowIndexByKey as findStoreRowIndexByKey,
} from '../../stores/table-data-store'
import { useConnectionStore } from '../../stores/connection-store'
import { FALLBACK_ROW_LIMIT } from '../../stores/query-store'
import { useToastStore } from '../../stores/toast-store'
import { saveCurrentRowWithFeedback } from './row-save-feedback'
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
import type {
  FilterCondition,
  RowEditState,
  SelectedCellInfo,
  TableDataColumnMeta,
  TableDataTabState,
} from '../../types/schema'
import { Button } from '../common/Button'
import styles from './TableDataToolbar.module.css'
import { toErrorMessage } from '../../lib/error-message'
import { hasPendingRowChanges } from '../../lib/row-edit-state'

interface TableDataToolbarProps {
  tabId: string
  isView?: boolean
}

type RowKey = Record<string, unknown>

const EMPTY_ROW_KEYS: RowKey[] = []
const EMPTY_COLUMNS: TableDataColumnMeta[] = []
const EMPTY_ROWS: unknown[][] = []
const EMPTY_FILTERS: FilterCondition[] = []

interface ToolbarTabView {
  connectionId: string
  executionTimeMs: number
  isLoading: boolean
  isCancelling: boolean
  isRestoring: boolean
  primaryKey: TableDataTabState['primaryKey']
  editState: RowEditState | null
  viewMode: TableDataTabState['viewMode']
  currentPage: number
  pageSize: number
  selectedRowKey: RowKey | null
  checkedRowKeys: RowKey[]
  columns: TableDataColumnMeta[]
  rows: unknown[][]
  filterModel: FilterCondition[]
  selectedCell: SelectedCellInfo | null
}

const EMPTY_TOOLBAR_TAB_VIEW: ToolbarTabView = {
  connectionId: '',
  executionTimeMs: 0,
  isLoading: false,
  isCancelling: false,
  isRestoring: false,
  primaryKey: null,
  editState: null,
  viewMode: 'grid',
  currentPage: 1,
  pageSize: FALLBACK_ROW_LIMIT,
  selectedRowKey: null,
  checkedRowKeys: EMPTY_ROW_KEYS,
  columns: EMPTY_COLUMNS,
  rows: EMPTY_ROWS,
  filterModel: EMPTY_FILTERS,
  selectedCell: null,
}

function toolbarTabView(tabState: TableDataTabState | undefined): ToolbarTabView {
  if (!tabState) return EMPTY_TOOLBAR_TAB_VIEW
  return {
    connectionId: tabState.connectionId,
    executionTimeMs: tabState.executionTimeMs,
    isLoading: tabState.isLoading,
    isCancelling: tabState.isCancelling ?? false,
    isRestoring: tabState.rowResidency?.status === 'restoring',
    primaryKey: tabState.primaryKey,
    editState: tabState.editState,
    viewMode: tabState.viewMode,
    currentPage: tabState.currentPage,
    pageSize: tabState.pageSize,
    selectedRowKey: tabState.selectedRowKey,
    checkedRowKeys: tabState.checkedRowKeys ?? EMPTY_ROW_KEYS,
    columns: tabState.columns,
    rows: tabState.rows,
    filterModel: tabState.filterModel,
    selectedCell: tabState.selectedCell,
  }
}

function isNewRowKey(rowKey: RowKey | null): boolean {
  return rowKey !== null && '__tempId' in rowKey
}

// Bulk delete targets checked rows when any are checked; otherwise the single
// visually selected row.
function deleteTargetCountFor(checkedCount: number, selectedRowKey: RowKey | null): number {
  if (checkedCount > 0) return checkedCount
  if (selectedRowKey) return 1
  return 0
}

interface RowIndexLookup {
  rows: unknown[][]
  columns: TableDataColumnMeta[]
  editTempId: unknown
}

function rowIndexForKey(rowKey: RowKey, lookup: RowIndexLookup): number {
  if (typeof rowKey.__rowIndex === 'number') return rowKey.__rowIndex
  const isEditedDraft = '__tempId' in rowKey && rowKey.__tempId === lookup.editTempId
  if (isEditedDraft) return lookup.rows.length - 1
  return findStoreRowIndexByKey(lookup.rows, lookup.columns, rowKey)
}

function pluralRows(count: number): string {
  return `${count} row${count === 1 ? '' : 's'}`
}

function isTabSettledWithoutError(tabId: string): boolean {
  const tabState = useTableDataStore.getState().tabs[tabId]
  return Boolean(tabState) && !tabState.error
}

interface DeleteCopy {
  title: string
  message: string
  buttonTitle: string
  buttonLabel: string
}

function deleteCopyFor(deleteTargetCount: number): DeleteCopy {
  if (deleteTargetCount > 1) {
    return {
      title: 'Delete rows',
      message: `Are you sure you want to delete these ${deleteTargetCount} rows?`,
      buttonTitle: `Delete ${deleteTargetCount} rows`,
      buttonLabel: `Delete (${deleteTargetCount})`,
    }
  }
  return {
    title: 'Delete row',
    message: 'Are you sure you want to delete this row?',
    buttonTitle: 'Delete row',
    buttonLabel: 'Delete',
  }
}

interface ActionAvailabilityInputs {
  view: ToolbarTabView
  isConnectionReadOnly: boolean
  isBusy: boolean
  deleteTargetCount: number
}

function canDeleteTargets(view: ToolbarTabView, deleteTargetCount: number): boolean {
  if (deleteTargetCount === 0) return false
  return view.checkedRowKeys.length > 0 || !isNewRowKey(view.selectedRowKey)
}

function canCloneSelection(view: ToolbarTabView): boolean {
  if (view.selectedRowKey === null) return false
  return !isNewRowKey(view.selectedRowKey) && view.editState?.isNewRow !== true
}

function rowActionAvailability(inputs: ActionAvailabilityInputs): RowActionAvailability {
  const { view, isBusy } = inputs
  const isMutationDisabled = inputs.isConnectionReadOnly || view.primaryKey === null
  const canMutate = !isMutationDisabled && !isBusy
  return {
    canAdd: canMutate && view.editState?.isNewRow !== true,
    canClone: canMutate && canCloneSelection(view),
    canDelete: canMutate && canDeleteTargets(view, inputs.deleteTargetCount),
    canSaveOrDiscard: hasPendingRowChanges(view.editState) && !isBusy,
  }
}

function isNoKeyBadgeVisible(isView: boolean, view: ToolbarTabView): boolean {
  if (isView) return false
  if (view.primaryKey !== null) return false
  return !view.isLoading && view.columns.length > 0
}

function positiveOrUndefined(value: number): number | undefined {
  if (value > 0) return value
  return undefined
}

interface ToolbarBadgesProps {
  isView: boolean
  isConnectionReadOnly: boolean
  showNoKeyBadge: boolean
}

function ToolbarBadges({ isView, isConnectionReadOnly, showNoKeyBadge }: ToolbarBadgesProps) {
  return (
    <>
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
      {showNoKeyBadge && (
        <span className={styles.nopkBadge} data-testid="nopk-badge">
          NO KEY
        </span>
      )}
    </>
  )
}

interface RowActionAvailability {
  canAdd: boolean
  canClone: boolean
  canDelete: boolean
  canSaveOrDiscard: boolean
}

interface RowActionHandlers {
  onAdd: () => void
  onClone: () => void
  onDelete: () => void
  onSave: () => void
  onDiscard: () => void
}

interface RowActionButtonsProps {
  availability: RowActionAvailability
  deleteCopy: DeleteCopy
  handlers: RowActionHandlers
}

function RowActionButtons({ availability, deleteCopy, handlers }: RowActionButtonsProps) {
  return (
    <>
      <Button
        variant="bare"
        className={styles.toolbarButton}
        disabled={!availability.canAdd}
        onClick={handlers.onAdd}
        title="Add row"
        data-testid="btn-add-row"
      >
        <Plus size={16} weight="bold" />
        <span>Add</span>
      </Button>

      <Button
        variant="bare"
        className={styles.toolbarButton}
        disabled={!availability.canClone}
        onClick={handlers.onClone}
        title="Clone selected row; primary key fields are left blank."
        data-testid="btn-clone-row"
      >
        <Copy size={16} weight="regular" />
        <span>Clone</span>
      </Button>

      <Button
        variant="bare"
        className={styles.toolbarButton}
        disabled={!availability.canDelete}
        onClick={handlers.onDelete}
        title={deleteCopy.buttonTitle}
        data-testid="btn-delete-row"
      >
        <Trash size={16} weight="regular" />
        <span>{deleteCopy.buttonLabel}</span>
      </Button>

      <Button
        variant="bare"
        className={styles.toolbarButton}
        disabled={!availability.canSaveOrDiscard}
        onClick={handlers.onSave}
        title="Save changes"
        data-testid="btn-save"
      >
        <FloppyDisk size={16} weight="regular" />
        <span>Save</span>
      </Button>

      <Button
        variant="bare"
        className={styles.toolbarButton}
        disabled={!availability.canSaveOrDiscard}
        onClick={handlers.onDiscard}
        title="Discard changes"
        data-testid="btn-discard"
      >
        <span>Discard</span>
      </Button>
    </>
  )
}

interface LoadControlButtonProps {
  view: Pick<ToolbarTabView, 'isLoading' | 'isRestoring' | 'isCancelling'>
  isBusy: boolean
  onCancelLoad: () => void
  onRefresh: () => void
}

function LoadControlButton({ view, isBusy, onCancelLoad, onRefresh }: LoadControlButtonProps) {
  const isCancellableLoad = view.isLoading && !view.isRestoring
  if (isCancellableLoad) {
    const cancellingClassName = view.isCancelling ? ` ${styles.cancelling}` : ''
    return (
      <Button
        variant="bare"
        className={`${styles.cancelButton}${cancellingClassName}`}
        onClick={onCancelLoad}
        disabled={view.isCancelling}
        title="Cancel the running query"
        data-testid="btn-cancel-load"
      >
        <Stop size={14} weight="fill" />
        <span>{view.isCancelling ? 'Cancelling...' : 'Cancel'}</span>
      </Button>
    )
  }
  return (
    <Button
      variant="bare"
      className={styles.iconButton}
      onClick={onRefresh}
      disabled={isBusy}
      title="Refresh data"
      data-testid="btn-refresh"
    >
      <ArrowCounterClockwise size={16} weight="bold" />
    </Button>
  )
}

function RestoringStatusHint({ isRestoring }: { isRestoring: boolean }) {
  if (!isRestoring) return undefined
  return (
    <span className={styles.statusHint} data-testid="table-data-restoring-status">
      Restoring cached rows...
    </span>
  )
}

export function TableDataToolbar({ tabId, isView = false }: TableDataToolbarProps) {
  const tabState = useTableDataStore((state) => state.tabs[tabId])

  // --- Filter dialog state (only open/close is local) ---

  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false)

  // --- Delete confirmation state ---

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const requestNavigationAction = useTableDataStore((state) => state.requestNavigationAction)
  const applyFilters = useTableDataStore((state) => state.applyFilters)
  const fetchPage = useTableDataStore((state) => state.fetchPage)
  const insertNewRow = useTableDataStore((state) => state.insertNewRow)
  const cloneSelectedRow = useTableDataStore((state) => state.cloneSelectedRow)
  const deleteRow = useTableDataStore((state) => state.deleteRow)
  const deleteRows = useTableDataStore((state) => state.deleteRows)
  const setCheckedRowKeys = useTableDataStore((state) => state.setCheckedRowKeys)
  const discardCurrentRow = useTableDataStore((state) => state.discardCurrentRow)
  const refreshData = useTableDataStore((state) => state.refreshData)
  const cancelLoad = useTableDataStore((state) => state.cancelLoad)
  const setViewMode = useTableDataStore((state) => state.setViewMode)
  const openExportDialog = useTableDataStore((state) => state.openExportDialog)
  const setPageSize = useTableDataStore((state) => state.setPageSize)

  const view = toolbarTabView(tabState)
  const {
    editState,
    selectedRowKey,
    checkedRowKeys,
    columns,
    rows,
    filterModel,
    selectedCell,
    currentPage,
  } = view

  // Get connection info for read-only check
  const isConnectionReadOnly = useConnectionStore(
    (state) => state.activeConnections[view.connectionId]?.profile?.readOnly ?? false
  )

  const hasLoadedTableData = columns.length > 0
  const isBusy = view.isLoading || view.isRestoring
  const deleteTargetCount = deleteTargetCountFor(checkedRowKeys.length, selectedRowKey)
  const deleteCopy = deleteCopyFor(deleteTargetCount)
  const availability = rowActionAvailability({
    view: view,
    isConnectionReadOnly: isConnectionReadOnly,
    isBusy: isBusy,
    deleteTargetCount: deleteTargetCount,
  })
  const showNoKeyBadge = isNoKeyBadgeVisible(isView, view)
  const executionTimeMs = positiveOrUndefined(view.executionTimeMs)

  const showError = useToastStore((state) => state.showError)
  const showSuccess = useToastStore((state) => state.showSuccess)

  // Navigation guard helper — wraps an action with unsaved-changes check.
  const withNavigationGuard = useCallback(
    (action: () => void) => {
      requestNavigationAction(tabId, action)
    },
    [tabId, requestNavigationAction]
  )

  // --- Handlers ---

  const handleAddRow = useCallback(() => {
    withNavigationGuard(() => {
      insertNewRow(tabId)
    })
  }, [withNavigationGuard, insertNewRow, tabId])

  const handleDeleteRow = useCallback(() => {
    if (deleteTargetCount === 0) return
    setShowDeleteConfirm(true)
  }, [deleteTargetCount])

  const handleCloneRow = useCallback(() => {
    withNavigationGuard(() => {
      cloneSelectedRow(tabId)
    })
  }, [withNavigationGuard, cloneSelectedRow, tabId])

  const deleteCheckedRows = useCallback(async () => {
    let rowKeysToDelete = checkedRowKeys
    let discardedDraftCount = 0

    // If we're editing one of the targeted rows, discard unsaved changes first.
    // For a draft row this already removes it from `rows`, so drop it from the
    // list handed to deleteRows to avoid removing the same slot twice (which
    // would otherwise pop a real persisted row out of the grid).
    const isEditingCheckedRow =
      editState !== null && checkedRowKeys.some((key) => isSameRowKey(editState.rowKey, key))
    if (isEditingCheckedRow) {
      discardCurrentRow(tabId)
    }
    if (isEditingCheckedRow && editState.isNewRow) {
      discardedDraftCount = 1
      rowKeysToDelete = checkedRowKeys.filter((key) => !isSameRowKey(editState.rowKey, key))
    }

    const deletedCount = (await deleteRows(tabId, rowKeysToDelete)) + discardedDraftCount
    setCheckedRowKeys(tabId, [])

    const shouldConfirmDeletion = deletedCount > 0 && isTabSettledWithoutError(tabId)
    if (shouldConfirmDeletion) {
      showSuccess('Rows deleted', `${pluralRows(deletedCount)} deleted successfully.`)
    }
  }, [
    checkedRowKeys,
    editState,
    discardCurrentRow,
    deleteRows,
    setCheckedRowKeys,
    tabId,
    showSuccess,
  ])

  const deleteSelectedRow = useCallback(async () => {
    // Single delete: always delete the visually selected row, not editState.rowKey
    if (!selectedRowKey) return

    // If we're editing this row, discard unsaved changes first
    if (isEditingRowKey(editState, selectedRowKey)) {
      discardCurrentRow(tabId)
    }

    await deleteRow(tabId, selectedRowKey)

    // Show success toast if no error occurred
    if (isTabSettledWithoutError(tabId)) {
      showSuccess('Row deleted', 'Row deleted successfully.')
    }
  }, [selectedRowKey, editState, discardCurrentRow, deleteRow, tabId, showSuccess])

  const handleConfirmDelete = useCallback(async () => {
    setShowDeleteConfirm(false)
    if (checkedRowKeys.length > 0) {
      await deleteCheckedRows()
      return
    }
    await deleteSelectedRow()
  }, [checkedRowKeys, deleteCheckedRows, deleteSelectedRow])

  const handleCancelDelete = useCallback(() => {
    setShowDeleteConfirm(false)
  }, [])

  const handleSave = useCallback(async () => {
    await saveCurrentRowWithFeedback({ tabId: tabId, editState: editState, columns: columns })
  }, [tabId, editState, columns])

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
    const lookup = { rows: rows, columns: columns, editTempId: editState?.tempId }
    const selectedRowIndices = new Set(
      checkedRowKeys.map((rowKey) => rowIndexForKey(rowKey, lookup))
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
      showError('Copy failed', toErrorMessage(error))
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

  const handlePreviousPage = useCallback(() => {
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

  const isTableDataActionDisabled = isBusy || !hasLoadedTableData

  return (
    <div className={styles.toolbar} data-testid="table-data-toolbar">
      {/* Left section: Status + action buttons */}
      <div className={styles.leftSection}>
        {/* Status — shared component */}
        <StatusArea
          status={isBusy ? 'loading' : 'success'}
          executionTimeMs={executionTimeMs}
          customContent={<RestoringStatusHint isRestoring={view.isRestoring} />}
        />

        <ToolbarBadges
          isView={isView}
          isConnectionReadOnly={isConnectionReadOnly}
          showNoKeyBadge={showNoKeyBadge}
        />

        {/* Divider */}
        <div className={styles.divider} />

        {/* Action buttons — hidden for views (read-only) */}
        {!isView && (
          <RowActionButtons
            availability={availability}
            deleteCopy={deleteCopy}
            handlers={{
              onAdd: handleAddRow,
              onClone: handleCloneRow,
              onDelete: handleDeleteRow,
              onSave: () => void handleSave(),
              onDiscard: handleDiscard,
            }}
          />
        )}

        <LoadControlButton
          view={view}
          isBusy={isBusy}
          onCancelLoad={handleCancelLoad}
          onRefresh={handleRefresh}
        />
      </div>

      {/* Right section: Filter + View mode + Export + Pagination */}
      <div className={styles.rightSection}>
        {/* Filter button */}
        <FilterToolbarButton
          isActive={filterModel.length > 0}
          activeCount={filterModel.length}
          onFilterClick={() => setIsFilterDialogOpen(true)}
          onClearClick={handleClearFilter}
          isDisabled={isTableDataActionDisabled}
        />

        {/* Divider */}
        <div className={styles.divider} />

        {/* View mode toggle — shared component */}
        <ViewModeGroup
          currentMode={view.viewMode}
          availableModes={['grid', 'form']}
          onModeChange={handleViewMode}
          testIdPrefix="view-mode"
        />

        {/* Export — shared component */}
        <ExportButton disabled={isTableDataActionDisabled} onClick={handleExport} />

        <CopySelectedRowsButton
          disabled={isBusy || checkedRowKeys.length === 0}
          onClick={() => void handleCopySelectedRows()}
        />

        {/* Pagination — shared component */}
        <PaginationGroup
          currentPage={currentPage}
          paginationMode="unknown"
          pageSize={view.pageSize}
          disabled={isBusy}
          onPageSizeChange={handlePageSizeChange}
          onPageSubmit={(page) => {
            withNavigationGuard(() => {
              fetchPage(tabId, page)
            })
          }}
          onPrevPage={handlePreviousPage}
          onNextPage={handleNextPage}
        />
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title={deleteCopy.title}
        message={deleteCopy.message}
        confirmLabel="Delete"
        isDestructive={true}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />

      {/* Filter Dialog */}
      <FilterDialog
        isOpen={isFilterDialogOpen}
        initialConditions={filterDialogInitialConditions}
        columns={columns.map((column) => column.name)}
        onApply={handleFilterApply}
        onCancel={() => setIsFilterDialogOpen(false)}
      />
    </div>
  )
}
