import { createRef } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IconButton } from '../../../components/common/IconButton'

describe('IconButton', () => {
  it('defaults to type button and md size', () => {
    render(<IconButton aria-label="Close">X</IconButton>)
    const btn = screen.getByRole('button', { name: 'Close' })
    expect(btn).toHaveAttribute('type', 'button')
    expect(btn.className).toContain('md')
  })

  it('renders sm size when specified', () => {
    render(
      <IconButton size="sm" aria-label="Small">
        S
      </IconButton>
    )
    const btn = screen.getByRole('button', { name: 'Small' })
    expect(btn.className).toContain('sm')
  })

  it('renders lg size when specified', () => {
    render(
      <IconButton size="lg" aria-label="Large">
        L
      </IconButton>
    )
    const btn = screen.getByRole('button', { name: 'Large' })
    expect(btn.className).toContain('lg')
  })

  it('merges className', () => {
    render(
      <IconButton className="my-extra" aria-label="Extra">
        E
      </IconButton>
    )
    const btn = screen.getByRole('button', { name: 'Extra' })
    expect(btn.className).toContain('my-extra')
    expect(btn.className).toContain('iconButton')
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

  it('allows overriding type for submit buttons', () => {
    render(
      <IconButton type="submit" aria-label="Submit">
        S
      </IconButton>
    )
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveAttribute('type', 'submit')
  })

  it('supports disabled state', () => {
    render(
      <IconButton disabled aria-label="Disabled">
        D
      </IconButton>
    )
    expect(screen.getByRole('button', { name: 'Disabled' })).toBeDisabled()
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
