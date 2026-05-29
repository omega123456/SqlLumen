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

import { useCallback, useMemo } from 'react'
import { Copy, FloppyDisk, Trash } from '@phosphor-icons/react'
import { useToastStore } from '../../stores/toast-store'
import { useQueryStore, getActiveResult } from '../../stores/query-store'
import { useSettingsStore } from '../../stores/settings-store'
import { EditModeDropdown } from './EditModeDropdown'
import { ViewModeGroup } from '../shared/toolbar/ViewModeGroup'
import { ExportButton } from '../shared/toolbar/ExportButton'
import { StatusArea } from '../shared/toolbar/StatusArea'
import { FilterToolbarButton } from '../shared/FilterToolbarButton'
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

  const status = activeResult.resultStatus
  const totalRows = activeResult.totalRows
  const affectedRows = activeResult.affectedRows
  const columnsCount = activeResult.columns.length
  const executionTimeMs = activeResult.executionTimeMs
  const errorMessage = activeResult.errorMessage
  const autoLimitApplied = activeResult.autoLimitApplied
  const configuredRowLimit = useSettingsStore((s) => s.getSetting('results.pageSize')) || '500'
  const viewMode = activeResult.viewMode

  // Edit state for Save/Discard buttons
  const editState = activeResult.editState
  const hasModifications = editState !== null && editState.modifiedColumns.size > 0

  // Checkbox-selected rows for in-memory (read-only) removal.
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
    const count = checkedRowIndices.length
    deleteResultRows(tabId, checkedRowIndices)
    showSuccess(
      'Rows removed',
      `${count} row${count === 1 ? '' : 's'} removed from the result view.`
    )
  }, [checkedRowIndices, deleteResultRows, tabId, showSuccess])

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

      {/* Delete checked rows — read-only in-memory removal from the result view */}
      {editState === null && checkedCount > 0 && (
        <div className={styles.editActionsGroup} data-testid="result-delete-actions-group">
          <button
            type="button"
            className={styles.discardButton}
            onClick={handleDeleteChecked}
            title={`Remove ${checkedCount} selected row${checkedCount === 1 ? '' : 's'} from the result view`}
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
          executionTimeMs={
            executionTimeMs != null && executionTimeMs > 0 ? executionTimeMs : undefined
          }
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
    </div>
  )
}
