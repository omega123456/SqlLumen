import type { GridColumn as GlideGridColumn } from '@glideapps/glide-data-grid'
import type { GridColumn } from './glide-grid-types'

const DEFAULT_COLUMN_WIDTH = 150

function readColumnTitle<TRow>(column: GridColumn<TRow>): string {
  return typeof column.name === 'string' ? column.name : column.key
}

function readColumnWidth(width: GridColumn<unknown>['width']): number {
  const isFiniteWidth = typeof width === 'number' && Number.isFinite(width)
  if (isFiniteWidth) return width
  if (typeof width === 'string') {
    const parsed = Number.parseFloat(width)
    if (Number.isFinite(parsed)) return parsed
  }
  return DEFAULT_COLUMN_WIDTH
}

export function toGlideColumn<TRow>(column: GridColumn<TRow>, index: number): GlideGridColumn {
  return {
    id: column.key || String(index),
    title: readColumnTitle(column),
    width: readColumnWidth(column.width),
  }
}

export function buildGlideColumns<TRow>(
  columns: GridColumn<TRow>[],
  options: { hasRowMarker?: boolean }
): GlideGridColumn[] {
  void options.hasRowMarker
  return columns.map((column, index) => toGlideColumn(column, index))
}
