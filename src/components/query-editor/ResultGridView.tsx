/**
 * AG Grid wrapper for displaying query results.
 *
 * Uses AG Grid Community with a custom Precision Studio theme.
 * Sorting is managed externally (server-side in Phase 5.3) — AG Grid's
 * built-in sort is disabled via `comparator: () => 0` while keeping
 * visual sort indicators via `sortable: true`.
 */

import { useCallback, useMemo } from 'react'
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community'
import type { ColDef, SortChangedEvent, RowClickedEvent, CellClassParams } from 'ag-grid-community'
import { AgGridReact } from 'ag-grid-react'
import { formatCellValue } from '../../lib/result-cell-utils'
import type { ColumnMeta } from '../../types/schema'
import styles from './ResultGridView.module.css'

// Register AG Grid Community modules (idempotent)
ModuleRegistry.registerModules([AllCommunityModule])

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
}

/**
 * No-op comparator — disables AG Grid's client-side sort while keeping
 * visual sort indicators intact. Server-side sort handled in Phase 5.3.
 */
const NOOP_COMPARATOR = () => 0

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
}: ResultGridViewProps) {
  // Build column definitions from ColumnMeta[]
  const columnDefs: ColDef[] = useMemo(() => {
    return columns.map((col, i) => ({
      headerName: col.name,
      field: `col_${i}`,
      sortable: true,
      resizable: true,
      unSortIcon: true,
      comparator: NOOP_COMPARATOR,
      // Show sort indicator for the currently sorted column
      sort:
        col.name === sortColumn && sortDirection ? (sortDirection as 'asc' | 'desc') : undefined,
      cellClassRules: {
        'ag-cell-null': (params: CellClassParams) => formatCellValue(params.value).isNull,
      },
      valueFormatter: (params: { value: unknown }) => formatCellValue(params.value).displayValue,
    }))
  }, [columns, sortColumn, sortDirection])

  // Transform array-of-arrays to array-of-objects for AG Grid
  const rowData = useMemo(() => {
    return rows.map((row) => {
      const obj: Record<string, unknown> = {}
      columns.forEach((_, i) => {
        obj[`col_${i}`] = row[i] ?? null
      })
      return obj
    })
  }, [rows, columns])

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

  // Apply custom selected-row class (convert absolute index to local)
  const getRowClass = useCallback(
    (params: { rowIndex: number | undefined }) => {
      if (selectedRowIndex == null || params.rowIndex == null) return undefined
      const localSelectedRow = selectedRowIndex - (currentPage - 1) * pageSize
      if (params.rowIndex === localSelectedRow) {
        return 'ag-row-precision-selected'
      }
      return undefined
    },
    [selectedRowIndex, currentPage, pageSize]
  )

  return (
    <div className={`ag-theme-precision ${styles.container}`} data-testid="result-grid-view">
      <AgGridReact
        theme="legacy"
        columnDefs={columnDefs}
        rowData={rowData}
        suppressMultiSort={true}
        animateRows={false}
        headerHeight={32}
        rowHeight={28}
        onSortChanged={handleSortChanged}
        onRowClicked={handleRowClicked}
        getRowClass={getRowClass}
        suppressCellFocus={true}
        enableCellTextSelection={true}
      />
    </div>
  )
}
