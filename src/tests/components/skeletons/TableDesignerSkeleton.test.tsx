import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import TableDesignerSkeleton from '../../../components/skeletons/TableDesignerSkeleton'

describe('TableDesignerSkeleton', () => {
  it('renders without errors', () => {
    const { container } = render(<TableDesignerSkeleton />)
    expect(container.firstElementChild).toBeTruthy()
  })

  it('has aria-hidden="true" on root', () => {
    const { container } = render(<TableDesignerSkeleton />)
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders header, tab bar, and grid', () => {
    const { container } = render(<TableDesignerSkeleton />)
    const root = container.firstElementChild!
    // header + tab bar + grid
    expect(root.children).toHaveLength(3)
  })

  it('renders 5 tab pills', () => {
    const { container } = render(<TableDesignerSkeleton />)
    const root = container.firstElementChild!
    // tab bar is the 2nd child (index 1, after header)
    const tabBar = root.children[1]
    expect(tabBar.children).toHaveLength(5)
  })

  it('renders grid header and 4 data rows', () => {
    const { container } = render(<TableDesignerSkeleton />)
    const root = container.firstElementChild!
    // grid is the 3rd child (index 2)
    const grid = root.children[2]
    // 1 header row + 4 data rows
    expect(grid.children).toHaveLength(5)
  })
})
