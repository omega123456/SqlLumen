/**
 * Tests for react-data-grid header renderers.
 *
 * Verifies sort direction icons and read-only column header lock icon.
 */

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import {
  SortStatusRenderer,
  ReadOnlyColumnHeaderCell,
} from '../../../components/shared/grid-header-renderers'

// ---------------------------------------------------------------------------
// Helpers — minimal mock of RenderHeaderCellProps
// ---------------------------------------------------------------------------

function makeHeaderCellProps(
  sortDirection: 'ASC' | 'DESC' | undefined,
  columnName: string = 'test_col'
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
// SortStatusRenderer
// ---------------------------------------------------------------------------

describe('SortStatusRenderer', () => {
  it('shows ArrowUp icon for ASC sort direction', () => {
    const { container } = render(<SortStatusRenderer sortDirection="ASC" priority={undefined} />)

    // Phosphor icons render as SVG elements
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()

    // ArrowUp has a specific path; verify the SVG is present
    // The icon should be visible (non-null return)
    expect(container.innerHTML).toBeTruthy()
    expect(container.children.length).toBeGreaterThan(0)
  })

  it('shows ArrowDown icon for DESC sort direction', () => {
    const { container } = render(<SortStatusRenderer sortDirection="DESC" priority={undefined} />)

    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
  })

  it('shows nothing when sort direction is undefined', () => {
    const { container } = render(
      <SortStatusRenderer sortDirection={undefined} priority={undefined} />
    )

    // Should render nothing
    expect(container.innerHTML).toBe('')
  })
})

// ---------------------------------------------------------------------------
// ReadOnlyColumnHeaderCell
// ---------------------------------------------------------------------------

describe('ReadOnlyColumnHeaderCell', () => {
  it('renders the lock icon', () => {
    const { container } = render(
      <ReadOnlyColumnHeaderCell {...makeHeaderCellProps(undefined, 'readonly_col')} />
    )

    // Lock icon from Phosphor renders as SVG
    const svgs = container.querySelectorAll('svg')
    expect(svgs.length).toBeGreaterThanOrEqual(1)
  })

  it('renders the column name', () => {
    const { container } = render(
      <ReadOnlyColumnHeaderCell {...makeHeaderCellProps(undefined, 'my_column')} />
    )

    expect(container.textContent).toContain('my_column')
  })

  it('renders sort indicator when column is sorted ASC', () => {
    const { container } = render(
      <ReadOnlyColumnHeaderCell {...makeHeaderCellProps('ASC', 'sorted_col')} />
    )

    // Should render both lock icon AND sort arrow = 2 SVGs
    const svgs = container.querySelectorAll('svg')
    expect(svgs.length).toBe(2)
  })

  it('renders sort indicator when column is sorted DESC', () => {
    const { container } = render(
      <ReadOnlyColumnHeaderCell {...makeHeaderCellProps('DESC', 'sorted_col')} />
    )

    // Should render both lock icon AND sort arrow = 2 SVGs
    const svgs = container.querySelectorAll('svg')
    expect(svgs.length).toBe(2)
  })

  it('renders only lock icon when column is not sorted', () => {
    const { container } = render(
      <ReadOnlyColumnHeaderCell {...makeHeaderCellProps(undefined, 'unsorted_col')} />
    )

    // Should render only the lock icon = 1 SVG
    const svgs = container.querySelectorAll('svg')
    expect(svgs.length).toBe(1)
  })
})
