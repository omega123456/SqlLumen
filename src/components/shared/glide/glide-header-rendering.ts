import type { DrawHeaderCallback, Theme } from '@glideapps/glide-data-grid'
import type { GridColumn, GridSortColumn } from './glide-grid-types'
import { drawHighlightedColumnBackground } from './glide-drawers'

export type HeaderDrawArgs = Parameters<DrawHeaderCallback>[0]

export interface GridColumnHeaderMeta {
  sortDirection: 'ASC' | 'DESC' | undefined
  isReadOnly: boolean
  hasFkLink: boolean
  isHighlighted: boolean
}

export function getSortIconName(direction: 'ASC' | 'DESC'): string {
  return direction === 'ASC' ? '↑' : '↓'
}

export function buildHeaderMeta(
  column: GridColumn<unknown>,
  sortColumns: GridSortColumn[],
  highlightedColumnKey: string | undefined
): GridColumnHeaderMeta {
  const sort = sortColumns.find((s) => s.columnKey === column.key)
  return {
    sortDirection: sort?.direction,
    isReadOnly: column.editable !== true,
    hasFkLink: column.foreignKey != null,
    isHighlighted: highlightedColumnKey === column.key,
  }
}

export function drawCustomHeader(
  ctx: CanvasRenderingContext2D,
  args: HeaderDrawArgs,
  meta: GridColumnHeaderMeta,
  theme: Theme
): void {
  if (meta.isHighlighted) {
    drawHighlightedColumnBackground(ctx, args.rect, theme.bgSearchResult)
  }

  ctx.fillStyle = meta.isHighlighted ? theme.textHeaderSelected : theme.textHeader
  ctx.font = `${theme.headerFontStyle} ${theme.fontFamily}`
  ctx.textAlign = 'left'
  ctx.fillText(
    args.column.title,
    args.rect.x + theme.cellHorizontalPadding,
    args.rect.y + args.rect.height / 2 + 4
  )

  let x = args.rect.x + args.rect.width - 8
  ctx.textAlign = 'right'
  if (meta.sortDirection) {
    ctx.fillText(getSortIconName(meta.sortDirection), x, args.rect.y + args.rect.height / 2 + 4)
    x -= 14
  }
  if (meta.hasFkLink) {
    ctx.fillText('↗', x, args.rect.y + args.rect.height / 2 + 4)
    x -= 14
  }
  if (meta.isReadOnly) {
    ctx.fillText('🔒', x, args.rect.y + args.rect.height / 2 + 4)
  }
  ctx.textAlign = 'left'
}
