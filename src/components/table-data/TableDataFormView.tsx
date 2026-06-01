/**
 * TableDataFormView — thin wrapper around BaseFormView for the table data browser.
 *
 * Reads from useTableDataStore + useConnectionStore, adapts the rich store
 * state into the shared BaseFormViewProps shape, and delegates all rendering
 * to BaseFormView.  Toast notifications and temporal-validation on save live
 * here (BaseFormView is store-free and toast-free).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTableDataStore, isSameRowKey } from '../../stores/table-data-store'
import { useConnectionStore } from '../../stores/connection-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useToastStore } from '../../stores/toast-store'
import { getTemporalValidationResult } from '../../lib/table-data-save-utils'
import { buildForeignKeyLookup } from '../../lib/foreign-key-utils'
import { BaseFormView } from '../shared/BaseFormView'
import { FkLookupProvider, type FkLookupArgs } from '../shared/fk-lookup-context'
import { FkLookupDialog } from './FkLookupDialog'
import { BlobViewerDialog } from '../dialogs/BlobViewerDialog'
import { fetchBlobValue } from '../../lib/table-data-commands'
import { buildEnvelopedPkPairs } from '../../lib/blob-utils'
import type {
  GridColumnDescriptor,
  RowEditState as SharedRowEditState,
} from '../../types/shared-data-view'
import type { BlobEnvelope, ForeignKeyColumnInfo, TableDataColumnMeta } from '../../types/schema'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a PK-based row key from a positional row array. */
function getRowKeyFromArray(
  row: unknown[],
  columns: TableDataColumnMeta[],
  pkColumns: string[]
): Record<string, unknown> {
  const key: Record<string, unknown> = {}
  for (const pkCol of pkColumns) {
    const idx = columns.findIndex((c) => c.name === pkCol)
    if (idx !== -1) {
      key[pkCol] = row[idx]
    }
  }
  return key
}

/** Build a values map from a positional row array and column metadata. */
function rowToValues(row: unknown[], columns: TableDataColumnMeta[]): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (let i = 0; i < columns.length; i++) {
    values[columns[i].name] = row[i]
  }
  return values
}

function escapeForAttributeSelector(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/(["\\])/g, '\\$1')
}

// ---------------------------------------------------------------------------
// Column adapter
// ---------------------------------------------------------------------------

/** Convert TableDataColumnMeta[] → GridColumnDescriptor[]. */
function toGridColumns(columns: TableDataColumnMeta[]): GridColumnDescriptor[] {
  return columns.map((col) => ({
    key: col.name,
    displayName: col.name,
    dataType: col.dataType,
    editable: true, // BaseFormView further restricts with hasEditCapability && !isBlobField
    isBinary: col.isBinary,
    isNullable: col.isNullable,
    isPrimaryKey: col.isPrimaryKey,
    isUniqueKey: col.isUniqueKey && !col.isPrimaryKey,
    enumValues: col.enumValues,
    tableColumnMeta: col,
  }))
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface TableDataFormViewProps {
  tabId: string
  isView?: boolean
  isActive?: boolean
}

export function TableDataFormView({ tabId, isView, isActive = true }: TableDataFormViewProps) {
  const tabState = useTableDataStore((state) => state.tabs[tabId])
  const startEditing = useTableDataStore((state) => state.startEditing)
  const updateCellValue = useTableDataStore((state) => state.updateCellValue)
  const saveCurrentRow = useTableDataStore((state) => state.saveCurrentRow)
  const discardCurrentRow = useTableDataStore((state) => state.discardCurrentRow)
  const requestNavigationAction = useTableDataStore((state) => state.requestNavigationAction)
  const fetchPage = useTableDataStore((state) => state.fetchPage)
  const setSelectedRow = useTableDataStore((state) => state.setSelectedRow)
  const stageBlobEnvelope = useTableDataStore((state) => state.stageBlobEnvelope)
  const setBlockingNavigation = useWorkspaceStore((state) => state.setBlockingNavigation)

  // Connection read-only check
  const connectionId = tabState?.connectionId ?? ''
  const activeConnection = useConnectionStore((state) => state.activeConnections[connectionId])
  const isConnectionReadOnly = activeConnection?.profile?.readOnly ?? false

  const columns = useMemo(() => tabState?.columns ?? [], [tabState?.columns])
  const rows = useMemo(() => tabState?.rows ?? [], [tabState?.rows])
  const currentPage = tabState?.currentPage ?? 1
  const pageSize = tabState?.pageSize ?? 1000
  const primaryKey = tabState?.primaryKey ?? null
  const storeEditState = tabState?.editState ?? null
  const selectedRowKey = tabState?.selectedRowKey ?? null
  const isLoading = tabState?.isLoading ?? false
  const foreignKeys = useMemo(() => tabState?.foreignKeys ?? [], [tabState?.foreignKeys])
  const foreignKeyLookup = useMemo(() => buildForeignKeyLookup(foreignKeys), [foreignKeys])

  const [fkLookupOpen, setFkLookupOpen] = useState(false)
  const [fkLookupContext, setFkLookupContext] = useState<{
    columnKey: string
    currentValue: unknown
    foreignKey: ForeignKeyColumnInfo
    rowData: Record<string, unknown>
  } | null>(null)

  const [blobDialogOpen, setBlobDialogOpen] = useState(false)
  const [blobContext, setBlobContext] = useState<{
    columnKey: string
    rowData: Record<string, unknown>
    pkPairs: [string, unknown][] | null
  } | null>(null)

  const hasPk = primaryKey !== null
  const isEditable = !isConnectionReadOnly && hasPk && !isView
  const pkColumns = useMemo(() => primaryKey?.keyColumns ?? [], [primaryKey?.keyColumns])

  // --- Grid columns (stable) ---
  const gridColumns = useMemo(
    () =>
      toGridColumns(columns).map((col) => ({
        ...col,
        foreignKey: foreignKeyLookup.get(col.key.toLowerCase()),
      })),
    [columns, foreignKeyLookup]
  )

  // --- Find local index of selected row ---
  const localIndex = useMemo(() => {
    if (!selectedRowKey || rows.length === 0) return 0
    // Handle temp rows (new row insert): selectedRowKey = { __tempId: 'temp-...' }
    // New rows are always appended at the end of the rows array
    if ('__tempId' in selectedRowKey) {
      return rows.length - 1
    }
    const idx = rows.findIndex((row) => {
      const key = getRowKeyFromArray(row, columns, pkColumns)
      return isSameRowKey(key, selectedRowKey)
    })
    return idx >= 0 ? idx : 0
  }, [selectedRowKey, rows, columns, pkColumns])

  const absoluteIndex = (currentPage - 1) * pageSize + localIndex
  // Use effectiveTotalRows so temp rows are counted in the display total
  const currentRow = rows.length > 0 ? rows[localIndex] : null

  // Current row key (for edit-state matching)
  const currentRowKey = useMemo(() => {
    if (storeEditState?.isNewRow) return storeEditState.rowKey
    if (!currentRow || pkColumns.length === 0) return null
    return getRowKeyFromArray(currentRow, columns, pkColumns)
  }, [storeEditState, currentRow, columns, pkColumns])

  // Is the current row being edited?
  const isEditingCurrentRow = useMemo(() => {
    if (!storeEditState || !currentRowKey) return false
    return isSameRowKey(storeEditState.rowKey, currentRowKey)
  }, [storeEditState, currentRowKey])

  const currentRowData = useMemo(() => {
    if (!currentRow) return null

    const rowData: Record<string, unknown> = {}
    for (let i = 0; i < columns.length; i++) {
      rowData[columns[i].name] = currentRow[i] ?? null
    }

    if (storeEditState && isEditingCurrentRow) {
      rowData.__editingRowKey = storeEditState.rowKey
      for (const [columnName, value] of Object.entries(storeEditState.currentValues)) {
        rowData[columnName] = value
      }
    }

    return rowData
  }, [currentRow, columns, storeEditState, isEditingCurrentRow])

  // --- Adapt store RowEditState → shared RowEditState ---
  const sharedEditState: SharedRowEditState | null = useMemo(() => {
    if (!storeEditState || !isEditingCurrentRow) return null
    return {
      rowKey: JSON.stringify(storeEditState.rowKey),
      currentValues: storeEditState.currentValues,
      originalValues: storeEditState.originalValues,
    }
  }, [storeEditState, isEditingCurrentRow])

  // --- Navigation boundary flags ---
  // Fold isLoading into the first flag so BaseFormView disables buttons
  const isFirstRecord = (currentPage === 1 && localIndex === 0) || isLoading

  // --- Navigation handlers ---
  const navigateRelative = useCallback(
    (direction: -1 | 1) => {
      if (!tabState || isLoading) return

      if (direction < 0 && currentPage === 1 && localIndex === 0) return

      const action = async () => {
        const isForwardCrossPage = direction > 0 && localIndex === rows.length - 1
        const isBackwardCrossPage = direction < 0 && localIndex === 0 && currentPage > 1

        if (isForwardCrossPage) {
          await fetchPage(tabId, currentPage + 1)
          const updatedState = useTableDataStore.getState().tabs[tabId]
          const targetRow = updatedState?.rows[0]

          if (updatedState && targetRow) {
            const newKey = getRowKeyFromArray(targetRow, updatedState.columns, pkColumns)
            setSelectedRow(tabId, newKey)
          }

          return
        }

        if (isBackwardCrossPage) {
          await fetchPage(tabId, currentPage - 1)
          const updatedState = useTableDataStore.getState().tabs[tabId]
          const targetRow = updatedState?.rows[updatedState.rows.length - 1]

          if (updatedState && targetRow) {
            const newKey = getRowKeyFromArray(targetRow, updatedState.columns, pkColumns)
            setSelectedRow(tabId, newKey)
          }

          return
        }

        const newAbsoluteIndex = absoluteIndex + direction
        const newLocalIndex = ((newAbsoluteIndex % pageSize) + pageSize) % pageSize
        const updatedState = useTableDataStore.getState().tabs[tabId]
        if (updatedState && updatedState.rows.length > 0) {
          const targetIndex = Math.min(newLocalIndex, updatedState.rows.length - 1)
          const targetRow = updatedState.rows[targetIndex]
          if (targetRow) {
            const newKey = getRowKeyFromArray(targetRow, updatedState.columns, pkColumns)
            setSelectedRow(tabId, newKey)
          }
        }
      }

      requestNavigationAction(tabId, action)
    },
    [
      tabState,
      isLoading,
      localIndex,
      rows.length,
      absoluteIndex,
      currentPage,
      pageSize,
      tabId,
      fetchPage,
      pkColumns,
      setSelectedRow,
      requestNavigationAction,
    ]
  )

  const onNavigatePrev = useCallback(() => navigateRelative(-1), [navigateRelative])
  const onNavigateNext = useCallback(() => navigateRelative(1), [navigateRelative])

  // --- Editing callbacks ---

  /** Shared logic: if the current row is editable and not already being edited, start editing. */
  const ensureEditingCurrentRow = useCallback(() => {
    if (!isEditable || !currentRow || !currentRowKey) return
    if (storeEditState && isSameRowKey(storeEditState.rowKey, currentRowKey)) return
    const values = rowToValues(currentRow, columns)
    startEditing(tabId, currentRowKey, values)
  }, [isEditable, currentRow, currentRowKey, storeEditState, columns, startEditing, tabId])

  const onEnsureEditing = useCallback(() => {
    ensureEditingCurrentRow()
  }, [ensureEditingCurrentRow])

  const onUpdateCell = useCallback(
    (columnKey: string, value: unknown) => {
      if (!currentRow || !currentRowKey) return
      // Ensure editing is started before updating
      ensureEditingCurrentRow()
      updateCellValue(tabId, columnKey, value)
    },
    [currentRow, currentRowKey, ensureEditingCurrentRow, updateCellValue, tabId]
  )

  // --- Save / Discard with toast feedback ---
  const showError = useToastStore((s) => s.showError)
  const showSuccess = useToastStore((s) => s.showSuccess)

  const onSave = useCallback(async () => {
    // Temporal validation uses the store's RowEditState (with modifiedColumns)
    const validationError = getTemporalValidationResult(storeEditState, columns)
    if (validationError) {
      showError('Invalid date value', `${validationError.columnName}: ${validationError.error}`)
      // Focus the problematic field
      const input = document.querySelector(
        `[data-testid="form-input-${escapeForAttributeSelector(validationError.columnName)}"]`
      ) as HTMLElement
      input?.focus()
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
  }, [saveCurrentRow, tabId, storeEditState, columns, showError, showSuccess])

  const onDiscard = useCallback(() => {
    discardCurrentRow(tabId)
  }, [discardCurrentRow, tabId])

  const onFkLookup = useCallback(
    async (args: FkLookupArgs) => {
      if (!isActive) return
      if (!currentRowKey) return

      if (storeEditState && !isSameRowKey(storeEditState.rowKey, currentRowKey)) {
        await saveCurrentRow(tabId)
        const refreshedState = useTableDataStore.getState().tabs[tabId]
        if (refreshedState?.saveError) return
      }

      setSelectedRow(tabId, currentRowKey)
      setFkLookupContext({
        columnKey: args.columnKey,
        currentValue: args.currentValue,
        foreignKey: args.foreignKey,
        rowData: args.rowData,
      })
      setFkLookupOpen(true)
    },
    [isActive, currentRowKey, storeEditState, saveCurrentRow, tabId, setSelectedRow]
  )

  const closeFkLookup = useCallback(() => {
    setFkLookupOpen(false)
    setFkLookupContext(null)
  }, [])

  useEffect(() => {
    setBlockingNavigation(tabId, fkLookupOpen)
    return () => setBlockingNavigation(tabId, false)
  }, [fkLookupOpen, setBlockingNavigation, tabId])

  useEffect(() => {
    if (isActive) return
    queueMicrotask(closeFkLookup)
  }, [closeFkLookup, isActive])

  const onFkApply = useCallback(
    (selectedValue: unknown) => {
      if (!fkLookupContext || !currentRowKey || !currentRowData) return

      const currentEdit = useTableDataStore.getState().tabs[tabId]?.editState
      const alreadyEditing = currentEdit && isSameRowKey(currentEdit.rowKey, currentRowKey)

      if (
        selectedValue === fkLookupContext.currentValue &&
        (!alreadyEditing || currentEdit.modifiedColumns.size === 0)
      ) {
        closeFkLookup()
        return
      }

      if (!alreadyEditing) {
        ensureEditingCurrentRow()
      }

      updateCellValue(tabId, fkLookupContext.columnKey, selectedValue)
      useTableDataStore
        .getState()
        .syncCellValue(
          tabId,
          currentRowData,
          fkLookupContext.columnKey,
          selectedValue,
          currentRowKey
        )
      closeFkLookup()
    },
    [
      fkLookupContext,
      currentRowKey,
      currentRowData,
      tabId,
      ensureEditingCurrentRow,
      updateCellValue,
      closeFkLookup,
    ]
  )

  // --- BLOB view/edit ---
  // The viewer can only fetch real bytes when the current row has a resolvable
  // primary key. Without one (read-only connection or PK-less table) the grid
  // holds only the placeholder, so the affordance is disabled rather than
  // opening a dialog that would falsely report the value as NULL.
  const canResolveBlobPk = isEditable && pkColumns.length > 0
  const onBlobView = useCallback(
    (column: GridColumnDescriptor, rowData: Record<string, unknown> | null) => {
      if (!rowData || !canResolveBlobPk) return
      const converted = buildEnvelopedPkPairs(pkColumns, columns, rowData)
      if (!converted.ok) {
        showError('Could not open BLOB viewer', converted.error)
        return
      }
      setBlobContext({ columnKey: column.key, rowData, pkPairs: converted.pairs })
      setBlobDialogOpen(true)
    },
    [canResolveBlobPk, pkColumns, columns, showError]
  )

  const closeBlobDialog = useCallback(() => {
    setBlobDialogOpen(false)
    setBlobContext(null)
  }, [])

  const blobLoader = useCallback(() => {
    if (!blobContext?.pkPairs || !tabState) {
      throw new Error('Cannot load BLOB without a resolvable primary key')
    }
    return fetchBlobValue(
      tabState.connectionId,
      tabState.database,
      tabState.table,
      blobContext.columnKey,
      blobContext.pkPairs
    )
  }, [blobContext, tabState])

  const onBlobApply = useCallback(
    (envelope: BlobEnvelope) => {
      if (!blobContext) return
      stageBlobEnvelope(tabId, blobContext.rowData, blobContext.columnKey, envelope)
    },
    [blobContext, stageBlobEnvelope, tabId]
  )

  // --- Render ---
  return (
    <FkLookupProvider onFkLookup={onFkLookup}>
      <BaseFormView
        columns={gridColumns}
        currentRow={currentRow}
        currentRowData={currentRowData}
        recordCountMode="unknown"
        currentAbsoluteIndex={absoluteIndex}
        isFirstRecord={isFirstRecord}
        onNavigatePrev={onNavigatePrev}
        onNavigateNext={onNavigateNext}
        isLoading={isLoading}
        editState={sharedEditState}
        onEnsureEditing={onEnsureEditing}
        onUpdateCell={onUpdateCell}
        onSave={isEditable ? onSave : undefined}
        onDiscard={isEditable ? onDiscard : undefined}
        readOnly={!isEditable}
        testId="table-data-form-view"
        workspaceTabId={tabId}
        onBlobView={onBlobView}
        blobViewDisabled={!canResolveBlobPk}
        blobViewDisabledReason="Cannot view BLOB — table has no primary key"
      />
      {fkLookupOpen && fkLookupContext && tabState && (
        <FkLookupDialog
          isOpen={fkLookupOpen}
          onClose={closeFkLookup}
          onApply={onFkApply}
          connectionId={tabState.connectionId}
          database={fkLookupContext.foreignKey.referencedDatabase || tabState.database}
          sourceTable={tabState.table}
          sourceColumn={fkLookupContext.columnKey}
          currentValue={fkLookupContext.currentValue}
          referencedTable={fkLookupContext.foreignKey.referencedTable}
          referencedColumn={fkLookupContext.foreignKey.referencedColumn}
          isReadOnly={!isEditable}
        />
      )}
      {blobDialogOpen && blobContext && (
        <BlobViewerDialog
          isOpen={blobDialogOpen}
          onClose={closeBlobDialog}
          mode="edit"
          columnLabel={blobContext.columnKey}
          loader={blobLoader}
          onApply={onBlobApply}
        />
      )}
    </FkLookupProvider>
  )
}
