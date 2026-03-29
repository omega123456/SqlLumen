/**
 * TableDataGrid — AG Grid wrapper configured for editable table data.
 *
 * Uses AG Grid Community with the Precision Studio theme.
 * Handles cell editing, NULL display, modified cell indicators, and row management.
 */

import { useCallback, useMemo, useState, useRef, useEffect } from 'react'
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community'
import type {
  CellClickedEvent,
  ColDef,
  SortChangedEvent,
  RowClickedEvent,
  CellEditingStartedEvent,
  CellEditingStoppedEvent,
  FilterChangedEvent,
  GetRowIdParams,
} from 'ag-grid-community'
import { AgGridReact } from 'ag-grid-react'
import { flushSync } from 'react-dom'
import { useTableDataStore, isSameRowKey } from '../../stores/table-data-store'
import { getTemporalColumnType } from '../../lib/date-utils'
import { useToastStore } from '../../stores/toast-store'
import { getTemporalValidationResult } from '../../lib/table-data-save-utils'
import type { TableDataColumnMeta, PrimaryKeyInfo, AgGridFilterModel } from '../../types/schema'
import DateTimeCellEditor from './DateTimeCellEditor'
import { isEnumColumn } from './enum-field-utils'
import { getTableDataGridCellClass, isNumericSqlType } from '../../lib/grid-column-style'
import { useGridAgDimensions } from '../../hooks/use-grid-ag-dimensions'
import {
  TableDataCellRenderer,
  NullableCellEditor,
  EnumCellEditor,
} from '../shared/grid-cell-editors'
import type { GridEditContext } from '../shared/grid-cell-editors'
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
// Column definition builder
// ---------------------------------------------------------------------------

/** Choose the correct AG Grid column filter based on data type. */
export function getFilterType(col: TableDataColumnMeta): string | false {
  if (col.isBinary) return false
  if (isNumericSqlType(col.dataType)) {
    return 'agNumberColumnFilter'
  }
  return 'agTextColumnFilter'
}

export function buildColumnDefs(
  columns: TableDataColumnMeta[],
  isReadOnly: boolean,
  hasPk: boolean,
  pkColumnNames: string[] = []
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
      cellClass: getTableDataGridCellClass(col, pkColumnNames),
      cellRenderer: 'tableDataCellRenderer',
      cellEditorPopup: false,
    }

    if (editable) {
      const temporalType = getTemporalColumnType(col.dataType)
      if (temporalType) {
        colDef.cellEditor = 'dateTimeCellEditor'
      } else if (isEnumColumn(col)) {
        colDef.cellEditor = 'enumCellEditor'
      } else {
        colDef.cellEditor = 'nullableCellEditor'
      }
      colDef.cellEditorParams = {
        isNullable: col.isNullable,
        columnMeta: col,
      }
    }

    return colDef
  })
}

// ---------------------------------------------------------------------------
// TableDataGrid component
// ---------------------------------------------------------------------------

interface TableDataGridProps {
  tabId: string
  isReadOnly: boolean
}

interface ActiveEditingCell {
  rowKey: Record<string, unknown>
  field: string
}

export function TableDataGrid({ tabId, isReadOnly }: TableDataGridProps) {
  const { rowHeight, headerHeight } = useGridAgDimensions()
  const tabState = useTableDataStore((state) => state.tabs[tabId])
  const startEditing = useTableDataStore((state) => state.startEditing)
  const updateCellValue = useTableDataStore((state) => state.updateCellValue)
  const syncCellValue = useTableDataStore((state) => state.syncCellValue)
  const commitEditingRowIfNeeded = useTableDataStore((state) => state.commitEditingRowIfNeeded)
  const setSelectedRow = useTableDataStore((state) => state.setSelectedRow)
  const requestNavigationAction = useTableDataStore((state) => state.requestNavigationAction)
  const sortByColumn = useTableDataStore((state) => state.sortByColumn)
  const applyFilters = useTableDataStore((state) => state.applyFilters)
  const clearEditStateIfUnmodified = useTableDataStore((state) => state.clearEditStateIfUnmodified)
  const showError = useToastStore((state) => state.showError)
  const showSuccess = useToastStore((state) => state.showSuccess)
  const [, setActiveEditingCell] = useState<ActiveEditingCell | null>(null)
  const activeEditingCellRef = useRef<ActiveEditingCell | null>(null)
  const pendingEditTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const columns = useMemo(() => tabState?.columns ?? [], [tabState?.columns])
  const rows = useMemo(() => tabState?.rows ?? [], [tabState?.rows])
  const primaryKey: PrimaryKeyInfo | null = tabState?.primaryKey ?? null
  const editState = tabState?.editState ?? null
  const sort = tabState?.sort ?? null

  // Cancel any pending deferred edit on unmount
  useEffect(() => {
    return () => {
      if (pendingEditTimerRef.current !== null) {
        clearTimeout(pendingEditTimerRef.current)
      }
    }
  }, [])

  const pkColumns = useMemo(() => primaryKey?.keyColumns ?? [], [primaryKey?.keyColumns])
  const hasPk = primaryKey !== null

  // Framework components for AG Grid
  const components = useMemo(
    () => ({
      tableDataCellRenderer: TableDataCellRenderer,
      nullableCellEditor: NullableCellEditor,
      enumCellEditor: EnumCellEditor,
      dateTimeCellEditor: DateTimeCellEditor,
    }),
    []
  )

  // AG Grid context — provides callbacks to cell editors
  const gridContext: GridEditContext = useMemo(
    () => ({
      tabId,
      updateCellValue,
      syncCellValue,
    }),
    [tabId, updateCellValue, syncCellValue]
  )

  // Build column definitions
  const columnDefs = useMemo(() => {
    const defs = buildColumnDefs(columns, isReadOnly, hasPk, pkColumns)
    // Apply sort indicator
    if (sort) {
      const sortDef = defs.find((d) => d.field === sort.column)
      if (sortDef) {
        sortDef.sort = sort.direction as 'asc' | 'desc'
      }
    }
    return defs
  }, [columns, isReadOnly, hasPk, pkColumns, sort])

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

  // Unique row ID for AG Grid
  const getRowId = useCallback(
    (params: GetRowIdParams) => {
      if (params.data.__tempId) return String(params.data.__tempId)
      if (params.data.__editingRowKey && typeof params.data.__editingRowKey === 'object') {
        return Object.values(params.data.__editingRowKey as Record<string, unknown>)
          .map((value) => String(value ?? ''))
          .join('|')
      }
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
      if (!event.data || !event.colDef?.field) return
      const currentState = useTableDataStore.getState().tabs[tabId]
      const currentEditState = currentState?.editState ?? null
      const newRowKey = getRowKey(event.data, pkColumns)
      const currentEditRowKey = currentEditState?.rowKey ?? null
      const nextActiveCell = { rowKey: newRowKey, field: event.colDef.field }

      activeEditingCellRef.current = nextActiveCell
      flushSync(() => {
        setActiveEditingCell(nextActiveCell)
      })

      // Only commit + start new edit if switching to a DIFFERENT row
      if (!isSameRowKey(newRowKey, currentEditRowKey)) {
        const validationError = getTemporalValidationResult(currentEditState, columns)
        if (validationError) {
          activeEditingCellRef.current = null
          flushSync(() => {
            setActiveEditingCell(null)
          })
          showError('Invalid date value', `${validationError.columnName}: ${validationError.error}`)
          if (currentEditState) {
            setSelectedRow(tabId, currentEditState.rowKey)
          }
          event.api.stopEditing(true)
          return
        }

        const hadPendingChanges = (currentEditState?.modifiedColumns.size ?? 0) > 0

        // Commit the old row first (async save) — await so we don't
        // reset edit state before the save completes.
        await commitEditingRowIfNeeded(tabId, newRowKey)

        // Check if save failed — if so, snap back to the failed row
        const updatedState = useTableDataStore.getState().tabs[tabId]
        if (updatedState?.saveError) {
          activeEditingCellRef.current = null
          flushSync(() => {
            setActiveEditingCell(null)
          })
          showError('Save failed', updatedState.saveError)
          // Save failed — cancel editing the new cell and restore selection
          // to the failed row. editState remains on the original row.
          if (updatedState.editState) {
            setSelectedRow(tabId, updatedState.editState.rowKey)
          }
          event.api.stopEditing(true) // cancel the new cell's editing
          return
        }

        if (hadPendingChanges) {
          showSuccess('Row saved', 'Changes saved successfully.')
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
      setSelectedRow,
      showError,
      showSuccess,
    ]
  )

  // When cell editing completes — update the store value
  const onCellEditingStopped = useCallback(
    (event: CellEditingStoppedEvent) => {
      if (!event.colDef?.field) return
      const colName = event.colDef.field
      const newValue = event.newValue
      const rowKey = event.data ? getRowKey(event.data, pkColumns) : null
      const currentActiveCell = activeEditingCellRef.current

      if (
        currentActiveCell &&
        rowKey &&
        currentActiveCell.field === colName &&
        isSameRowKey(currentActiveCell.rowKey, rowKey)
      ) {
        activeEditingCellRef.current = null
        setActiveEditingCell(null)
      }

      // Double-update guard: cell editors (DateTimeCellEditor, NullableCellEditor)
      // sync values to the store on every change. If the store already has this
      // value, skip the redundant updateCellValue call.
      const currentState = useTableDataStore.getState().tabs[tabId]
      const currentEditState = currentState?.editState ?? null

      if (!currentEditState || !rowKey || !isSameRowKey(rowKey, currentEditState.rowKey)) {
        return
      }

      const currentStoreValue = currentEditState.currentValues[colName]

      if (event.oldValue !== newValue) {
        if (currentStoreValue !== newValue) {
          updateCellValue(tabId, colName, newValue)
        }
      } else {
        clearEditStateIfUnmodified(tabId, rowKey)
      }
    },
    [tabId, updateCellValue, clearEditStateIfUnmodified, pkColumns]
  )

  const handleCellClicked = useCallback(
    (event: CellClickedEvent) => {
      if (!event.data || !event.colDef?.field) return
      if (!event.colDef.editable) return

      const rowIndex = event.node?.rowIndex
      if (rowIndex == null) return

      const clickedRowKey = getRowKey(event.data, pkColumns)
      const currentActiveCell = activeEditingCellRef.current

      // Already editing this exact cell — nothing to do
      if (
        currentActiveCell &&
        currentActiveCell.field === event.colDef.field &&
        isSameRowKey(currentActiveCell.rowKey, clickedRowKey)
      ) {
        return
      }

      // Editing a different cell — stop the current editor, then start the new one.
      // We must defer startEditingCell to the next task because stopEditing
      // triggers the cell editor's handleBlur callback synchronously, which calls
      // stopEditing again and would immediately stop the new editor if we started
      // it synchronously.
      if (currentActiveCell) {
        const colKey = event.colDef.field
        // Cancel any pending deferred edit from a previous rapid click
        if (pendingEditTimerRef.current !== null) {
          clearTimeout(pendingEditTimerRef.current)
          pendingEditTimerRef.current = null
        }
        event.api.stopEditing(false)
        activeEditingCellRef.current = null
        flushSync(() => {
          setActiveEditingCell(null)
        })
        // Defer so the outgoing editor's blur → stopEditing chain finishes first
        pendingEditTimerRef.current = setTimeout(() => {
          pendingEditTimerRef.current = null
          event.api.startEditingCell({ rowIndex, colKey })
        }, 0)
        return
      }

      event.api.startEditingCell({ rowIndex, colKey: event.colDef.field })
    },
    [pkColumns]
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
        context={gridContext}
        suppressMultiSort={true}
        animateRows={false}
        headerHeight={headerHeight}
        rowHeight={rowHeight}
        suppressMovableColumns={true}
        singleClickEdit={false}
        suppressClickEdit={true}
        stopEditingWhenCellsLoseFocus={true}
        onCellClicked={handleCellClicked}
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
