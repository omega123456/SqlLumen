/**
 * AG Grid wrapper for displaying query results.
 *
 * Uses AG Grid Community with a custom Precision Studio theme.
 * Sorting is managed externally (server-side) — AG Grid's built-in sort
 * is disabled via `comparator: () => 0` while keeping visual sort indicators
 * via `sortable: true`.
 *
 * When `editMode` is set, columns are decorated with editable/read-only
 * styling and cell editors from the shared module are wired up.
 */

import { useCallback, useMemo, useState, useEffect, useRef } from 'react'
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community'
import type {
  ColDef,
  SortChangedEvent,
  RowClickedEvent,
  CellClassParams,
  CellClickedEvent,
  CellEditingStoppedEvent,
} from 'ag-grid-community'
import { AgGridReact } from 'ag-grid-react'
import { LockSimple } from '@phosphor-icons/react'
import { formatCellValue } from '../../lib/result-cell-utils'
import { getResultGridCellClass } from '../../lib/grid-column-style'
import { getTemporalColumnType } from '../../lib/date-utils'
import { useGridAgDimensions } from '../../hooks/use-grid-ag-dimensions'
import { isEnumColumn } from '../table-data/enum-field-utils'
import DateTimeCellEditor from '../table-data/DateTimeCellEditor'
import {
  TableDataCellRenderer,
  NullableCellEditor,
  EnumCellEditor,
} from '../shared/grid-cell-editors'
import type { GridEditContext } from '../shared/grid-cell-editors'
import type { ColumnMeta, TableDataColumnMeta, RowEditState } from '../../types/schema'
import styles from './ResultGridView.module.css'

// Register AG Grid Community modules (idempotent)
ModuleRegistry.registerModules([AllCommunityModule])

// ---------------------------------------------------------------------------
// ReadOnlyColumnHeader — custom header for non-editable columns
// ---------------------------------------------------------------------------

export interface ReadOnlyHeaderParams {
  displayName: string
  progressSort: (multiSort?: boolean) => void
  column: {
    isSortAscending: () => boolean
    isSortDescending: () => boolean
    addEventListener: (eventType: string, listener: () => void) => void
    removeEventListener: (eventType: string, listener: () => void) => void
  }
}

export function ReadOnlyColumnHeader(params: ReadOnlyHeaderParams) {
  const [sortState, setSortState] = useState<'asc' | 'desc' | null>(() => {
    if (params.column.isSortAscending()) return 'asc'
    if (params.column.isSortDescending()) return 'desc'
    return null
  })

  useEffect(() => {
    const listener = () => {
      if (params.column.isSortAscending()) setSortState('asc')
      else if (params.column.isSortDescending()) setSortState('desc')
      else setSortState(null)
    }
    params.column.addEventListener('sortChanged', listener)
    return () => params.column.removeEventListener('sortChanged', listener)
  }, [params.column])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        cursor: 'pointer',
        width: '100%',
        overflow: 'hidden',
      }}
      onClick={() => params.progressSort(false)}
    >
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {params.displayName}
      </span>
      <LockSimple size={10} weight="bold" style={{ opacity: 0.5, flexShrink: 0 }} />
      {sortState === 'asc' && (
        <span className="ag-icon ag-icon-asc" style={{ opacity: 0.6, flexShrink: 0 }} />
      )}
      {sortState === 'desc' && (
        <span className="ag-icon ag-icon-desc" style={{ opacity: 0.6, flexShrink: 0 }} />
      )}
    </div>
  )
}

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
  /** Request a navigation action guarded by unsaved changes dialog. */
  onRequestNavigationAction: (action: () => void) => void
}

/**
 * No-op comparator — disables AG Grid's client-side sort while keeping
 * visual sort indicators intact. Server-side sort is handled externally.
 */
const NOOP_COMPARATOR = () => 0

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
  // onRequestNavigationAction is available for future use but sort wrapping
  // is handled in ResultPanel before onSortChanged reaches this component.
  onRequestNavigationAction: _onRequestNavigationAction,
}: ResultGridViewProps) {
  const { rowHeight, headerHeight } = useGridAgDimensions()
  const pendingEditTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cancel any pending deferred edit on unmount
  useEffect(() => {
    return () => {
      if (pendingEditTimerRef.current !== null) {
        clearTimeout(pendingEditTimerRef.current)
      }
    }
  }, [])

  // Framework components for AG Grid (includes shared cell editors + custom header)
  const components = useMemo(
    () => ({
      tableDataCellRenderer: TableDataCellRenderer,
      nullableCellEditor: NullableCellEditor,
      enumCellEditor: EnumCellEditor,
      dateTimeCellEditor: DateTimeCellEditor,
      readOnlyColumnHeader: ReadOnlyColumnHeader,
    }),
    []
  )

  // AG Grid context — provides callbacks to cell editors.
  // Wraps field-name (col_N) → real column name translation.
  const gridContext: GridEditContext = useMemo(
    () => ({
      tabId,
      updateCellValue: (_tabId: string, fieldName: string, value: unknown) => {
        const colIndex = parseInt(fieldName.replace('col_', ''), 10)
        const realName = columns[colIndex]?.name ?? fieldName
        onUpdateCellValue(realName, value)
      },
      syncCellValue: (
        _tabId: string,
        _rowData: Record<string, unknown> | undefined,
        fieldName: string,
        value: unknown
      ) => {
        const colIndex = parseInt(fieldName.replace('col_', ''), 10)
        const realName = columns[colIndex]?.name ?? fieldName
        onSyncCellValue(realName, value)
      },
    }),
    [tabId, columns, onUpdateCellValue, onSyncCellValue]
  )

  // Build column definitions from ColumnMeta[].
  // Rebuilds when editMode changes (or columns/sort state changes).
  const columnDefs: ColDef[] = useMemo(() => {
    return columns.map((col, i) => {
      const baseDef: ColDef = {
        headerName: col.name,
        field: `col_${i}`,
        sortable: true,
        resizable: true,
        unSortIcon: true,
        comparator: NOOP_COMPARATOR,
        cellClass: getResultGridCellClass(col.dataType),
        sort:
          col.name === sortColumn && sortDirection ? (sortDirection as 'asc' | 'desc') : undefined,
        valueFormatter: (params: { value: unknown }) => formatCellValue(params.value).displayValue,
      }

      // Edit mode enhancements
      if (editMode && editableColumnMap.size > 0) {
        const isEditable = editableColumnMap.get(i) ?? false
        baseDef.editable = isEditable

        if (isEditable) {
          baseDef.cellClass = `${getResultGridCellClass(col.dataType)} col-editable`

          // Find matching table column for cell editor type
          const tableCol = editTableColumns.find(
            (tc) => tc.name.toLowerCase() === col.name.toLowerCase()
          )

          // Choose the right cell editor: temporal → enum → text
          const temporalType = tableCol ? getTemporalColumnType(tableCol.dataType) : null
          if (temporalType) {
            baseDef.cellEditor = 'dateTimeCellEditor'
          } else if (tableCol && isEnumColumn(tableCol)) {
            baseDef.cellEditor = 'enumCellEditor'
          } else {
            baseDef.cellEditor = 'nullableCellEditor'
          }
          baseDef.cellEditorParams = {
            isNullable: tableCol?.isNullable ?? false,
            columnMeta: tableCol,
          }
          baseDef.cellEditorPopup = false

          // Use shared cell renderer for NULL/BLOB display
          baseDef.cellRenderer = 'tableDataCellRenderer'
        } else {
          baseDef.cellClass = `${getResultGridCellClass(col.dataType)} col-readonly`
          baseDef.headerClass = 'col-readonly'
          baseDef.headerComponent = 'readOnlyColumnHeader'
        }
      }

      return baseDef
    })
  }, [columns, sortColumn, sortDirection, editMode, editableColumnMap, editTableColumns])

  // Default column def — includes cell class rules for null and modified indicators.
  const defaultColDef = useMemo(
    () => ({
      cellClassRules: {
        'ag-cell-null': (params: CellClassParams) => formatCellValue(params.value).isNull,
        'cell-modified': (params: CellClassParams) => {
          if (!editMode || !editState || !params.colDef?.field || editingRowIndex === null)
            return false
          if (params.node?.rowIndex !== editingRowIndex) return false
          const colIndex = parseInt(params.colDef.field.replace('col_', ''), 10)
          const realName = columns[colIndex]?.name
          if (!realName) return false
          return editState.modifiedColumns.has(realName)
        },
      },
    }),
    [editMode, editState, editingRowIndex, columns]
  )

  // Transform array-of-arrays to array-of-objects for AG Grid.
  // Overlays editState current values on the editing row.
  const rowData = useMemo(() => {
    return rows.map((row, rowIdx) => {
      const obj: Record<string, unknown> = {}
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

  // Handle AG Grid sort changes — extract column/direction, call parent
  const handleSortChanged = useCallback(
    (event: SortChangedEvent) => {
      const colState = event.api.getColumnState()
      const sortedCol = colState.find((c) => c.sort != null)

      if (!sortedCol) {
        // Sort was cleared — pass the previously sorted column with null direction
        if (sortColumn) {
          onSortChanged(sortColumn, null)
        }
        return
      }

      const colIndex = parseInt(sortedCol.colId.replace('col_', ''), 10)
      const colName = columns[colIndex]?.name
      if (colName) {
        onSortChanged(colName, sortedCol.sort as 'asc' | 'desc')
      }
    },
    [columns, sortColumn, onSortChanged]
  )

  // Handle row click — call parent with row index
  const handleRowClicked = useCallback(
    (event: RowClickedEvent) => {
      if (event.rowIndex != null) {
        onRowSelected(event.rowIndex)
      }
    },
    [onRowSelected]
  )

  // Handle cell click — start editing if editable (edit mode only)
  const handleCellClicked = useCallback(
    async (event: CellClickedEvent) => {
      if (!editMode) return
      if (!event.colDef?.field) return

      const colIndex = parseInt(event.colDef.field.replace('col_', ''), 10)
      const isEditable = editableColumnMap.get(colIndex) ?? false
      if (!isEditable) return

      const rowIndex = event.node?.rowIndex
      if (rowIndex == null) return

      const field = event.colDef.field

      // Cancel any pending deferred edit from a previous rapid click
      if (pendingEditTimerRef.current !== null) {
        clearTimeout(pendingEditTimerRef.current)
        pendingEditTimerRef.current = null
      }

      // If changing rows and there are unsaved edits, auto-save first
      if (editingRowIndex !== null && editingRowIndex !== rowIndex) {
        if (editState && editState.modifiedColumns.size > 0) {
          const saveSucceeded = await onAutoSave()
          if (!saveSucceeded) {
            return // Save failed, stay on current row
          }
        }
      }

      // Start editing the new row if different
      if (editingRowIndex !== rowIndex) {
        onStartEditing(rowIndex)
      }

      // Defer startEditingCell to the next task so AG Grid finishes its click processing
      pendingEditTimerRef.current = setTimeout(() => {
        pendingEditTimerRef.current = null
        event.api.startEditingCell({ rowIndex, colKey: field })
      }, 0)
    },
    [editMode, editableColumnMap, editingRowIndex, editState, onAutoSave, onStartEditing]
  )

  // When cell editing stops — sync final value if needed
  const handleCellEditingStopped = useCallback(
    (event: CellEditingStoppedEvent) => {
      if (!event.colDef?.field) return
      const fieldName = event.colDef.field
      const colIndex = parseInt(fieldName.replace('col_', ''), 10)
      const realName = columns[colIndex]?.name
      if (!realName) return

      // The cell editor already syncs values via context.updateCellValue on every change.
      // Only handle the final value if it differs from what the editor reported.
      const newValue = event.newValue
      const oldValue = event.oldValue
      if (oldValue !== newValue) {
        onUpdateCellValue(realName, newValue)
      }
    },
    [columns, onUpdateCellValue]
  )

  // Apply custom selected-row + editing-row classes
  const getRowClass = useCallback(
    (params: { rowIndex: number | undefined }) => {
      const classes: string[] = []

      // Editing row highlight
      if (editingRowIndex !== null && params.rowIndex === editingRowIndex) {
        classes.push('result-editing-row')
      }

      // Selected row highlight — only shown in edit mode (not read-only)
      if (editMode && selectedRowIndex != null && params.rowIndex != null) {
        const localSelectedRow = selectedRowIndex - (currentPage - 1) * pageSize
        if (params.rowIndex === localSelectedRow) {
          classes.push('ag-row-precision-selected')
        }
      }

      return classes.length > 0 ? classes.join(' ') : undefined
    },
    [selectedRowIndex, currentPage, pageSize, editingRowIndex, editMode]
  )

  return (
    <div className={`ag-theme-precision ${styles.container}`} data-testid="result-grid-view">
      <AgGridReact
        theme="legacy"
        columnDefs={columnDefs}
        rowData={rowData}
        defaultColDef={defaultColDef}
        components={components}
        context={gridContext}
        suppressMultiSort={true}
        animateRows={false}
        headerHeight={headerHeight}
        rowHeight={rowHeight}
        onSortChanged={handleSortChanged}
        onRowClicked={handleRowClicked}
        onCellClicked={editMode ? handleCellClicked : undefined}
        onCellEditingStopped={editMode ? handleCellEditingStopped : undefined}
        getRowClass={getRowClass}
        suppressCellFocus={!editMode}
        suppressClickEdit={true}
        stopEditingWhenCellsLoseFocus={!!editMode}
        enableCellTextSelection={true}
      />
    </div>
  )
}
