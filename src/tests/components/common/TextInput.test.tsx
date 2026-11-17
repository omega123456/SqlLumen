import { createRef } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TextInput } from '../../../components/common/TextInput'

describe('TextInput', () => {
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

  it('flags a modified value with a data attribute', () => {
    render(<TextInput fieldState={{ modified: true, isNull: false }} data-testid="inp" />)
    const el = screen.getByTestId('inp')
    expect(el).toHaveAttribute('data-modified', 'true')
    expect(el).not.toHaveAttribute('data-null')
  })

  it('flags a NULL value with a data attribute', () => {
    render(<TextInput fieldState={{ modified: false, isNull: true }} data-testid="inp" />)
    const el = screen.getByTestId('inp')
    expect(el).toHaveAttribute('data-null', 'true')
    expect(el).not.toHaveAttribute('data-modified')
  })

  it('renders the grid cell variant as a plain input', () => {
    render(<TextInput variant="gridCell" data-testid="inp" />)
    expect(screen.getByTestId('inp')).toHaveAttribute('data-variant', 'gridCell')
  })
})
