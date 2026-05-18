import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  it('displays error message text', () => {
    render(<AiErrorBanner error="Could not reach the AI service at localhost:11434" />)
    expect(
      screen.getByText('Could not reach the AI service at localhost:11434')
    ).toBeInTheDocument()
  })

  it('shows retry button when onRetry is provided', () => {
    render(<AiErrorBanner error="Connection failed" onRetry={vi.fn()} />)
    expect(screen.getByTestId('ai-error-retry-button')).toBeInTheDocument()
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })

  it('does not show retry button when onRetry is not provided', () => {
    render(<AiErrorBanner error="Connection failed" />)
    expect(screen.queryByTestId('ai-error-retry-button')).not.toBeInTheDocument()
  })

  it('calls onRetry when retry button is clicked', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<AiErrorBanner error="Connection failed" onRetry={onRetry} />)

    await user.click(screen.getByTestId('ai-error-retry-button'))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders long error messages with word break', () => {
    const longError = 'Error: ' + 'a'.repeat(200)
    render(<AiErrorBanner error={longError} />)
    expect(screen.getByText(longError)).toBeInTheDocument()
  })
})
