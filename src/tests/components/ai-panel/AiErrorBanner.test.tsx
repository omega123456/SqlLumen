import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AiErrorBanner } from '../../../components/ai-panel/AiErrorBanner'

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.clearAllMocks()
})

afterEach(() => {
  consoleSpy.mockRestore()
})

describe('AiErrorBanner', () => {
  it('renders with data-testid="ai-error-banner"', () => {
    render(<AiErrorBanner error="Connection failed" />)
    expect(screen.getByTestId('ai-error-banner')).toBeInTheDocument()
  })

  it('has role="alert" for accessibility', () => {
    render(<AiErrorBanner error="Connection failed" />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('renders as an error InfoBar with a glyph', () => {
    render(<AiErrorBanner error="Connection failed" />)
    const banner = screen.getByTestId('ai-error-banner')
    expect(banner).toHaveAttribute('data-severity', 'error')
    expect(banner.querySelector('[aria-hidden="true"]')).toHaveTextContent('✕')
  })

  it('shows retry button when onRetry is provided', () => {
    render(<AiErrorBanner error="Connection failed" onRetry={vi.fn()} />)
    expect(screen.getByTestId('ai-error-retry-button')).toBeInTheDocument()
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })
})
