/**
 * Tests for ForeignKeyColumnHeaderCell renderer.
 *
 * Verifies Link icon rendering and sort direction arrows for FK column headers.
 */

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ForeignKeyColumnHeaderCell } from '../../../components/shared/grid-header-renderers'

// ---------------------------------------------------------------------------
// Helpers — minimal mock of RenderHeaderCellProps
// ---------------------------------------------------------------------------

function makeHeaderCellProps(
  sortDirection: 'ASC' | 'DESC' | undefined,
  columnName: string = 'user_id'
) {
  return {
    column: {
      key: columnName,
      name: columnName,
      idx: 0,
      level: 0,
      width: 100,
      minWidth: 50,
      maxWidth: undefined,
      resizable: true,
      sortable: true,
      draggable: false,
      frozen: false,
      parent: undefined,
      renderCell: () => null,
      renderHeaderCell: () => null,
    },
    sortDirection,
    priority: undefined,
    tabIndex: 0,
  }
}

// ---------------------------------------------------------------------------
// ForeignKeyColumnHeaderCell
// ---------------------------------------------------------------------------

describe('ForeignKeyColumnHeaderCell', () => {
  it('renders the column name', () => {
    const { container } = render(
      <ForeignKeyColumnHeaderCell {...makeHeaderCellProps(undefined, 'user_id')} />
    )

    expect(container.textContent).toContain('user_id')
  })

  it('renders the Link icon (Phosphor SVG)', () => {
    const { container } = render(
      <ForeignKeyColumnHeaderCell {...makeHeaderCellProps(undefined, 'user_id')} />
    )

    // Link icon from Phosphor renders as SVG
    const svgs = container.querySelectorAll('svg')
    expect(svgs.length).toBeGreaterThanOrEqual(1)
  })

  it('renders sort direction arrow when sortDirection is ASC', () => {
    const { container } = render(
      <ForeignKeyColumnHeaderCell {...makeHeaderCellProps('ASC', 'user_id')} />
    )

    // Should render both Link icon AND sort arrow = 2 SVGs
    const svgs = container.querySelectorAll('svg')
    expect(svgs.length).toBe(2)
  })

  it('renders sort direction arrow when sortDirection is DESC', () => {
    const { container } = render(
      <ForeignKeyColumnHeaderCell {...makeHeaderCellProps('DESC', 'user_id')} />
    )

    // Should render both Link icon AND sort arrow = 2 SVGs
    const svgs = container.querySelectorAll('svg')
    expect(svgs.length).toBe(2)
  })

  it('does NOT show sort arrow when no sortDirection', () => {
    const { container } = render(
      <ForeignKeyColumnHeaderCell {...makeHeaderCellProps(undefined, 'order_id')} />
    )

    // Should render only the Link icon = 1 SVG
    const svgs = container.querySelectorAll('svg')
    expect(svgs.length).toBe(1)
  })
})
