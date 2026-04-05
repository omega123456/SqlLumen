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
 */

import { useCallback, useMemo, useState } from 'react'
import { Play, CheckCircle } from '@phosphor-icons/react'
import { useQueryStore } from '../../stores/query-store'
import { FkLookupProvider, type FkLookupArgs } from '../shared/fk-lookup-context'
import { FkLookupDialog } from '../table-data/FkLookupDialog'
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

  // Individual action selectors — stable references that never change,
  // unlike `useQueryStore()` which subscribes to all state and causes
  // every useCallback to get a new identity on each store update.
  const requestNavigationAction = useQueryStore((s) => s.requestNavigationAction)
  const sortResults = useQueryStore((s) => s.sortResults)
  const setSelectedRow = useQueryStore((s) => s.setSelectedRow)
  const fetchPage = useQueryStore((s) => s.fetchPage)
  const startEditingRow = useQueryStore((s) => s.startEditingRow)
  const updateCellValue = useQueryStore((s) => s.updateCellValue)
  const syncCellValue = useQueryStore((s) => s.syncCellValue)
  const saveCurrentRow = useQueryStore((s) => s.saveCurrentRow)
  const confirmNavigation = useQueryStore((s) => s.confirmNavigation)
  const cancelNavigation = useQueryStore((s) => s.cancelNavigation)
  const discardCurrentRow = useQueryStore((s) => s.discardCurrentRow)
  const closeExportDialog = useQueryStore((s) => s.closeExportDialog)

  const status = tabState?.status ?? 'idle'
  const columns = (tabState?.columns ?? []) as ColumnMeta[]
  const rows = (tabState?.rows ?? []) as unknown[][]
  const affectedRows = tabState?.affectedRows ?? 0
  const viewMode = tabState?.viewMode ?? 'grid'
  const sortColumn = tabState?.sortColumn ?? null
  const sortDirection = tabState?.sortDirection ?? null
  const selectedRowIndex = tabState?.selectedRowIndex ?? null
  const exportDialogOpen = tabState?.exportDialogOpen ?? false
  const totalRows = tabState?.totalRows ?? 0
  const currentPage = tabState?.currentPage ?? 1
  const totalPages = tabState?.totalPages ?? 1
  const pageSize = tabState?.pageSize ?? 1000

  // Edit mode state
  const editMode = tabState?.editMode ?? null
  const editableColumnMap = tabState?.editableColumnMap ?? new Map<number, boolean>()
  const editColumnBindings = tabState?.editColumnBindings ?? new Map<number, string>()
  const editState = tabState?.editState ?? null
  const editingRowIndex = tabState?.editingRowIndex ?? null
  const editForeignKeys = tabState?.editForeignKeys ?? EMPTY_FOREIGN_KEYS
  const pendingNavigationAction = tabState?.pendingNavigationAction ?? null
  const saveError = tabState?.saveError ?? null
  const editTableColumns =
    editMode && tabState?.editTableMetadata?.[editMode]?.columns
      ? tabState.editTableMetadata[editMode].columns
      : EMPTY_TABLE_COLUMNS

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
    (localRowIndex: number) => {
      // Convert page-local index to absolute index across the full result set
      const absoluteIndex = (currentPage - 1) * pageSize + localRowIndex
      setSelectedRow(tabId, absoluteIndex)
    },
    [setSelectedRow, tabId, currentPage, pageSize]
  )

  /**
   * Handle form-view record navigation (Previous / Next).
   *
   * Calculates the new absolute index, checks if a page change is needed,
   * fetches the new page if so, and always updates the selected row index.
   */
  const handleFormNavigate = useCallback(
    (direction: 'prev' | 'next') => {
      const currentIndex = selectedRowIndex ?? 0
      const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1

      // Bounds check
      if (newIndex < 0 || newIndex >= totalRows) return

      // Determine if we need a page change
      const pageStart = (currentPage - 1) * pageSize
      const pageEnd = pageStart + pageSize - 1

      if (newIndex < pageStart && currentPage > 1) {
        fetchPage(connectionId, tabId, currentPage - 1)
      } else if (newIndex > pageEnd && currentPage < totalPages) {
        fetchPage(connectionId, tabId, currentPage + 1)
      }

      setSelectedRow(tabId, newIndex)
    },
    [
      fetchPage,
      setSelectedRow,
      connectionId,
      tabId,
      selectedRowIndex,
      totalRows,
      currentPage,
      totalPages,
      pageSize,
    ]
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

  /**
   * Auto-save the current editing row. Returns true if save succeeded
   * (or nothing to save), false if save failed.
   */
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

  /**
   * Save the current editing row (form view). Returns true on success.
   */
  const handleFormSave = useCallback(async (): Promise<boolean> => {
    await saveCurrentRow(tabId)
    const tab = useQueryStore.getState().tabs[tabId]
    return !tab?.saveError
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

      const currentEditingRow = useQueryStore.getState().tabs[tabId]?.editingRowIndex ?? null
      const currentEditState = useQueryStore.getState().tabs[tabId]?.editState ?? null

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

      const currentEdit = useQueryStore.getState().tabs[tabId]?.editState
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

  return (
    <div className={styles.container} data-testid="result-panel">
      {status === 'idle' && (
        <div className={styles.emptyState}>
          <Play size={32} weight="duotone" className={styles.emptyIcon} />
          <span>Run a query to see results</span>
        </div>
      )}

      {status === 'running' && (
        <div className={styles.emptyState}>
          <div className={styles.spinner} />
          <span>Executing query...</span>
        </div>
      )}

      {status === 'success' && (
        <>
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
                  currentPage={currentPage}
                  pageSize={pageSize}
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
                  currentPage={currentPage}
                  totalPages={totalPages}
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
        </>
      )}

      {status === 'error' && (
        <>
          <ResultToolbar tabId={tabId} connectionId={connectionId} />
          <div className={styles.errorBody}>
            <span className={styles.errorMessage}>{tabState?.errorMessage}</span>
          </div>
        </>
      )}

      {exportDialogOpen && (
        <ExportDialog
          connectionId={connectionId}
          tabId={tabId}
          columnCount={columns.length}
          totalRows={totalRows}
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
            tabState?.editTableMetadata?.[editMode]?.database ||
            ''
          }
          sourceTable={tabState?.editTableMetadata?.[editMode]?.table ?? editMode}
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
