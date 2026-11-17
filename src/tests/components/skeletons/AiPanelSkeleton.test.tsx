import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import AiPanelSkeleton from '../../../components/skeletons/AiPanelSkeleton'

describe('AiPanelSkeleton', () => {
  it('renders without errors', () => {
    const { container } = render(<AiPanelSkeleton />)
    expect(container.firstElementChild).toBeTruthy()
  })

  it('has aria-hidden="true" on root', () => {
    const { container } = render(<AiPanelSkeleton />)
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })
})
