import { useCallback, useMemo } from 'react'
import { columnKey, columnIndexFromKey } from '../../../../lib/col-key-utils'
import type { ColumnMeta, ResultViewSort } from '../../../../types/schema'
import type { DataViewSurfaceRef } from '../../../../stores/data-view/data-view-types'
import { requestNavigationAction } from '../../../../stores/data-view/navigation-guard'
import { sortView, type ColumnSortChange } from '../../../../stores/data-view/view-actions'

type SortDirection = 'asc' | 'desc'
type GridSortDirection = 'ASC' | 'DESC'

const GRID_SORT_DIRECTIONS: Record<SortDirection, GridSortDirection> = {
  asc: 'ASC',
  desc: 'DESC',
}

const VIEW_SORT_DIRECTIONS: Record<GridSortDirection, SortDirection> = {
  ASC: 'asc',
  DESC: 'desc',
}

interface DataGridSortInputs {
  ref: DataViewSurfaceRef
  columns: ColumnMeta[]
  sort: ResultViewSort | null
}

function findSortColumnKey(columns: ColumnMeta[], sort: ResultViewSort | null): string | null {
  if (!sort) return null
  const columnIndex = columns.findIndex((column) => column.name === sort.column)
  if (columnIndex < 0) return null
  return columnKey(columnIndex)
}

function requestSort(ref: DataViewSurfaceRef, change: ColumnSortChange) {
  requestNavigationAction(ref, () => void sortView(ref, change))
}

export function useDataGridSort({ ref, columns, sort }: DataGridSortInputs) {
  const sortColumnKey = useMemo(() => findSortColumnKey(columns, sort), [sort, columns])
  const sortDirectionUpper = sort ? GRID_SORT_DIRECTIONS[sort.direction] : null
  const sortedColumn = sort?.column ?? null

  const handleSortChange = useCallback(
    (requestedColumnKey: string | null, direction: GridSortDirection | null) => {
      if (!requestedColumnKey) {
        if (sortedColumn) requestSort(ref, { column: sortedColumn, direction: null })
        return
      }
      const columnName = columns[columnIndexFromKey(requestedColumnKey)]?.name
      if (!columnName) return
      const viewDirection = direction ? VIEW_SORT_DIRECTIONS[direction] : null
      requestSort(ref, { column: columnName, direction: viewDirection })
    },
    [columns, sortedColumn, ref]
  )

  return { sortColumnKey, sortDirectionUpper, handleSortChange }
}
