import { useCallback, useMemo } from 'react'
import { columnKey, columnIndexFromKey } from '../../../lib/col-key-utils'
import type { ColumnMeta } from '../../../types/schema'

type SortDirection = 'asc' | 'desc'
type GridSortDirection = 'ASC' | 'DESC'

const GRID_SORT_DIRECTIONS: Record<SortDirection, GridSortDirection> = {
  asc: 'ASC',
  desc: 'DESC',
}

const RESULT_SORT_DIRECTIONS: Record<GridSortDirection, SortDirection> = {
  ASC: 'asc',
  DESC: 'desc',
}

interface ResultGridSortInputs {
  columns: ColumnMeta[]
  sortColumn: string | null
  sortDirection: SortDirection | null
  onSortChanged: (column: string, direction: SortDirection | null) => void
}

function findSortColumnKey(
  columns: ColumnMeta[],
  sortColumn: string | null,
  sortDirection: SortDirection | null
): string | null {
  if (!sortColumn) return null
  if (!sortDirection) return null
  const columnIndex = columns.findIndex((column) => column.name === sortColumn)
  if (columnIndex < 0) return null
  return columnKey(columnIndex)
}

export function useResultGridSort(inputs: ResultGridSortInputs) {
  const { columns, sortColumn, sortDirection, onSortChanged } = inputs

  const sortColumnKey = useMemo(
    () => findSortColumnKey(columns, sortColumn, sortDirection),
    [sortColumn, sortDirection, columns]
  )

  const sortDirectionUpper = sortDirection ? GRID_SORT_DIRECTIONS[sortDirection] : null

  const handleSortChange = useCallback(
    (requestedColumnKey: string | null, direction: GridSortDirection | null) => {
      if (!requestedColumnKey) {
        if (sortColumn) onSortChanged(sortColumn, null)
        return
      }
      const columnName = columns[columnIndexFromKey(requestedColumnKey)]?.name
      if (!columnName) return
      onSortChanged(columnName, direction ? RESULT_SORT_DIRECTIONS[direction] : null)
    },
    [columns, sortColumn, onSortChanged]
  )

  return { sortColumnKey, sortDirectionUpper, handleSortChange }
}
