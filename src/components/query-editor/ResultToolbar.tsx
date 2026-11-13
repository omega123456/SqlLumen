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

import { useCallback, useMemo, useState, type ReactNode } from 'react'
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
import { toErrorMessage } from '../../lib/error-message'
import { hasResultColumns } from '../../lib/query-result-column-utils'

const ERROR_PREVIEW_MAX_LENGTH = 200

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
function getDeleteDialogCopy(count: number, tableName: string): DeleteDialogCopy {
  const formattedCount = formatCount(count)
  if (count > MAX_BULK_DELETE_ROWS) {
    return {
      title: 'Too many rows to delete at once',
      message: `You have ${formattedCount} rows checked. You can delete up to ${formatCount(
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
    message: `Delete ${formattedCount} rows from ${tableName}?`,
    confirmLabel: `Delete ${formattedCount} rows`,
    warningText:
      count > BULK_DELETE_WARNING_ROWS
        ? "This can't be undone. Deleting more than 1,000 rows can take a while. If a row fails, rows already deleted stay deleted."
        : undefined,
    isDestructive: true,
    blocked: false,
  }
}

type ActiveResult = ReturnType<typeof getActiveResult>
type RowCountParts = ReturnType<typeof formatRowCountParts>
type RowActionProgress = NonNullable<ActiveResult['rowActionProgress']>

const STATUS_AREA_BY_RESULT_STATUS: Record<ActiveResult['resultStatus'], StatusType> = {
  idle: 'idle',
  running: 'idle',
  success: 'success',
  error: 'error',
}

function resolveStatusAreaStatus(
  showActionProgress: boolean,
  status: ActiveResult['resultStatus']
): StatusType {
  return showActionProgress ? 'loading' : STATUS_AREA_BY_RESULT_STATUS[status]
}

function truncateErrorMessage(errorMessage: string | null): string | undefined {
  if (!errorMessage) return undefined
  if (errorMessage.length <= ERROR_PREVIEW_MAX_LENGTH) return errorMessage
  return errorMessage.slice(0, ERROR_PREVIEW_MAX_LENGTH) + '…'
}

function editTableNameOf(result: ActiveResult): string {
  if (!result.editMode) return ''
  return result.editTableMetadata[result.editMode]?.table ?? result.editMode
}

function sortedCheckedRanges(result: ActiveResult): ActiveResult['checkedRanges'] {
  if (result.checkedViewVersion !== result.viewVersion) return []
  return [...result.checkedRanges].sort((left, right) => left[0] - right[0])
}

function ResultRowCount({ rowCount }: { rowCount: RowCountParts }) {
  if (rowCount.segmentKind !== 'truncated') {
    return <span data-testid="result-row-count">{rowCount.count}</span>
  }
  return (
    <span className={styles.truncatedCount} data-testid="result-row-count">
      <WarningCircle size={12} weight="fill" className={styles.truncatedIcon} aria-hidden="true" />
      {rowCount.count} · {rowCount.segment}
    </span>
  )
}

interface StatusCounts {
  statusTotalRows: number | undefined
  countLabel: ReactNode
}

function resolveStatusCounts(result: ActiveResult, rowCount: RowCountParts): StatusCounts {
  if (result.resultStatus !== 'success')
    return { statusTotalRows: undefined, countLabel: undefined }
  if (hasResultColumns(result)) {
    return { statusTotalRows: undefined, countLabel: <ResultRowCount rowCount={rowCount} /> }
  }
  if (result.affectedRows > 0)
    return { statusTotalRows: result.affectedRows, countLabel: undefined }
  return { statusTotalRows: undefined, countLabel: undefined }
}

function rowActionLabel(progress: RowActionProgress | null): string | undefined {
  if (!progress) return undefined
  return `${progress.verb}… ${formatCount(progress.done)} of ${formatCount(progress.total)}`
}

function windowLoadingLabel(range: ActiveResult['pendingWindowRange']): string | null {
  if (!range) return null
  return `Loading rows ${formatRowRange(range[0] + 1, range[1])}…`
}

interface AnnouncementInputs {
  showActionProgress: boolean
  rowActionProgress: RowActionProgress | null
  windowLabel: string | null
  hasResults: boolean
}

function resolveAnnouncement(inputs: AnnouncementInputs): string {
  const { rowActionProgress, windowLabel } = inputs
  if (inputs.showActionProgress) {
    return `${rowActionProgress?.verb}… ${formatCount(rowActionProgress?.total ?? 0)} rows`
  }
  if (windowLabel && inputs.hasResults) return windowLabel
  return ''
}

interface StatusDetailsProps {
  rowCount: RowCountParts
  isFiltering: boolean
  windowLabel: string | null
}

function ResultStatusDetails({ rowCount, isFiltering, windowLabel }: StatusDetailsProps) {
  return (
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

interface CustomContentInputs {
  result: ActiveResult
  showActionProgress: boolean
  details: StatusDetailsProps
  onCancelRowAction: () => void
}

function resolveStatusCustomContent(inputs: CustomContentInputs): ReactNode {
  const { result } = inputs
  if (inputs.showActionProgress) {
    if (!result.rowActionProgress?.cancellable) return undefined
    return (
      <Button
        variant="subtle"
        size="sm"
        onClick={inputs.onCancelRowAction}
        data-testid="row-action-cancel"
      >
        Cancel
      </Button>
    )
  }
  const showsRowDetails = result.resultStatus === 'success' && result.columns.length > 0
  if (!showsRowDetails) return undefined
  return <ResultStatusDetails {...inputs.details} />
}

function copiedRowsToast(
  wasVisible: boolean,
  rowCount: number
): { title: string; message: string } {
  if (wasVisible) {
    return { title: 'Copied', message: `${formatCount(rowCount)} rows copied to clipboard.` }
  }
  return { title: 'Selected rows copied', message: `${rowCount} row(s) copied to clipboard.` }
}

function pluralSuffix(count: number): string {
  return count === 1 ? '' : 's'
}

interface CopySelectedAvailability {
  hasResults: boolean
  checkedCount: number
  isRowActionPending: boolean
}

function isCopySelectedDisabled(availability: CopySelectedAvailability): boolean {
  if (!availability.hasResults) return true
  return availability.checkedCount === 0 || availability.isRowActionPending
}

function CloneActionGroup({ isDisabled, onClone }: { isDisabled: boolean; onClone: () => void }) {
  return (
    <div className={styles.editActionsGroup} data-testid="clone-actions-group">
      <Button
        variant="bare"
        className={styles.cloneButton}
        onClick={onClone}
        title="Clone selected row; primary key fields are left blank."
        data-testid="query-clone-button"
        disabled={isDisabled}
      >
        <Copy size={16} weight="regular" />
        <span>Clone</span>
      </Button>
    </div>
  )
}

interface DeleteRowsActionGroupProps {
  editMode: string | null
  checkedCount: number
  onDelete: () => void
}

function DeleteRowsActionGroup({ editMode, checkedCount, onDelete }: DeleteRowsActionGroupProps) {
  if (editMode === null) return null
  if (checkedCount === 0) return null
  const formattedCount = formatCount(checkedCount)
  return (
    <div className={styles.editActionsGroup} data-testid="result-delete-actions-group">
      <Button
        variant="bare"
        className={styles.discardButton}
        onClick={onDelete}
        title={`Delete ${formattedCount} selected row${pluralSuffix(checkedCount)} from the database`}
        data-testid="query-delete-rows-button"
      >
        <Trash size={16} weight="regular" />
        <span>Delete ({formattedCount})</span>
      </Button>
    </div>
  )
}

interface SaveDiscardActionGroupProps {
  editState: ActiveResult['editState']
  onSave: () => void
  onDiscard: () => void
}

function SaveDiscardActionGroup({ editState, onSave, onDiscard }: SaveDiscardActionGroupProps) {
  if (editState === null) return null
  const hasModifications = editState.modifiedColumns.size > 0
  return (
    <div className={styles.editActionsGroup} data-testid="edit-actions-group">
      {hasModifications && (
        <Button
          variant="bare"
          className={styles.saveButton}
          onClick={onSave}
          title="Save changes"
          data-testid="query-save-button"
        >
          <FloppyDisk size={16} weight="regular" />
          <span>Save</span>
        </Button>
      )}
      <Button
        variant="bare"
        className={styles.discardButton}
        onClick={onDiscard}
        title="Discard changes"
        data-testid="query-discard-button"
      >
        <span>Discard</span>
      </Button>
    </div>
  )
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
  const columnsCount = activeResult.columns.length
  const { viewMode, rowActionProgress, editState, editMode } = activeResult
  const editTableName = editTableNameOf(activeResult)

  const checkedRanges = useMemo(() => sortedCheckedRanges(activeResult), [activeResult])
  const checkedCount = countRanges(checkedRanges)
  const isRowActionPending = rowActionProgress !== null
  const hasResults = status === 'success'
  const showActionProgress = rowActionProgress?.visible === true

  const rowCount = formatRowCountParts({
    viewRowCount: activeResult.viewRowCount,
    totalRows: activeResult.totalRows,
    isFiltered: filterModel.length > 0,
    truncated: activeResult.truncated,
    autoLimitApplied: activeResult.autoLimitApplied,
    appliedRowLimit: activeResult.appliedRowLimit,
  })
  const { statusTotalRows, countLabel } = resolveStatusCounts(activeResult, rowCount)
  const windowLabel = windowLoadingLabel(activeResult.pendingWindowRange)
  const announcement = resolveAnnouncement({
    showActionProgress: showActionProgress,
    rowActionProgress: rowActionProgress,
    windowLabel: windowLabel,
    hasResults: hasResults,
  })
  const customContent = resolveStatusCustomContent({
    result: activeResult,
    showActionProgress: showActionProgress,
    details: {
      rowCount: rowCount,
      isFiltering: activeResult.isFiltering,
      windowLabel: windowLabel,
    },
    onCancelRowAction: () => cancelRowAction(tabId),
  })
  // The badge shows the combined timing, so totalTimeMs (not executionTimeMs) feeds StatusArea.
  const totalTimeMs = activeResult.totalTimeMs

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
    const action = beginRowAction(tabId, {
      verb: 'Copying',
      total: total,
      onCancel: chunkCount > 1 ? () => controller.abort() : undefined,
    })
    let rows: CachedRow[] = []
    try {
      for (const range of checkedRanges) {
        const doneBefore = rows.length
        const chunk = await readViewRange({
          tabId: tabId,
          resultIndex: activeResultIndex,
          range: range,
          options: {
            signal: controller.signal,
            onProgress: ({ done }) => action.update(doneBefore + done),
          },
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
      logFrontend('warn', `[result-toolbar] could not load checked rows: ${toErrorMessage(error)}`)
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
      const toast = copiedRowsToast(wasVisible, rows.length)
      showSuccess(toast.title, toast.message)
    } catch (error) {
      logFrontend('warn', `[result-toolbar] clipboard write failed: ${toErrorMessage(error)}`)
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
    if (checkedCount === 0) return
    if (deleteCopy.blocked) return
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

      {isCloneVisible && <CloneActionGroup isDisabled={isCloneDisabled} onClone={handleClone} />}

      <DeleteRowsActionGroup
        editMode={editMode}
        checkedCount={checkedCount}
        onDelete={handleDeleteChecked}
      />

      <SaveDiscardActionGroup editState={editState} onSave={handleSave} onDiscard={handleDiscard} />

      {/* Center-left: status — shared component */}
      <div className={styles.statusWrapper}>
        <StatusArea
          status={resolveStatusAreaStatus(showActionProgress, status)}
          totalRows={statusTotalRows}
          countLabel={countLabel}
          loadingLabel={rowActionLabel(rowActionProgress)}
          executionTimeMs={totalTimeMs > 0 ? totalTimeMs : undefined}
          errorMessage={truncateErrorMessage(activeResult.errorMessage)}
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
        disabled={isCopySelectedDisabled({
          hasResults: hasResults,
          checkedCount: checkedCount,
          isRowActionPending: isRowActionPending,
        })}
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
