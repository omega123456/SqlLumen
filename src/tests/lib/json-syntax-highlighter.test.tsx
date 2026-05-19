import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { JsonSyntaxHighlighter } from '../../lib/json-syntax-highlighter'

function renderHighlighted(json: string) {
  render(<pre data-testid="json">{JsonSyntaxHighlighter.highlightJson(json)}</pre>)
  return screen.getByTestId('json')
}

describe('JsonSyntaxHighlighter', () => {
  it('highlights keys, strings, numbers, booleans, nulls, and punctuation', () => {
    const container = renderHighlighted('{"name":"Ada","age":42,"active":true,"meta":null}')

    expect(container.querySelector('.key')?.textContent).toBe('"name"')
    expect(container.querySelector('.string')?.textContent).toBe('"Ada"')
    expect(container.querySelector('.number')?.textContent).toBe('42')
    expect(container.querySelector('.boolean')?.textContent).toBe('true')
    expect(container.querySelector('.null')?.textContent).toBe('null')
    expect(container.querySelectorAll('.punctuation').length).toBeGreaterThan(0)
  })

  it('preserves unmatched whitespace and newlines', () => {
    const container = renderHighlighted('{\n  "items": [1, 2]\n}')
    expect(container.textContent).toBe('{\n  "items": [1, 2]\n}')
  })
})
