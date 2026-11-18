import type { DrawHeaderCallback, Theme } from '@glideapps/glide-data-grid'
import type { GridColumn, GridSortColumn } from './glide-grid-types'
import {
  drawHighlightedColumnBackground,
  centeredTextBaselineY,
  TRAILING_ICON_INSET_PX,
} from './glide-drawers'
import { HEADER_ICON_WIDTH_PX } from '../../../lib/grid-column-style'

export type HeaderDrawArgs = Parameters<DrawHeaderCallback>[0]

export interface GridColumnHeaderMeta {
  sortDirection: 'ASC' | 'DESC' | undefined
  isReadOnly: boolean
  isGenerated: boolean
  hasFkLink: boolean
  isHighlighted: boolean
}

export function getSortIconName(direction: 'ASC' | 'DESC'): string {
  return direction === 'ASC' ? '↑' : '↓'
}

export function buildHeaderMeta<TRow>(
  column: GridColumn<TRow>,
  sortColumns: GridSortColumn[],
  highlightedColumnKey: string | undefined
): GridColumnHeaderMeta {
  const sort = sortColumns.find((sortColumn) => sortColumn.columnKey === column.key)
  return {
    sortDirection: sort?.direction,
    isReadOnly: column.editable !== true && column.blobViewerEditable !== true,
    isGenerated: column.isGenerated === true,
    hasFkLink: column.foreignKey != null,
    isHighlighted: highlightedColumnKey === column.key,
  }
}

function editabilityMarkerOf(meta: GridColumnHeaderMeta): string | null {
  if (meta.isGenerated) return 'ƒx'
  if (meta.isReadOnly) return '🔒'
  return null
}

export interface CustomHeaderDrawing {
  context: CanvasRenderingContext2D
  args: HeaderDrawArgs
  meta: GridColumnHeaderMeta
  theme: Theme
}

export function drawCustomHeader({ context, args, meta, theme }: CustomHeaderDrawing): void {
  if (meta.isHighlighted) {
    drawHighlightedColumnBackground(context, args.rect, theme.bgSearchResult)
  }

  context.fillStyle = meta.isHighlighted ? theme.textHeaderSelected : theme.textHeader
  context.font = `${theme.headerFontStyle} ${theme.fontFamily}`
  context.textAlign = 'left'
  context.fillText(
    args.column.title,
    args.rect.x + theme.cellHorizontalPadding,
    centeredTextBaselineY(args.rect)
  )

  let iconX = args.rect.x + args.rect.width - TRAILING_ICON_INSET_PX
  context.textAlign = 'right'
  if (meta.sortDirection) {
    context.fillText(getSortIconName(meta.sortDirection), iconX, centeredTextBaselineY(args.rect))
    iconX -= HEADER_ICON_WIDTH_PX
  }
  if (meta.hasFkLink) {
    context.fillText('↗', iconX, centeredTextBaselineY(args.rect))
    iconX -= HEADER_ICON_WIDTH_PX
  }
  const editabilityMarker = editabilityMarkerOf(meta)
  if (editabilityMarker) {
    context.fillText(editabilityMarker, iconX, centeredTextBaselineY(args.rect))
  }
  context.textAlign = 'left'
}
