import { useCallback } from 'react'
import type { CellClickedEventArgs, Item } from '@glideapps/glide-data-grid'
import type { GridSortColumn } from '../glide-grid-types'
import type { CanvasBaseGridViewProps } from './canvas-grid-types'
import { hasInfoText } from './grid-columns'
import {
  boundsToDomRect,
  isForeignKeyAffordanceClick,
  isInfoAffordanceClick,
} from './grid-hit-testing'
import type { GridViewModel } from './grid-view-model'
import type { PointerCellAction } from './use-grid-pointer-selection'

interface PointerActions {
  selectCellFromPointer: PointerCellAction
  openForeignKeyLookupFromPointer: PointerCellAction
}

type SortChange = Parameters<NonNullable<CanvasBaseGridViewProps['onSortChange']>>

function nextSortChange(
  columnKey: string,
  props: Pick<CanvasBaseGridViewProps, 'sortColumn' | 'sortDirection'>
): SortChange {
  if (props.sortColumn !== columnKey) return [columnKey, 'ASC']
  if (props.sortDirection === 'ASC') return [columnKey, 'DESC']
  return [null, null]
}

export function sortColumnsFor(
  sortColumn: string | null | undefined,
  sortDirection: 'ASC' | 'DESC' | null | undefined
): GridSortColumn[] {
  return sortColumn && sortDirection ? [{ columnKey: sortColumn, direction: sortDirection }] : []
}

function useHeaderClick(model: GridViewModel) {
  const { gridColumns } = model
  const { onSortChange, sortColumn, sortDirection } = model.props
  return useCallback(
    (columnIndex: number) => {
      const column = gridColumns[columnIndex]
      if (!column) return
      if (!onSortChange) return
      if (column.sortable === false) return
      const [columnKey, direction] = nextSortChange(column.key, { sortColumn, sortDirection })
      onSortChange(columnKey, direction)
    },
    [gridColumns, onSortChange, sortColumn, sortDirection]
  )
}

function useCellClick(model: GridViewModel, pointerActions: PointerActions) {
  const { gridColumns, source } = model
  const { onInfoCellClick, onRowClick } = model.props
  const { lastInteractedCellRef } = model.refs.selection
  const { selectCellFromPointer, openForeignKeyLookupFromPointer } = pointerActions
  return useCallback(
    ([columnIndex, rowIndex]: Item, event: CellClickedEventArgs) => {
      const row = source.getRow(rowIndex)
      const column = gridColumns[columnIndex]
      if (!row) return
      if (!column) return
      const position = { rowIdx: rowIndex, idx: columnIndex }
      lastInteractedCellRef.current = position
      if (isForeignKeyAffordanceClick(column, event)) {
        event.preventDefault()
        openForeignKeyLookupFromPointer(position, row, column.key)
        return
      }
      if (isInfoAffordanceClick(column, row, event)) {
        onInfoCellClick?.(row, boundsToDomRect(event.bounds))
        return
      }
      void selectCellFromPointer(position, row, column.key)
      onRowClick?.(row, column.key)
      const infoBounds = hasInfoText(column, row) ? event.bounds : undefined
      if (infoBounds) onInfoCellClick?.(row, boundsToDomRect(infoBounds))
    },
    [
      gridColumns,
      lastInteractedCellRef,
      onInfoCellClick,
      onRowClick,
      openForeignKeyLookupFromPointer,
      selectCellFromPointer,
      source,
    ]
  )
}

function useCellDoubleClick(model: GridViewModel) {
  const { gridColumns, source } = model
  const { onCellDoubleClick, onRowDoubleClicked } = model.props
  return useCallback(
    ([columnIndex, rowIndex]: Item) => {
      const row = source.getRow(rowIndex)
      const column = gridColumns[columnIndex]
      if (!row) return
      if (!column) return
      onCellDoubleClick?.(row, column.key)
      onRowDoubleClicked?.(row)
    },
    [gridColumns, onCellDoubleClick, onRowDoubleClicked, source]
  )
}

export function useGridCellClicks(model: GridViewModel, pointerActions: PointerActions) {
  const handleHeaderClicked = useHeaderClick(model)
  const handleCellClicked = useCellClick(model, pointerActions)
  const handleCellDoubleClicked = useCellDoubleClick(model)
  return { handleHeaderClicked, handleCellClicked, handleCellDoubleClicked }
}
