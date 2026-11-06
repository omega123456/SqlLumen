import type { Rectangle, Theme } from '@glideapps/glide-data-grid'

export function drawSelectedRowAccent(
  ctx: CanvasRenderingContext2D,
  rect: Rectangle,
  color: string
): void {
  ctx.save()
  try {
    ctx.fillStyle = color
    ctx.fillRect(rect.x, rect.y, 2, rect.height)
  } finally {
    ctx.restore()
  }
}

export function drawModifiedCellIndicator(
  ctx: CanvasRenderingContext2D,
  rect: Rectangle,
  color: string,
  isDark: boolean
): void {
  ctx.save()
  try {
    ctx.fillStyle = color
    ctx.strokeStyle = color
    if (isDark) {
      ctx.beginPath()
      ctx.moveTo(rect.x, rect.y + 6)
      ctx.lineTo(rect.x, rect.y)
      ctx.lineTo(rect.x + 6, rect.y)
      ctx.stroke()
      return
    }
    ctx.beginPath()
    ctx.arc(rect.x + rect.width - 8, rect.y + 7, 3, 0, Math.PI * 2)
    ctx.fill()
  } finally {
    ctx.restore()
  }
}

export function drawReadOnlyOverlay(
  ctx: CanvasRenderingContext2D,
  rect: Rectangle,
  color: string
): void {
  ctx.save()
  try {
    ctx.fillStyle = color
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  } finally {
    ctx.restore()
  }
}

export function drawNullText(ctx: CanvasRenderingContext2D, rect: Rectangle, theme: Theme): void {
  ctx.save()
  try {
    ctx.fillStyle = theme.textLight
    ctx.font = `italic ${theme.baseFontStyle} ${theme.fontFamily}`
    ctx.fillText('NULL', rect.x + theme.cellHorizontalPadding, rect.y + rect.height / 2 + 4)
  } finally {
    ctx.restore()
  }
}

export function drawBlobText(
  ctx: CanvasRenderingContext2D,
  rect: Rectangle,
  text: string,
  theme: Theme
): void {
  ctx.save()
  try {
    ctx.fillStyle = theme.textMedium
    ctx.font = `${theme.baseFontStyle} ${theme.fontFamily}`
    ctx.fillText(text, rect.x + theme.cellHorizontalPadding, rect.y + rect.height / 2 + 4)
  } finally {
    ctx.restore()
  }
}

export function drawFkEllipsis(
  ctx: CanvasRenderingContext2D,
  rect: Rectangle,
  color: string
): void {
  ctx.save()
  try {
    ctx.fillStyle = color
    ctx.textAlign = 'right'
    ctx.fillText('…', rect.x + rect.width - 8, rect.y + rect.height / 2 + 4)
  } finally {
    ctx.restore()
  }
}

export function drawInfoAffordance(
  ctx: CanvasRenderingContext2D,
  rect: Rectangle,
  color: string
): void {
  ctx.save()
  try {
    ctx.fillStyle = color
    ctx.textAlign = 'right'
    ctx.fillText('ⓘ', rect.x + rect.width - 8, rect.y + rect.height / 2 + 4)
  } finally {
    ctx.restore()
  }
}

export function drawHighlightedColumnBackground(
  ctx: CanvasRenderingContext2D,
  rect: Rectangle,
  color: string
): void {
  ctx.save()
  try {
    ctx.fillStyle = color
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  } finally {
    ctx.restore()
  }
}

/**
 * Skeleton for a row that isn't loaded yet (wireframe 2): a flat bar in the
 * resolved `--skeleton-base` colour, one text line high, inset by the cell
 * padding. No shimmer and no gradient, and deliberately unlike NULL text.
 */
export function drawSkeletonCell(
  ctx: CanvasRenderingContext2D,
  rect: Rectangle,
  color: string,
  horizontalPadding: number,
  lineHeight: number
): void {
  const width = Math.max(0, rect.width - horizontalPadding * 2)
  const height = Math.max(0, Math.min(lineHeight, rect.height - 4))
  if (width === 0 || height === 0) return
  ctx.save()
  try {
    ctx.fillStyle = color
    ctx.fillRect(
      rect.x + horizontalPadding,
      rect.y + Math.round((rect.height - height) / 2),
      width,
      height
    )
  } finally {
    ctx.restore()
  }
}
