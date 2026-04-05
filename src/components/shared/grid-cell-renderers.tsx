/**
 * Shared cell renderers for react-data-grid.
 *
 * Adapted from the original `TableDataCellRenderer` in grid-cell-editors.tsx
 * to work with react-data-grid's `RenderCellProps<R>` interface.
 *
 * - renderCellValue: shared NULL/BLOB/normal value display logic
 * - TableDataCellRenderer: displays NULL/BLOB indicators with styled spans
 */

import type { RenderCellProps } from 'react-data-grid'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined
}

// ---------------------------------------------------------------------------
// renderCellValue — shared NULL/BLOB/normal value display
// ---------------------------------------------------------------------------

/**
 * Renders a cell value as a React node with consistent NULL/BLOB handling.
 *
 * - null / undefined → `<span class="td-null-value">NULL</span>`
 * - string starting with "[BLOB" → `<span class="td-blob-value">{value}</span>`
 * - anything else → `<span>{String(value)}</span>`
 */
export function renderCellValue(value: unknown): React.ReactNode {
  if (isNullish(value)) {
    return <span className="td-null-value">NULL</span>
  }

  if (typeof value === 'string' && value.startsWith('[BLOB')) {
    return <span className="td-blob-value">{value}</span>
  }

  return <span>{String(value)}</span>
}

// ---------------------------------------------------------------------------
// TableDataCellRenderer — NULL/BLOB display for react-data-grid
// ---------------------------------------------------------------------------

/**
 * Cell renderer that displays NULL values with muted styling and BLOB values
 * distinctively. Designed for react-data-grid's `renderCell` column property.
 *
 * Reads the cell value from `row[column.key]`.
 */
export function TableDataCellRenderer<R extends Record<string, unknown>>(
  props: RenderCellProps<R>
) {
  const value = props.row[props.column.key as keyof R]
  return renderCellValue(value)
}
