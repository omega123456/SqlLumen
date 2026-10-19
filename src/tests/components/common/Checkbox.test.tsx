import { createRef, useState } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Checkbox } from '../../../components/common/Checkbox'
import { cssRule } from '../../helpers/css-source'

function ControlledToggle() {
  const [on, setOn] = useState(false)
  return <Checkbox checked={on} onChange={(e) => setOn(e.target.checked)} aria-label="Toggle me" />
}

describe('Checkbox', () => {
  it('renders a real checkbox input', () => {
    render(<Checkbox defaultChecked aria-label="box" />)
    const input = screen.getByRole('checkbox', { name: 'box' })
    expect(input).toHaveAttribute('type', 'checkbox')
  })

  it('supports controlled toggle', async () => {
    const user = userEvent.setup()
    render(<ControlledToggle />)
    const input = screen.getByRole('checkbox', { name: 'Toggle me' })
    expect(input).not.toBeChecked()
    await user.click(input)
    expect(input).toBeChecked()
    await user.click(input)
    expect(input).not.toBeChecked()
  })

  it('respects disabled', () => {
    render(<Checkbox disabled defaultChecked aria-label="off" />)
    const input = screen.getByRole('checkbox', { name: 'off' })
    expect(input).toBeDisabled()
    expect(input).toBeChecked()
  })

  it('forwards ref', () => {
    const ref = createRef<HTMLInputElement>()
    render(<Checkbox ref={ref} aria-label="ref box" />)
    expect(ref.current).toBeInstanceOf(HTMLInputElement)
    expect(ref.current).toBe(screen.getByRole('checkbox', { name: 'ref box' }))
  })

  it('passes through data-testid', () => {
    render(<Checkbox data-testid="my-cb" aria-label="x" />)
    expect(screen.getByTestId('my-cb')).toBeInTheDocument()
  })

  it('merges className with base styles', () => {
    render(<Checkbox className="extra" aria-label="c" />)
    expect(screen.getByRole('checkbox', { name: 'c' })).toHaveClass('extra')
  })
})

describe('Checkbox Fluent styles', () => {
  const css = 'components/common/Checkbox.module.css'

  it('draws a 20px Fluent box on the native input (prototype `.cb`)', () => {
    const base = cssRule(css, '.input')
    expect(base).toContain('width: 20px')
    expect(base).toContain('height: 20px')
    expect(base).toContain('appearance: none')
    expect(base).toContain('border-radius: var(--radius-control)')
  })

  it('fills checked and mixed states with the accent', () => {
    expect(cssRule(css, '.input:checked, .input:indeterminate')).toContain(
      'background: var(--primary)'
    )
  })

  it('keeps checked and mixed boxes filled on hover', () => {
    expect(
      cssRule(css, '.input:checked:hover:not(:disabled), .input:indeterminate:hover:not(:disabled)')
    ).toContain('background: var(--accent-hover)')
  })
})
