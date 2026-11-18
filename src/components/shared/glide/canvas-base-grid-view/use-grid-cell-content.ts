import { useCallback } from 'react'
import { GridCellKind, type GridCell, type Item, type Rectangle } from '@glideapps/glide-data-grid'
import { classifyCellValue } from '../glide-cell-content'
import { NEW_ROW_CLASS } from '../../data-view/row-class-names'
import type { GridColumn } from '../glide-grid-types'
import type { CanvasBaseGridViewProps, GridRow, PendingTypingActivation } from './canvas-grid-types'
import { buildCheckboxCell, buildDataCell, buildEmptyTextCell } from './grid-cell-builders'
import { isEditableColumn, isReadOnlyInEditMode } from './grid-columns'
import type { GridViewModel } from './grid-view-model'

export type RowPredicate = (row: GridRow) => boolean
export type CellForRowBuilder = (row: GridRow, columnIndex: number, rowIndex: number) => GridCell

export interface GridRowClasses {
  isRowSelected: RowPredicate
  isRowEditing: RowPredicate
  isRowNew: RowPredicate
}

interface CellBuildContext extends GridRowClasses {
  column: GridColumn<GridRow>
  activeSelectedRowIndex: number | null
  props: Pick<
    CanvasBaseGridViewProps,
    'isEditMode' | 'editableColumnKeys' | 'isModifiedCell' | 'highlightColumnKey'
  >
  pendingTypingActivation: PendingTypingActivation | null
}

interface CellContentInput {
  model: GridViewModel
  rowClasses: GridRowClasses
  activeSelectedRowIndex: number | null
}

function isSelectedRowClass(rowClass: string | undefined): boolean {
  return rowClass?.includes('selected') === true
}

function isNewRowClass(rowClass: string | undefined): boolean {
  return rowClass?.includes(NEW_ROW_CLASS) === true
}

function isEditingRowClass(rowClass: string | undefined): boolean {
  return rowClass?.includes('editing-row') === true
}

export function useGridRowClasses(
  getRowClass: CanvasBaseGridViewProps['getRowClass']
): GridRowClasses {
  const isRowSelected = useCallback(
    (row: GridRow): boolean => isSelectedRowClass(getRowClass?.(row)),
    [getRowClass]
  )
  const isRowEditing = useCallback(
    (row: GridRow): boolean => isEditingRowClass(getRowClass?.(row)),
    [getRowClass]
  )
  const isRowNew = useCallback(
    (row: GridRow): boolean => isNewRowClass(getRowClass?.(row)),
    [getRowClass]
  )
  return { isRowSelected, isRowEditing, isRowNew }
}

function buildColumnCell(context: CellBuildContext, row: GridRow, rowIndex: number): GridCell {
  const { column, props } = context
  const rawValue = row[column.key]
  if (column.cellKind === 'checkbox') return buildCheckboxCell(rawValue)
  const isSelectedRow = context.activeSelectedRowIndex === rowIndex || context.isRowSelected(row)
  const flags = classifyCellValue(rawValue, column.key, {
    isReadOnly: isReadOnlyInEditMode(column, props.isEditMode, props.editableColumnKeys),
    isModified: props.isModifiedCell?.(row, column.key) ?? false,
    isFkCell: column.foreignKey != null,
    isBlobColumn: column.isBinary === true,
    isSelectedRow: isSelectedRow,
    isEditingRow: context.isRowEditing(row),
    isNewRow: context.isRowNew(row),
    highlightedColumnKey: props.highlightColumnKey,
  })
  return buildDataCell({
    row: row,
    rowIndex: rowIndex,
    column: column,
    flags: flags,
    editable: isEditableColumn(column, props.isEditMode, props.editableColumnKeys),
    pendingTypingActivation: context.pendingTypingActivation,
  })
}

function useCellForRowBuilder(input: CellContentInput): CellForRowBuilder {
  const { model, rowClasses, activeSelectedRowIndex } = input
  const { gridColumns } = model
  const { isEditMode, editableColumnKeys, isModifiedCell, highlightColumnKey } = model.props
  const { isRowSelected, isRowEditing, isRowNew } = rowClasses
  const { pendingTypingActivationRef } = model.refs.editor
  return useCallback(
    (row: GridRow, columnIndex: number, rowIndex: number): GridCell => {
      const column = gridColumns[columnIndex]
      if (!column) return buildEmptyTextCell()
      const context: CellBuildContext = {
        column: column,
        activeSelectedRowIndex: activeSelectedRowIndex,
        isRowSelected: isRowSelected,
        isRowEditing: isRowEditing,
        isRowNew: isRowNew,
        props: { isEditMode, editableColumnKeys, isModifiedCell, highlightColumnKey },
        pendingTypingActivation: pendingTypingActivationRef.current,
      }
      return buildColumnCell(context, row, rowIndex)
    },
    [
      activeSelectedRowIndex,
      editableColumnKeys,
      gridColumns,
      highlightColumnKey,
      isEditMode,
      isModifiedCell,
      isRowEditing,
      isRowNew,
      isRowSelected,
      pendingTypingActivationRef,
    ]
  )
}

export function useGridCellContent(input: CellContentInput) {
  const { source, isWindowed } = input.model
  const buildCellForRow = useCellForRowBuilder(input)

  const getCellContent = useCallback(
    ([columnIndex, rowIndex]: Item): GridCell => {
      const row = source.getRow(rowIndex)
      if (row) return buildCellForRow(row, columnIndex, rowIndex)
      return isWindowed ? { kind: GridCellKind.Loading, allowOverlay: false } : buildEmptyTextCell()
    },
    [buildCellForRow, isWindowed, source]
  )

  const getCellsForSelection = useCallback(
    (rect: Rectangle): readonly (readonly GridCell[])[] =>
      Array.from({ length: rect.height }, (_, rowOffset) =>
        Array.from({ length: rect.width }, (_, columnOffset) =>
          getCellContent([rect.x + columnOffset, rect.y + rowOffset])
        )
      ),
    [getCellContent]
  )

  return { buildCellForRow, getCellContent, getCellsForSelection }
}
