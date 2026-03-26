/**
 * TableDataGrid — AG Grid wrapper configured for editable table data.
 *
 * Uses AG Grid Community with the Precision Studio theme.
 * Handles cell editing, NULL display, modified cell indicators, and row management.
 */

import {
  useCallback,
  useMemo,
  useState,
  useRef,
  useImperativeHandle,
  forwardRef,
  useEffect,
} from 'react'
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community'
import type {
  ColDef,
  SortChangedEvent,
  RowClickedEvent,
  CellEditingStartedEvent,
  CellEditingStoppedEvent,
  ICellEditorParams,
  ICellRendererParams,
  FilterChangedEvent,
  GetRowIdParams,
} from 'ag-grid-community'
import { AgGridReact } from 'ag-grid-react'
import { useTableDataStore, isSameRowKey } from '../../stores/table-data-store'
import type { TableDataColumnMeta, PrimaryKeyInfo, AgGridFilterModel } from '../../types/schema'
import styles from './TableDataGrid.module.css'

// Register AG Grid Community modules (idempotent)
ModuleRegistry.registerModules([AllCommunityModule])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** No-op comparator — disables AG Grid client-side sorting. */
const NOOP_COMPARATOR = () => 0

/** Build a row key from row data and PK columns. */
function getRowKey(data: Record<string, unknown>, pkColumns: string[]): Record<string, unknown> {
  if (data.__tempId != null) {
    return { __tempId: data.__tempId }
  }
  const key: Record<string, unknown> = {}
  for (const col of pkColumns) {
    key[col] = data[col]
  }
  return key
}

// ---------------------------------------------------------------------------
// Column definition builder
// ---------------------------------------------------------------------------

/** Numeric MySQL/MariaDB type prefixes — these columns use agNumberColumnFilter. */
const NUMERIC_TYPE_PREFIXES = [
  'INT',
  'INTEGER',
  'TINYINT',
  'SMALLINT',
  'MEDIUMINT',
  'BIGINT',
  'FLOAT',
  'DOUBLE',
  'DECIMAL',
  'NUMERIC',
  'REAL',
]

/** Choose the correct AG Grid column filter based on data type. */
export function getFilterType(col: TableDataColumnMeta): string | false {
  if (col.isBinary) return false
  const upperType = col.dataType.toUpperCase()
  if (NUMERIC_TYPE_PREFIXES.some((prefix) => upperType.startsWith(prefix))) {
    return 'agNumberColumnFilter'
  }
  return 'agTextColumnFilter'
}

export function buildColumnDefs(
  columns: TableDataColumnMeta[],
  _pkColumns: string[],
  isReadOnly: boolean,
  hasPk: boolean
): ColDef[] {
  return columns.map((col) => {
    const editable = !isReadOnly && hasPk && !col.isBinary

    const colDef: ColDef = {
      field: col.name,
      headerName: col.name,
      sortable: true,
      resizable: true,
      unSortIcon: true,
      comparator: NOOP_COMPARATOR,
      editable,
      filter: getFilterType(col),
      cellRenderer: 'tableDataCellRenderer',
      cellEditorPopup: false,
    }

    if (editable) {
      colDef.cellEditor = 'nullableCellEditor'
      colDef.cellEditorParams = {
        isNullable: col.isNullable,
        columnMeta: col,
      }
    }

    return colDef
  })
}

// ---------------------------------------------------------------------------
// Custom cell renderer — NULL/BLOB display
// ---------------------------------------------------------------------------

function TableDataCellRenderer(props: ICellRendererParams) {
  if (props.value === null || props.value === undefined) {
    return <span className="td-null-value">NULL</span>
  }
  if (typeof props.value === 'string' && props.value.startsWith('[BLOB')) {
    return <span className="td-blob-value">{props.value}</span>
  }
  return <span>{String(props.value)}</span>
}

// ---------------------------------------------------------------------------
// Custom cell editor — input + NULL toggle
// ---------------------------------------------------------------------------

interface NullableCellEditorProps extends ICellEditorParams {
  isNullable?: boolean
  columnMeta?: TableDataColumnMeta
}

const NullableCellEditor = forwardRef(function NullableCellEditor(
  props: NullableCellEditorProps,
  ref: React.Ref<{ getValue: () => unknown }>
) {
  const isNullable = props.isNullable ?? false
  const initialNull = props.value === null || props.value === undefined
  const [isNull, setIsNull] = useState(initialNull)
  const [value, setValue] = useState(initialNull ? '' : String(props.value ?? ''))
  const inputRef = useRef<HTMLInputElement>(null)

  useImperativeHandle(ref, () => ({
    getValue: () => (isNull ? null : value),
    isCancelBeforeStart: () => false,
    isCancelAfterEnd: () => false,
  }))

  useEffect(() => {
    // Auto-focus the input after the editor mounts
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const handleToggleNull = useCallback(() => {
    if (isNull) {
      setIsNull(false)
      // Restore with empty string
      setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      setIsNull(true)
      setValue('')
    }
  }, [isNull])

  return (
    <div className={styles.cellEditorWrapper}>
      <input
        ref={inputRef}
        className="td-cell-editor-input"
        value={isNull ? 'NULL' : value}
        disabled={isNull}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // Let AG Grid handle Tab/Enter/Escape
          if (e.key === 'Tab' || e.key === 'Enter' || e.key === 'Escape') {
            return
          }
        }}
      />
      {isNullable && (
        <button
          type="button"
          className={`td-null-toggle ${isNull ? 'td-null-active' : ''}`}
          onClick={handleToggleNull}
          tabIndex={-1}
        >
          NULL
        </button>
      )}
    </div>
  )
})

// ---------------------------------------------------------------------------
// TableDataGrid component
// ---------------------------------------------------------------------------

interface TableDataGridProps {
  tabId: string
  isReadOnly: boolean
}

export function TableDataGrid({ tabId, isReadOnly }: TableDataGridProps) {
  const tabState = useTableDataStore((state) => state.tabs[tabId])
  const startEditing = useTableDataStore((state) => state.startEditing)
  const updateCellValue = useTableDataStore((state) => state.updateCellValue)
  const commitEditingRowIfNeeded = useTableDataStore((state) => state.commitEditingRowIfNeeded)
  const setSelectedRow = useTableDataStore((state) => state.setSelectedRow)
  const requestNavigationAction = useTableDataStore((state) => state.requestNavigationAction)
  const sortByColumn = useTableDataStore((state) => state.sortByColumn)
  const applyFilters = useTableDataStore((state) => state.applyFilters)

  const columns = useMemo(() => tabState?.columns ?? [], [tabState?.columns])
  const rows = useMemo(() => tabState?.rows ?? [], [tabState?.rows])
  const primaryKey: PrimaryKeyInfo | null = tabState?.primaryKey ?? null
  const editState = tabState?.editState ?? null
  const sort = tabState?.sort ?? null

  const pkColumns = useMemo(() => primaryKey?.keyColumns ?? [], [primaryKey?.keyColumns])
  const hasPk = primaryKey !== null

  // Framework components for AG Grid
  const components = useMemo(
    () => ({
      tableDataCellRenderer: TableDataCellRenderer,
      nullableCellEditor: NullableCellEditor,
    }),
    []
  )

  // Build column definitions
  const columnDefs = useMemo(() => {
    const defs = buildColumnDefs(columns, pkColumns, isReadOnly, hasPk)
    // Apply sort indicator
    if (sort) {
      const sortDef = defs.find((d) => d.field === sort.column)
      if (sortDef) {
        sortDef.sort = sort.direction as 'asc' | 'desc'
      }
    }
    return defs
  }, [columns, pkColumns, isReadOnly, hasPk, sort])

  // Transform array-of-arrays to array-of-objects with __rowIndex for identification
  const rowData = useMemo(() => {
    return rows.map((row, rowIdx) => {
      const obj: Record<string, unknown> = { __rowIndex: rowIdx }
      columns.forEach((col, i) => {
        obj[col.name] = row[i] ?? null
      })
      // Carry forward __tempId for new rows
      if (editState?.isNewRow && editState.tempId && rowIdx === rows.length - 1) {
        obj.__tempId = editState.tempId
      }
      return obj
    })
  }, [rows, columns, editState])

  // Unique row ID for AG Grid
  const getRowId = useCallback(
    (params: GetRowIdParams) => {
      if (params.data.__tempId) return String(params.data.__tempId)
      if (pkColumns.length > 0) {
        return pkColumns.map((c) => String(params.data[c] ?? '')).join('|')
      }
      return String(params.data.__rowIndex)
    },
    [pkColumns]
  )

  // Row class callback — apply editing / new row styles
  const getRowClass = useCallback(
    (params: { data?: Record<string, unknown> }) => {
      if (!params.data || !editState) return undefined
      const rowKey = getRowKey(params.data, pkColumns)
      const isEditing = isSameRowKey(rowKey, editState.rowKey)
      if (isEditing && editState.isNewRow) return 'td-editing-row td-new-row'
      if (isEditing) return 'td-editing-row'
      return undefined
    },
    [editState, pkColumns]
  )

  // Cell class callback — apply modified cell + editable cell classes
  const cellClassRules = useMemo(() => {
    return {
      'td-modified-cell': (params: {
        colDef?: { field?: string }
        data?: Record<string, unknown>
      }) => {
        if (!editState || !params.colDef?.field || !params.data) return false
        const rowKey = getRowKey(params.data, pkColumns)
        if (!isSameRowKey(rowKey, editState.rowKey)) return false
        return editState.modifiedColumns.has(params.colDef.field)
      },
      'td-editable-cell': () => !isReadOnly && hasPk,
    }
  }, [editState, pkColumns, isReadOnly, hasPk])

  // When a cell starts editing
  const onCellEditingStarted = useCallback(
    async (event: CellEditingStartedEvent) => {
      if (!event.data) return
      const newRowKey = getRowKey(event.data, pkColumns)
      const currentEditRowKey = tabState?.editState?.rowKey ?? null

      // Only commit + start new edit if switching to a DIFFERENT row
      if (!isSameRowKey(newRowKey, currentEditRowKey)) {
        // Commit the old row first (async save) — await so we don't
        // reset edit state before the save completes.
        await commitEditingRowIfNeeded(tabId, newRowKey)

        // Check if save failed — if so, snap back to the failed row
        const updatedState = useTableDataStore.getState().tabs[tabId]
        if (updatedState?.saveError) {
          // Save failed — cancel editing the new cell and restore selection
          // to the failed row. editState remains on the original row.
          if (updatedState.editState) {
            setSelectedRow(tabId, updatedState.editState.rowKey)
          }
          event.api.stopEditing(true) // cancel the new cell's editing
          return
        }

        // Start tracking the new row
        const currentValues: Record<string, unknown> = {}
        columns.forEach((col) => {
          currentValues[col.name] = event.data[col.name]
        })
        startEditing(tabId, newRowKey, currentValues)
      }
      // If same row: don't reset edit state — preserve existing tracked changes
    },
    [
      pkColumns,
      tabId,
      commitEditingRowIfNeeded,
      startEditing,
      columns,
      tabState?.editState?.rowKey,
      setSelectedRow,
    ]
  )

  // When cell editing completes — update the store value
  const onCellEditingStopped = useCallback(
    (event: CellEditingStoppedEvent) => {
      if (!event.colDef?.field) return
      const colName = event.colDef.field
      const newValue = event.newValue

      // Only update if value actually changed
      if (event.oldValue !== newValue) {
        updateCellValue(tabId, colName, newValue)
      }
    },
    [tabId, updateCellValue]
  )

  // Handle row click — update selection
  const handleRowClicked = useCallback(
    (event: RowClickedEvent) => {
      if (!event.data) return
      const rowKey = getRowKey(event.data, pkColumns)
      setSelectedRow(tabId, rowKey)
    },
    [pkColumns, tabId, setSelectedRow]
  )

  // Handle sort changed
  const handleSortChanged = useCallback(
    (event: SortChangedEvent) => {
      const colState = event.api.getColumnState()
      const sortedCol = colState.find((c) => c.sort != null)

      if (!sortedCol) {
        if (sort?.column) {
          requestNavigationAction(tabId, () => {
            sortByColumn(tabId, sort.column, null)
          })
        }
        return
      }

      const colName = sortedCol.colId
      const direction = sortedCol.sort as 'asc' | 'desc'
      requestNavigationAction(tabId, () => {
        sortByColumn(tabId, colName, direction)
      })
    },
    [sort, tabId, requestNavigationAction, sortByColumn]
  )

  // Handle filter changed
  const handleFilterChanged = useCallback(
    (event: FilterChangedEvent) => {
      const model = event.api.getFilterModel() as AgGridFilterModel
      requestNavigationAction(tabId, () => {
        applyFilters(tabId, model)
      })
    },
    [tabId, requestNavigationAction, applyFilters]
  )

  // Apply cellClassRules as defaultColDef
  const defaultColDef = useMemo(
    () => ({
      cellClassRules,
    }),
    [cellClassRules]
  )

  return (
    <div className={`ag-theme-precision ${styles.container}`} data-testid="table-data-grid">
      <AgGridReact
        theme="legacy"
        columnDefs={columnDefs}
        rowData={rowData}
        defaultColDef={defaultColDef}
        components={components}
        suppressMultiSort={true}
        animateRows={false}
        headerHeight={32}
        rowHeight={28}
        suppressMovableColumns={true}
        singleClickEdit={true}
        stopEditingWhenCellsLoseFocus={true}
        onCellEditingStarted={onCellEditingStarted}
        onCellEditingStopped={onCellEditingStopped}
        onRowClicked={handleRowClicked}
        onSortChanged={handleSortChanged}
        onFilterChanged={handleFilterChanged}
        getRowId={getRowId}
        getRowClass={getRowClass}
        suppressCellFocus={false}
        enableCellTextSelection={true}
      />
    </div>
  )
}
