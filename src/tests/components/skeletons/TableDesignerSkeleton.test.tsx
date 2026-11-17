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
})
