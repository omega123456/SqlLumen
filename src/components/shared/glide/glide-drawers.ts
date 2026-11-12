import type { Rectangle, Theme } from '@glideapps/glide-data-grid'
import { HALF_DIVISOR, BOTH_SIDES } from '../../../lib/units'

const SELECTED_ROW_ACCENT_WIDTH_PX = 2
const MODIFIED_CORNER_LENGTH_PX = 6
const MODIFIED_DOT_INSET_X_PX = 8
const MODIFIED_DOT_CENTER_Y_PX = 7
const MODIFIED_DOT_RADIUS_PX = 3
const FULL_CIRCLE_RADIANS = Math.PI * BOTH_SIDES
const TEXT_BASELINE_OFFSET_PX = 4
const SKELETON_VERTICAL_INSET_PX = 4
export const TRAILING_ICON_INSET_PX = 8

export function centeredTextBaselineY(rect: Rectangle): number {
  return rect.y + rect.height / HALF_DIVISOR + TEXT_BASELINE_OFFSET_PX
}

export function drawSelectedRowAccent(
  context: CanvasRenderingContext2D,
  rect: Rectangle,
  color: string
): void {
  context.save()
  try {
    context.fillStyle = color
    context.fillRect(rect.x, rect.y, SELECTED_ROW_ACCENT_WIDTH_PX, rect.height)
  } finally {
    context.restore()
  }
}

export function drawModifiedCellIndicator(
  context: CanvasRenderingContext2D,
  rect: Rectangle,
  color: string,
  isDark: boolean
): void {
  context.save()
  try {
    context.fillStyle = color
    context.strokeStyle = color
    if (isDark) {
      context.beginPath()
      context.moveTo(rect.x, rect.y + MODIFIED_CORNER_LENGTH_PX)
      context.lineTo(rect.x, rect.y)
      context.lineTo(rect.x + MODIFIED_CORNER_LENGTH_PX, rect.y)
      context.stroke()
      return
    }
    context.beginPath()
    context.arc(
      rect.x + rect.width - MODIFIED_DOT_INSET_X_PX,
      rect.y + MODIFIED_DOT_CENTER_Y_PX,
      MODIFIED_DOT_RADIUS_PX,
      0,
      FULL_CIRCLE_RADIANS
    )
    context.fill()
  } finally {
    context.restore()
  }
}

export function drawReadOnlyOverlay(
  context: CanvasRenderingContext2D,
  rect: Rectangle,
  color: string
): void {
  context.save()
  try {
    context.fillStyle = color
    context.fillRect(rect.x, rect.y, rect.width, rect.height)
  } finally {
    context.restore()
  }
}

export function drawNullText(
  context: CanvasRenderingContext2D,
  rect: Rectangle,
  theme: Theme
): void {
  context.save()
  try {
    context.fillStyle = theme.textLight
    context.font = `italic ${theme.baseFontStyle} ${theme.fontFamily}`
    context.fillText('NULL', rect.x + theme.cellHorizontalPadding, centeredTextBaselineY(rect))
  } finally {
    context.restore()
  }
}

export function drawBlobText(
  context: CanvasRenderingContext2D,
  rect: Rectangle,
  text: string,
  theme: Theme
): void {
  context.save()
  try {
    context.fillStyle = theme.textMedium
    context.font = `${theme.baseFontStyle} ${theme.fontFamily}`
    context.fillText(text, rect.x + theme.cellHorizontalPadding, centeredTextBaselineY(rect))
  } finally {
    context.restore()
  }
}

export function drawForeignKeyEllipsis(
  context: CanvasRenderingContext2D,
  rect: Rectangle,
  color: string
): void {
  context.save()
  try {
    context.fillStyle = color
    context.textAlign = 'right'
    context.fillText('…', rect.x + rect.width - TRAILING_ICON_INSET_PX, centeredTextBaselineY(rect))
  } finally {
    context.restore()
  }
}

export function drawInfoAffordance(
  context: CanvasRenderingContext2D,
  rect: Rectangle,
  color: string
): void {
  context.save()
  try {
    context.fillStyle = color
    context.textAlign = 'right'
    context.fillText('ⓘ', rect.x + rect.width - TRAILING_ICON_INSET_PX, centeredTextBaselineY(rect))
  } finally {
    context.restore()
  }
}

export function drawHighlightedColumnBackground(
  context: CanvasRenderingContext2D,
  rect: Rectangle,
  color: string
): void {
  context.save()
  try {
    context.fillStyle = color
    context.fillRect(rect.x, rect.y, rect.width, rect.height)
  } finally {
    context.restore()
  }
}

/**
 * Skeleton for a row that isn't loaded yet (wireframe 2): a flat bar in the
 * resolved `--skeleton-base` colour, one text line high, inset by the cell
 * padding. No shimmer and no gradient, and deliberately unlike NULL text.
 */
export function drawSkeletonCell(
  context: CanvasRenderingContext2D,
  rect: Rectangle,
  color: string,
  horizontalPadding: number,
  lineHeight: number
): void {
  const width = Math.max(0, rect.width - horizontalPadding * BOTH_SIDES)
  const height = Math.max(0, Math.min(lineHeight, rect.height - SKELETON_VERTICAL_INSET_PX))
  if (width === 0 || height === 0) return
  context.save()
  try {
    context.fillStyle = color
    context.fillRect(
      rect.x + horizontalPadding,
      rect.y + Math.round((rect.height - height) / HALF_DIVISOR),
      width,
      height
    )
  } finally {
    context.restore()
  }
}
