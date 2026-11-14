import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InfoBar, type InfoBarSeverity } from '../../../components/common/InfoBar'
import { Button } from '../../../components/common/Button'

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
    const glyphEl = bar.querySelector('[aria-hidden="true"]')
    expect(glyphEl).toHaveTextContent(glyph)
  })

  it.each<InfoBarSeverity>(['warning', 'error'])(
    'announces a %s politely in the opt-in polite mode',
    (severity) => {
      render(<InfoBar severity={severity} polite message="Truncated" data-testid="bar" />)
      const bar = screen.getByTestId('bar')
      expect(bar).toHaveAttribute('role', 'status')
      expect(bar).toHaveAttribute('aria-live', 'polite')
    }
  )

  it('keeps the alert default when polite is not set', () => {
    render(<InfoBar severity="warning" message="Careful" data-testid="bar" />)
    expect(screen.getByTestId('bar')).not.toHaveAttribute('aria-live')
  })

  it('renders title, message, detail and actions', () => {
    render(
      <InfoBar
        severity="error"
        title="Error 1146"
        message="Table 'shop.user' doesn't exist"
        detail="Line 1"
        actions={<Button size="sm">Copy error</Button>}
      />
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
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
})
