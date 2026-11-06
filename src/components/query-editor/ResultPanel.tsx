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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Play, ClockCountdown } from '@phosphor-icons/react'
import { useQueryStore, getActiveResult } from '../../stores/query-store'
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
  ColumnMeta,
  FilterCondition,
  ForeignKeyColumnInfo,
  TableDataColumnMeta,
} from '../../types/schema'
import { colIndexFromKey } from '../../lib/col-key-utils'
import { buildForeignKeyLookup } from '../../lib/foreign-key-utils'
import { buildInitialConditionsFromCell } from '../../lib/filter-utils'
import styles from './ResultPanel.module.css'

interface ResultPanelProps {
  tabId: string
  connectionId: string
  isActive?: boolean
  hideSubTabs?: boolean
}

const EMPTY_TABLE_COLUMNS: TableDataColumnMeta[] = []
const EMPTY_FOREIGN_KEYS: ForeignKeyColumnInfo[] = []
const EMPTY_RESULTS: readonly unknown[] = []
const EMPTY_COLUMNS: ColumnMeta[] = []
const EMPTY_FILTER_MODEL: FilterCondition[] = []
const EMPTY_EDITABLE_MAP = new Map<number, boolean>()
const EMPTY_BINDINGS = new Map<number, string>()
const EMPTY_BOUND_COLUMN_INDEX_MAP = new Map<string, number>()

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
  const requestNavigationAction = useQueryStore((s) => s.requestNavigationAction)
  const sortResults = useQueryStore((s) => s.sortResults)
  const setSelectedRow = useQueryStore((s) => s.setSelectedRow)
  const startEditingRow = useQueryStore((s) => s.startEditingRow)
  const updateCellValue = useQueryStore((s) => s.updateCellValue)
  const syncCellValue = useQueryStore((s) => s.syncCellValue)
  const saveCurrentRow = useQueryStore((s) => s.saveCurrentRow)
  const confirmNavigation = useQueryStore((s) => s.confirmNavigation)
  const cancelNavigation = useQueryStore((s) => s.cancelNavigation)
  const discardCurrentRow = useQueryStore((s) => s.discardCurrentRow)
  const closeExportDialog = useQueryStore((s) => s.closeExportDialog)
  const applyQueryFilters = useQueryStore((s) => s.applyQueryFilters)
  const retryExpiredResult = useQueryStore((s) => s.retryExpiredResult)
  const openExportDialog = useQueryStore((s) => s.openExportDialog)
  const retryResultWindow = useQueryStore((s) => s.retryResultWindow)
  const retryViewChange = useQueryStore((s) => s.retryViewChange)
  const beginRowAction = useQueryStore((s) => s.beginRowAction)
  const markResultsExpired = useQueryStore((s) => s.markResultsExpired)

  // Read from active result
  const resultStatus = activeResult.resultStatus
  const columns = (activeResult.columns ?? EMPTY_COLUMNS) as ColumnMeta[]
  const viewRowCount = activeResult.viewRowCount ?? 0
  const viewVersion = activeResult.viewVersion ?? 0
  const queryId = activeResult.queryId ?? null
  const draftRow = activeResult.draftRow ?? null
  const truncated = activeResult.truncated ?? false
  const rowCeiling = activeResult.rowCeiling ?? 0
  const fullExportBlockedReason = activeResult.fullExportBlockedReason ?? null
  const failedWindowRange = activeResult.failedWindowRange ?? null
  const viewError = activeResult.viewError ?? null
  const affectedRows = activeResult.affectedRows ?? 0
  const viewMode = activeResult.viewMode ?? 'grid'
  const sortColumn = activeResult.sortColumn ?? null
  const sortDirection = activeResult.sortDirection ?? null
  const selectedRowIndex = activeResult.selectedRowIndex ?? null
  const exportDialogOpen = activeResult.exportDialogOpen ?? false
  const isExpired = activeResult.isExpired ?? false
  const rowResidencyStatus = activeResult.rowResidency?.status ?? 'resident'
  const isSorting = activeResult.isSorting ?? false

  // Edit mode state from active result
  const editMode = activeResult.editMode ?? null
  const editableColumnMap = activeResult.editableColumnMap ?? EMPTY_EDITABLE_MAP
  const editColumnBindings = activeResult.editColumnBindings ?? EMPTY_BINDINGS
  const editBoundColumnIndexMap =
    activeResult.editBoundColumnIndexMap ?? EMPTY_BOUND_COLUMN_INDEX_MAP
  const editState = activeResult.editState ?? null
  const editingRowIndex = activeResult.editingRowIndex ?? null
  const editingBaseIndex = activeResult.editingBaseIndex ?? null
  const editForeignKeys = activeResult.editForeignKeys ?? EMPTY_FOREIGN_KEYS
  const saveError = activeResult.saveError ?? null
  const isAnalyzingQuery = activeResult.isAnalyzingQuery ?? false
  const primaryKey = editMode
    ? (activeResult.editTableMetadata?.[editMode]?.primaryKey ?? null)
    : null
  const editTableColumns =
    editMode && activeResult.editTableMetadata?.[editMode]?.columns
      ? activeResult.editTableMetadata[editMode].columns
      : EMPTY_TABLE_COLUMNS

  // Filter state
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false)
  const filterModel: FilterCondition[] = activeResult.filterModel ?? EMPTY_FILTER_MODEL
  const filterColumns = useMemo(() => columns.map((c) => c.name), [columns])
  const selectedCell = activeResult?.selectedCell ?? null

  const showSuccess = useToastStore((s) => s.showSuccess)

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
    [tabId, activeResultIndex, applyQueryFilters]
  )

  const handleClearFilter = useCallback(() => {
    applyQueryFilters(tabId, activeResultIndex, [])
    showSuccess('Filters cleared')
  }, [tabId, activeResultIndex, applyQueryFilters, showSuccess])

  // Determine if editing is active (used to disable filter buttons)
  const isEditingActive = activeResult?.editState !== null && activeResult?.editState !== undefined

  const [fkLookupOpen, setFkLookupOpen] = useState(false)
  const [fkLookupContext, setFkLookupContext] = useState<{
    columnKey: string
    sourceColumn: string
    currentValue: unknown
    foreignKey: ForeignKeyColumnInfo
    rowData: Record<string, unknown>
  } | null>(null)

  useEffect(() => {
    if (isActive) return
    queueMicrotask(() => {
      if (exportDialogOpen) closeExportDialog(tabId)
      setIsFilterDialogOpen(false)
      setFkLookupOpen(false)
      setFkLookupContext(null)
    })
  }, [closeExportDialog, exportDialogOpen, isActive, tabId])

  const resultForeignKeyLookup = useMemo(
    () => buildForeignKeyLookup(editForeignKeys),
    [editForeignKeys]
  )

  const resolveResultForeignKey = useCallback(
    (columnKey: string) => {
      const resultColumnIndex = colIndexFromKey(columnKey)
      if (resultColumnIndex < 0) return null
      const sourceColumnName = editColumnBindings.get(resultColumnIndex)
      if (!sourceColumnName) return null
      const foreignKey = resultForeignKeyLookup.get(sourceColumnName.toLowerCase())
      if (!foreignKey) return null
      return { sourceColumnName, foreignKey }
    },
    [editColumnBindings, resultForeignKeyLookup]
  )

  const handleFkLookup = useCallback(
    async (args: FkLookupArgs) => {
      const resolved = resolveResultForeignKey(args.columnKey)
      if (!resolved || !editMode) return

      const { sourceColumnName, foreignKey } = resolved

      const rowIndexRaw = args.rowData.__rowIdx
      const rowIndex = typeof rowIndexRaw === 'number' ? rowIndexRaw : 0

      const currentTab = useQueryStore.getState().tabs[tabId]
      const currentActiveResult = getActiveResult(currentTab)
      const currentEditingRow = currentActiveResult.editingRowIndex ?? null
      const currentEditState = currentActiveResult.editState ?? null

      // The lookup row may not be in the page cache (e.g. evicted): use the
      // row the grid handed over, or fetch it by view position.
      const resolveRow = async (): Promise<CachedRow | undefined> => {
        const fromGrid = cachedRowFromRowData(args.rowData, currentActiveResult.columns.length)
        if (fromGrid) return fromGrid
        try {
          const fetched = await readViewRange(tabId, activeResultIndex, [rowIndex, rowIndex + 1])
          return fetched[0]
        } catch (error) {
          logFrontend(
            'warn',
            `[result-panel] FK lookup could not load row ${rowIndex + 1}: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
          return undefined
        }
      }

      if (currentEditingRow !== null && currentEditingRow !== rowIndex) {
        if (currentEditState && currentEditState.modifiedColumns.size > 0) {
          const saveSucceeded = await saveCurrentRow(tabId)
          if (!saveSucceeded) return
        } else {
          discardCurrentRow(tabId)
        }

        startEditingRow(tabId, rowIndex, await resolveRow())
      } else if (currentEditingRow === null) {
        startEditingRow(tabId, rowIndex, await resolveRow())
      }

      handleRowSelected(rowIndex)

      setFkLookupContext({
        columnKey: args.columnKey,
        sourceColumn: sourceColumnName,
        currentValue: args.currentValue,
        foreignKey,
        rowData: args.rowData,
      })
      setFkLookupOpen(true)
    },
    [
      resolveResultForeignKey,
      editMode,
      tabId,
      activeResultIndex,
      saveCurrentRow,
      discardCurrentRow,
      handleRowSelected,
      startEditingRow,
    ]
  )

  const handleFkApply = useCallback(
    (selectedValue: unknown) => {
      if (!fkLookupContext) return

      const rowIndexRaw = fkLookupContext.rowData.__rowIdx
      const rowIndex = typeof rowIndexRaw === 'number' ? rowIndexRaw : 0
      const resultColumnIndex = colIndexFromKey(fkLookupContext.columnKey)
      if (resultColumnIndex < 0) {
        setFkLookupOpen(false)
        return
      }

      const currentTab = useQueryStore.getState().tabs[tabId]
      const currentActiveResult = getActiveResult(currentTab)
      const currentEdit = currentActiveResult.editState
      const sameRow = currentEdit && editingRowIndex === rowIndex

      if (
        selectedValue === fkLookupContext.currentValue &&
        (!sameRow || currentEdit.modifiedColumns.size === 0)
      ) {
        handleRowSelected(rowIndex)
        setFkLookupOpen(false)
        return
      }

      if (!sameRow) {
        startEditingRow(
          tabId,
          rowIndex,
          cachedRowFromRowData(fkLookupContext.rowData, columns.length) ?? undefined
        )
      }

      syncCellValue(tabId, resultColumnIndex, selectedValue)
      handleRowSelected(rowIndex)
      setFkLookupOpen(false)
    },
    [
      columns.length,
      fkLookupContext,
      tabId,
      editingRowIndex,
      handleRowSelected,
      startEditingRow,
      syncCellValue,
    ]
  )

  // Determine which status to show for the result area
  // Tab-level 'running' takes precedence; otherwise use active result's status
  const displayStatus =
    tabStatus === 'running'
      ? 'running'
      : rowResidencyStatus === 'restoring'
        ? 'restoring'
        : tabStatus === 'idle'
          ? 'idle'
          : resultStatus
  const cloneVisible = editMode !== null
  const selectedRowExists =
    selectedRowIndex !== null && selectedRowIndex >= 0 && selectedRowIndex < viewRowCount
  const selectedRowIsDraft = !!editState?.isNewRow && editingRowIndex === selectedRowIndex
  const hasBlockingPendingEdit =
    editState !== null && (editState.isNewRow || editState.modifiedColumns.size > 0)
  const hasInsertEligibleNonPrimaryCloneColumns =
    editMode !== null &&
    editTableColumns.some(
      (column) => !column.isPrimaryKey && editBoundColumnIndexMap.has(column.name.toLowerCase())
    )
  const cloneDisabled =
    !cloneVisible ||
    displayStatus !== 'success' ||
    isAnalyzingQuery ||
    viewMode === 'text' ||
    hasBlockingPendingEdit ||
    !selectedRowExists ||
    selectedRowIsDraft ||
    !primaryKey ||
    primaryKey.isUniqueKeyFallback ||
    !hasInsertEligibleNonPrimaryCloneColumns
  const gridTabPanelClassName =
    viewMode === 'grid' && columns.length > 0
      ? `${styles.tabPanel} ${styles.gridTabPanel}`
      : styles.tabPanel
  const resultPanelId = `result-tabpanel-${tabId}-${activeResultIndex}`
  const resultPanelLabelledBy =
    !hideSubTabs && results.length > 1 ? `result-tab-${tabId}-${activeResultIndex}` : undefined

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
    <div
      role={hideSubTabs ? undefined : 'tabpanel'}
      id={hideSubTabs ? undefined : resultPanelId}
      aria-labelledby={hideSubTabs ? undefined : resultPanelLabelledBy}
      className={className}
      aria-busy={displayStatus === 'restoring'}
    >
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
        <FkLookupProvider onFkLookup={handleFkLookup}>
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
            message={
              affectedRows > 0
                ? `${affectedRows} ${affectedRows === 1 ? 'row' : 'rows'} affected`
                : 'Query executed successfully'
            }
            data-testid="dml-success"
          />
        </div>
      )}
    </div>
  )

  const renderErrorBody = () => (
    <div
      role={hideSubTabs ? undefined : 'tabpanel'}
      id={hideSubTabs ? undefined : resultPanelId}
      aria-labelledby={hideSubTabs ? undefined : resultPanelLabelledBy}
      className={styles.tabPanel}
    >
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

  return (
    <div
      className={styles.container}
      data-testid="result-panel"
      aria-busy={displayStatus === 'restoring'}
    >
      <div role="status" aria-live="polite" aria-atomic="true" data-testid="expired-status">
        {isExpired && displayStatus !== 'running' && (
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
              onClick={handleRetryExpired}
              disabled={displayStatus === 'restoring'}
              style={{ marginTop: 8 }}
              data-testid="retry-expired-button"
            >
              Re-run query
            </Button>
          </div>
        )}
      </div>

      {!isExpired && displayStatus === 'idle' && (
        <div className={styles.emptyState}>
          <Play size={32} weight="duotone" className={styles.emptyIcon} />
          <span>Run a query to see results</span>
        </div>
      )}

      {!isExpired && displayStatus === 'running' && (
        <div className={styles.emptyState}>
          <div className={styles.spinner} />
          <span>Executing query...</span>
        </div>
      )}

      {!isExpired && displayStatus === 'restoring' && (
        <>
          {!hideSubTabs && results.length > 1 && <ResultSubTabs tabId={tabId} />}
          {renderResultBody(gridTabPanelClassName)}
          <div
            className={styles.restoringOverlay}
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-testid="query-result-restore-overlay"
          >
            <div className={styles.spinner} aria-hidden="true" />
            <span>Restoring cached results…</span>
          </div>
        </>
      )}

      {!isExpired && displayStatus === 'success' && (
        <>
          {!hideSubTabs && results.length > 1 && <ResultSubTabs tabId={tabId} />}
          {renderResultBody(gridTabPanelClassName)}
          {isSorting && (
            <div
              className={styles.restoringOverlay}
              role="status"
              aria-live="polite"
              aria-atomic="true"
              data-testid="query-result-sort-overlay"
            >
              <div className={styles.spinner} aria-hidden="true" />
              <span>Sorting…</span>
            </div>
          )}
        </>
      )}

      {!isExpired && displayStatus === 'error' && (
        <>
          {!hideSubTabs && results.length > 1 && <ResultSubTabs tabId={tabId} />}
          {renderErrorBody()}
        </>
      )}

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

      {fkLookupOpen && fkLookupContext && editMode && (
        <FkLookupDialog
          isOpen={fkLookupOpen}
          onClose={() => setFkLookupOpen(false)}
          onApply={handleFkApply}
          connectionId={connectionId}
          database={
            fkLookupContext.foreignKey.referencedDatabase ||
            activeResult.editTableMetadata?.[editMode]?.database ||
            ''
          }
          sourceTable={activeResult.editTableMetadata?.[editMode]?.table ?? editMode}
          sourceColumn={fkLookupContext.sourceColumn}
          currentValue={fkLookupContext.currentValue}
          referencedTable={fkLookupContext.foreignKey.referencedTable}
          referencedColumn={fkLookupContext.foreignKey.referencedColumn}
          isReadOnly={false}
        />
      )}
    </div>
  )
}
