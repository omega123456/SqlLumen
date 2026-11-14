import { createRef } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TextInput } from '../../../components/common/TextInput'

describe('TextInput', () => {
  it('exposes the default variant as its lookup key', () => {
    render(<TextInput aria-label="Field" />)
    expect(screen.getByRole('textbox', { name: 'Field' })).toHaveAttribute(
      'data-variant',
      'default'
    )
  })

  it('exposes the mono variant as its lookup key', () => {
    render(<TextInput variant="mono" aria-label="Host" />)
    expect(screen.getByRole('textbox', { name: 'Host' })).toHaveAttribute('data-variant', 'mono')
  })

  it('forwards ref', () => {
    const ref = createRef<HTMLInputElement>()
    render(<TextInput ref={ref} defaultValue="a" />)
    expect(ref.current).toBeInstanceOf(HTMLInputElement)
    expect(ref.current?.value).toBe('a')
  })

  it('flags the invalid state with a data attribute', () => {
    render(<TextInput invalid data-testid="inp" />)
    expect(screen.getByTestId('inp')).toHaveAttribute('data-invalid', 'true')
  })

  it('does not flag a valid field as invalid', () => {
    render(<TextInput data-testid="inp" />)
    expect(screen.getByTestId('inp')).not.toHaveAttribute('data-invalid')
  })

  it('disables WebKit auto-capitalization and correction by default', () => {
    render(<TextInput data-testid="inp" />)
    const el = screen.getByTestId('inp')
    expect(el).toHaveAttribute('autocapitalize', 'none')
    expect(el).toHaveAttribute('autocorrect', 'off')
  })

  it('allows overriding autoCapitalize', () => {
    render(<TextInput autoCapitalize="sentences" data-testid="inp" />)
    expect(screen.getByTestId('inp')).toHaveAttribute('autocapitalize', 'sentences')
  })
})
