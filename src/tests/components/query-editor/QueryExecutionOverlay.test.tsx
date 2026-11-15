import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryExecutionOverlay } from '../../../components/query-editor/QueryExecutionOverlay'

describe('QueryExecutionOverlay', () => {
  it('renders with data-testid="query-execution-overlay"', () => {
    render(<QueryExecutionOverlay />)
    expect(screen.getByTestId('query-execution-overlay')).toBeInTheDocument()
  })

  it('is a div element', () => {
    render(<QueryExecutionOverlay />)
    const overlay = screen.getByTestId('query-execution-overlay')
    expect(overlay.tagName).toBe('DIV')
  })
})
