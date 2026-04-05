/**
 * Shared header renderers for react-data-grid.
 *
 * - SortStatusRenderer: renders sort direction arrow icons (Phosphor)
 * - ReadOnlyColumnHeaderCell: renders lock icon + column name + sort indicator
 *   for read-only columns
 * - ForeignKeyColumnHeaderCell: renders link icon + column name + sort indicator
 *   for foreign key columns
 */

import { ArrowUp, ArrowDown, Lock, Link } from '@phosphor-icons/react'
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
// HeaderCellWithIcon — internal shared helper for icon header cells
// ---------------------------------------------------------------------------

/**
 * Internal helper that renders the shared structure for icon-annotated header
 * cells: column name → icon → optional sort arrow.
 *
 * NOT exported — used only by ReadOnlyColumnHeaderCell and
 * ForeignKeyColumnHeaderCell below.
 */
function HeaderCellWithIcon<R, SR>(
  props: RenderHeaderCellProps<R, SR> & { icon: React.ReactNode }
) {
  const { column, sortDirection, tabIndex, icon } = props
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
      {icon}
      {sortDirection === 'ASC' && (
        <ArrowUp size={12} weight="bold" style={{ opacity: 0.6, flexShrink: 0 }} />
      )}
      {sortDirection === 'DESC' && (
        <ArrowDown size={12} weight="bold" style={{ opacity: 0.6, flexShrink: 0 }} />
      )}
    </div>
  )
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
  return (
    <HeaderCellWithIcon
      {...props}
      icon={<Lock size={10} weight="bold" style={{ opacity: 0.5, flexShrink: 0 }} />}
    />
  )
}

// ---------------------------------------------------------------------------
// ForeignKeyColumnHeaderCell — link icon header for FK columns
// ---------------------------------------------------------------------------

/**
 * Custom `renderHeaderCell` for foreign key columns. Renders the column name,
 * a link icon, and the sort direction indicator (if applicable).
 *
 * CRITICAL: Must also render the sort indicator alongside the link icon,
 * otherwise sort arrows will be lost on FK columns.
 */
export function ForeignKeyColumnHeaderCell<R, SR>(props: RenderHeaderCellProps<R, SR>) {
  return (
    <HeaderCellWithIcon
      {...props}
      icon={<Link size={10} weight="bold" style={{ opacity: 0.5, flexShrink: 0 }} />}
    />
  )
}
