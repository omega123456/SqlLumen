import type { CellClickedEventArgs, Rectangle } from '@glideapps/glide-data-grid'
import type { CellClickGuardResult } from '../../../../types/shared-data-view'
import type { GridCellPosition, GridColumn, GridHandle } from '../glide-grid-types'
import type { GridRow } from './canvas-grid-types'
import { hasInfoText, isListSelectionColumn } from './grid-columns'

const FOREIGN_KEY_AFFORDANCE_WIDTH_PX = 28
export const INFO_AFFORDANCE_GUTTER_PX = 28

function isPointerInTrailingGutter(event: CellClickedEventArgs, gutterWidth: number): boolean {
  return (event.localEventX ?? 0) >= event.bounds.width - gutterWidth
}

export function isForeignKeyAffordanceClick(
  column: GridColumn<GridRow>,
  event: CellClickedEventArgs
): boolean {
  if (isListSelectionColumn(column)) return false
  if (column.foreignKey == null) return false
  return event.bounds != null && isPointerInTrailingGutter(event, FOREIGN_KEY_AFFORDANCE_WIDTH_PX)
}

export function isInfoAffordanceClick(
  column: GridColumn<GridRow>,
  row: GridRow,
  event: CellClickedEventArgs
): boolean {
  if (!hasInfoText(column, row)) return false
  return event.bounds != null && isPointerInTrailingGutter(event, INFO_AFFORDANCE_GUTTER_PX)
}

export function boundsToDomRect(bounds: Rectangle): DOMRect {
  return new DOMRect(bounds.x, bounds.y, bounds.width, bounds.height)
}

export function proceedWithoutGuard(
  target: GridCellPosition,
  enableEditor: boolean
): CellClickGuardResult {
  return {
    proceed: true,
    targetRowIdx: target.rowIdx,
    targetColIdx: target.idx,
    enableEditor: enableEditor,
  }
}

export function guardTargetCell(guard: CellClickGuardResult): GridCellPosition {
  return { rowIdx: guard.targetRowIdx, idx: guard.targetColIdx }
}

export function selectGuardTarget(grid: GridHandle | null, guard: CellClickGuardResult): void {
  grid?.selectCell(guardTargetCell(guard), {
    shouldFocusCell: true,
    enableEditor: guard.enableEditor,
  })
}

export function restoreFocusAfterRejectedGuard(
  grid: GridHandle | null,
  guard: CellClickGuardResult
): void {
  if (guard.restoreFocus) selectGuardTarget(grid, guard)
}
