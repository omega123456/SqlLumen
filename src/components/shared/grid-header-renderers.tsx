/**
 * Shared header renderers for react-data-grid.
 *
 * - SortStatusRenderer: renders sort direction arrow icons (Phosphor)
 * - ReadOnlyColumnHeaderCell: renders lock icon + column name + sort indicator
 *   for read-only columns
 */

import { ArrowUp, ArrowDown, Lock } from '@phosphor-icons/react'
import type { RenderSortStatusProps, RenderHeaderCellProps } from 'react-data-grid'

// ---------------------------------------------------------------------------
// SortStatusRenderer — sort direction arrow icons
// ---------------------------------------------------------------------------

/**
 * Custom `renderSortStatus` renderer for react-data-grid's `renderers` prop.
 * Shows a Phosphor ArrowUp for ASC, ArrowDown for DESC, nothing otherwise.
 */
export function SortStatusRenderer({ sortDirection }: RenderSortStatusProps) {
  if (sortDirection === 'ASC') {
    return <ArrowUp size={12} weight="bold" style={{ opacity: 0.6 }} />
  }
  if (sortDirection === 'DESC') {
    return <ArrowDown size={12} weight="bold" style={{ opacity: 0.6 }} />
  }
  return null
}

// ---------------------------------------------------------------------------
// ReadOnlyColumnHeaderCell — lock icon header for non-editable columns
// ---------------------------------------------------------------------------

/**
 * Custom `renderHeaderCell` for read-only columns. Renders the column name,
 * a lock icon, and the sort direction indicator (if applicable).
 *
 * CRITICAL: Must also render the sort indicator alongside the lock icon,
 * otherwise sort arrows will be lost on read-only columns.
 */
export function ReadOnlyColumnHeaderCell<R, SR>(props: RenderHeaderCellProps<R, SR>) {
  const { column, sortDirection, tabIndex } = props
  const columnName = typeof column.name === 'string' ? column.name : ''

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        width: '100%',
        overflow: 'hidden',
      }}
      tabIndex={tabIndex}
    >
      <span
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {columnName}
      </span>
      <Lock size={10} weight="bold" style={{ opacity: 0.5, flexShrink: 0 }} />
      {sortDirection === 'ASC' && (
        <ArrowUp size={12} weight="bold" style={{ opacity: 0.6, flexShrink: 0 }} />
      )}
      {sortDirection === 'DESC' && (
        <ArrowDown size={12} weight="bold" style={{ opacity: 0.6, flexShrink: 0 }} />
      )}
    </div>
  )
}
