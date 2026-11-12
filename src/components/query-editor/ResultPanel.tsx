/**
 * Result display panel — shows query results in different states:
 * idle (placeholder), running (spinner), success (toolbar + grid/form/text),
 * or error (toolbar + error message).
 *
 * Wires edit mode state from the query store to ResultGridView and
 * ResultFormView, and renders the UnsavedChangesDialog when pending
 * edit navigation is deferred.
 *
 * When switching to text view while edits are pending, auto-saves the
 * current row before completing the view mode switch.
 *
 * Supports multi-result tabs — renders ResultSubTabs when results.length > 1.
 *
 * Rows are windowed (the Rust cache owns them). Between the toolbar and the
 * grid sits the band slot: the polite truncation notice (wireframes 1 / 1b),
 * then the window-fetch or view-change failure band with Retry (wireframe 2).
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Play, ClockCountdown } from '@phosphor-icons/react'
import {
  useQueryStore,
  getActiveResult,
  hasUnsavedModifications,
  type SingleResultState,
} from '../../stores/query-store'
import type { GridRowActions } from '../shared/glide/CanvasBaseGridView'
import { formatCount, formatRowRange } from '../../lib/format-row-count'
import { readViewRange, type CachedRow } from '../../lib/result-window-cache'
import { logFrontend } from '../../lib/app-log-commands'
import { toCachedRow } from '../../lib/result-row-materializer'
import type { FullExportBlockedReason } from '../../types/schema'
import { useToastStore } from '../../stores/toast-store'
import { FkLookupProvider, type FkLookupArgs } from '../shared/fk-lookup-context'
import { FkLookupDialog } from '../table-data/FkLookupDialog'
import { ResultSubTabs } from './ResultSubTabs'
import { ResultToolbar } from './ResultToolbar'
import { ResultGridView } from './ResultGridView'
import { ResultFormView } from './ResultFormView'
import { ResultTextView } from './ResultTextView'
import { UnsavedChangesDialog } from '../shared/UnsavedChangesDialog'
import { Button } from '../common/Button'
import { InfoBar } from '../common/InfoBar'
import ExportDialog from '../dialogs/ExportDialog'
import { FilterDialog } from '../dialogs/FilterDialog'
import type {
  FilterCondition,
  ForeignKeyColumnInfo,
  PrimaryKeyInfo,
  RowEditState,
  TableDataColumnMeta,
} from '../../types/schema'
import { columnIndexFromKey } from '../../lib/col-key-utils'
import { buildForeignKeyLookup } from '../../lib/foreign-key-utils'
import { buildInitialConditionsFromCell } from '../../lib/filter-utils'
import styles from './ResultPanel.module.css'
import { toErrorMessage } from '../../lib/error-message'

interface ResultPanelProps {
  tabId: string
  connectionId: string
  isActive?: boolean
  hideSubTabs?: boolean
}

const EMPTY_TABLE_COLUMNS: TableDataColumnMeta[] = []
const EMPTY_RESULTS: readonly unknown[] = []

/** Truncation band message per full-export-blocked reason (wireframes 1 and 1b). */
const TRUNCATION_MESSAGES: Record<FullExportBlockedReason | 'none', string> = {
  none: 'Result truncated. This query returned more rows than the maximum rows kept per result.',
  call: 'Result truncated. Exporting all rows would run this stored procedure again and repeat its changes. To keep more rows in future runs, raise Maximum rows kept per result in Settings.',
  locking:
    'Result truncated. Exporting all rows would run this locking query again and take its locks again. To export every row, remove the locking clause and run the query again.',
  unknownDatabase:
    "Result truncated. The database this query ran in couldn't be recorded, so all rows can't be exported. Run the query again to enable full export.",
}

/** The cached row a materialized grid row stands for, or null when it has no base index. */
function cachedRowFromRowData(
  rowData: Record<string, unknown>,
  columnCount: number
): CachedRow | null {
  return typeof rowData.__baseIdx === 'number' ? toCachedRow(rowData, columnCount) : null
}

type DisplayStatus = SingleResultState['resultStatus'] | 'running' | 'restoring' | 'idle'

interface DisplayStatusInputs {
  tabStatus: string
  rowResidencyStatus: string
  resultStatus: SingleResultState['resultStatus']
}

function resolveDisplayStatus(inputs: DisplayStatusInputs): DisplayStatus {
  if (inputs.tabStatus === 'running') return 'running'
  if (inputs.rowResidencyStatus === 'restoring') return 'restoring'
  if (inputs.tabStatus === 'idle') return 'idle'
  return inputs.resultStatus
}

function hasPendingRowEdit(editState: RowEditState | null): boolean {
  if (editState === null) return false
  return editState.isNewRow || editState.modifiedColumns.size > 0
}

function isSelectedRowInView(selectedRowIndex: number | null, viewRowCount: number): boolean {
  if (selectedRowIndex === null) return false
  return selectedRowIndex >= 0 && selectedRowIndex < viewRowCount
}

function hasInsertEligibleNonPrimaryColumns(
  editTableColumns: TableDataColumnMeta[],
  editBoundColumnIndexMap: Map<string, number>
): boolean {
  return editTableColumns.some(
    (column) => !column.isPrimaryKey && editBoundColumnIndexMap.has(column.name.toLowerCase())
  )
}

interface CloneAvailability {
  result: SingleResultState
  displayStatus: DisplayStatus
  editTableColumns: TableDataColumnMeta[]
  primaryKey: PrimaryKeyInfo | null
}

function isCloneBlockedByEditing(result: SingleResultState): boolean {
  const selectedRowIsDraft =
    result.editState?.isNewRow === true && result.editingRowIndex === result.selectedRowIndex
  return hasPendingRowEdit(result.editState) || selectedRowIsDraft
}

function isCloneDisabled(availability: CloneAvailability): boolean {
  const { result, primaryKey } = availability
  if (result.editMode === null) return true
  if (availability.displayStatus !== 'success') return true
  if (result.isAnalyzingQuery || result.viewMode === 'text') return true
  if (isCloneBlockedByEditing(result)) return true
  if (!isSelectedRowInView(result.selectedRowIndex, result.viewRowCount)) return true
  if (!primaryKey || primaryKey.isUniqueKeyFallback) return true
  return !hasInsertEligibleNonPrimaryColumns(
    availability.editTableColumns,
    result.editBoundColumnIndexMap
  )
}

function gridTabPanelClassNameFor(viewMode: string, columnCount: number): string {
  const isGridWithColumns = viewMode === 'grid' && columnCount > 0
  return isGridWithColumns ? `${styles.tabPanel} ${styles.gridTabPanel}` : styles.tabPanel
}

interface TabPanelAttributes {
  role?: string
  id?: string
  'aria-labelledby'?: string
}

function resultTabPanelAttributes(
  hideSubTabs: boolean,
  panelId: string,
  labelledBy: string | undefined
): TabPanelAttributes {
  if (hideSubTabs) return {}
  return { role: 'tabpanel', id: panelId, 'aria-labelledby': labelledBy }
}

function dmlSuccessMessage(affectedRows: number): string {
  if (affectedRows <= 0) return 'Query executed successfully'
  return `${affectedRows} ${affectedRows === 1 ? 'row' : 'rows'} affected`
}

function rowIndexFromRowData(rowData: Record<string, unknown>): number {
  const rowIndexRaw = rowData.__rowIdx
  return typeof rowIndexRaw === 'number' ? rowIndexRaw : 0
}

interface LookupRowRequest {
  tabId: string
  resultIndex: number
  rowIndex: number
}

async function resolveLookupRow(
  rowData: Record<string, unknown>,
  columnCount: number,
  request: LookupRowRequest
): Promise<CachedRow | undefined> {
  const fromGrid = cachedRowFromRowData(rowData, columnCount)
  if (fromGrid) return fromGrid
  const { tabId, resultIndex, rowIndex } = request
  try {
    const fetched = await readViewRange(tabId, resultIndex, [rowIndex, rowIndex + 1])
    return fetched[0]
  } catch (error) {
    logFrontend(
      'warn',
      `[result-panel] FK lookup could not load row ${rowIndex + 1}: ${toErrorMessage(error)}`
    )
    return undefined
  }
}

function readEditTable(result: SingleResultState) {
  const editTable = result.editMode ? result.editTableMetadata[result.editMode] : undefined
  return {
    editTable: editTable,
    primaryKey: editTable?.primaryKey ?? null,
    editTableColumns: editTable?.columns ?? EMPTY_TABLE_COLUMNS,
  }
}

function hasVisibleSubTabs(hideSubTabs: boolean, resultCount: number): boolean {
  return !hideSubTabs && resultCount > 1
}

function subTabLabelledBy(
  showsSubTabs: boolean,
  tabId: string,
  resultIndex: number
): string | undefined {
  return showsSubTabs ? `result-tab-${tabId}-${resultIndex}` : undefined
}

function shouldShowExpiredState(isExpired: boolean, displayStatus: DisplayStatus): boolean {
  return isExpired && displayStatus !== 'running'
}

interface ForeignKeyLookupContext {
  columnKey: string
  sourceColumn: string
  currentValue: unknown
  foreignKey: ForeignKeyColumnInfo
  rowData: Record<string, unknown>
}

interface ForeignKeyLookupTargetInputs {
  isOpen: boolean
  context: ForeignKeyLookupContext | null
  editMode: string | null
  editTable: ReturnType<typeof readEditTable>['editTable']
}

function resolveForeignKeyLookupTarget(inputs: ForeignKeyLookupTargetInputs) {
  const { context, editMode, editTable } = inputs
  if (!inputs.isOpen || !context || !editMode) return null
  return {
    context: context,
    database: context.foreignKey.referencedDatabase || editTable?.database || '',
    sourceTable: editTable?.table ?? editMode,
  }
}

function EmptyResultState({ isRunning }: { isRunning: boolean }) {
  if (isRunning) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.spinner} />
        <span>Executing query...</span>
      </div>
    )
  }
  return (
    <div className={styles.emptyState}>
      <Play size={32} weight="duotone" className={styles.emptyIcon} />
      <span>Run a query to see results</span>
    </div>
  )
}

function ResultStatusOverlay({ testId, label }: { testId: string; label: string }) {
  return (
    <div
      className={styles.restoringOverlay}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid={testId}
    >
      <div className={styles.spinner} aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

function ResultActivityOverlay({
  displayStatus,
  isSorting,
}: {
  displayStatus: DisplayStatus
  isSorting: boolean
}) {
  if (displayStatus === 'restoring') {
    return (
      <ResultStatusOverlay
        testId="query-result-restore-overlay"
        label="Restoring cached results…"
      />
    )
  }
  if (!isSorting) return null
  return <ResultStatusOverlay testId="query-result-sort-overlay" label="Sorting…" />
}

function ExpiredResultState({
  isRestoring,
  onRetry,
}: {
  isRestoring: boolean
  onRetry: () => void
}) {
  return (
    <div className={styles.emptyState} style={{ height: '100%' }}>
      <ClockCountdown
        weight="duotone"
        size={32}
        aria-hidden="true"
        style={{ opacity: 0.35, color: 'var(--on-surface-variant)' }}
      />
      <div style={{ maxWidth: 320, textAlign: 'center' }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--on-surface)',
          }}
        >
          Results expired
        </div>
        <div
          style={{
            fontSize: 12,
            opacity: 0.6,
            color: 'var(--on-surface-variant)',
            marginTop: 4,
          }}
        >
          Cached results are no longer available.
        </div>
      </div>
      <Button
        onClick={onRetry}
        disabled={isRestoring}
        style={{ marginTop: 8 }}
        data-testid="retry-expired-button"
      >
        Re-run query
      </Button>
    </div>
  )
}

export function ResultPanel({
  tabId,
  connectionId,
  isActive = true,
  hideSubTabs = false,
}: ResultPanelProps) {
  const activeResult = useQueryStore((state) => getActiveResult(state.tabs[tabId]))
  const tabStatus = useQueryStore((state) => state.tabs[tabId]?.tabStatus ?? 'idle')
  const results = useQueryStore((state) => state.tabs[tabId]?.results ?? EMPTY_RESULTS)
  const activeResultIndex = useQueryStore((state) => state.tabs[tabId]?.activeResultIndex ?? 0)
  const pendingNavigationAction = useQueryStore(
    (state) => state.tabs[tabId]?.pendingNavigationAction ?? null
  )

  // Individual action selectors — stable references that never change
  const requestNavigationAction = useQueryStore((state) => state.requestNavigationAction)
  const sortResults = useQueryStore((state) => state.sortResults)
  const setSelectedRow = useQueryStore((state) => state.setSelectedRow)
  const startEditingRow = useQueryStore((state) => state.startEditingRow)
  const updateCellValue = useQueryStore((state) => state.updateCellValue)
  const syncCellValue = useQueryStore((state) => state.syncCellValue)
  const saveCurrentRow = useQueryStore((state) => state.saveCurrentRow)
  const confirmNavigation = useQueryStore((state) => state.confirmNavigation)
  const cancelNavigation = useQueryStore((state) => state.cancelNavigation)
  const discardCurrentRow = useQueryStore((state) => state.discardCurrentRow)
  const closeExportDialog = useQueryStore((state) => state.closeExportDialog)
  const applyQueryFilters = useQueryStore((state) => state.applyQueryFilters)
  const retryExpiredResult = useQueryStore((state) => state.retryExpiredResult)
  const openExportDialog = useQueryStore((state) => state.openExportDialog)
  const retryResultWindow = useQueryStore((state) => state.retryResultWindow)
  const retryViewChange = useQueryStore((state) => state.retryViewChange)
  const beginRowAction = useQueryStore((state) => state.beginRowAction)
  const markResultsExpired = useQueryStore((state) => state.markResultsExpired)

  const {
    resultStatus,
    columns,
    viewRowCount,
    viewVersion,
    queryId,
    draftRow,
    truncated,
    rowCeiling,
    fullExportBlockedReason,
    failedWindowRange,
    viewError,
    affectedRows,
    viewMode,
    sortColumn,
    sortDirection,
    selectedRowIndex,
    exportDialogOpen,
    isExpired,
    isSorting,
    editMode,
    editableColumnMap,
    editColumnBindings,
    editState,
    editingRowIndex,
    editingBaseIndex,
    editForeignKeys,
    saveError,
    filterModel,
    selectedCell,
  } = activeResult
  const rowResidencyStatus = activeResult.rowResidency.status
  const { editTable, primaryKey, editTableColumns } = readEditTable(activeResult)

  // Filter state
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false)
  const filterColumns = useMemo(() => columns.map((column) => column.name), [columns])

  const showSuccess = useToastStore((state) => state.showSuccess)

  // Wrap sort handler with navigation action guard (handles pending edits)
  const handleSortChanged = useCallback(
    (column: string, direction: 'asc' | 'desc' | null) => {
      requestNavigationAction(tabId, () => {
        sortResults(connectionId, tabId, column, direction)
      })
    },
    [requestNavigationAction, sortResults, connectionId, tabId]
  )

  const handleRowSelected = useCallback(
    (rowIndex: number) => {
      setSelectedRow(tabId, rowIndex)
    },
    [setSelectedRow, tabId]
  )

  /**
   * Handle form-view record navigation (Previous / Next) over the whole view;
   * the form view fetches rows that aren't loaded.
   */
  const formRowCount = viewRowCount + (draftRow ? 1 : 0)
  const handleFormNavigate = useCallback(
    (direction: 'prev' | 'next') => {
      const currentIndex = selectedRowIndex ?? 0
      const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1

      // Bounds check
      if (newIndex < 0 || newIndex >= formRowCount) return

      setSelectedRow(tabId, newIndex)
    },
    [setSelectedRow, tabId, selectedRowIndex, formRowCount]
  )

  // --- Edit mode callbacks ---

  const handleStartEditing = useCallback(
    (rowIndex: number, row?: CachedRow) => {
      startEditingRow(tabId, rowIndex, row)
    },
    [startEditingRow, tabId]
  )

  // Grid actions that fetch unloaded rows report progress through the store.
  const gridRowActions = useMemo<GridRowActions>(
    () => ({
      begin: (verb, total, onCancel) => beginRowAction(tabId, verb, total, onCancel),
      onExpired: () => markResultsExpired(tabId),
    }),
    [beginRowAction, markResultsExpired, tabId]
  )

  const handleExportAllRows = useCallback(() => {
    openExportDialog(tabId, 'allRows')
  }, [openExportDialog, tabId])

  const handleUpdateCellValue = useCallback(
    (columnIndex: number, value: unknown) => {
      updateCellValue(tabId, columnIndex, value)
    },
    [updateCellValue, tabId]
  )

  const handleSyncCellValue = useCallback(
    (columnIndex: number, value: unknown) => {
      syncCellValue(tabId, columnIndex, value)
    },
    [syncCellValue, tabId]
  )

  const handleAutoSave = useCallback(async (): Promise<boolean> => {
    return await saveCurrentRow(tabId)
  }, [saveCurrentRow, tabId])

  // --- UnsavedChangesDialog handlers ---

  const handleDialogSave = useCallback(async () => {
    await confirmNavigation(tabId, true)
  }, [confirmNavigation, tabId])

  const handleDialogDiscard = useCallback(() => {
    confirmNavigation(tabId, false)
  }, [confirmNavigation, tabId])

  const handleDialogCancel = useCallback(() => {
    cancelNavigation(tabId)
  }, [cancelNavigation, tabId])

  const handleFormSave = useCallback(async (): Promise<boolean> => {
    await saveCurrentRow(tabId)
    const tab = useQueryStore.getState().tabs[tabId]
    const result = getActiveResult(tab)
    return !result.saveError
  }, [saveCurrentRow, tabId])

  const handleFormDiscard = useCallback(() => {
    discardCurrentRow(tabId)
  }, [discardCurrentRow, tabId])

  const filterDialogInitialConditions: FilterCondition[] = useMemo(
    () => buildInitialConditionsFromCell(selectedCell, filterModel),
    [filterModel, selectedCell]
  )

  const handleFilterApply = useCallback(
    (conditions: FilterCondition[]) => {
      setIsFilterDialogOpen(false)
      applyQueryFilters(tabId, activeResultIndex, conditions)
    },
    [tabId, activeResultIndex, applyQueryFilters, setIsFilterDialogOpen]
  )

  const handleClearFilter = useCallback(() => {
    applyQueryFilters(tabId, activeResultIndex, [])
    showSuccess('Filters cleared')
  }, [tabId, activeResultIndex, applyQueryFilters, showSuccess])

  // Determine if editing is active (used to disable filter buttons)
  const isEditingActive = editState !== null

  const [foreignKeyLookupOpen, setForeignKeyLookupOpen] = useState(false)
  const [foreignKeyLookupContext, setForeignKeyLookupContext] =
    useState<ForeignKeyLookupContext | null>(null)

  useEffect(() => {
    if (isActive) return
    queueMicrotask(() => {
      if (exportDialogOpen) closeExportDialog(tabId)
      setIsFilterDialogOpen(false)
      setForeignKeyLookupOpen(false)
      setForeignKeyLookupContext(null)
    })
  }, [closeExportDialog, exportDialogOpen, isActive, tabId])

  const resultForeignKeyLookup = useMemo(
    () => buildForeignKeyLookup(editForeignKeys),
    [editForeignKeys]
  )

  const resolveResultForeignKey = useCallback(
    (columnKey: string) => {
      const resultColumnIndex = columnIndexFromKey(columnKey)
      if (resultColumnIndex < 0) return null
      const sourceColumnName = editColumnBindings.get(resultColumnIndex)
      if (!sourceColumnName) return null
      const foreignKey = resultForeignKeyLookup.get(sourceColumnName.toLowerCase())
      if (!foreignKey) return null
      return { sourceColumnName, foreignKey }
    },
    [editColumnBindings, resultForeignKeyLookup]
  )

  const leaveCurrentEditingRow = useCallback(
    async (currentResult: SingleResultState): Promise<boolean> => {
      if (hasUnsavedModifications(currentResult)) return saveCurrentRow(tabId)
      discardCurrentRow(tabId)
      return true
    },
    [discardCurrentRow, saveCurrentRow, tabId]
  )

  const handleForeignKeyLookup = useCallback(
    async (args: FkLookupArgs) => {
      const resolved = resolveResultForeignKey(args.columnKey)
      if (!resolved || !editMode) return

      const { sourceColumnName, foreignKey } = resolved
      const rowIndex = rowIndexFromRowData(args.rowData)
      const currentActiveResult = getActiveResult(useQueryStore.getState().tabs[tabId])
      const currentEditingRow = currentActiveResult.editingRowIndex

      const isEditingOtherRow = currentEditingRow !== null && currentEditingRow !== rowIndex
      if (isEditingOtherRow) {
        const canSwitchRows = await leaveCurrentEditingRow(currentActiveResult)
        if (!canSwitchRows) return
      }
      if (currentEditingRow !== rowIndex) {
        const lookupRow = await resolveLookupRow(args.rowData, currentActiveResult.columns.length, {
          tabId: tabId,
          resultIndex: activeResultIndex,
          rowIndex: rowIndex,
        })
        startEditingRow(tabId, rowIndex, lookupRow)
      }

      handleRowSelected(rowIndex)

      setForeignKeyLookupContext({
        columnKey: args.columnKey,
        sourceColumn: sourceColumnName,
        currentValue: args.currentValue,
        foreignKey: foreignKey,
        rowData: args.rowData,
      })
      setForeignKeyLookupOpen(true)
    },
    [
      resolveResultForeignKey,
      editMode,
      tabId,
      activeResultIndex,
      leaveCurrentEditingRow,
      handleRowSelected,
      startEditingRow,
      setForeignKeyLookupOpen,
    ]
  )

  const handleForeignKeyApply = useCallback(
    (selectedValue: unknown) => {
      if (!foreignKeyLookupContext) return

      const rowIndex = rowIndexFromRowData(foreignKeyLookupContext.rowData)
      const resultColumnIndex = columnIndexFromKey(foreignKeyLookupContext.columnKey)
      if (resultColumnIndex < 0) {
        setForeignKeyLookupOpen(false)
        return
      }

      const currentTab = useQueryStore.getState().tabs[tabId]
      const currentActiveResult = getActiveResult(currentTab)
      const currentEdit = currentActiveResult.editState
      const sameRow = currentEdit && editingRowIndex === rowIndex

      if (
        selectedValue === foreignKeyLookupContext.currentValue &&
        (!sameRow || currentEdit.modifiedColumns.size === 0)
      ) {
        handleRowSelected(rowIndex)
        setForeignKeyLookupOpen(false)
        return
      }

      if (!sameRow) {
        startEditingRow(
          tabId,
          rowIndex,
          cachedRowFromRowData(foreignKeyLookupContext.rowData, columns.length) ?? undefined
        )
      }

      syncCellValue(tabId, resultColumnIndex, selectedValue)
      handleRowSelected(rowIndex)
      setForeignKeyLookupOpen(false)
    },
    [
      columns.length,
      foreignKeyLookupContext,
      tabId,
      editingRowIndex,
      handleRowSelected,
      startEditingRow,
      syncCellValue,
      setForeignKeyLookupOpen,
    ]
  )

  const displayStatus = resolveDisplayStatus({
    tabStatus: tabStatus,
    rowResidencyStatus: rowResidencyStatus,
    resultStatus: resultStatus,
  })
  const cloneVisible = editMode !== null
  const cloneDisabled = isCloneDisabled({
    result: activeResult,
    displayStatus: displayStatus,
    editTableColumns: editTableColumns,
    primaryKey: primaryKey,
  })
  const gridTabPanelClassName = gridTabPanelClassNameFor(viewMode, columns.length)
  const resultPanelId = `result-tabpanel-${tabId}-${activeResultIndex}`
  const showsSubTabs = hasVisibleSubTabs(hideSubTabs, results.length)
  const resultPanelLabelledBy = subTabLabelledBy(showsSubTabs, tabId, activeResultIndex)
  const tabPanelAttributes = resultTabPanelAttributes(
    hideSubTabs,
    resultPanelId,
    resultPanelLabelledBy
  )

  const isFiltered = filterModel.length > 0
  const isTabRunning = tabStatus === 'running'

  /** Truncation notice, then the window / view failure band (wireframes 1, 1b and 2). */
  const renderBands = () => {
    const showTruncation = truncated
    const showWindowFailure = failedWindowRange !== null
    const showViewError = viewError !== null
    if (!showTruncation && !showWindowFailure && !showViewError) return null
    return (
      <div className={styles.bandSlot} data-testid="result-band-slot">
        {showTruncation && (
          <InfoBar
            severity="warning"
            polite
            title={`Showing the first ${formatCount(rowCeiling)} rows`}
            message={TRUNCATION_MESSAGES[fullExportBlockedReason ?? 'none']}
            actions={
              fullExportBlockedReason === null ? (
                <Button
                  size="sm"
                  onClick={handleExportAllRows}
                  disabled={isTabRunning}
                  title={isTabRunning ? 'Wait for the query to finish.' : undefined}
                  data-testid="truncation-export-all"
                >
                  Export all rows…
                </Button>
              ) : undefined
            }
            data-testid="result-truncation-band"
          />
        )}
        {showViewError ? (
          <InfoBar
            severity="error"
            title="Couldn't apply sort or filter"
            message={viewError}
            actions={
              <Button
                size="sm"
                onClick={() => retryViewChange(tabId)}
                data-testid="view-error-retry"
              >
                Retry
              </Button>
            }
            data-testid="result-view-error-band"
          />
        ) : (
          showWindowFailure && (
            <InfoBar
              severity="error"
              title={`Couldn't load rows ${formatRowRange(
                failedWindowRange[0] + 1,
                failedWindowRange[1]
              )}`}
              message="Retry to load these rows."
              actions={
                <Button
                  size="sm"
                  onClick={() => retryResultWindow(tabId)}
                  data-testid="window-error-retry"
                >
                  Retry
                </Button>
              }
              data-testid="result-window-error-band"
            />
          )
        )}
      </div>
    )
  }

  const renderResultBody = (className: string) => (
    <div {...tabPanelAttributes} className={className} aria-busy={displayStatus === 'restoring'}>
      <ResultToolbar
        tabId={tabId}
        connectionId={connectionId}
        filterModel={filterModel}
        onFilterClick={() => setIsFilterDialogOpen(true)}
        onClearFilterClick={handleClearFilter}
        isEditingActive={isEditingActive}
        isCloneVisible={cloneVisible}
        isCloneDisabled={cloneDisabled}
      />
      {columns.length > 0 && renderBands()}
      {columns.length > 0 ? (
        <FkLookupProvider onFkLookup={handleForeignKeyLookup}>
          {viewMode === 'grid' && (
            <ResultGridView
              // Remount per result so the grid's internal checkbox selection
              // doesn't leak between result sub-tabs.
              key={activeResultIndex}
              columns={columns}
              resultIndex={activeResultIndex}
              queryId={queryId}
              viewRowCount={viewRowCount}
              viewVersion={viewVersion}
              draftRow={draftRow}
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSortChanged={handleSortChanged}
              onRowSelected={handleRowSelected}
              selectedRowIndex={selectedRowIndex}
              tabId={tabId}
              editMode={editMode}
              editableColumnMap={editableColumnMap}
              editColumnBindings={editColumnBindings}
              editState={editState}
              editingRowIndex={editingRowIndex}
              editingBaseIndex={editingBaseIndex}
              editTableColumns={editTableColumns}
              editForeignKeys={editForeignKeys}
              onStartEditing={handleStartEditing}
              onUpdateCellValue={handleUpdateCellValue}
              onSyncCellValue={handleSyncCellValue}
              onAutoSave={handleAutoSave}
              rowActions={gridRowActions}
              isActive={isActive}
            />
          )}
          {viewMode === 'form' && (
            <ResultFormView
              columns={columns}
              resultIndex={activeResultIndex}
              queryId={queryId}
              viewVersion={viewVersion}
              viewRowCount={viewRowCount}
              draftRow={draftRow}
              selectedRowIndex={selectedRowIndex}
              onNavigate={handleFormNavigate}
              tabId={tabId}
              editMode={editMode}
              editableColumnMap={editableColumnMap}
              editColumnBindings={editColumnBindings}
              editState={editState}
              editingRowIndex={editingRowIndex}
              editTableColumns={editTableColumns}
              editForeignKeys={editForeignKeys}
              onStartEdit={handleStartEditing}
              onUpdateCell={handleUpdateCellValue}
              onSaveRow={handleFormSave}
              onDiscardRow={handleFormDiscard}
            />
          )}
          {viewMode === 'text' && (
            <ResultTextView
              columns={columns}
              tabId={tabId}
              resultIndex={activeResultIndex}
              queryId={queryId}
              viewVersion={viewVersion}
              viewRowCount={viewRowCount}
              truncated={truncated}
              isFiltered={isFiltered}
            />
          )}
        </FkLookupProvider>
      ) : (
        <div className={styles.infoBody}>
          <InfoBar
            severity="success"
            title="Query OK"
            message={dmlSuccessMessage(affectedRows)}
            data-testid="dml-success"
          />
        </div>
      )}
    </div>
  )

  const renderErrorBody = () => (
    <div {...tabPanelAttributes} className={styles.tabPanel}>
      <ResultToolbar
        tabId={tabId}
        connectionId={connectionId}
        filterModel={filterModel}
        onFilterClick={() => setIsFilterDialogOpen(true)}
        onClearFilterClick={handleClearFilter}
        isEditingActive={isEditingActive}
        isCloneVisible={cloneVisible}
        isCloneDisabled={true}
      />
      <div className={styles.infoBody}>
        <InfoBar
          severity="error"
          title="Query failed"
          message={activeResult.errorMessage}
          data-testid="result-error"
        />
      </div>
    </div>
  )

  const handleRetryExpired = useCallback(() => {
    void retryExpiredResult(tabId)
  }, [retryExpiredResult, tabId])

  const foreignKeyLookupTarget = resolveForeignKeyLookupTarget({
    isOpen: foreignKeyLookupOpen,
    context: foreignKeyLookupContext,
    editMode: editMode,
    editTable: editTable,
  })
  const subTabs = showsSubTabs ? <ResultSubTabs tabId={tabId} /> : null
  const renderStatusView = (): ReactNode => {
    if (displayStatus === 'idle') return <EmptyResultState isRunning={false} />
    if (displayStatus === 'running') return <EmptyResultState isRunning={true} />
    if (displayStatus === 'error') {
      return (
        <>
          {subTabs}
          {renderErrorBody()}
        </>
      )
    }
    return (
      <>
        {subTabs}
        {renderResultBody(gridTabPanelClassName)}
        <ResultActivityOverlay displayStatus={displayStatus} isSorting={isSorting} />
      </>
    )
  }

  return (
    <div
      className={styles.container}
      data-testid="result-panel"
      aria-busy={displayStatus === 'restoring'}
    >
      <div role="status" aria-live="polite" aria-atomic="true" data-testid="expired-status">
        {shouldShowExpiredState(isExpired, displayStatus) && (
          <ExpiredResultState
            isRestoring={displayStatus === 'restoring'}
            onRetry={handleRetryExpired}
          />
        )}
      </div>

      {!isExpired && renderStatusView()}

      {exportDialogOpen && (
        <ExportDialog
          connectionId={connectionId}
          tabId={tabId}
          resultIndex={activeResultIndex}
          onClose={() => closeExportDialog(tabId)}
        />
      )}

      <FilterDialog
        isOpen={isFilterDialogOpen}
        initialConditions={filterDialogInitialConditions}
        columns={filterColumns}
        onApply={handleFilterApply}
        onCancel={() => setIsFilterDialogOpen(false)}
      />

      {pendingNavigationAction !== null && (
        <UnsavedChangesDialog
          tabId={tabId}
          onSave={handleDialogSave}
          onDiscard={handleDialogDiscard}
          onCancel={handleDialogCancel}
          error={saveError}
        />
      )}

      {foreignKeyLookupTarget && (
        <FkLookupDialog
          isOpen={foreignKeyLookupOpen}
          onClose={() => setForeignKeyLookupOpen(false)}
          onApply={handleForeignKeyApply}
          connectionId={connectionId}
          database={foreignKeyLookupTarget.database}
          sourceTable={foreignKeyLookupTarget.sourceTable}
          sourceColumn={foreignKeyLookupTarget.context.sourceColumn}
          currentValue={foreignKeyLookupTarget.context.currentValue}
          referencedTable={foreignKeyLookupTarget.context.foreignKey.referencedTable}
          referencedColumn={foreignKeyLookupTarget.context.foreignKey.referencedColumn}
          isReadOnly={false}
        />
      )}
    </div>
  )
}
