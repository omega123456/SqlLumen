import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import { AiErrorBanner } from '../../../components/ai-panel/AiErrorBanner'

function setupMockIPC() {
  mockIPC((cmd) => {
    if (cmd === 'log_frontend') return undefined
    if (cmd === 'plugin:event|listen') return () => {}
    if (cmd === 'plugin:event|unlisten') return undefined
    if (cmd === 'get_setting') return null
    if (cmd === 'set_setting') return undefined
    if (cmd === 'get_all_settings') return {}
    throw new Error(`[vitest] Unmocked Tauri IPC command: ${cmd}`)
  })
}

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.clearAllMocks()
  setupMockIPC()
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
