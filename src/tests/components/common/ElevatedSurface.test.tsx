import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ElevatedSurface } from '../../../components/common/ElevatedSurface'

describe('ElevatedSurface', () => {
  it('renders its children as a ring surface by default', () => {
    render(
      <ElevatedSurface data-testid="elevated">
        <span>content</span>
      </ElevatedSurface>
    )

    const surface = screen.getByTestId('elevated')
    expect(surface).toHaveAttribute('data-variant', 'ring')
    expect(surface).toHaveTextContent('content')
  })

  it('exposes the bordered variant', () => {
    render(
      <ElevatedSurface data-testid="elevated" variant="bordered">
        x
      </ElevatedSurface>
    )

    expect(screen.getByTestId('elevated')).toHaveAttribute('data-variant', 'bordered')
  })

  it('forwards native attributes to the surface element', () => {
    render(
      <ElevatedSurface data-testid="elevated" aria-label="Panel">
        x
      </ElevatedSurface>
    )

    expect(screen.getByTestId('elevated')).toHaveAttribute('aria-label', 'Panel')
  })
})
