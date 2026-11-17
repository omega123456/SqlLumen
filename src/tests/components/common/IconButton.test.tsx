import { createRef } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IconButton } from '../../../components/common/IconButton'

describe('IconButton', () => {
  it('defaults to type button and md size', () => {
    render(<IconButton aria-label="Close">X</IconButton>)
    const btn = screen.getByRole('button', { name: 'Close' })
    expect(btn).toHaveAttribute('type', 'button')
    expect(btn).toHaveAttribute('data-size', 'md')
  })

  it('forwards ref', () => {
    const ref = createRef<HTMLButtonElement>()
    render(
      <IconButton ref={ref} aria-label="Ref">
        R
      </IconButton>
    )
    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
    expect(ref.current).toBe(screen.getByRole('button'))
  })

  it('passes through data-testid and other HTML attributes', () => {
    render(
      <IconButton aria-label="Test" data-testid="icon-btn" title="My Title">
        T
      </IconButton>
    )
    expect(screen.getByTestId('icon-btn')).toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveAttribute('title', 'My Title')
  })
})
