/**
 * Toolbar above the result grid — shows view mode toggle, edit mode dropdown,
 * Save/Discard buttons, query status, and export action.
 *
 * Results are windowed: the row count comes from the shared formatter
 * (`format-row-count`) as "12,340 rows", "2,340 of 12,340 rows" or
 * "100,000+ rows · truncated" (wireframe 3). Checked rows are view ranges, so
 * copy and delete resolve them through the page cache / Rust before acting.
 *
 * Status priorities (wireframes 2, 7 and 8):
 * - a row action whose progress passed the 1 s threshold shows the StatusArea
 *   loading state ("Copying… 4,000 of 12,340") with Cancel for multi-chunk
 *   fetches;
 * - otherwise the success state keeps the count visible, followed by
 *   "Filtering…" or the 1 s "Loading rows X–Y…" status.
 *
 * Reads per-result state from the active result via getActiveResult.
 */

import { useCallback, useMemo, useState } from 'react'
import { Copy, FloppyDisk, Trash, WarningCircle } from '@phosphor-icons/react'
import {
  BULK_DELETE_WARNING_ROWS,
  MAX_BULK_DELETE_ROWS,
  countRanges,
  useQueryStore,
  getActiveResult,
} from '../../stores/query-store'
import { showErrorToast, useToastStore } from '../../stores/toast-store'
import { serializeCsv } from '../../lib/csv-utils'
import { writeClipboardText } from '../../lib/context-menu-utils'
import { CLIPBOARD_ACTION_FAILURES } from '../../lib/clipboard-action-failures'
import { logFrontend } from '../../lib/app-log-commands'
import { formatCount, formatRowCountParts, formatRowRange } from '../../lib/format-row-count'
import {
  RESULT_MAX_CHUNK_ROWS,
  isAbortError,
  isResultsExpiredError,
  readViewRange,
  type CachedRow,
} from '../../lib/result-window-cache'
import { EditModeDropdown } from './EditModeDropdown'
import { ViewModeGroup } from '../shared/toolbar/ViewModeGroup'
import { ExportButton } from '../shared/toolbar/ExportButton'
import { CopySelectedRowsButton } from '../shared/toolbar/CopySelectedRowsButton'
import { StatusArea } from '../shared/toolbar/StatusArea'
import { FilterToolbarButton } from '../shared/FilterToolbarButton'
import { Button } from '../common/Button'
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

/** Copy of the delete confirmation for `count` checked rows (wireframe 7). */
export interface DeleteDialogCopy {
  title: string
  message: string
  confirmLabel: string
  warningText: string | null | undefined
  isDestructive: boolean
  blocked: boolean
}

/** The three-tier delete dialog copy (wireframe 7). */
// eslint-disable-next-line react-refresh/only-export-components
export function getDeleteDialogCopy(count: number, tableName: string): DeleteDialogCopy {
  const n = formatCount(count)
  if (count > MAX_BULK_DELETE_ROWS) {
    return {
      title: 'Too many rows to delete at once',
      message: `You have ${n} rows checked. You can delete up to ${formatCount(
        MAX_BULK_DELETE_ROWS
      )} rows at a time. Uncheck some rows, then try again.`,
      confirmLabel: 'OK',
      warningText: null,
      isDestructive: false,
      blocked: true,
    }
  }
  if (count === 1) {
    return {
      title: 'Delete row',
      message: `Delete this row from ${tableName}?`,
      confirmLabel: 'Delete row',
      warningText: undefined,
      isDestructive: true,
      blocked: false,
    }
  }
  return {
    title: 'Delete rows',
    message: `Delete ${n} rows from ${tableName}?`,
    confirmLabel: `Delete ${n} rows`,
    warningText:
      count > BULK_DELETE_WARNING_ROWS
        ? "This can't be undone. Deleting more than 1,000 rows can take a while. If a row fails, rows already deleted stay deleted."
        : undefined,
    isDestructive: true,
    blocked: false,
  }
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
  const activeResultIndex = useQueryStore((state) => state.tabs[tabId]?.activeResultIndex ?? 0)
  const setViewMode = useQueryStore((state) => state.setViewMode)
  const openExportDialog = useQueryStore((state) => state.openExportDialog)
  const cloneSelectedRow = useQueryStore((state) => state.cloneSelectedRow)
  const saveCurrentRow = useQueryStore((state) => state.saveCurrentRow)
  const discardCurrentRow = useQueryStore((state) => state.discardCurrentRow)
  const deleteResultRows = useQueryStore((state) => state.deleteResultRows)
  const beginRowAction = useQueryStore((state) => state.beginRowAction)
  const cancelRowAction = useQueryStore((state) => state.cancelRowAction)
  const markResultsExpired = useQueryStore((state) => state.markResultsExpired)
  const showSuccess = useToastStore((state) => state.showSuccess)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const status = activeResult.resultStatus
  const totalRows = activeResult.totalRows
  const affectedRows = activeResult.affectedRows
  const columnsCount = activeResult.columns.length
  // The toolbar badge shows the combined (total) timing, unchanged in magnitude
  // from before the execution/total split — so feed totalTimeMs into StatusArea.
  const totalTimeMs = activeResult.totalTimeMs
  const errorMessage = activeResult.errorMessage
  const viewMode = activeResult.viewMode
  const rowActionProgress = activeResult.rowActionProgress
  const pendingWindowRange = activeResult.pendingWindowRange
  const isFiltering = activeResult.isFiltering

  // Edit state for Save/Discard buttons
  const editState = activeResult.editState
  const editMode = activeResult.editMode
  const hasModifications = editState !== null && editState.modifiedColumns.size > 0
  const editTableName = editMode
    ? (activeResult.editTableMetadata[editMode]?.table ?? editMode)
    : ''

  // Checked rows are view ranges of the current view (D17).
  const checkedRanges = useMemo(
    () =>
      activeResult.checkedViewVersion === activeResult.viewVersion
        ? [...activeResult.checkedRanges].sort((a, b) => a[0] - b[0])
        : [],
    [activeResult.checkedRanges, activeResult.checkedViewVersion, activeResult.viewVersion]
  )
  const checkedCount = countRanges(checkedRanges)
  const isRowActionPending = rowActionProgress !== null

  const truncatedError =
    errorMessage && errorMessage.length > 200 ? errorMessage.slice(0, 200) + '…' : errorMessage

  const hasResults = status === 'success'
  const showActionProgress = rowActionProgress?.visible === true

  // Map query status to StatusArea status type
  const statusAreaStatus: StatusType = showActionProgress
    ? 'loading'
    : status === 'success'
      ? 'success'
      : status === 'error'
        ? 'error'
        : 'idle'

  // Unified row-count string (wireframe 3) for row-bearing results; DML keeps
  // the numeric affected-rows count.
  const rowCount = formatRowCountParts({
    viewRowCount: activeResult.viewRowCount,
    totalRows,
    isFiltered: filterModel.length > 0,
    truncated: activeResult.truncated,
    autoLimitApplied: activeResult.autoLimitApplied,
    appliedRowLimit: activeResult.appliedRowLimit,
  })
  let statusTotalRows: number | undefined = undefined
  let countLabel: React.ReactNode = undefined
  if (status === 'success') {
    if (columnsCount > 0) {
      countLabel =
        rowCount.segmentKind === 'truncated' ? (
          <span className={styles.truncatedCount} data-testid="result-row-count">
            <WarningCircle
              size={12}
              weight="fill"
              className={styles.truncatedIcon}
              aria-hidden="true"
            />
            {rowCount.count} · {rowCount.segment}
          </span>
        ) : (
          <span data-testid="result-row-count">{rowCount.count}</span>
        )
    } else if (affectedRows > 0) {
      statusTotalRows = affectedRows
    }
  }

  const actionLabel = rowActionProgress
    ? `${rowActionProgress.verb}… ${formatCount(rowActionProgress.done)} of ${formatCount(
        rowActionProgress.total
      )}`
    : null
  const windowLabel = pendingWindowRange
    ? `Loading rows ${formatRowRange(pendingWindowRange[0] + 1, pendingWindowRange[1])}…`
    : null
  // Announced once when the status appears, never per chunk.
  const announcement = showActionProgress
    ? `${rowActionProgress?.verb}… ${formatCount(rowActionProgress?.total ?? 0)} rows`
    : windowLabel && hasResults
      ? windowLabel
      : ''

  let customContent: React.ReactNode = undefined
  if (showActionProgress) {
    customContent = rowActionProgress?.cancellable ? (
      <Button
        variant="subtle"
        size="sm"
        onClick={() => cancelRowAction(tabId)}
        data-testid="row-action-cancel"
      >
        Cancel
      </Button>
    ) : undefined
  } else if (status === 'success' && columnsCount > 0) {
    customContent = (
      <>
        {rowCount.segmentKind === 'autoLimit' && (
          <span className={styles.autoLimit}>· {rowCount.segment}</span>
        )}
        {isFiltering && (
          <span className={styles.statusNote} data-testid="result-filtering-status">
            Filtering…
          </span>
        )}
        {windowLabel && (
          <span className={styles.windowLoading} data-testid="result-window-loading">
            <span className={styles.miniSpinner} aria-hidden="true" />
            <span>{windowLabel}</span>
          </span>
        )}
      </>
    )
  }

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
    if (checkedRanges.length === 0) return
    const total = countRanges(checkedRanges)
    const chunkCount = checkedRanges.reduce(
      (sum, [start, end]) => sum + Math.ceil((end - start) / RESULT_MAX_CHUNK_ROWS),
      0
    )
    const controller = new AbortController()
    const action = beginRowAction(
      tabId,
      'Copying',
      total,
      chunkCount > 1 ? () => controller.abort() : undefined
    )
    let rows: CachedRow[] = []
    try {
      for (const range of checkedRanges) {
        const doneBefore = rows.length
        const chunk = await readViewRange(tabId, activeResultIndex, range, {
          signal: controller.signal,
          onProgress: ({ done }) => action.update(doneBefore + done),
        })
        rows = rows.concat(chunk)
      }
    } catch (error) {
      action.finish()
      if (isAbortError(error)) return
      if (isResultsExpiredError(error)) {
        markResultsExpired(tabId)
        return
      }
      logFrontend(
        'warn',
        `[result-toolbar] could not load checked rows: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      showErrorToast(CLIPBOARD_ACTION_FAILURES.copy.title, CLIPBOARD_ACTION_FAILURES.copy.message)
      return
    }
    const wasVisible = action.finish()

    try {
      await writeClipboardText(
        serializeCsv(
          activeResult.columns.map((column) => column.name),
          rows.map((row) => row.row)
        )
      )
      if (wasVisible) {
        showSuccess('Copied', `${formatCount(rows.length)} rows copied to clipboard.`)
      } else {
        showSuccess('Selected rows copied', `${rows.length} row(s) copied to clipboard.`)
      }
    } catch (error) {
      logFrontend(
        'warn',
        `[result-toolbar] clipboard write failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      showErrorToast(CLIPBOARD_ACTION_FAILURES.copy.title, CLIPBOARD_ACTION_FAILURES.copy.message)
    }
  }, [
    activeResult.columns,
    activeResultIndex,
    beginRowAction,
    checkedRanges,
    markResultsExpired,
    showSuccess,
    tabId,
  ])

  const handleSave = useCallback(() => {
    saveCurrentRow(tabId)
  }, [saveCurrentRow, tabId])

  const handleClone = useCallback(() => {
    cloneSelectedRow(tabId)
  }, [cloneSelectedRow, tabId])

  const handleDiscard = useCallback(() => {
    discardCurrentRow(tabId)
  }, [discardCurrentRow, tabId])

  const deleteCopy = getDeleteDialogCopy(checkedCount, editTableName)

  const handleDeleteChecked = useCallback(() => {
    if (checkedCount === 0) return
    setShowDeleteConfirm(true)
  }, [checkedCount])

  const handleConfirmDelete = useCallback(() => {
    setShowDeleteConfirm(false)
    // The blocked tier (> 10,000 rows) only explains; nothing is deleted.
    if (checkedCount === 0 || deleteCopy.blocked) return
    // Success / error toasts are surfaced by the store action.
    void deleteResultRows(tabId)
  }, [checkedCount, deleteCopy.blocked, deleteResultRows, tabId])

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
          key columns are present), matching the cell-edit gating. The button
          stays enabled at every count so keyboard users reach the explanation. */}
      {editMode !== null && checkedCount > 0 && (
        <div className={styles.editActionsGroup} data-testid="result-delete-actions-group">
          <button
            type="button"
            className={styles.discardButton}
            onClick={handleDeleteChecked}
            title={`Delete ${formatCount(checkedCount)} selected row${checkedCount === 1 ? '' : 's'} from the database`}
            data-testid="query-delete-rows-button"
          >
            <Trash size={16} weight="regular" />
            <span>Delete ({formatCount(checkedCount)})</span>
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
          countLabel={countLabel}
          loadingLabel={actionLabel ?? undefined}
          executionTimeMs={totalTimeMs > 0 ? totalTimeMs : undefined}
          errorMessage={truncatedError || undefined}
          customContent={customContent}
        />
        <span className={styles.srOnly} role="status" aria-live="polite">
          {announcement}
        </span>
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
        disabled={!hasResults || checkedCount === 0 || isRowActionPending}
        onClick={() => void handleCopySelectedRows()}
      />

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title={deleteCopy.title}
        message={deleteCopy.message}
        confirmLabel={deleteCopy.confirmLabel}
        isDestructive={deleteCopy.isDestructive}
        warningText={deleteCopy.warningText}
        hideCancel={deleteCopy.blocked}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </div>
  )
}
