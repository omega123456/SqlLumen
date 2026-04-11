/**
 * ResultGridView — thin wrapper around the shared BaseGridView for query results.
 *
 * Responsibilities:
 * - Transforms array-of-arrays rows into keyed Record<string, unknown>[] with col_N keys
 * - Builds GridColumnDescriptor[] from ColumnMeta[] + editableColumnMap
 * - Translates col_N ↔ real column names in sort, cell click guard, and onRowsChange
 * - Adapts the rich RowEditState (schema.ts) to the simple RowEditState (shared-data-view.ts)
 * - Provides isModifiedCell and getRowClass callbacks
 *
 * The external props interface remains unchanged — ResultPanel.tsx does not need modification.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { BaseGridView } from '../shared/BaseGridView'
import { colKey, colIndexFromKey } from '../../lib/col-key-utils'
import { getAutoSizedColumnWidth } from '../../lib/grid-column-style'
import { resolveQueryResultColumns } from '../../lib/query-result-column-utils'
import type { ColumnMeta, TableDataColumnMeta, RowEditState } from '../../types/schema'
import { useQueryStore } from '../../stores/query-store'
import type {
  GridColumnDescriptor,
  RowEditState as SharedRowEditState,
  CellClickGuardArgs,
  CellClickGuardResult,
  CellClipboardEditArgs,
  AutoSizeConfig,
} from '../../types/shared-data-view'
import type { RowsChangeData } from 'react-data-grid'

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
  /** FK metadata from the edit table (single-column constraints only). */
  editForeignKeys?: import('../../types/schema').ForeignKeyColumnInfo[]
  /** Result column index → bound source-table column name. */
  editColumnBindings: Map<number, string>
  /** Start editing a row by its page-local index. */
  onStartEditing: (rowIndex: number) => void
  /** Update a cell value in the edit state (result column index). */
  onUpdateCellValue: (columnIndex: number, value: unknown) => void
  /** Sync a cell value to both edit state and local rows. */
  onSyncCellValue: (columnIndex: number, value: unknown) => void
  /** Auto-save the current editing row (called on row transition). */
  onAutoSave: () => Promise<boolean>
}

const EMPTY_EDITABLE_MAP = new Map<number, boolean>()
const EMPTY_TABLE_COLUMNS: TableDataColumnMeta[] = []
const EMPTY_FOREIGN_KEYS: import('../../types/schema').ForeignKeyColumnInfo[] = []
const EMPTY_BINDINGS = new Map<number, string>()

export function ResultGridView({
  columns,
  rows,
  sortColumn,
  sortDirection,
  onSortChanged,
  onRowSelected,
  selectedRowIndex,
  tabId,
  editMode = null,
  editableColumnMap = EMPTY_EDITABLE_MAP,
  editState = null,
  editingRowIndex = null,
  editTableColumns = EMPTY_TABLE_COLUMNS,
  editForeignKeys = EMPTY_FOREIGN_KEYS,
  editColumnBindings = EMPTY_BINDINGS,
  onStartEditing,
  onUpdateCellValue: _onUpdateCellValue,
  onSyncCellValue,
  onAutoSave,
}: ResultGridViewProps) {
  void _onUpdateCellValue

  const storeSetSelectedCell = useQueryStore((state) => state.setSelectedCell)

  // Refs for stable access in callbacks without re-creating them
  const editStateRef = useRef(editState)
  const editingRowIndexRef = useRef(editingRowIndex)

  useEffect(() => {
    editStateRef.current = editState
  }, [editState])

  useEffect(() => {
    editingRowIndexRef.current = editingRowIndex
  }, [editingRowIndex])

  // ---------------------------------------------------------------------------
  // Table column lookup map — case-insensitive name → TableDataColumnMeta.
  // Used by column descriptors and shared with the form view pattern.
  // ---------------------------------------------------------------------------
  const boundColumnIndexLookup = useMemo(() => {
    const lookup = new Map<string, number>()
    for (const [index, columnName] of editColumnBindings) {
      lookup.set(columnName, index)
    }
    return lookup
  }, [editColumnBindings])

  // ---------------------------------------------------------------------------
  // Row data: transform array-of-arrays to array-of-objects with col_N keys.
  // Overlays editState current values on the editing row.
  // ---------------------------------------------------------------------------
  const rowData: ResultRow[] = useMemo(() => {
    return rows.map((row, rowIdx) => {
      const obj: ResultRow = { __rowIdx: rowIdx }
      columns.forEach((_, i) => {
        obj[colKey(i)] = row[i] ?? null
      })

      if (editState && editingRowIndex !== null && rowIdx === editingRowIndex) {
        for (const [colName, value] of Object.entries(editState.currentValues)) {
          const colIdx = boundColumnIndexLookup.get(colName) ?? -1
          if (colIdx !== -1) {
            obj[colKey(colIdx)] = value
          }
        }
      }

      return obj
    })
  }, [rows, columns, editState, editingRowIndex, boundColumnIndexLookup])

  const resolvedColumns = useMemo(
    () =>
      resolveQueryResultColumns({
        resultColumns: columns,
        editMode,
        editableColumnMap,
        editTableColumns,
        editForeignKeys,
        editColumnBindings,
      }),
    [columns, editMode, editableColumnMap, editTableColumns, editForeignKeys, editColumnBindings]
  )

  // ---------------------------------------------------------------------------
  // Column descriptors: build GridColumnDescriptor[] from ColumnMeta[].
  // ---------------------------------------------------------------------------
  const gridColumns: GridColumnDescriptor[] = useMemo(() => {
    return resolvedColumns.map((column) => ({
      key: column.key,
      displayName: column.displayName,
      dataType: column.dataType,
      editable: column.editable,
      isBinary: false,
      isNullable: column.tableColumnMeta?.isNullable ?? true,
      isPrimaryKey: column.tableColumnMeta?.isPrimaryKey ?? false,
      isUniqueKey: column.tableColumnMeta?.isUniqueKey ?? false,
      enumValues: column.tableColumnMeta?.enumValues,
      tableColumnMeta: column.editable ? column.tableColumnMeta : undefined,
      foreignKey: column.foreignKey,
    }))
  }, [resolvedColumns])

  // ---------------------------------------------------------------------------
  // Sort state: translate between app (lowercase, real names) and BaseGridView
  // (uppercase, col_N keys).
  // ---------------------------------------------------------------------------
  const sortColumnKey = useMemo(() => {
    if (sortColumn && sortDirection) {
      const colIdx = columns.findIndex((c) => c.name === sortColumn)
      if (colIdx >= 0) return colKey(colIdx)
    }
    return null
  }, [sortColumn, sortDirection, columns])

  const sortDirectionUpper = useMemo(() => {
    if (sortDirection) return sortDirection.toUpperCase() as 'ASC' | 'DESC'
    return null
  }, [sortDirection])

  const handleSortChange = useCallback(
    (colKey_: string | null, direction: 'ASC' | 'DESC' | null) => {
      if (!colKey_) {
        // Sort was cleared — pass the previously sorted column with null direction.
        // The store's sortResults action handles the cache-only guard and shows
        // a warning toast when the result is not re-executable.
        if (sortColumn) {
          onSortChanged(sortColumn, null)
        }
        return
      }
      const colIndex = colIndexFromKey(colKey_)
      const colName = columns[colIndex]?.name
      if (colName) {
        const dir = direction ? (direction.toLowerCase() as 'asc' | 'desc') : null
        onSortChanged(colName, dir)
      }
    },
    [columns, sortColumn, onSortChanged]
  )

  // ---------------------------------------------------------------------------
  // Adapt rich RowEditState (schema.ts) to simple RowEditState (shared-data-view.ts).
  // Values are keyed by col_N in the shared version.
  // ---------------------------------------------------------------------------
  const sharedEditState: SharedRowEditState | null = useMemo(() => {
    if (!editState) return null
    // Build a col_N-keyed currentValues/originalValues for BaseGridView
    const currentValues: Record<string, unknown> = {}
    const originalValues: Record<string, unknown> = {}
    for (const [colName, value] of Object.entries(editState.currentValues)) {
      const colIdx = boundColumnIndexLookup.get(colName) ?? -1
      if (colIdx !== -1) {
        currentValues[colKey(colIdx)] = value
      }
    }
    for (const [colName, value] of Object.entries(editState.originalValues)) {
      const colIdx = boundColumnIndexLookup.get(colName) ?? -1
      if (colIdx !== -1) {
        originalValues[colKey(colIdx)] = value
      }
    }
    // Use a serialised rowKey string
    const rowKey =
      typeof editState.rowKey === 'object'
        ? JSON.stringify(editState.rowKey)
        : String(editState.rowKey)
    return { rowKey, currentValues, originalValues }
  }, [editState, boundColumnIndexLookup])

  // ---------------------------------------------------------------------------
  // isModifiedCell: detect modified cells using the rich editState.
  // ---------------------------------------------------------------------------
  const isModifiedCell = useCallback(
    (rowData: Record<string, unknown>, columnKey: string) => {
      if (!editMode) return false
      const currentEditState = editStateRef.current
      const currentEditingRowIndex = editingRowIndexRef.current
      if (!currentEditState || currentEditingRowIndex === null) return false

      const rowIdx = rowData.__rowIdx as number
      if (rowIdx !== currentEditingRowIndex) return false

      // Only bound source columns can be considered modified query-edit fields.
      const colIndex = colIndexFromKey(columnKey)
      const boundName = editColumnBindings.get(colIndex)
      if (!boundName) return false

      return currentEditState.modifiedColumns.has(boundName)
    },
    [editMode, editColumnBindings]
  )

  // ---------------------------------------------------------------------------
  // Cell click guard: handles row selection, auto-save, and edit initiation.
  // ---------------------------------------------------------------------------
  const cellClickGuard = useMemo(() => {
    if (!editMode) return undefined

    return async (args: CellClickGuardArgs): Promise<CellClickGuardResult> => {
      const { rowIdx, columnKey } = args

      const colIndex = colIndexFromKey(columnKey)
      const isEditable = editableColumnMap.get(colIndex) ?? false

      // Determine target column index for selectCell
      const targetColIdx = colIndexFromKey(columnKey)

      // Run async guard (save, validate) if switching rows
      const currentEditingRow = editingRowIndexRef.current
      const currentEditState = editStateRef.current
      if (currentEditingRow !== null && currentEditingRow !== rowIdx) {
        if (currentEditState && currentEditState.modifiedColumns.size > 0) {
          const saveSucceeded = await onAutoSave()
          if (!saveSucceeded) {
            return {
              proceed: false,
              targetRowIdx: currentEditingRow,
              targetColIdx,
              enableEditor: true,
              restoreFocus: true,
            }
          }
        }
      }

      // Update selection
      onRowSelected(rowIdx)

      // Track selected cell for filter auto-population
      {
        const ci = colIndexFromKey(columnKey)
        const colMeta = columns[ci]
        if (colMeta) {
          storeSetSelectedCell(tabId, {
            columnKey: colMeta.name,
            value: args.rowData[columnKey],
          })
        }
      }

      // Only start editing and enter editor for editable columns
      if (isEditable) {
        if (currentEditingRow !== rowIdx) {
          onStartEditing(rowIdx)
        }
        return { proceed: true, targetRowIdx: rowIdx, targetColIdx, enableEditor: true }
      }

      // Non-editable column: select but don't edit
      return { proceed: true, targetRowIdx: rowIdx, targetColIdx, enableEditor: false }
    }
  }, [
    editMode,
    editableColumnMap,
    onAutoSave,
    onRowSelected,
    onStartEditing,
    columns,
    tabId,
    storeSetSelectedCell,
  ])

  // In read-only mode, we still need a simple cell click handler for row selection.
  // BaseGridView only calls onCellClickGuard; when it's undefined, RDG default behavior
  // applies (no row selection callback). So for read-only mode we provide a minimal guard.
  const readOnlyCellClickGuard = useCallback(
    async (args: CellClickGuardArgs): Promise<CellClickGuardResult> => {
      onRowSelected(args.rowIdx)

      // Track selected cell for filter auto-population
      const ci = colIndexFromKey(args.columnKey)
      const colMeta = columns[ci]
      if (colMeta) {
        storeSetSelectedCell(tabId, {
          columnKey: colMeta.name,
          value: args.rowData[args.columnKey],
        })
      }

      // Allow selectCell so the cell gets focus/selection, but don't open an editor
      const targetColIdx = colIndexFromKey(args.columnKey)
      return {
        proceed: true,
        targetRowIdx: args.rowIdx,
        targetColIdx: targetColIdx >= 0 ? targetColIdx : 0,
        enableEditor: false,
      }
    },
    [onRowSelected, columns, tabId, storeSetSelectedCell]
  )

  // ---------------------------------------------------------------------------
  // onRowsChange: handle cell editor updates via RDG's onRowChange protocol.
  // When a cell editor changes a value, RDG fires onRowsChange. We detect
  // which col_N changed and call onSyncCellValue with the real column name.
  // ---------------------------------------------------------------------------
  const handleRowsChange = useCallback(
    (newRows: Record<string, unknown>[], data: RowsChangeData<Record<string, unknown>>) => {
      // data.indexes contains the indices of changed rows
      if (!data.indexes || data.indexes.length === 0) return

      for (const changedIdx of data.indexes) {
        const newRow = newRows[changedIdx]
        const oldRow = rowData[changedIdx]
        if (!newRow || !oldRow) continue

        // Find which col_N value changed
        for (let i = 0; i < columns.length; i++) {
          const key = colKey(i)
          if (newRow[key] !== oldRow[key]) {
            if (columns[i]) {
              onSyncCellValue(i, newRow[key])
            }
          }
        }
      }
    },
    [columns, rowData, onSyncCellValue]
  )

  const autoSizeConfig: AutoSizeConfig | undefined = useMemo(() => {
    return {
      enabled: true,
      computeWidth: (col, gridRows) => {
        const index = colIndexFromKey(col.key)
        const tableMeta = resolvedColumns[index]?.effectiveTableMeta
        if (!tableMeta) return 150
        // Build a lightweight proxy array that extracts only the target column
        // from each row, avoiding the full row-to-array transformation that
        // previously created N temporary arrays per column.
        const columnRows: unknown[][] = new Array(gridRows.length)
        for (let i = 0; i < gridRows.length; i++) {
          columnRows[i] = [gridRows[i][colKey(index)]]
        }
        // Lock icon shown for non-editable columns in edit mode: 10px icon + 4px gap
        const isEditable = editableColumnMap.get(index) ?? false
        const headerIconWidthPx = !isEditable ? 14 : 0
        return getAutoSizedColumnWidth(
          tableMeta,
          0, // column is at index 0 in our single-column proxy array
          columnRows,
          col.displayName,
          headerIconWidthPx
        )
      },
    }
  }, [columns, resolvedColumns])

  const handleCellClipboardEdit = useCallback(
    async (args: CellClipboardEditArgs) => {
      if (!editMode) return

      const colIndex = colIndexFromKey(args.columnKey)
      const isEditable = editableColumnMap.get(colIndex) ?? false
      if (!columns[colIndex] || !isEditable) return

      const currentEditingRow = editingRowIndexRef.current
      const currentEditState = editStateRef.current
      if (currentEditingRow !== null && currentEditingRow !== args.rowIdx) {
        if (currentEditState && currentEditState.modifiedColumns.size > 0) {
          const saveSucceeded = await onAutoSave()
          if (!saveSucceeded) return
        }
      }

      onRowSelected(args.rowIdx)

      if (currentEditingRow !== args.rowIdx) {
        onStartEditing(args.rowIdx)
      }

      const nextValue =
        args.action === 'cut'
          ? null
          : (args.text ?? (args.rowData[args.columnKey] as string | null))
      onSyncCellValue(colIndex, nextValue)
    },
    [
      editMode,
      columns,
      editableColumnMap,
      onAutoSave,
      onRowSelected,
      onStartEditing,
      onSyncCellValue,
    ]
  )

  // ---------------------------------------------------------------------------
  // Row key getter: return string for BaseGridView compatibility.
  // ---------------------------------------------------------------------------
  const rowKeyGetter = useCallback((row: Record<string, unknown>) => String(row.__rowIdx), [])

  // ---------------------------------------------------------------------------
  // Row class: editing row + selected row highlight.
  // ---------------------------------------------------------------------------
  const getRowClass = useCallback(
    (row: Record<string, unknown>) => {
      const rowIdx = row.__rowIdx as number
      const classes: string[] = []

      // Editing row highlight
      if (editingRowIndex !== null && rowIdx === editingRowIndex) {
        classes.push('rdg-editing-row')
      }

      // Selected row highlight
      if (selectedRowIndex != null && rowIdx === selectedRowIndex) {
        classes.push('rdg-row-precision-selected')
      }

      return classes.length > 0 ? classes.join(' ') : undefined
    },
    [selectedRowIndex, editingRowIndex]
  )

  return (
    <BaseGridView
      rows={rowData}
      columns={gridColumns}
      editState={sharedEditState}
      sortColumn={sortColumnKey}
      sortDirection={sortDirectionUpper}
      onSortChange={handleSortChange}
      onCellClickGuard={editMode ? cellClickGuard : readOnlyCellClickGuard}
      onRowsChange={handleRowsChange}
      onCellClipboardEdit={handleCellClipboardEdit}
      rowKeyGetter={rowKeyGetter}
      getRowClass={getRowClass}
      isModifiedCell={isModifiedCell}
      autoSizeConfig={autoSizeConfig}
      showReadOnlyHeaders={!!editMode}
      testId="result-grid-view"
    />
  )
}
