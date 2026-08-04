/**
 * Toolbar above the result grid — shows view mode toggle, edit mode dropdown,
 * Save/Discard buttons, query status, and export action.
 *
 * Query results display all rows at once (up to the backend's configured
 * auto-limit) without client-side pagination. The page-size dropdown and
 * prev/next page buttons are intentionally omitted here — pagination
 * controls remain available in the table-data toolbar where they make sense.
 *
 * Reads per-result state from the active result via getActiveResult.
 */

import { useCallback, useMemo, useState } from 'react'
import { Copy, FloppyDisk, Trash } from '@phosphor-icons/react'
import { useQueryStore, getActiveResult } from '../../stores/query-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useToastStore } from '../../stores/toast-store'
import { serializeCsv } from '../../lib/csv-utils'
import { writeClipboardText } from '../../lib/context-menu-utils'
import { EditModeDropdown } from './EditModeDropdown'
import { ViewModeGroup } from '../shared/toolbar/ViewModeGroup'
import { ExportButton } from '../shared/toolbar/ExportButton'
import { CopySelectedRowsButton } from '../shared/toolbar/CopySelectedRowsButton'
import { StatusArea } from '../shared/toolbar/StatusArea'
import { FilterToolbarButton } from '../shared/FilterToolbarButton'
import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import type { ViewMode, StatusType } from '../../types/shared-data-view'
import type { FilterCondition } from '../../types/schema'
import styles from './ResultToolbar.module.css'

interface ResultToolbarProps {
  tabId: string
  connectionId: string
  filterModel: FilterCondition[]
  onFilterClick: () => void
  onClearFilterClick: () => void
  isEditingActive?: boolean
  isCloneVisible?: boolean
  isCloneDisabled?: boolean
}

export function ResultToolbar({
  tabId,
  connectionId,
  filterModel,
  onFilterClick,
  onClearFilterClick,
  isEditingActive = false,
  isCloneVisible = false,
  isCloneDisabled = true,
}: ResultToolbarProps) {
  const activeResult = useQueryStore((state) => getActiveResult(state.tabs[tabId]))
  const setViewMode = useQueryStore((state) => state.setViewMode)
  const openExportDialog = useQueryStore((state) => state.openExportDialog)
  const cloneSelectedRow = useQueryStore((state) => state.cloneSelectedRow)
  const saveCurrentRow = useQueryStore((state) => state.saveCurrentRow)
  const discardCurrentRow = useQueryStore((state) => state.discardCurrentRow)
  const deleteResultRows = useQueryStore((state) => state.deleteResultRows)
  const showSuccess = useToastStore((state) => state.showSuccess)
  const showError = useToastStore((state) => state.showError)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const status = activeResult.resultStatus
  const totalRows = activeResult.totalRows
  const affectedRows = activeResult.affectedRows
  const columnsCount = activeResult.columns.length
  // The toolbar badge shows the combined (total) timing, unchanged in magnitude
  // from before the execution/total split — so feed totalTimeMs into StatusArea.
  const totalTimeMs = activeResult.totalTimeMs
  const errorMessage = activeResult.errorMessage
  const autoLimitApplied = activeResult.autoLimitApplied
  const configuredRowLimit = useSettingsStore((s) => s.getSetting('results.pageSize')) || '500'
  const viewMode = activeResult.viewMode

  // Edit state for Save/Discard buttons
  const editState = activeResult.editState
  const editMode = activeResult.editMode
  const hasModifications = editState !== null && editState.modifiedColumns.size > 0

  // Checkbox-selected rows for toolbar actions.
  const checkedRowIndices = useMemo(
    () => activeResult.checkedRowIndices ?? [],
    [activeResult.checkedRowIndices]
  )
  const checkedCount = checkedRowIndices.length

  const truncatedError =
    errorMessage && errorMessage.length > 200 ? errorMessage.slice(0, 200) + '\u2026' : errorMessage

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
  }

  // Auto-limit custom content
  const autoLimitContent = autoLimitApplied ? (
    <span className={styles.autoLimit}>({configuredRowLimit} row limit applied)</span>
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

  const handleCopySelectedRows = useCallback(async () => {
    const selectedRowIndices = new Set(checkedRowIndices)
    const selectedRows = activeResult.rows.filter((_, index) => selectedRowIndices.has(index))

    try {
      await writeClipboardText(
        serializeCsv(
          activeResult.columns.map((column) => column.name),
          selectedRows
        )
      )
      showSuccess('Selected rows copied', `${selectedRows.length} row(s) copied to clipboard.`)
    } catch (error) {
      showError('Copy failed', error instanceof Error ? error.message : String(error))
    }
  }, [activeResult.columns, activeResult.rows, checkedRowIndices, showError, showSuccess])

  const handleSave = useCallback(() => {
    saveCurrentRow(tabId)
  }, [saveCurrentRow, tabId])

  const handleClone = useCallback(() => {
    cloneSelectedRow(tabId)
  }, [cloneSelectedRow, tabId])

  const handleDiscard = useCallback(() => {
    discardCurrentRow(tabId)
  }, [discardCurrentRow, tabId])

  const handleDeleteChecked = useCallback(() => {
    if (checkedRowIndices.length === 0) return
    setShowDeleteConfirm(true)
  }, [checkedRowIndices.length])

  const handleConfirmDelete = useCallback(() => {
    setShowDeleteConfirm(false)
    if (checkedRowIndices.length === 0) return
    // Success / error toasts are surfaced by the store action.
    void deleteResultRows(tabId, checkedRowIndices)
  }, [checkedRowIndices, deleteResultRows, tabId])

  const handleCancelDelete = useCallback(() => {
    setShowDeleteConfirm(false)
  }, [])

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

      {/* Clone is independently visible whenever editable query-result mode is active. */}
      {isCloneVisible && (
        <div className={styles.editActionsGroup} data-testid="clone-actions-group">
          <button
            type="button"
            className={styles.cloneButton}
            onClick={handleClone}
            title="Clone selected row; primary key fields are left blank."
            data-testid="query-clone-button"
            disabled={isCloneDisabled}
          >
            <Copy size={16} weight="regular" />
            <span>Clone</span>
          </button>
        </div>
      )}

      {/* Delete checked rows — real DB delete against the bound source table.
          Only available in edit mode (a table with a primary/unique key whose
          key columns are present), matching the cell-edit gating. */}
      {editMode !== null && checkedCount > 0 && (
        <div className={styles.editActionsGroup} data-testid="result-delete-actions-group">
          <button
            type="button"
            className={styles.discardButton}
            onClick={handleDeleteChecked}
            title={`Delete ${checkedCount} selected row${checkedCount === 1 ? '' : 's'} from the database`}
            data-testid="query-delete-rows-button"
          >
            <Trash size={16} weight="regular" />
            <span>Delete ({checkedCount})</span>
          </button>
        </div>
      )}

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
              <FloppyDisk size={16} weight="regular" />
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
          executionTimeMs={totalTimeMs > 0 ? totalTimeMs : undefined}
          errorMessage={truncatedError || undefined}
          customContent={autoLimitContent}
        />
      </div>

      {/* Center-right: Filter + Export — shared component */}
      <FilterToolbarButton
        isActive={filterModel.length > 0}
        activeCount={filterModel.length}
        onFilterClick={onFilterClick}
        onClearClick={onClearFilterClick}
        isDisabled={columnsCount === 0 || isEditingActive}
      />

      <ExportButton disabled={!hasResults} onClick={handleExport} testId="export-button" />

      <CopySelectedRowsButton
        disabled={!hasResults || checkedCount === 0}
        onClick={() => void handleCopySelectedRows()}
      />

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title={checkedCount > 1 ? 'Delete Rows' : 'Delete Row'}
        message={
          checkedCount > 1
            ? `Are you sure you want to delete these ${checkedCount} rows from the database?`
            : 'Are you sure you want to delete this row from the database?'
        }
        confirmLabel="Delete"
        isDestructive={true}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </div>
  )
}
