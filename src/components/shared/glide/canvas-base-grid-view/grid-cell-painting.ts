import type { DrawCellCallback } from '@glideapps/glide-data-grid'
import type { GridColumn } from '../glide-grid-types'
import {
  drawForeignKeyEllipsis,
  drawHighlightedColumnBackground,
  drawInfoAffordance,
  drawModifiedCellIndicator,
  drawSelectedRowAccent,
} from '../glide-drawers'
import type { CanvasBaseGridViewProps, GridRow } from './canvas-grid-types'
import { isForeignKeyLookupColumn } from './grid-columns'
import { INFO_AFFORDANCE_GUTTER_PX } from './grid-hit-testing'

export type CellDrawArgs = Parameters<DrawCellCallback>[0]

export interface CellDrawState {
  row: GridRow | undefined
  column: GridColumn<GridRow> | undefined
  isSelected: boolean
  isEditing: boolean
  isHighlightedColumn: boolean
  isModified: boolean
  hasInfoAffordance: boolean
}

interface ModifiedCellCheck {
  row: GridRow | undefined
  column: GridColumn<GridRow> | undefined
  isModifiedCell: CanvasBaseGridViewProps['isModifiedCell']
}

/** Skeleton bar height when the theme has no cell font size. */
const SKELETON_FALLBACK_LINE_PX = 13

export function isCellModified(check: ModifiedCellCheck): boolean {
  const { row, column, isModifiedCell } = check
  if (!row) return false
  if (!column) return false
  return isModifiedCell?.(row, column.key) === true
}

export function drawCellBackground(args: CellDrawArgs, state: CellDrawState): void {
  if (state.isHighlightedColumn) {
    drawHighlightedColumnBackground(args.ctx, args.rect, args.theme.bgSearchResult)
  }
  if (state.isSelected) {
    drawHighlightedColumnBackground(args.ctx, args.rect, args.theme.bgBubbleSelected)
    drawSelectedRowAccent(args.ctx, args.rect, args.theme.accentColor)
  }
  if (state.isEditing) {
    drawHighlightedColumnBackground(args.ctx, args.rect, args.theme.bgHeaderHovered)
  }
}

function drawContentBesideInfoGutter(args: CellDrawArgs, drawContent: () => void): void {
  args.ctx.save()
  args.ctx.beginPath()
  args.ctx.rect(
    args.rect.x,
    args.rect.y,
    Math.max(0, args.rect.width - INFO_AFFORDANCE_GUTTER_PX),
    args.rect.height
  )
  args.ctx.clip()
  drawContent()
  args.ctx.restore()
}

export function drawCellContent(
  args: CellDrawArgs,
  state: CellDrawState,
  drawContent: () => void
): void {
  if (state.hasInfoAffordance) {
    drawContentBesideInfoGutter(args, drawContent)
    return
  }
  drawContent()
}

export function drawCellOverlays(args: CellDrawArgs, state: CellDrawState): void {
  if (state.isModified) {
    drawModifiedCellIndicator({
      context: args.ctx,
      rect: args.rect,
      color: args.theme.accentColor,
      isDark: false,
    })
  }
  if (state.hasInfoAffordance) {
    drawInfoAffordance(args.ctx, args.rect, args.theme.linkColor)
  }
  const hasForeignKeyLookup = state.row && isForeignKeyLookupColumn(state.column)
  if (hasForeignKeyLookup) {
    drawForeignKeyEllipsis(args.ctx, args.rect, args.theme.linkColor)
  }
}

export function skeletonLineHeight(theme: CellDrawArgs['theme']): number {
  return parseFloat(theme.editorFontSize) || SKELETON_FALLBACK_LINE_PX
}
