import { createRef } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Textarea } from '../../../components/common/Textarea'

describe('Textarea', () => {
  it('exposes the default variant as its lookup key', () => {
    render(<Textarea aria-label="Notes" />)
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveAttribute(
      'data-variant',
      'default'
    )
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

  it('exposes the formField variant as its lookup key', () => {
    render(<Textarea variant="formField" aria-label="Field" />)
    expect(screen.getByRole('textbox', { name: 'Field' })).toHaveAttribute(
      'data-variant',
      'formField'
    )
  })

  it('flags the invalid state with a data attribute', () => {
    render(<Textarea invalid aria-label="Bad" />)
    expect(screen.getByRole('textbox', { name: 'Bad' })).toHaveAttribute('data-invalid', 'true')
  })
})
