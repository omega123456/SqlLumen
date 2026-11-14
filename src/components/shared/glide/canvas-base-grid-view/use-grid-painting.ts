import { useCallback, useMemo } from 'react'
import type { DrawCellCallback, DrawHeaderCallback } from '@glideapps/glide-data-grid'
import { useGlideSkeletonColor } from '../../../../hooks/use-glide-grid-theme'
import { drawSkeletonCell } from '../glide-drawers'
import type { GridColumn, GridSortColumn } from '../glide-grid-types'
import { drawCustomHeader } from '../glide-header-rendering'
import type { GridRow } from './canvas-grid-types'
import {
  drawCellBackground,
  drawCellContent,
  drawCellOverlays,
  isCellModified,
  skeletonLineHeight,
  type CellDrawArgs,
  type CellDrawState,
} from './grid-cell-painting'
import { hasInfoText, isListSelectionColumn } from './grid-columns'
import type { GridViewModel } from './grid-view-model'
import { sortColumnsFor } from './use-grid-cell-clicks'
import type { GridRowClasses } from './use-grid-cell-content'

interface GridPaintingInput {
  model: GridViewModel
  rowClasses: GridRowClasses
  activeSelectedRowIndex: number | null
}

function drawUnloadedRowSkeleton(args: CellDrawArgs, skeletonColor: string): void {
  drawSkeletonCell({
    context: args.ctx,
    rect: args.rect,
    color: skeletonColor,
    horizontalPadding: args.theme.cellHorizontalPadding,
    lineHeight: skeletonLineHeight(args.theme),
  })
}

function paintCell(args: CellDrawArgs, state: CellDrawState, drawContent: () => void): void {
  drawCellBackground(args, state)
  drawCellContent(args, state, drawContent)
  drawCellOverlays(args, state)
}

function headerMeta(
  column: GridColumn<GridRow>,
  sortColumns: GridSortColumn[],
  highlightColumnKey: string | undefined
) {
  return {
    sortDirection: sortColumns.find((sort) => sort.columnKey === column.key)?.direction,
    isReadOnly: column.editable !== true && column.blobViewerEditable !== true,
    hasFkLink: column.foreignKey != null && !isListSelectionColumn(column),
    isHighlighted: highlightColumnKey === column.key,
  }
}

function useDrawCell(input: GridPaintingInput): DrawCellCallback {
  const { source, gridColumns, isWindowed } = input.model
  const { highlightColumnKey, isModifiedCell } = input.model.props
  const { isRowSelected, isRowEditing } = input.rowClasses
  const { activeSelectedRowIndex } = input
  const skeletonColor = useGlideSkeletonColor()
  return useCallback<DrawCellCallback>(
    (args, drawContent) => {
      const row = source.getRow(args.row)
      const column = gridColumns[args.col]
      const isUnloadedWindowRow = row === undefined && isWindowed
      if (isUnloadedWindowRow) {
        drawUnloadedRowSkeleton(args, skeletonColor)
        return
      }
      const isSelected = row != null && (activeSelectedRowIndex === args.row || isRowSelected(row))
      paintCell(
        args,
        {
          row: row,
          column: column,
          isSelected: isSelected,
          isEditing: row != null && isRowEditing(row),
          isHighlightedColumn: column?.key === highlightColumnKey,
          isModified: isCellModified({ row: row, column: column, isModifiedCell: isModifiedCell }),
          hasInfoAffordance: hasInfoText(column, row),
        },
        drawContent
      )
    },
    [
      activeSelectedRowIndex,
      gridColumns,
      highlightColumnKey,
      isModifiedCell,
      isRowEditing,
      isRowSelected,
      isWindowed,
      skeletonColor,
      source,
    ]
  )
}

function useDrawHeader(model: GridViewModel): DrawHeaderCallback {
  const { gridColumns } = model
  const { highlightColumnKey, sortColumn, sortDirection } = model.props
  const sortColumns = useMemo(
    () => sortColumnsFor(sortColumn, sortDirection),
    [sortColumn, sortDirection]
  )
  return useCallback<DrawHeaderCallback>(
    (args, drawContent) => {
      const column = gridColumns[args.columnIndex]
      if (!column) {
        drawContent()
        return
      }
      drawCustomHeader({
        context: args.ctx,
        args: args,
        meta: headerMeta(column, sortColumns, highlightColumnKey),
        theme: args.theme,
      })
    },
    [gridColumns, highlightColumnKey, sortColumns]
  )
}

export function useGridPainting(input: GridPaintingInput) {
  const drawCell = useDrawCell(input)
  const drawHeader = useDrawHeader(input.model)
  return { drawCell, drawHeader }
}
