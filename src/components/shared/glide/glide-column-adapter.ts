import type { GridColumn as GlideGridColumn } from '@glideapps/glide-data-grid'
import type { GridColumn } from './glide-grid-types'

const DEFAULT_COLUMN_WIDTH = 150

function readColumnTitle<TRow>(col: GridColumn<TRow>): string {
  return typeof col.name === 'string' ? col.name : col.key
}

function readColumnWidth(width: GridColumn<unknown>['width']): number {
  if (typeof width === 'number' && Number.isFinite(width)) return width
  if (typeof width === 'string') {
    const parsed = Number.parseFloat(width)
    if (Number.isFinite(parsed)) return parsed
  }
  return DEFAULT_COLUMN_WIDTH
}

export function toGlideColumn<TRow>(col: GridColumn<TRow>, index: number): GlideGridColumn {
  return {
    id: col.key || String(index),
    title: readColumnTitle(col),
    width: readColumnWidth(col.width),
  }
}

export function buildGlideColumns<TRow>(
  columns: GridColumn<TRow>[],
  options: { hasRowMarker?: boolean }
): GlideGridColumn[] {
  void options.hasRowMarker
  return columns.map((column, index) => toGlideColumn(column, index))
}
