/**
 * TableDataFormView — thin wrapper around BaseFormView for the table data browser.
 *
 * Reads from useTableDataStore + useConnectionStore, adapts the rich store
 * state into the shared BaseFormViewProps shape, and delegates all rendering
 * to BaseFormView.  Toast notifications and temporal-validation on save live
 * here (BaseFormView is store-free and toast-free).
 */

import { useCallback, useMemo } from 'react'
import { useTableDataStore, isSameRowKey } from '../../stores/table-data-store'
import { useConnectionStore } from '../../stores/connection-store'
import { useToastStore } from '../../stores/toast-store'
import { getTemporalValidationResult } from '../../lib/table-data-save-utils'
import { BaseFormView } from '../shared/BaseFormView'
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
}

export function TableDataFormView({ tabId }: TableDataFormViewProps) {
  const tabState = useTableDataStore((state) => state.tabs[tabId])
  const startEditing = useTableDataStore((state) => state.startEditing)
  const updateCellValue = useTableDataStore((state) => state.updateCellValue)
  const saveCurrentRow = useTableDataStore((state) => state.saveCurrentRow)
  const discardCurrentRow = useTableDataStore((state) => state.discardCurrentRow)
  const requestNavigationAction = useTableDataStore((state) => state.requestNavigationAction)
  const fetchPage = useTableDataStore((state) => state.fetchPage)
  const setSelectedRow = useTableDataStore((state) => state.setSelectedRow)

  // Connection read-only check
  const connectionId = tabState?.connectionId ?? ''
  const activeConnection = useConnectionStore((state) => state.activeConnections[connectionId])
  const isConnectionReadOnly = activeConnection?.profile?.readOnly ?? false

  const columns = useMemo(() => tabState?.columns ?? [], [tabState?.columns])
  const rows = useMemo(() => tabState?.rows ?? [], [tabState?.rows])
  const totalRows = tabState?.totalRows ?? 0
  const currentPage = tabState?.currentPage ?? 1
  const totalPages = tabState?.totalPages ?? 1
  const pageSize = tabState?.pageSize ?? 1000
  const primaryKey = tabState?.primaryKey ?? null
  const storeEditState = tabState?.editState ?? null
  const selectedRowKey = tabState?.selectedRowKey ?? null
  const isLoading = tabState?.isLoading ?? false

  const hasPk = primaryKey !== null
  const isEditable = !isConnectionReadOnly && hasPk
  const pkColumns = useMemo(() => primaryKey?.keyColumns ?? [], [primaryKey?.keyColumns])

  // When a temp/new row exists, totalRows from the server doesn't include it.
  // Add 1 so the display and navigation bounds are correct ("Record 3 of 3" not "Record 3 of 2").
  const hasTempRow = storeEditState?.isNewRow === true
  const effectiveTotalRows = hasTempRow ? totalRows + 1 : totalRows

  // --- Grid columns (stable) ---
  const gridColumns = useMemo(() => toGridColumns(columns), [columns])

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
  // Fold isLoading into the first/last flags so BaseFormView disables buttons
  const isFirstRecord = (currentPage === 1 && localIndex === 0) || isLoading
  const isLastRecord = (currentPage >= totalPages && localIndex >= rows.length - 1) || isLoading

  // --- Navigation handlers ---
  const navigateRelative = useCallback(
    (direction: -1 | 1) => {
      if (!tabState || isLoading) return

      const absoluteIdx = (currentPage - 1) * pageSize + localIndex
      const newAbsoluteIndex = absoluteIdx + direction

      // Boundary check — use effectiveTotalRows so navigation accounts for temp rows
      if (newAbsoluteIndex < 0 || newAbsoluteIndex >= effectiveTotalRows) return

      const newPage = Math.floor(newAbsoluteIndex / pageSize) + 1
      const newLocalIndex = newAbsoluteIndex % pageSize

      const action = async () => {
        if (newPage !== currentPage) {
          await fetchPage(tabId, newPage)
        }
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
      currentPage,
      pageSize,
      effectiveTotalRows,
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

  // --- Render ---
  return (
    <BaseFormView
      columns={gridColumns}
      currentRow={currentRow}
      totalRows={effectiveTotalRows}
      currentAbsoluteIndex={absoluteIndex}
      isFirstRecord={isFirstRecord}
      isLastRecord={isLastRecord}
      onNavigatePrev={onNavigatePrev}
      onNavigateNext={onNavigateNext}
      editState={sharedEditState}
      onEnsureEditing={onEnsureEditing}
      onUpdateCell={onUpdateCell}
      onSave={isEditable ? onSave : undefined}
      onDiscard={isEditable ? onDiscard : undefined}
      readOnly={!isEditable}
      testId="table-data-form-view"
    />
  )
}
