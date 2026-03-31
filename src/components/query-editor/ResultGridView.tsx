/**
 * react-data-grid wrapper for displaying query results.
 *
 * Uses the shared DataGrid wrapper with the Precision Studio theme.
 * Sorting is managed externally (server-side) — react-data-grid's built-in
 * sort indicators are driven by controlled `sortColumns` while the
 * `onSortColumnsChange` handler converts direction casing (ASC/DESC → asc/desc)
 * and enforces single-sort.
 *
 * When `editMode` is set, columns are decorated with editable/read-only
 * styling and cell editors from the shared module are wired up.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CellMouseArgs, CellMouseEvent } from 'react-data-grid'
import { DataGrid } from '../shared/DataGrid'
import type { Column, SortColumn, DataGridHandle } from '../shared/DataGrid'
import { TableDataCellRenderer } from '../shared/grid-cell-renderers'
import { ReadOnlyColumnHeaderCell } from '../shared/grid-header-renderers'
import { getCellEditorForColumn } from '../shared/grid-cell-editors'
import { getResultGridCellClass, getDefaultColumnWidth } from '../../lib/grid-column-style'
import type { ColumnMeta, TableDataColumnMeta, RowEditState } from '../../types/schema'
import styles from './ResultGridView.module.css'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Row data shape: col_0, col_1, ... plus __rowIdx for stable identification. */
type ResultRow = Record<string, unknown>

// ---------------------------------------------------------------------------
// ResultGridView
// ---------------------------------------------------------------------------

interface ResultGridViewProps {
  columns: ColumnMeta[]
  rows: unknown[][]
  sortColumn: string | null
  sortDirection: 'asc' | 'desc' | null
  onSortChanged: (column: string, direction: 'asc' | 'desc' | null) => void
  onRowSelected: (rowIndex: number) => void
  selectedRowIndex: number | null
  /** Current page (1-indexed) — used to convert absolute selectedRowIndex to local. */
  currentPage: number
  /** Page size — used to convert absolute selectedRowIndex to local. */
  pageSize: number
  /** Tab identifier — passed through to cell editor context for store syncing. */
  tabId: string
  /** Active edit table name, or null for read-only mode. */
  editMode: string | null
  /** Column index → editable boolean for the selected edit table. */
  editableColumnMap: Map<number, boolean>
  /** Current row edit state. */
  editState: RowEditState | null
  /** Page-local row index of the editing row. */
  editingRowIndex: number | null
  /** Column metadata from the edit table (for cell editor selection). */
  editTableColumns: TableDataColumnMeta[]
  /** Start editing a row by its page-local index. */
  onStartEditing: (rowIndex: number) => void
  /** Update a cell value in the edit state (real column name). */
  onUpdateCellValue: (columnName: string, value: unknown) => void
  /** Sync a cell value to both edit state and local rows. */
  onSyncCellValue: (columnName: string, value: unknown) => void
  /** Auto-save the current editing row (called on row transition). */
  onAutoSave: () => Promise<boolean>
}

const EMPTY_EDITABLE_MAP = new Map<number, boolean>()
const EMPTY_TABLE_COLUMNS: TableDataColumnMeta[] = []

export function ResultGridView({
  columns,
  rows,
  sortColumn,
  sortDirection,
  onSortChanged,
  onRowSelected,
  selectedRowIndex,
  currentPage,
  pageSize,
  tabId,
  editMode = null,
  editableColumnMap = EMPTY_EDITABLE_MAP,
  editState = null,
  editingRowIndex = null,
  editTableColumns = EMPTY_TABLE_COLUMNS,
  onStartEditing,
  onUpdateCellValue,
  onSyncCellValue,
  onAutoSave,
}: ResultGridViewProps) {
  const gridRef = useRef<DataGridHandle | null>(null)

  // ---------------------------------------------------------------------------
  // Refs for editState/editingRowIndex: read inside cellClass closures without
  // adding them as useMemo dependencies.  This prevents rdgColumns from
  // recomputing on every keystroke (which would create new renderEditCell
  // function references and cause React to unmount/remount the editor → focus
  // loss).  Cell re-rendering still works because rowData depends on editState,
  // so cells call cellClass(row) which reads from the ref.
  // ---------------------------------------------------------------------------
  const editStateRef = useRef(editState)
  editStateRef.current = editState
  const editingRowIndexRef = useRef(editingRowIndex)
  editingRowIndexRef.current = editingRowIndex

  // ---------------------------------------------------------------------------
  // Controlled column-width state: tracks user-resized widths per column key.
  // Reset to defaults whenever the column set changes (new query result).
  // NOTE: intentionally does NOT depend on `rows` — row data changes during
  // cell editing (syncCellValue) and resetting widths there would cause an
  // extra render cycle that destabilises column definitions.
  // ---------------------------------------------------------------------------
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})

  useEffect(() => {
    setColumnWidths({})
  }, [columns])

  const handleColumnResize = useCallback((column: { key: string }, width: number) => {
    setColumnWidths((prev) => ({ ...prev, [column.key]: width }))
  }, [])

  // ---------------------------------------------------------------------------
  // Row data: transform array-of-arrays to array-of-objects for react-data-grid.
  // Each row includes a __rowIdx property for stable identification.
  // Overlays editState current values on the editing row.
  // ---------------------------------------------------------------------------
  const rowData: ResultRow[] = useMemo(() => {
    return rows.map((row, rowIdx) => {
      const obj: ResultRow = { __rowIdx: rowIdx }
      columns.forEach((_, i) => {
        obj[`col_${i}`] = row[i] ?? null
      })

      // Overlay editState values for the editing row
      if (editState && editingRowIndex !== null && rowIdx === editingRowIndex) {
        for (const [colName, value] of Object.entries(editState.currentValues)) {
          const colIdx = columns.findIndex((c) => c.name === colName)
          if (colIdx !== -1) {
            obj[`col_${colIdx}`] = value
          }
        }
      }

      return obj
    })
  }, [rows, columns, editState, editingRowIndex])

  // ---------------------------------------------------------------------------
  // Sort columns: derive from sortColumn/sortDirection props.
  // react-data-grid uses uppercase 'ASC'/'DESC'; app uses lowercase 'asc'/'desc'.
  // ---------------------------------------------------------------------------
  const sortColumnsRdg: readonly SortColumn[] = useMemo(() => {
    if (sortColumn && sortDirection) {
      const colIdx = columns.findIndex((c) => c.name === sortColumn)
      if (colIdx >= 0) {
        return [
          {
            columnKey: `col_${colIdx}`,
            direction: sortDirection.toUpperCase() as 'ASC' | 'DESC',
          },
        ]
      }
    }
    return []
  }, [sortColumn, sortDirection, columns])

  // ---------------------------------------------------------------------------
  // Wrapped callbacks for cell editors: translate col_N → real column name.
  // ---------------------------------------------------------------------------
  const wrappedUpdateCellValue = useCallback(
    (_tabId: string, fieldName: string, value: unknown) => {
      const colIndex = parseInt(fieldName.replace('col_', ''), 10)
      const realName = columns[colIndex]?.name ?? fieldName
      onUpdateCellValue(realName, value)
    },
    [columns, onUpdateCellValue]
  )

  const wrappedSyncCellValue = useCallback(
    (
      _tabId: string,
      _rowData: Record<string, unknown> | undefined,
      fieldName: string,
      value: unknown
    ) => {
      const colIndex = parseInt(fieldName.replace('col_', ''), 10)
      const realName = columns[colIndex]?.name ?? fieldName
      onSyncCellValue(realName, value)
    },
    [columns, onSyncCellValue]
  )

  // ---------------------------------------------------------------------------
  // Column definitions: build react-data-grid Column[] from ColumnMeta[].
  // Uses a helper to compute edit-mode properties before constructing the
  // readonly Column object.
  // ---------------------------------------------------------------------------
  const rdgColumns: readonly Column<ResultRow>[] = useMemo(() => {
    return columns.map((col, i) => {
      const key = `col_${i}`
      const colWidth = columnWidths[key] ?? getDefaultColumnWidth(col.dataType)

      // Shared cellClass function
      const cellClass = (row: ResultRow) => {
        const classes = [getResultGridCellClass(col.dataType)]
        const value = row[key]
        if (value === null || value === undefined) {
          classes.push('rdg-cell-null')
        }

        if (editMode && editableColumnMap.size > 0) {
          const isEditable = editableColumnMap.get(i) ?? false
          if (isEditable) {
            classes.push('col-editable')
          } else {
            classes.push('col-readonly')
          }
        }

        // Cell modified indicator — reads from refs to avoid triggering
        // rdgColumns recomputation on every keystroke.
        if (editMode && editStateRef.current && editingRowIndexRef.current !== null) {
          const rowIdx = row.__rowIdx as number
          if (rowIdx === editingRowIndexRef.current) {
            const realName = columns[i]?.name
            if (realName && editStateRef.current.modifiedColumns.has(realName)) {
              classes.push('cell-modified')
            }
          }
        }

        return classes.join(' ')
      }

      // Compute edit-mode properties
      if (editMode && editableColumnMap.size > 0) {
        const isEditable = editableColumnMap.get(i) ?? false

        if (isEditable) {
          // Find matching table column for cell editor type
          const tableCol = editTableColumns.find(
            (tc) => tc.name.toLowerCase() === col.name.toLowerCase()
          )

          // Use the shared factory — col_N → real column name translation
          // stays here (wrappedUpdateCellValue / wrappedSyncCellValue).
          const editorConfig = getCellEditorForColumn(tableCol, {
            tabId,
            updateCellValue: wrappedUpdateCellValue,
            syncCellValue: wrappedSyncCellValue,
          })

          return {
            key,
            name: col.name,
            resizable: true,
            sortable: true,
            width: colWidth,
            renderCell: TableDataCellRenderer,
            cellClass,
            renderEditCell: editorConfig.renderEditCell,
            ...(editorConfig.editorOptions && { editorOptions: editorConfig.editorOptions }),
          } as Column<ResultRow>
        } else {
          // Non-editable column in edit mode: lock icon header
          return {
            key,
            name: col.name,
            resizable: true,
            sortable: true,
            width: colWidth,
            renderCell: TableDataCellRenderer,
            cellClass,
            headerCellClass: 'col-readonly',
            renderHeaderCell: ReadOnlyColumnHeaderCell,
          } as Column<ResultRow>
        }
      }

      // Read-only mode: basic column
      return {
        key,
        name: col.name,
        resizable: true,
        sortable: true,
        width: colWidth,
        renderCell: TableDataCellRenderer,
        cellClass,
      } as Column<ResultRow>
    })
  }, [
    columns,
    columnWidths,
    editMode,
    editableColumnMap,
    editTableColumns,
    tabId,
    wrappedUpdateCellValue,
    wrappedSyncCellValue,
  ])

  // ---------------------------------------------------------------------------
  // Sort change handler: convert direction casing, enforce single-sort.
  // ---------------------------------------------------------------------------
  const handleSortColumnsChange = useCallback(
    (newSortColumns: SortColumn[]) => {
      // Single-sort enforcement: keep only the LAST element
      const lastSort =
        newSortColumns.length > 0 ? newSortColumns[newSortColumns.length - 1] : undefined

      if (!lastSort) {
        // Sort was cleared — pass the previously sorted column with null direction
        if (sortColumn) {
          onSortChanged(sortColumn, null)
        }
        return
      }

      const colIndex = parseInt(lastSort.columnKey.replace('col_', ''), 10)
      const colName = columns[colIndex]?.name
      if (colName) {
        // Convert uppercase direction to lowercase for app convention
        const direction = lastSort.direction.toLowerCase() as 'asc' | 'desc'
        onSortChanged(colName, direction)
      }
    },
    [columns, sortColumn, onSortChanged]
  )

  // ---------------------------------------------------------------------------
  // Cell click handler: row selection + edit-mode cell editing.
  // Uses the async edit-guard pattern from the brief.
  // ---------------------------------------------------------------------------
  const handleCellClick = useCallback(
    async (args: CellMouseArgs<ResultRow>, event: CellMouseEvent) => {
      const rowIdx = args.rowIdx

      // Read-only mode: just notify row selection immediately
      if (!editMode) {
        onRowSelected(rowIdx)
        return
      }

      // Edit mode: ALWAYS run the guard before changing row selection,
      // regardless of whether the clicked column is editable.
      event.preventGridDefault()

      // Capture target row index and column index BEFORE any async await
      const targetRowIdx = rowIdx
      const targetColIdx = args.column.idx
      const colKey = args.column.key
      const colIndex = parseInt(colKey.replace('col_', ''), 10)
      const isEditable = editableColumnMap.get(colIndex) ?? false

      // Run async guard (save, validate) if switching rows
      if (editingRowIndex !== null && editingRowIndex !== targetRowIdx) {
        if (editState && editState.modifiedColumns.size > 0) {
          const saveSucceeded = await onAutoSave()
          if (!saveSucceeded) {
            return // Save failed, stay on current row — do NOT move selection
          }
        }
      }

      // Guard passed — NOW update selection
      onRowSelected(targetRowIdx)

      // Only start editing and enter editor for editable columns
      if (isEditable) {
        // Start editing the new row if different
        if (editingRowIndex !== targetRowIdx) {
          onStartEditing(targetRowIdx)
        }

        // DO NOT use args.selectCell(true) after an async gap — args may be stale
        gridRef.current?.selectCell(
          { rowIdx: targetRowIdx, idx: targetColIdx },
          { enableEditor: true }
        )
      }
    },
    [
      editMode,
      editableColumnMap,
      editingRowIndex,
      editState,
      onAutoSave,
      onStartEditing,
      onRowSelected,
    ]
  )

  // ---------------------------------------------------------------------------
  // Row key getter: use array index (stable for read-only query results).
  // ---------------------------------------------------------------------------
  const rowKeyGetter = useCallback((row: ResultRow) => row.__rowIdx as number, [])

  // ---------------------------------------------------------------------------
  // Row class: editing row + selected row highlight.
  // ---------------------------------------------------------------------------
  const rowClass = useCallback(
    (row: ResultRow) => {
      const rowIdx = row.__rowIdx as number
      const classes: string[] = []

      // Editing row highlight
      if (editingRowIndex !== null && rowIdx === editingRowIndex) {
        classes.push('result-editing-row')
      }

      // Selected row highlight
      if (selectedRowIndex != null) {
        const localSelectedRow = selectedRowIndex - (currentPage - 1) * pageSize
        if (rowIdx === localSelectedRow) {
          classes.push('rdg-row-precision-selected')
        }
      }

      return classes.length > 0 ? classes.join(' ') : undefined
    },
    [selectedRowIndex, currentPage, pageSize, editingRowIndex]
  )

  return (
    <div className={styles.container} data-testid="result-grid-view">
      <DataGrid<ResultRow>
        ref={gridRef}
        columns={rdgColumns}
        rows={rowData}
        sortColumns={sortColumnsRdg}
        onSortColumnsChange={handleSortColumnsChange}
        onCellClick={handleCellClick}
        onColumnResize={handleColumnResize}
        rowKeyGetter={rowKeyGetter}
        rowClass={rowClass}
        data-testid="result-grid-inner"
      />
    </div>
  )
}
