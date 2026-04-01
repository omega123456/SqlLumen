/**
 * TableDataGrid — thin wrapper around BaseGridView for editable table data.
 *
 * Reads tab state from useTableDataStore, transforms it into BaseGridView
 * props (GridColumnDescriptor[], Record<string, unknown>[] rows), and
 * implements the cell-click guard pattern for async edit validation.
 *
 * Store-specific logic (toast notifications, edit-state tracking, sort
 * dispatch) lives here — BaseGridView stays store-agnostic.
 */

import { useCallback, useMemo, useRef } from 'react'
import { BaseGridView } from '../shared/BaseGridView'
import type { DataGridHandle } from '../shared/DataGrid'
import {
  EditorCallbacksContext,
  type EditorCallbacksContextType,
} from '../shared/editor-callbacks-context'
import { useTableDataStore, isSameRowKey } from '../../stores/table-data-store'
import { useToastStore } from '../../stores/toast-store'
import { getTemporalValidationResult } from '../../lib/table-data-save-utils'
import { getAutoSizedColumnWidth } from '../../lib/grid-column-style'
import type {
  GridColumnDescriptor,
  RowEditState as SharedRowEditState,
  CellClickGuardArgs,
  CellClickGuardResult,
  AutoSizeConfig,
} from '../../types/shared-data-view'
import type { TableDataColumnMeta } from '../../types/schema'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TableDataRow = Record<string, unknown>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a row key from row data and PK columns. */
function getRowKey(data: Record<string, unknown>, pkColumns: string[]): Record<string, unknown> {
  if (data.__tempId != null) {
    return { __tempId: data.__tempId }
  }
  if (data.__editingRowKey && typeof data.__editingRowKey === 'object') {
    return data.__editingRowKey as Record<string, unknown>
  }
  const key: Record<string, unknown> = {}
  for (const col of pkColumns) {
    key[col] = data[col]
  }
  return key
}

// ---------------------------------------------------------------------------
// Column descriptor builder
// ---------------------------------------------------------------------------

/**
 * Build GridColumnDescriptor[] from TableDataColumnMeta[].
 * Exported for unit testing.
 */
export function buildColumnDescriptors(
  columns: TableDataColumnMeta[],
  isReadOnly: boolean,
  hasPk: boolean
): GridColumnDescriptor[] {
  return columns.map((col) => ({
    key: col.name,
    displayName: col.name,
    dataType: col.dataType,
    editable: !isReadOnly && hasPk && !col.isBinary,
    isBinary: col.isBinary,
    isNullable: col.isNullable,
    isPrimaryKey: col.isPrimaryKey,
    isUniqueKey: col.isUniqueKey,
    enumValues: col.enumValues,
    tableColumnMeta: col,
  }))
}

// ---------------------------------------------------------------------------
// TableDataGrid component
// ---------------------------------------------------------------------------

interface TableDataGridProps {
  tabId: string
  isReadOnly: boolean
}

export function TableDataGrid({ tabId, isReadOnly }: TableDataGridProps) {
  const gridRef = useRef<DataGridHandle | null>(null)

  // ---------------------------------------------------------------------------
  // Store subscriptions
  // ---------------------------------------------------------------------------

  const tabState = useTableDataStore((state) => state.tabs[tabId])
  const startEditing = useTableDataStore((state) => state.startEditing)
  const commitEditingRowIfNeeded = useTableDataStore((state) => state.commitEditingRowIfNeeded)
  const setSelectedRow = useTableDataStore((state) => state.setSelectedRow)
  const requestNavigationAction = useTableDataStore((state) => state.requestNavigationAction)
  const sortByColumn = useTableDataStore((state) => state.sortByColumn)
  const clearEditStateIfUnmodified = useTableDataStore((state) => state.clearEditStateIfUnmodified)
  const storeUpdateCellValue = useTableDataStore((state) => state.updateCellValue)
  const showError = useToastStore((state) => state.showError)
  const showSuccess = useToastStore((state) => state.showSuccess)

  const columns = useMemo(() => tabState?.columns ?? [], [tabState?.columns])
  const rows = useMemo(() => tabState?.rows ?? [], [tabState?.rows])
  const primaryKey = tabState?.primaryKey ?? null
  const editState = tabState?.editState ?? null
  const sort = tabState?.sort ?? null
  const selectedRowKey = tabState?.selectedRowKey ?? null

  const pkColumns = useMemo(() => primaryKey?.keyColumns ?? [], [primaryKey?.keyColumns])
  const hasPk = primaryKey !== null

  // ---------------------------------------------------------------------------
  // Editor callbacks context — provides real updateCellValue to editors inside
  // BaseGridView (which uses NOOP_EDITOR_CALLBACKS).
  //
  // syncCellValue is intentionally a no-op here: calling the real one during
  // typing would update the backing row array, changing the rows prop, which
  // triggers autoColumnWidths → rdgColumns recomputation → new renderEditCell
  // references → editor unmount/remount → focus loss.
  // ---------------------------------------------------------------------------
  const editorCallbacksCtx: EditorCallbacksContextType = useMemo(
    () => ({
      tabId,
      updateCellValue: storeUpdateCellValue,

      syncCellValue: () => {},
    }),
    [tabId, storeUpdateCellValue]
  )

  // ---------------------------------------------------------------------------
  // Column descriptors: TableDataColumnMeta[] → GridColumnDescriptor[]
  // ---------------------------------------------------------------------------
  const descriptorColumns = useMemo(
    () => buildColumnDescriptors(columns, isReadOnly, hasPk),
    [columns, isReadOnly, hasPk]
  )

  // ---------------------------------------------------------------------------
  // editState ref: read inside rowData useMemo without making editState a dep.
  // This prevents rowData from recomputing on every keystroke (which would
  // trigger the autoColumnWidths → rdgColumns recomputation chain that
  // destabilises renderEditCell references).
  // ---------------------------------------------------------------------------
  const editStateRef = useRef(editState)
  editStateRef.current = editState

  // ---------------------------------------------------------------------------
  // Row data: transform array-of-arrays → array-of-objects for BaseGridView.
  // Overlays editState current values, __editingRowKey, and __tempId.
  //
  // CRITICAL: editState is read from a ref — NOT included in deps. This keeps
  // rows stable during cell editing (only underlying data changes trigger
  // recomputation). The cell EDITOR component manages its own display value
  // via local state, so the grid doesn't need row updates on every keystroke.
  // ---------------------------------------------------------------------------
  const rowData: TableDataRow[] = useMemo(() => {
    const currentEditState = editStateRef.current
    return rows.map((row, rowIdx) => {
      const obj: TableDataRow = { __rowIndex: rowIdx }
      columns.forEach((col, i) => {
        obj[col.name] = row[i] ?? null
      })
      // Carry forward __tempId for new rows
      if (currentEditState?.isNewRow && currentEditState.tempId && rowIdx === rows.length - 1) {
        obj.__tempId = currentEditState.tempId
      }
      if (currentEditState) {
        const rowKey = getRowKey(obj, pkColumns)
        if (isSameRowKey(rowKey, currentEditState.rowKey)) {
          obj.__editingRowKey = currentEditState.rowKey
          for (const [colName, value] of Object.entries(currentEditState.currentValues)) {
            obj[colName] = value
          }
        }
      }
      return obj
    })
  }, [rows, columns, pkColumns])

  // Keep a ref to the latest rowData for post-async lookups
  const rowDataRef = useRef<TableDataRow[]>(rowData)
  rowDataRef.current = rowData

  // ---------------------------------------------------------------------------
  // Row key getter — CRITICAL: complex row identity logic
  // ---------------------------------------------------------------------------
  const rowKeyGetter = useCallback(
    (row: TableDataRow) => {
      if (row.__tempId) return String(row.__tempId)
      if (row.__editingRowKey && typeof row.__editingRowKey === 'object') {
        return JSON.stringify(Object.values(row.__editingRowKey as Record<string, unknown>))
      }
      if (pkColumns.length > 0) {
        return JSON.stringify(pkColumns.map((c) => row[c]))
      }
      return String(row.__rowIndex)
    },
    [pkColumns]
  )

  // ---------------------------------------------------------------------------
  // Row class: editing row, new row styles, selected row highlight
  // Using standardised class names from Phase 1.
  // ---------------------------------------------------------------------------
  const getRowClass = useCallback(
    (row: TableDataRow) => {
      const classes: string[] = []
      const rowKey = getRowKey(row, pkColumns)

      if (editState) {
        const isEditing = isSameRowKey(rowKey, editState.rowKey)
        if (isEditing && editState.isNewRow) {
          classes.push('rdg-editing-row', 'rdg-new-row')
        } else if (isEditing) {
          classes.push('rdg-editing-row')
        }
      }

      if (selectedRowKey && isSameRowKey(rowKey, selectedRowKey)) {
        classes.push('rdg-row-precision-selected')
      }

      return classes.length > 0 ? classes.join(' ') : undefined
    },
    [editState, pkColumns, selectedRowKey]
  )

  // ---------------------------------------------------------------------------
  // isModifiedCell — reads LATEST editState from store (not from component
  // state) so that it returns correct results even when the wrapper's
  // editState prop is stale due to the ref pattern.
  // ---------------------------------------------------------------------------
  const isModifiedCell = useCallback(
    (rowData: Record<string, unknown>, columnKey: string) => {
      const currentEditState = useTableDataStore.getState().tabs[tabId]?.editState
      if (!currentEditState) return false

      const rowKey = getRowKey(rowData, pkColumns)
      if (!isSameRowKey(rowKey, currentEditState.rowKey)) return false

      return currentEditState.modifiedColumns.has(columnKey)
    },
    [tabId, pkColumns]
  )

  // ---------------------------------------------------------------------------
  // Shared edit state for BaseGridView (lighter RowEditState shape)
  // ---------------------------------------------------------------------------
  const sharedEditState: SharedRowEditState | null = useMemo(() => {
    if (!editState) return null
    return {
      rowKey: JSON.stringify(editState.rowKey),
      currentValues: editState.currentValues,
      originalValues: editState.originalValues,
    }
  }, [editState])

  // ---------------------------------------------------------------------------
  // Auto-size configuration
  //
  // Always enabled — the editStateRef pattern already prevents the rowData →
  // rows → autoColumnWidths → rdgColumns recomputation chain that would
  // destabilise renderEditCell references during editing.
  //
  // Precomputed: column lookup map and array-format rows are built once in the
  // surrounding useMemo so computeWidth is a thin per-column lookup.
  // ---------------------------------------------------------------------------
  const autoSizeConfig: AutoSizeConfig | undefined = useMemo(() => {
    // Precompute: name → column meta lookup
    const colMetaByName = new Map<string, { meta: TableDataColumnMeta; index: number }>()
    for (let i = 0; i < columns.length; i++) {
      colMetaByName.set(columns[i].name, { meta: columns[i], index: i })
    }

    return {
      enabled: true,
      computeWidth: (col: GridColumnDescriptor, gridRows: Record<string, unknown>[]) => {
        const entry = colMetaByName.get(col.key)
        if (!entry) return 150
        // Convert Record rows to array format for the sizing function
        const arrayRows = gridRows.map((r) => columns.map((c) => r[c.name]))
        return getAutoSizedColumnWidth(entry.meta, entry.index, arrayRows)
      },
    }
  }, [columns])

  // ---------------------------------------------------------------------------
  // Sort handler — wraps requestNavigationAction + sortByColumn
  // ---------------------------------------------------------------------------
  const handleSortChange = useCallback(
    (column: string | null, direction: 'ASC' | 'DESC' | null) => {
      if (!column || !direction) {
        // Sort was cleared
        if (sort?.column) {
          requestNavigationAction(tabId, () => {
            sortByColumn(tabId, sort.column, null)
          })
        }
        return
      }

      const dir = direction.toLowerCase() as 'asc' | 'desc'
      requestNavigationAction(tabId, () => {
        sortByColumn(tabId, column, dir)
      })
    },
    [sort, tabId, requestNavigationAction, sortByColumn]
  )

  // ---------------------------------------------------------------------------
  // Cell click guard — async edit-guard pattern
  //
  // 1. Capture the target row KEY (not rowIdx which may shift during async)
  // 2. Run async guard (validate temporal, commit editing row, check save errors)
  // 3. If guard passes: find current rowIdx by key, return proceed=true
  //
  // Split into focused helpers for readability; async ordering is preserved.
  // ---------------------------------------------------------------------------

  /** Resolve the target column descriptor and its index in descriptorColumns. */
  const resolveTargetColumn = useCallback(
    (columnKey: string) => {
      const col = columns.find((c) => c.name === columnKey)
      if (!col) return null
      const editable = !isReadOnly && hasPk && !col.isBinary
      const targetColIdx = descriptorColumns.findIndex((c) => c.key === columnKey)
      return { col, editable, targetColIdx }
    },
    [columns, isReadOnly, hasPk, descriptorColumns]
  )

  /**
   * Validate temporal columns on the current edit state and commit the editing
   * row if switching rows. Returns `true` if the guard passed (or no commit
   * was needed), `false` if it failed (validation error or save error).
   */
  const validateAndCommitCurrentEdit = useCallback(
    async (
      targetRowKey: Record<string, unknown>,
      fallbackRowIdx: number,
      targetColIdx: number
    ): Promise<{ passed: boolean; result?: CellClickGuardResult }> => {
      const currentState = useTableDataStore.getState().tabs[tabId]
      const currentEditState = currentState?.editState ?? null
      const currentEditRowKey = currentEditState?.rowKey ?? null

      if (!isSameRowKey(targetRowKey, currentEditRowKey) && currentEditRowKey !== null) {
        // Validate temporal columns
        const validationError = getTemporalValidationResult(currentEditState, columns)
        if (validationError) {
          showError('Invalid date value', `${validationError.columnName}: ${validationError.error}`)
          // Snap selection back to the editing row
          if (currentEditState) {
            setSelectedRow(tabId, currentEditState.rowKey)
          }
          return {
            passed: false,
            result: {
              proceed: false,
              targetRowIdx: fallbackRowIdx,
              targetColIdx,
              enableEditor: false,
            },
          }
        }

        const hadPendingChanges = (currentEditState?.modifiedColumns.size ?? 0) > 0

        // Commit the old row first (async save)
        await commitEditingRowIfNeeded(tabId, targetRowKey)

        // Check if save failed
        const updatedState = useTableDataStore.getState().tabs[tabId]
        if (updatedState?.saveError) {
          showError('Save failed', updatedState.saveError)
          // Snap selection back to the editing row
          if (updatedState.editState) {
            setSelectedRow(tabId, updatedState.editState.rowKey)
          }
          return {
            passed: false,
            result: {
              proceed: false,
              targetRowIdx: fallbackRowIdx,
              targetColIdx,
              enableEditor: false,
            },
          }
        }

        if (hadPendingChanges) {
          showSuccess('Row saved', 'Changes saved successfully.')
        }
      }

      return { passed: true }
    },
    [tabId, columns, commitEditingRowIfNeeded, setSelectedRow, showError, showSuccess]
  )

  /** Find the current row index for a given row key in the latest rowData snapshot. */
  const findCurrentRowIndex = useCallback(
    (targetRowKey: Record<string, unknown>): number => {
      const currentRowData = rowDataRef.current
      return currentRowData.findIndex((r) => {
        const rk = getRowKey(r, pkColumns)
        return isSameRowKey(rk, targetRowKey)
      })
    },
    [pkColumns]
  )

  const handleCellClickGuard = useCallback(
    async (args: CellClickGuardArgs): Promise<CellClickGuardResult> => {
      const row = args.rowData
      const targetRowKey = getRowKey(row, pkColumns)

      // Resolve target column descriptor
      const target = resolveTargetColumn(args.columnKey)
      if (!target) {
        return { proceed: false, targetRowIdx: args.rowIdx, targetColIdx: 0, enableEditor: false }
      }
      const { editable, targetColIdx } = target

      // Validate and commit current edit if switching rows (async guard)
      const guardResult = await validateAndCommitCurrentEdit(
        targetRowKey,
        args.rowIdx,
        targetColIdx
      )
      if (!guardResult.passed) {
        return guardResult.result!
      }

      // Guard passed — NOW update selectedRowKey
      setSelectedRow(tabId, targetRowKey)

      // Non-editable columns: stop here (selection updated, no editing needed)
      if (!editable) {
        const rowIdx = findCurrentRowIndex(targetRowKey)
        return {
          proceed: true,
          targetRowIdx: rowIdx >= 0 ? rowIdx : args.rowIdx,
          targetColIdx,
          enableEditor: false,
        }
      }

      // Start tracking the new row if switching rows
      const currentEditRowKey = useTableDataStore.getState().tabs[tabId]?.editState?.rowKey ?? null
      if (!isSameRowKey(targetRowKey, currentEditRowKey)) {
        const currentValues: Record<string, unknown> = {}
        columns.forEach((c) => {
          currentValues[c.name] = row[c.name]
        })
        startEditing(tabId, targetRowKey, currentValues)
      }

      // Find current rowIdx for captured row key and enter editor
      const finalRowIdx = findCurrentRowIndex(targetRowKey)

      if (finalRowIdx >= 0) {
        return { proceed: true, targetRowIdx: finalRowIdx, targetColIdx, enableEditor: true }
      }

      return { proceed: false, targetRowIdx: args.rowIdx, targetColIdx, enableEditor: false }
    },
    [
      pkColumns,
      tabId,
      columns,
      resolveTargetColumn,
      validateAndCommitCurrentEdit,
      findCurrentRowIndex,
      startEditing,
      setSelectedRow,
    ]
  )

  // ---------------------------------------------------------------------------
  // onRowsChange: called when an editor commits — used to clear no-op edits
  // ---------------------------------------------------------------------------
  const handleRowsChange = useCallback(
    (newRows: TableDataRow[], data: { indexes: number[] }) => {
      for (const idx of data.indexes) {
        const row = newRows[idx]
        if (!row) continue
        const rowKey = getRowKey(row, pkColumns)
        clearEditStateIfUnmodified(tabId, rowKey)
      }
    },
    [pkColumns, tabId, clearEditStateIfUnmodified]
  )

  // ---------------------------------------------------------------------------
  // Render: wrap BaseGridView with EditorCallbacksContext
  // ---------------------------------------------------------------------------
  return (
    <EditorCallbacksContext.Provider value={editorCallbacksCtx}>
      <BaseGridView
        ref={gridRef}
        rows={rowData}
        columns={descriptorColumns}
        editState={sharedEditState}
        sortColumn={sort?.column ?? null}
        sortDirection={sort ? (sort.direction.toUpperCase() as 'ASC' | 'DESC') : null}
        onSortChange={handleSortChange}
        onCellClickGuard={handleCellClickGuard}
        onRowsChange={handleRowsChange}
        rowKeyGetter={rowKeyGetter}
        getRowClass={getRowClass}
        isModifiedCell={isModifiedCell}
        autoSizeConfig={autoSizeConfig}
        testId="table-data-grid"
      />
    </EditorCallbacksContext.Provider>
  )
}
