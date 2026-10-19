import { createRef } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Textarea } from '../../../components/common/Textarea'
import { cssRule } from '../../helpers/css-source'

describe('Textarea', () => {
  it('applies ui-textarea for default variant', () => {
    render(<Textarea aria-label="Notes" />)
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveClass('ui-textarea')
  })

  it('merges className', () => {
    render(<Textarea className="extra" aria-label="C" />)
    expect(screen.getByRole('textbox', { name: 'C' })).toHaveClass('ui-textarea', 'extra')
  })

  it('forwards ref', () => {
    const ref = createRef<HTMLTextAreaElement>()
    render(<Textarea ref={ref} defaultValue="hi" />)
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement)
    expect(ref.current?.value).toBe('hi')
  })

  it('disables WebKit auto-capitalization and correction by default', () => {
    render(<Textarea data-testid="ta" aria-label="Body" />)
    const el = screen.getByTestId('ta')
    expect(el).toHaveAttribute('autocapitalize', 'none')
    expect(el).toHaveAttribute('autocorrect', 'off')
  })

  it('applies ui-field-chrome for formField variant', () => {
    render(<Textarea variant="formField" aria-label="Field" />)
    expect(screen.getByRole('textbox', { name: 'Field' })).toHaveClass('ui-field-chrome')
  })
})

describe('Textarea field chrome', () => {
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
