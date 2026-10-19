import { createRef } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TextInput } from '../../../components/common/TextInput'
import styles from '../../../components/common/TextInput.module.css'
import { cssRule } from '../../helpers/css-source'

describe('TextInput', () => {
  it('applies ui-input for default variant', () => {
    render(<TextInput aria-label="Field" />)
    expect(screen.getByRole('textbox', { name: 'Field' })).toHaveClass('ui-input')
  })

  it('applies mono with ui-input for mono variant', () => {
    render(<TextInput variant="mono" aria-label="Host" />)
    const el = screen.getByRole('textbox', { name: 'Host' })
    expect(el).toHaveClass('ui-input')
    expect(el.className).toContain(styles.mono)
  })

  it('gridCell variant exposes td-cell-editor-input for grid editor styles', () => {
    render(<TextInput variant="gridCell" defaultValue="x" aria-label="Cell" />)
    expect(screen.getByRole('textbox', { name: 'Cell' })).toHaveClass('td-cell-editor-input')
  })

  it('merges className last', () => {
    render(<TextInput className="extra" data-testid="inp" />)
    expect(screen.getByTestId('inp')).toHaveClass('ui-input', 'extra')
  })

  it('forwards ref', () => {
    const ref = createRef<HTMLInputElement>()
    render(<TextInput ref={ref} defaultValue="a" />)
    expect(ref.current).toBeInstanceOf(HTMLInputElement)
    expect(ref.current?.value).toBe('a')
  })

  it('invalid adds error styling class', () => {
    render(<TextInput invalid data-testid="inp" />)
    expect(screen.getByTestId('inp')).toHaveClass(styles.invalid)
  })

  it('passwordToggleGutter adds padding class', () => {
    render(<TextInput passwordToggleGutter data-testid="inp" />)
    expect(screen.getByTestId('inp')).toHaveClass(styles.passwordToggleGutter)
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

describe('TextInput field chrome', () => {
  const global = 'styles/global.css'
  const fields = '.ui-field-chrome, .ui-input, .ui-textarea'

  it('has a control stroke with a boundary bottom edge and no glow ring', () => {
    const rest = cssRule(global, fields)
    expect(rest).toContain('border: 1px solid var(--stroke-control)')
    expect(rest).toContain('border-bottom-color: var(--stroke-text-field)')
    expect(rest).toContain('box-shadow: none')
  })

  it('shows a 2px accent bottom edge on focus', () => {
    const focus = cssRule(
      global,
      '.ui-field-chrome:focus, .ui-input:focus, .ui-textarea:focus, .ui-field-chrome:focus-visible, .ui-input:focus-visible, .ui-textarea:focus-visible'
    )
    expect(focus).toContain('border-bottom-color: var(--primary)')
    expect(focus).toContain('box-shadow: inset 0 -1px 0 var(--primary)')
  })
})
