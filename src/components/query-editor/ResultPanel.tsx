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
 */

import { useCallback, useMemo, useState } from 'react'
import { Play, CheckCircle } from '@phosphor-icons/react'
import { useQueryStore, getActiveResult } from '../../stores/query-store'
import { FkLookupProvider, type FkLookupArgs } from '../shared/fk-lookup-context'
import { FkLookupDialog } from '../table-data/FkLookupDialog'
import { ResultSubTabs } from './ResultSubTabs'
import { ResultToolbar } from './ResultToolbar'
import { ResultGridView } from './ResultGridView'
import { ResultFormView } from './ResultFormView'
import { ResultTextView } from './ResultTextView'
import { UnsavedChangesDialog } from '../shared/UnsavedChangesDialog'
import ExportDialog from '../dialogs/ExportDialog'
import type { ColumnMeta, ForeignKeyColumnInfo, TableDataColumnMeta } from '../../types/schema'
import { colIndexFromKey } from '../../lib/col-key-utils'
import { buildForeignKeyLookup } from '../../lib/foreign-key-utils'
import styles from './ResultPanel.module.css'

interface ResultPanelProps {
  tabId: string
  connectionId: string
}

const EMPTY_TABLE_COLUMNS: TableDataColumnMeta[] = []
const EMPTY_FOREIGN_KEYS: ForeignKeyColumnInfo[] = []

export function ResultPanel({ tabId, connectionId }: ResultPanelProps) {
  const tabState = useQueryStore((state) => state.tabs[tabId])
  const activeResult = useQueryStore((state) => getActiveResult(state.tabs[tabId]))

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

  const tabStatus = tabState?.status ?? 'idle'
  const results = tabState?.results ?? []
  const activeResultIndex = tabState?.activeResultIndex ?? 0

  // Read from active result
  const resultStatus = activeResult.status
  const columns = (activeResult.columns ?? []) as ColumnMeta[]
  const rows = (activeResult.rows ?? []) as unknown[][]
  const affectedRows = activeResult.affectedRows ?? 0
  const viewMode = activeResult.viewMode ?? 'grid'
  const sortColumn = activeResult.sortColumn ?? null
  const sortDirection = activeResult.sortDirection ?? null
  const selectedRowIndex = activeResult.selectedRowIndex ?? null
  const exportDialogOpen = activeResult.exportDialogOpen ?? false
  const totalRows = activeResult.totalRows ?? 0

  // Edit mode state from active result
  const editMode = activeResult.editMode ?? null
  const editableColumnMap = activeResult.editableColumnMap ?? new Map<number, boolean>()
  const editColumnBindings = activeResult.editColumnBindings ?? new Map<number, string>()
  const editState = activeResult.editState ?? null
  const editingRowIndex = activeResult.editingRowIndex ?? null
  const editForeignKeys = activeResult.editForeignKeys ?? EMPTY_FOREIGN_KEYS
  const saveError = activeResult.saveError ?? null
  const editTableColumns =
    editMode && activeResult.editTableMetadata?.[editMode]?.columns
      ? activeResult.editTableMetadata[editMode].columns
      : EMPTY_TABLE_COLUMNS

  // Tab-level pending navigation
  const pendingNavigationAction = tabState?.pendingNavigationAction ?? null

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
   * Handle form-view record navigation (Previous / Next).
   * All rows are in a single page, so no page boundary logic needed.
   */
  const handleFormNavigate = useCallback(
    (direction: 'prev' | 'next') => {
      const currentIndex = selectedRowIndex ?? 0
      const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1

      // Bounds check
      if (newIndex < 0 || newIndex >= totalRows) return

      setSelectedRow(tabId, newIndex)
    },
    [setSelectedRow, tabId, selectedRowIndex, totalRows]
  )

  // --- Edit mode callbacks ---

  const handleStartEditing = useCallback(
    (rowIndex: number) => {
      startEditingRow(tabId, rowIndex)
    },
    [startEditingRow, tabId]
  )

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

  const [fkLookupOpen, setFkLookupOpen] = useState(false)
  const [fkLookupContext, setFkLookupContext] = useState<{
    columnKey: string
    sourceColumn: string
    currentValue: unknown
    foreignKey: ForeignKeyColumnInfo
    rowData: Record<string, unknown>
  } | null>(null)

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

      if (currentEditingRow !== null && currentEditingRow !== rowIndex) {
        if (currentEditState && currentEditState.modifiedColumns.size > 0) {
          const saveSucceeded = await saveCurrentRow(tabId)
          if (!saveSucceeded) return
        } else {
          discardCurrentRow(tabId)
        }

        startEditingRow(tabId, rowIndex)
      } else if (currentEditingRow === null) {
        startEditingRow(tabId, rowIndex)
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
        startEditingRow(tabId, rowIndex)
      }

      syncCellValue(tabId, resultColumnIndex, selectedValue)
      handleRowSelected(rowIndex)
      setFkLookupOpen(false)
    },
    [fkLookupContext, tabId, editingRowIndex, handleRowSelected, startEditingRow, syncCellValue]
  )

  // Determine which status to show for the result area
  // Tab-level 'running' takes precedence; otherwise use active result's status
  const displayStatus =
    tabStatus === 'running' ? 'running' : tabStatus === 'idle' ? 'idle' : resultStatus

  return (
    <div className={styles.container} data-testid="result-panel">
      {displayStatus === 'idle' && (
        <div className={styles.emptyState}>
          <Play size={32} weight="duotone" className={styles.emptyIcon} />
          <span>Run a query to see results</span>
        </div>
      )}

      {displayStatus === 'running' && (
        <div className={styles.emptyState}>
          <div className={styles.spinner} />
          <span>Executing query...</span>
        </div>
      )}

      {displayStatus === 'success' && (
        <>
          {results.length > 1 && <ResultSubTabs tabId={tabId} />}
          <div
            role="tabpanel"
            id={`result-tabpanel-${tabId}-${activeResultIndex}`}
            aria-labelledby={
              results.length > 1 ? `result-tab-${tabId}-${activeResultIndex}` : undefined
            }
            className={styles.tabPanel}
          >
            <ResultToolbar tabId={tabId} connectionId={connectionId} />
            {columns.length > 0 ? (
              <FkLookupProvider onFkLookup={handleFkLookup}>
                {viewMode === 'grid' && (
                  <ResultGridView
                    columns={columns}
                    rows={rows}
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
                    editTableColumns={editTableColumns}
                    editForeignKeys={editForeignKeys}
                    onStartEditing={handleStartEditing}
                    onUpdateCellValue={handleUpdateCellValue}
                    onSyncCellValue={handleSyncCellValue}
                    onAutoSave={handleAutoSave}
                  />
                )}
                {viewMode === 'form' && (
                  <ResultFormView
                    columns={columns}
                    rows={rows}
                    selectedRowIndex={selectedRowIndex}
                    totalRows={totalRows}
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
                {viewMode === 'text' && <ResultTextView columns={columns} rows={rows} />}
              </FkLookupProvider>
            ) : (
              <div className={styles.emptyState} data-testid="dml-success">
                <CheckCircle size={32} weight="duotone" className={styles.successIcon} />
                <span>
                  {affectedRows > 0
                    ? `Query executed: ${affectedRows} rows affected`
                    : 'Query executed successfully'}
                </span>
              </div>
            )}
          </div>
        </>
      )}

      {displayStatus === 'error' && (
        <>
          {results.length > 1 && <ResultSubTabs tabId={tabId} />}
          <div
            role="tabpanel"
            id={`result-tabpanel-${tabId}-${activeResultIndex}`}
            aria-labelledby={
              results.length > 1 ? `result-tab-${tabId}-${activeResultIndex}` : undefined
            }
            className={styles.tabPanel}
          >
            <ResultToolbar tabId={tabId} connectionId={connectionId} />
            <div className={styles.errorBody}>
              <span className={styles.errorMessage}>{activeResult.errorMessage}</span>
            </div>
          </div>
        </>
      )}

      {exportDialogOpen && (
        <ExportDialog
          connectionId={connectionId}
          tabId={tabId}
          columnCount={columns.length}
          totalRows={totalRows}
          resultIndex={activeResultIndex}
          onClose={() => closeExportDialog(tabId)}
        />
      )}

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
