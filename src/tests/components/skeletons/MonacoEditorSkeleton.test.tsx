import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import MonacoEditorSkeleton from '../../../components/skeletons/MonacoEditorSkeleton'

describe('MonacoEditorSkeleton', () => {
  it('renders without errors', () => {
    const { container } = render(<MonacoEditorSkeleton />)
    expect(container.firstElementChild).toBeTruthy()
  })

  it('has aria-hidden="true" on root', () => {
    const { container } = render(<MonacoEditorSkeleton />)
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders gutter and 8 code lines', () => {
    const { container } = render(<MonacoEditorSkeleton />)
    const root = container.firstElementChild!
    // gutter div + code area div
    expect(root.children).toHaveLength(2)
    // Code area should have 8 lines
    const codeArea = root.children[1]
    expect(codeArea.children).toHaveLength(8)
  })
})
