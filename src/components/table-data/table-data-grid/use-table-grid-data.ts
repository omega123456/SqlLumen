import { useCallback, useMemo } from 'react'
import { useTableDataStore } from '../../../stores/table-data-store'
import type { AutoSizeConfig, GridColumnDescriptor } from '../../../types/shared-data-view'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import { buildColumnDescriptors } from '../table-data-grid-columns'
import {
  buildColumnLookup,
  buildTableDataRow,
  checkedRowKeyOf,
  computeTableColumnWidth,
  readGridTabView,
  type TableDataRow,
} from './table-data-grid-model'

export function useTableGridView(tabId: string, isReadOnly: boolean) {
  const tabState = useTableDataStore((state) => state.tabs[tabId])
  const view = readGridTabView(tabState)
  const { columns, rows, primaryKey, editState, foreignKeys, columnWidths } = view
  const primaryKeyColumns = useMemo(() => primaryKey?.keyColumns ?? [], [primaryKey?.keyColumns])
  const hasPrimaryKey = primaryKey !== null
  const descriptorColumns: GridColumnDescriptor[] = useMemo(
    () =>
      buildColumnDescriptors({
        columns: columns,
        isReadOnly: isReadOnly,
        hasPrimaryKey: hasPrimaryKey,
        foreignKeys: foreignKeys,
        columnWidths: columnWidths,
      }),
    [columns, isReadOnly, hasPrimaryKey, foreignKeys, columnWidths]
  )
  const rowData: TableDataRow[] = useMemo(() => {
    const source = { rows, columns, primaryKeyColumns, editState }
    return rows.map((_, rowIndex) => buildTableDataRow(source, rowIndex))
  }, [rows, columns, primaryKeyColumns, editState])
  const rowDataRef = useLatestRef(rowData)
  return {
    tabState: tabState,
    view: view,
    primaryKeyColumns: primaryKeyColumns,
    hasPrimaryKey: hasPrimaryKey,
    descriptorColumns: descriptorColumns,
    rowData: rowData,
    rowDataRef: rowDataRef,
  }
}

export function useTableAutoSize(view: ReturnType<typeof readGridTabView>): AutoSizeConfig {
  const { columns, rows } = view
  return useMemo(() => {
    const lookup = buildColumnLookup(columns)
    return {
      enabled: true,
      computeWidth: (column: GridColumnDescriptor) => computeTableColumnWidth(lookup, rows, column),
    }
  }, [columns, rows])
}

export function useTableGridLayoutCallbacks(tabId: string, primaryKeyColumns: string[]) {
  const setScrollCell = useTableDataStore((state) => state.setScrollCell)
  const setColumnWidth = useTableDataStore((state) => state.setColumnWidth)
  const setCheckedRowKeys = useTableDataStore((state) => state.setCheckedRowKeys)
  return {
    onScrollCellChange: useCallback(
      (scrollRow: number, scrollColumn: number) => setScrollCell(tabId, scrollRow, scrollColumn),
      [setScrollCell, tabId]
    ),
    onColumnResize: useCallback(
      (columnKey: string, width: number) => setColumnWidth(tabId, columnKey, width),
      [setColumnWidth, tabId]
    ),
    onRowMarkersChange: useCallback(
      (selectedRows: TableDataRow[]) =>
        setCheckedRowKeys(
          tabId,
          selectedRows.map((row) => checkedRowKeyOf(row, primaryKeyColumns))
        ),
      [primaryKeyColumns, setCheckedRowKeys, tabId]
    ),
  }
}
