import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InfoBar, type InfoBarSeverity } from '../../../components/common/InfoBar'
import { Button } from '../../../components/common/Button'
import { cssRule } from '../../helpers/css-source'

describe('InfoBar', () => {
  it.each<[InfoBarSeverity, string, string]>([
    ['info', 'i', 'status'],
    ['success', '✓', 'status'],
    ['warning', '!', 'alert'],
    ['error', '✕', 'alert'],
  ])('renders the %s glyph and role', (severity, glyph, role) => {
    render(<InfoBar severity={severity} message="Something happened" data-testid="bar" />)
    const bar = screen.getByTestId('bar')
    expect(bar).toHaveAttribute('role', role)
    expect(bar).toHaveAttribute('data-severity', severity)
    expect(bar.className).toContain(severity)
    const glyphEl = bar.querySelector('[aria-hidden="true"]')
    expect(glyphEl).toHaveTextContent(glyph)
  })

  it('renders title, message, detail and actions', () => {
    render(
      <InfoBar
        severity="error"
        title="Error 1146"
        message="Table 'shop.user' doesn't exist"
        detail="Line 1"
        actions={<Button size="sm">Copy error</Button>}
        className="extra"
      />
    )
    const bar = screen.getByRole('alert')
    expect(bar).toHaveClass('extra')
    expect(screen.getByText('Error 1146').tagName).toBe('B')
    expect(screen.getByText("Table 'shop.user' doesn't exist")).toBeInTheDocument()
    expect(screen.getByText('Line 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy error' })).toBeInTheDocument()
  })

  it('omits optional parts that are not given', () => {
    render(<InfoBar severity="info" message="Only a message" data-testid="bar" />)
    const bar = screen.getByTestId('bar')
    expect(bar.querySelector('b')).toBeNull()
    expect(bar.children).toHaveLength(2)
  })

  it('matches the prototype `.ibar` and `.sdot` styles', () => {
    const css = 'components/common/InfoBar.module.css'
    const bar = cssRule(css, '.bar')
    expect(bar).toContain('gap: 12px')
    expect(bar).toContain('padding: 12px 8px 12px 14px')
    expect(bar).toContain('border-radius: var(--radius-card)')
    expect(bar).toContain('border: 1px solid var(--stroke-card)')
    expect(cssRule(css, '.error')).toBe('background: var(--error-container);')
    expect(cssRule(css, '.warning')).toBe('background: var(--warning-container);')
    expect(cssRule(css, '.success')).toBe('background: var(--tertiary-container);')
    expect(cssRule(css, '.info')).toBe('background: var(--surface-container-high);')
    const glyph = cssRule(css, '.glyph')
    expect(glyph).toContain('width: 16px')
    expect(glyph).toContain('font-size: 10px')
    expect(glyph).toContain('font-weight: 800')
  })
})
