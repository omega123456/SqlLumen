import { forwardRef, useCallback } from 'react'
import type {
  EditableGridCell,
  GridCell,
  GridColumn as GlideColumn,
  Item,
} from '@glideapps/glide-data-grid'
import { GlideDataGrid } from './glide/GlideDataGrid'
import type {
  GridColumn,
  GridHandle,
  GridRowsChangeData,
  GridSortColumn,
} from './glide/glide-grid-types'

export type Column<TRow> = GridColumn<TRow>
export type SortColumn = GridSortColumn
export type DataGridHandle = GridHandle
export type CalculatedColumn<TRow> = GridColumn<TRow> & { idx: number }
export type ColumnWidth = number | string

export interface DataGridWrapperProps<R extends Record<string, unknown>> {
  columns: readonly GridColumn<R>[]
  rows: readonly R[]
  sortColumns?: readonly GridSortColumn[]
  onSortColumnsChange?: (sortColumns: GridSortColumn[]) => void
  onRowsChange?: (rows: R[], data: GridRowsChangeData<R>) => void
  onColumnResize?: (column: CalculatedColumn<R>, width: number) => void
  rowKeyGetter?: (row: R) => string | number
  rowClass?: (row: R) => string | undefined
  getCellContent?: (cell: Item) => GridCell
  onCellEdited?: (cell: Item, newValue: EditableGridCell) => void
  'data-testid'?: string
  className?: string
}

function toGlideColumn<TRow>(column: GridColumn<TRow>): GlideColumn {
  return {
    id: column.key,
    title: typeof column.name === 'string' ? column.name : column.key,
    width: typeof column.width === 'number' ? column.width : 150,
  }
}

function DataGridInner<R extends Record<string, unknown>>(
  props: DataGridWrapperProps<R>,
  ref: React.Ref<GridHandle>
) {
  const { columns, rows, onColumnResize, getCellContent, 'data-testid': testId, className } = props
  const glideColumns = columns.map(toGlideColumn)

  const fallbackGetCellContent = useCallback(
    ([colIndex, rowIndex]: Item): GridCell => {
      const column = columns[colIndex]
      const row = rows[rowIndex]
      return {
        kind: 'text',
        data: column && row ? String(row[column.key] ?? '') : '',
        displayData: column && row ? String(row[column.key] ?? '') : '',
        allowOverlay: true,
      } as GridCell
    },
    [columns, rows]
  )

  const handleColumnResize = useCallback(
    (columnIndex: number, width: number) => {
      const column = columns[columnIndex]
      if (!column) return
      onColumnResize?.({ ...column, idx: columnIndex }, width)
    },
    [columns, onColumnResize]
  )

  return (
    <GlideDataGrid
      ref={ref}
      columns={glideColumns}
      rows={rows}
      getCellContent={getCellContent ?? fallbackGetCellContent}
      onColumnResize={handleColumnResize}
      data-testid={testId}
      className={className}
    />
  )
}

export const DataGrid = forwardRef(DataGridInner) as <R extends Record<string, unknown>>(
  props: DataGridWrapperProps<R> & { ref?: React.Ref<GridHandle> }
) => React.ReactElement | null

export type {
  GridCellPosition,
  GridColumn,
  GridHandle,
  GridRowsChangeData,
  GridSortColumn,
} from './glide/glide-grid-types'
