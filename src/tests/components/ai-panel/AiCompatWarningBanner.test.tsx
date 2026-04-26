import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import { AiCompatWarningBanner } from '../../../components/ai-panel/AiCompatWarningBanner'

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

describe('AiCompatWarningBanner', () => {
  it('renders with data-testid="ai-compat-warning-banner"', () => {
    render(<AiCompatWarningBanner onDismiss={vi.fn()} />)
    expect(screen.getByTestId('ai-compat-warning-banner')).toBeInTheDocument()
  })

  it('has role="status" for accessibility', () => {
    render(<AiCompatWarningBanner onDismiss={vi.fn()} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('displays the warning text about /v1/completions', () => {
    render(<AiCompatWarningBanner onDismiss={vi.fn()} />)
    expect(screen.getByText(/does not support/)).toBeInTheDocument()
    expect(screen.getByText('/v1/completions')).toBeInTheDocument()
  })

  it('shows dismiss button', () => {
    render(<AiCompatWarningBanner onDismiss={vi.fn()} />)
    expect(screen.getByTestId('ai-compat-warning-dismiss')).toBeInTheDocument()
    expect(screen.getByText('Dismiss')).toBeInTheDocument()
  })

  it('calls onDismiss when dismiss button is clicked', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    render(<AiCompatWarningBanner onDismiss={onDismiss} />)

    await user.click(screen.getByTestId('ai-compat-warning-dismiss'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
