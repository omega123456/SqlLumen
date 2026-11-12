/**
 * TableDataFormView — thin wrapper around BaseFormView for the table data browser.
 *
 * Reads from useTableDataStore + useConnectionStore, adapts the rich store
 * state into the shared BaseFormViewProps shape, and delegates all rendering
 * to BaseFormView.  Toast notifications and temporal-validation on save live
 * here (BaseFormView is store-free and toast-free).
 */

import { useCallback, useEffect, useMemo } from 'react'
import { useTableDataStore, isSameRowKey } from '../../stores/table-data-store'
import { useConnectionStore } from '../../stores/connection-store'
import { FALLBACK_ROW_LIMIT } from '../../stores/query-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { buildForeignKeyLookup } from '../../lib/foreign-key-utils'
import { BaseFormView } from '../shared/BaseFormView'
import { FkLookupProvider, type FkLookupArgs } from '../shared/fk-lookup-context'
import { BlobViewerTargetDialog, ForeignKeyLookupTargetDialog } from './TableDataCellDialogs'
import { useBlobViewerState } from './use-blob-viewer-state'
import { useFkLookupFlow } from './use-fk-lookup-flow'
import { saveCurrentRowWithFeedback } from './row-save-feedback'
import type {
  GridColumnDescriptor,
  RowEditState as SharedRowEditState,
} from '../../types/shared-data-view'
import type { TableDataColumnMeta } from '../../types/schema'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a PK-based row key from a positional row array. */
function getRowKeyFromArray(
  row: unknown[],
  columns: TableDataColumnMeta[],
  primaryKeyColumns: string[]
): Record<string, unknown> {
  const key: Record<string, unknown> = {}
  for (const primaryKeyColumn of primaryKeyColumns) {
    const index = columns.findIndex((column) => column.name === primaryKeyColumn)
    if (index !== -1) {
      key[primaryKeyColumn] = row[index]
    }
  }
  return key
}

/** Build a values map from a positional row array and column metadata. */
function rowToValues(row: unknown[], columns: TableDataColumnMeta[]): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
    values[columns[columnIndex].name] = row[columnIndex]
  }
  return values
}

function escapeForAttributeSelector(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/(["\\])/g, '\\$1')
}

function focusFormInput(columnName: string): void {
  const input = document.querySelector<HTMLElement>(
    `[data-testid="form-input-${escapeForAttributeSelector(columnName)}"]`
  )
  input?.focus()
}

// ---------------------------------------------------------------------------
// Column adapter
// ---------------------------------------------------------------------------

/** Convert TableDataColumnMeta[] → GridColumnDescriptor[]. */
function toGridColumns(columns: TableDataColumnMeta[]): GridColumnDescriptor[] {
  return columns.map((column) => ({
    key: column.name,
    displayName: column.name,
    dataType: column.dataType,
    editable: true, // BaseFormView further restricts with hasEditCapability && !isBlobField
    isBinary: column.isBinary,
    isNullable: column.isNullable,
    isPrimaryKey: column.isPrimaryKey,
    isUniqueKey: column.isUniqueKey && !column.isPrimaryKey,
    enumValues: column.enumValues,
    tableColumnMeta: column,
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
  const setBlockingNavigation = useWorkspaceStore((state) => state.setBlockingNavigation)

  // Connection read-only check
  const connectionId = tabState?.connectionId ?? ''
  const activeConnection = useConnectionStore((state) => state.activeConnections[connectionId])
  const isConnectionReadOnly = activeConnection?.profile?.readOnly ?? false

  const columns = useMemo(() => tabState?.columns ?? [], [tabState?.columns])
  const rows = useMemo(() => tabState?.rows ?? [], [tabState?.rows])
  const currentPage = tabState?.currentPage ?? 1
  const pageSize = tabState?.pageSize ?? FALLBACK_ROW_LIMIT
  const primaryKey = tabState?.primaryKey ?? null
  const storeEditState = tabState?.editState ?? null
  const selectedRowKey = tabState?.selectedRowKey ?? null
  const isLoading = tabState?.isLoading ?? false
  const foreignKeys = useMemo(() => tabState?.foreignKeys ?? [], [tabState?.foreignKeys])
  const foreignKeyLookup = useMemo(() => buildForeignKeyLookup(foreignKeys), [foreignKeys])

  const { foreignKeyLookupTarget, openForeignKeyLookup, closeForeignKeyLookup } = useFkLookupFlow()
  const isForeignKeyLookupOpen = foreignKeyLookupTarget !== null

  const hasPrimaryKey = primaryKey !== null
  const isEditable = !isConnectionReadOnly && hasPrimaryKey && !isView
  const primaryKeyColumns = useMemo(() => primaryKey?.keyColumns ?? [], [primaryKey?.keyColumns])
  const blobViewer = useBlobViewerState({
    tabId: tabId,
    columns: columns,
    primaryKeyColumns: primaryKeyColumns,
  })

  // --- Grid columns (stable) ---
  const gridColumns = useMemo(
    () =>
      toGridColumns(columns).map((column) => ({
        ...column,
        foreignKey: foreignKeyLookup.get(column.key.toLowerCase()),
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
    const index = rows.findIndex((row) => {
      const key = getRowKeyFromArray(row, columns, primaryKeyColumns)
      return isSameRowKey(key, selectedRowKey)
    })
    return index >= 0 ? index : 0
  }, [selectedRowKey, rows, columns, primaryKeyColumns])

  const absoluteIndex = (currentPage - 1) * pageSize + localIndex
  const currentRow = rows.length > 0 ? rows[localIndex] : null

  // Current row key (for edit-state matching)
  const currentRowKey = useMemo(() => {
    if (storeEditState?.isNewRow) return storeEditState.rowKey
    if (!currentRow || primaryKeyColumns.length === 0) return null
    return getRowKeyFromArray(currentRow, columns, primaryKeyColumns)
  }, [storeEditState, currentRow, columns, primaryKeyColumns])

  // Is the current row being edited?
  const isEditingCurrentRow = useMemo(() => {
    if (!storeEditState || !currentRowKey) return false
    return isSameRowKey(storeEditState.rowKey, currentRowKey)
  }, [storeEditState, currentRowKey])

  const currentRowData = useMemo(() => {
    if (!currentRow) return null

    const rowData: Record<string, unknown> = {}
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
      rowData[columns[columnIndex].name] = currentRow[columnIndex] ?? null
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
            const newKey = getRowKeyFromArray(targetRow, updatedState.columns, primaryKeyColumns)
            setSelectedRow(tabId, newKey)
          }

          return
        }

        if (isBackwardCrossPage) {
          await fetchPage(tabId, currentPage - 1)
          const updatedState = useTableDataStore.getState().tabs[tabId]
          const targetRow = updatedState?.rows[updatedState.rows.length - 1]

          if (updatedState && targetRow) {
            const newKey = getRowKeyFromArray(targetRow, updatedState.columns, primaryKeyColumns)
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
            const newKey = getRowKeyFromArray(targetRow, updatedState.columns, primaryKeyColumns)
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
      primaryKeyColumns,
      setSelectedRow,
      requestNavigationAction,
    ]
  )

  const onNavigatePrevious = useCallback(() => navigateRelative(-1), [navigateRelative])
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

  const onSave = useCallback(async () => {
    const validationError = await saveCurrentRowWithFeedback({
      tabId: tabId,
      editState: storeEditState,
      columns: columns,
    })
    if (validationError) {
      focusFormInput(validationError.columnName)
    }
  }, [tabId, storeEditState, columns])

  const onDiscard = useCallback(() => {
    discardCurrentRow(tabId)
  }, [discardCurrentRow, tabId])

  const onForeignKeyLookup = useCallback(
    async (args: FkLookupArgs) => {
      if (!isActive) return
      if (!currentRowKey) return

      if (storeEditState && !isSameRowKey(storeEditState.rowKey, currentRowKey)) {
        await saveCurrentRow(tabId)
        const refreshedState = useTableDataStore.getState().tabs[tabId]
        if (refreshedState?.saveError) return
      }

      setSelectedRow(tabId, currentRowKey)
      openForeignKeyLookup(args)
    },
    [
      isActive,
      currentRowKey,
      storeEditState,
      saveCurrentRow,
      tabId,
      setSelectedRow,
      openForeignKeyLookup,
    ]
  )

  useEffect(() => {
    setBlockingNavigation(tabId, isForeignKeyLookupOpen)
    return () => setBlockingNavigation(tabId, false)
  }, [isForeignKeyLookupOpen, setBlockingNavigation, tabId])

  useEffect(() => {
    if (isActive) return
    queueMicrotask(closeForeignKeyLookup)
  }, [closeForeignKeyLookup, isActive])

  const onForeignKeyApply = useCallback(
    (selectedValue: unknown) => {
      if (!foreignKeyLookupTarget || !currentRowKey || !currentRowData) return

      const currentEdit = useTableDataStore.getState().tabs[tabId]?.editState
      const alreadyEditing = currentEdit && isSameRowKey(currentEdit.rowKey, currentRowKey)

      if (
        selectedValue === foreignKeyLookupTarget.currentValue &&
        (!alreadyEditing || currentEdit.modifiedColumns.size === 0)
      ) {
        closeForeignKeyLookup()
        return
      }

      if (!alreadyEditing) {
        ensureEditingCurrentRow()
      }

      updateCellValue(tabId, foreignKeyLookupTarget.columnKey, selectedValue)
      useTableDataStore
        .getState()
        .syncCellValue(
          tabId,
          currentRowData,
          foreignKeyLookupTarget.columnKey,
          selectedValue,
          currentRowKey
        )
      closeForeignKeyLookup()
    },
    [
      foreignKeyLookupTarget,
      currentRowKey,
      currentRowData,
      tabId,
      ensureEditingCurrentRow,
      updateCellValue,
      closeForeignKeyLookup,
    ]
  )

  // --- BLOB view/edit ---
  // The viewer can only fetch real bytes when the current row has a resolvable
  // primary key. Without one (read-only connection or PK-less table) the grid
  // holds only the placeholder, so the affordance is disabled rather than
  // opening a dialog that would falsely report the value as NULL.
  const canResolveBlobPrimaryKey = isEditable && primaryKeyColumns.length > 0
  const { openBlobViewer } = blobViewer
  const onBlobView = useCallback(
    (column: GridColumnDescriptor, rowData: Record<string, unknown> | null) => {
      if (!rowData || !canResolveBlobPrimaryKey) return
      openBlobViewer(column.key, rowData)
    },
    [canResolveBlobPrimaryKey, openBlobViewer]
  )

  // --- Render ---
  return (
    <FkLookupProvider onFkLookup={onForeignKeyLookup}>
      <BaseFormView
        columns={gridColumns}
        currentRow={currentRow}
        currentRowData={currentRowData}
        recordCountMode="unknown"
        currentAbsoluteIndex={absoluteIndex}
        isFirstRecord={isFirstRecord}
        onNavigatePrev={onNavigatePrevious}
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
        blobViewDisabled={!canResolveBlobPrimaryKey}
        blobViewDisabledReason="Cannot view BLOB — table has no primary key"
      />
      {foreignKeyLookupTarget && tabState && (
        <ForeignKeyLookupTargetDialog
          target={foreignKeyLookupTarget}
          tableLocation={tabState}
          isReadOnly={!isEditable}
          onClose={closeForeignKeyLookup}
          onApply={onForeignKeyApply}
        />
      )}
      <BlobViewerTargetDialog viewer={blobViewer} />
    </FkLookupProvider>
  )
}
