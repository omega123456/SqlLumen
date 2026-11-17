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

  it('disables WebKit auto-capitalization and correction by default', () => {
    render(<TextInput data-testid="inp" />)
    const el = screen.getByTestId('inp')
    expect(el).toHaveAttribute('autocapitalize', 'none')
    expect(el).toHaveAttribute('autocorrect', 'off')
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
})
