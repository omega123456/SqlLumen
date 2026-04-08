import { createRef } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Textarea } from '../../../components/common/Textarea'

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
})
