/**
 * TableDataGrid — react-data-grid wrapper configured for editable table data.
 *
 * Uses the shared DataGrid wrapper with the Precision Studio theme.
 * Handles cell editing, NULL display, modified cell indicators, and row management.
 *
 * Cell editing uses the async edit-guard pattern:
 * 1. preventGridDefault() on cell click
 * 2. Capture row KEY (not rowIdx which may shift during async)
 * 3. Run async guard (validate temporal, commit editing row, check save errors)
 * 4. If guard passes: find current rowIdx by key, call selectCell with enableEditor
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CellMouseArgs, CellMouseEvent } from 'react-data-grid'
import { DataGrid } from '../shared/DataGrid'
import type { Column, SortColumn, DataGridHandle } from '../shared/DataGrid'
import { TableDataCellRenderer } from '../shared/grid-cell-renderers'
import { getCellEditorForColumn } from '../shared/grid-cell-editors'
import { useTableDataStore, isSameRowKey } from '../../stores/table-data-store'
import { useToastStore } from '../../stores/toast-store'
import { getTemporalValidationResult } from '../../lib/table-data-save-utils'
import {
  getAutoSizedColumnWidth,
  getTableDataGridCellClass,
  getDefaultColumnWidth,
} from '../../lib/grid-column-style'
import type { TableDataColumnMeta, PrimaryKeyInfo } from '../../types/schema'
import styles from './TableDataGrid.module.css'

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
// Column definition builder (basic props — no closures)
// ---------------------------------------------------------------------------

/**
 * Build base react-data-grid column definitions from table column metadata.
 * Returns columns with basic properties (key, name, sizing, cellClass).
 * The component enhances these with renderEditCell and dynamic cellClass.
 */
export function buildColumnDefs(
  columns: TableDataColumnMeta[],
  isReadOnly: boolean,
  hasPk: boolean,
  pkColumnNames: string[] = []
): (Column<TableDataRow> & { _editable: boolean })[] {
  return columns.map((col) => {
    const editable = !isReadOnly && hasPk && !col.isBinary

    return {
      key: col.name,
      name: col.name,
      resizable: true,
      sortable: true,
      width: getDefaultColumnWidth(col.dataType),
      cellClass: getTableDataGridCellClass(col, pkColumnNames),
      renderCell: TableDataCellRenderer,
      _editable: editable,
    }
  })
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

  const tabState = useTableDataStore((state) => state.tabs[tabId])
  const startEditing = useTableDataStore((state) => state.startEditing)
  const updateCellValue = useTableDataStore((state) => state.updateCellValue)
  const syncCellValue = useTableDataStore((state) => state.syncCellValue)
  const commitEditingRowIfNeeded = useTableDataStore((state) => state.commitEditingRowIfNeeded)
  const setSelectedRow = useTableDataStore((state) => state.setSelectedRow)
  const requestNavigationAction = useTableDataStore((state) => state.requestNavigationAction)
  const sortByColumn = useTableDataStore((state) => state.sortByColumn)
  const clearEditStateIfUnmodified = useTableDataStore((state) => state.clearEditStateIfUnmodified)
  const showError = useToastStore((state) => state.showError)
  const showSuccess = useToastStore((state) => state.showSuccess)

  const columns = useMemo(() => tabState?.columns ?? [], [tabState?.columns])
  const rows = useMemo(() => tabState?.rows ?? [], [tabState?.rows])
  const primaryKey: PrimaryKeyInfo | null = tabState?.primaryKey ?? null
  const editState = tabState?.editState ?? null
  const sort = tabState?.sort ?? null
  const selectedRowKey = tabState?.selectedRowKey ?? null

  const pkColumns = useMemo(() => primaryKey?.keyColumns ?? [], [primaryKey?.keyColumns])
  const hasPk = primaryKey !== null

  // ---------------------------------------------------------------------------
  // Ref for editState: read inside cellClass closures without adding it as a
  // useMemo dependency.  This prevents rdgColumns from recomputing on every
  // keystroke (which would create new renderEditCell function references and
  // cause React to unmount/remount the editor → focus loss).  Cell re-rendering
  // still works because rowData depends on editState, so cells call
  // cellClass(row) which reads from the ref.
  // ---------------------------------------------------------------------------
  const editStateRef = useRef(editState)
  editStateRef.current = editState

  // ---------------------------------------------------------------------------
  // Controlled column-width state: tracks user-resized widths per column key.
  // Reset to defaults whenever columns change (data refresh).
  // NOTE: intentionally does NOT depend on `rows` — row data changes during
  // cell editing (syncCellValue) and resetting widths there would cause an
  // extra render cycle that destabilises column definitions.
  // ---------------------------------------------------------------------------
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})
  const [autoColumnWidths, setAutoColumnWidths] = useState<Record<string, number>>({})

  useEffect(() => {
    setColumnWidths({})
    setAutoColumnWidths({})
  }, [columns])

  useEffect(() => {
    if (editState) return

    setAutoColumnWidths(
      Object.fromEntries(
        columns.map((column, index) => [column.name, getAutoSizedColumnWidth(column, index, rows)])
      )
    )
  }, [columns, rows, editState])

  const handleColumnResize = useCallback((column: { key: string }, width: number) => {
    setColumnWidths((prev) => ({ ...prev, [column.key]: width }))
  }, [])

  // ---------------------------------------------------------------------------
  // Row data: transform array-of-arrays → array-of-objects for react-data-grid.
  // Overlays editState current values on the editing row.
  // ---------------------------------------------------------------------------
  const rowData: TableDataRow[] = useMemo(() => {
    return rows.map((row, rowIdx) => {
      const obj: TableDataRow = { __rowIndex: rowIdx }
      columns.forEach((col, i) => {
        obj[col.name] = row[i] ?? null
      })
      // Carry forward __tempId for new rows
      if (editState?.isNewRow && editState.tempId && rowIdx === rows.length - 1) {
        obj.__tempId = editState.tempId
      }
      if (editState) {
        const rowKey = getRowKey(obj, pkColumns)
        if (isSameRowKey(rowKey, editState.rowKey)) {
          obj.__editingRowKey = editState.rowKey
          for (const [colName, value] of Object.entries(editState.currentValues)) {
            obj[colName] = value
          }
        }
      }
      return obj
    })
  }, [rows, columns, editState, pkColumns])

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
  // Sort columns: derive from tabState.sort
  // ---------------------------------------------------------------------------
  const sortColumnsRdg: readonly SortColumn[] = useMemo(() => {
    if (sort) {
      return [
        {
          columnKey: sort.column,
          direction: sort.direction.toUpperCase() as 'ASC' | 'DESC',
        },
      ]
    }
    return []
  }, [sort])

  const handleSortColumnsChange = useCallback(
    (newSortColumns: SortColumn[]) => {
      // Single-sort enforcement: keep only the LAST element
      const lastSort =
        newSortColumns.length > 0 ? newSortColumns[newSortColumns.length - 1] : undefined

      if (!lastSort) {
        // Sort was cleared
        if (sort?.column) {
          requestNavigationAction(tabId, () => {
            sortByColumn(tabId, sort.column, null)
          })
        }
        return
      }

      const colName = lastSort.columnKey
      const direction = lastSort.direction.toLowerCase() as 'asc' | 'desc'
      requestNavigationAction(tabId, () => {
        sortByColumn(tabId, colName, direction)
      })
    },
    [sort, tabId, requestNavigationAction, sortByColumn]
  )

  // ---------------------------------------------------------------------------
  // Row class: editing row, new row styles, selected row highlight
  // ---------------------------------------------------------------------------
  const getRowClass = useCallback(
    (row: TableDataRow) => {
      const classes: string[] = []
      const rowKey = getRowKey(row, pkColumns)

      if (editState) {
        const isEditing = isSameRowKey(rowKey, editState.rowKey)
        if (isEditing && editState.isNewRow) {
          classes.push('td-editing-row', 'td-new-row')
        } else if (isEditing) {
          classes.push('td-editing-row')
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
  // Column definitions: react-data-grid Column[] with editors
  // ---------------------------------------------------------------------------
  const rdgColumns: readonly Column<TableDataRow>[] = useMemo(() => {
    return columns.map((col) => {
      const editable = !isReadOnly && hasPk && !col.isBinary
      const baseCellClass = getTableDataGridCellClass(col, pkColumns)
      const colWidth =
        columnWidths[col.name] ?? autoColumnWidths[col.name] ?? getDefaultColumnWidth(col.dataType)

      // Dynamic cell class function
      const cellClass = (row: TableDataRow) => {
        const classes = [baseCellClass]

        if (editable) {
          classes.push('td-editable-cell')
        }

        // Modified cell indicator — reads from ref to avoid triggering
        // rdgColumns recomputation on every keystroke.
        if (editStateRef.current) {
          const rowKey = getRowKey(row, pkColumns)
          if (
            isSameRowKey(rowKey, editStateRef.current.rowKey) &&
            editStateRef.current.modifiedColumns.has(col.name)
          ) {
            classes.push('td-modified-cell')
          }
        }

        return classes.join(' ')
      }

      // Determine the editor for editable columns
      if (editable) {
        const editorConfig = getCellEditorForColumn(col, {
          tabId,
          updateCellValue,
          syncCellValue,
        })

        return {
          key: col.name,
          name: col.name,
          resizable: true,
          sortable: true,
          width: colWidth,
          renderCell: TableDataCellRenderer,
          cellClass,
          renderEditCell: editorConfig.renderEditCell,
          ...(editorConfig.editorOptions && { editorOptions: editorConfig.editorOptions }),
        } as Column<TableDataRow>
      }

      return {
        key: col.name,
        name: col.name,
        resizable: true,
        sortable: true,
        width: colWidth,
        renderCell: TableDataCellRenderer,
        cellClass,
      } as Column<TableDataRow>
    })
  }, [
    columns,
    columnWidths,
    autoColumnWidths,
    isReadOnly,
    hasPk,
    pkColumns,
    tabId,
    updateCellValue,
    syncCellValue,
  ])

  // ---------------------------------------------------------------------------
  // onRowsChange: called when an editor commits — used to clear no-op edits
  // ---------------------------------------------------------------------------
  const handleRowsChange = useCallback(
    (newRows: TableDataRow[], { indexes }: { indexes: number[] }) => {
      for (const idx of indexes) {
        const row = newRows[idx]
        if (!row) continue
        const rowKey = getRowKey(row, pkColumns)
        clearEditStateIfUnmodified(tabId, rowKey)
      }
    },
    [pkColumns, tabId, clearEditStateIfUnmodified]
  )

  // ---------------------------------------------------------------------------
  // Cell click handler — async edit-guard pattern
  // ---------------------------------------------------------------------------
  const handleCellClick = useCallback(
    async (args: CellMouseArgs<TableDataRow>, event: CellMouseEvent) => {
      const row = args.row

      // 1. Capture the target row key BEFORE any async await
      const targetRowKey = getRowKey(row, pkColumns)

      // Prevent grid default unconditionally — the async guard below may yield,
      // and RDG must not process the click before the guard completes.
      event.preventGridDefault()

      // Check if column is editable
      const colKey = args.column.key
      const col = columns.find((c) => c.name === colKey)
      if (!col) return
      const editable = !isReadOnly && hasPk && !col.isBinary

      const targetColIdx = args.column.idx

      // 2. Run async guard — validate and commit if switching rows while editing
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
          return // Guard failed — do NOT proceed
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
          return // Guard failed — do NOT proceed
        }

        if (hadPendingChanges) {
          showSuccess('Row saved', 'Changes saved successfully.')
        }
      }

      // 3. Guard passed — NOW update selectedRowKey
      setSelectedRow(tabId, targetRowKey)

      // Non-editable columns: stop here (selection updated, no editing needed)
      if (!editable) return

      // Start tracking the new row if switching rows
      if (!isSameRowKey(targetRowKey, currentEditRowKey)) {
        const currentValues: Record<string, unknown> = {}
        columns.forEach((c) => {
          currentValues[c.name] = row[c.name]
        })
        startEditing(tabId, targetRowKey, currentValues)
      }

      // 4. Find current rowIdx for captured row key and enter editor
      const currentRowData = rowDataRef.current
      const targetRowIdx = currentRowData.findIndex((r) => {
        const rk = getRowKey(r, pkColumns)
        return isSameRowKey(rk, targetRowKey)
      })

      if (targetRowIdx >= 0) {
        gridRef.current?.selectCell(
          { rowIdx: targetRowIdx, idx: targetColIdx },
          { enableEditor: true }
        )
      }
    },
    [
      pkColumns,
      tabId,
      columns,
      isReadOnly,
      hasPk,
      commitEditingRowIfNeeded,
      startEditing,
      setSelectedRow,
      showError,
      showSuccess,
    ]
  )

  return (
    <div className={styles.container} data-testid="table-data-grid">
      <DataGrid<TableDataRow>
        ref={gridRef}
        columns={rdgColumns}
        rows={rowData}
        sortColumns={sortColumnsRdg}
        onSortColumnsChange={handleSortColumnsChange}
        onCellClick={handleCellClick}
        onRowsChange={handleRowsChange}
        onColumnResize={handleColumnResize}
        rowKeyGetter={rowKeyGetter}
        rowClass={getRowClass}
        data-testid="table-data-grid-inner"
      />
    </div>
  )
}
