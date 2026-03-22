import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ElevatedSurface } from '../../../components/common/ElevatedSurface'

describe('ElevatedSurface', () => {
  it('applies global ui-elevated-surface class', () => {
    render(
      <ElevatedSurface data-testid="elevated">
        <span>content</span>
      </ElevatedSurface>
    )

    const el = screen.getByTestId('elevated')
    expect(el).toHaveClass('ui-elevated-surface')
    expect(el).toHaveTextContent('content')
  })

  it('merges custom className', () => {
    render(
      <ElevatedSurface data-testid="elevated" className="extra">
        x
      </ElevatedSurface>
    )

    expect(screen.getByTestId('elevated')).toHaveClass('ui-elevated-surface', 'extra')
  })
})
