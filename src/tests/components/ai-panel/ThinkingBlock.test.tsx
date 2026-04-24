import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import { ThinkingBlock } from '../../../components/ai-panel/ThinkingBlock'

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

describe('ThinkingBlock', () => {
  it('renders with isStreaming=true — shows "Thinking…" label and content is visible', () => {
    render(<ThinkingBlock content="Let me think about this..." isStreaming={true} />)
    expect(screen.getByTestId('thinking-block-header')).toHaveTextContent('Thinking…')
    expect(screen.getByTestId('thinking-block-content')).toBeVisible()
  })

  it('renders with isStreaming=false — shows "Reasoning" label and is collapsed', () => {
    render(<ThinkingBlock content="I thought about this." isStreaming={false} />)
    expect(screen.getByTestId('thinking-block-header')).toHaveTextContent('Reasoning')
    // Content should not be rendered when collapsed
    expect(screen.queryByTestId('thinking-block-content')).not.toBeInTheDocument()
  })

  it('clicking header when collapsed expands content', async () => {
    const user = userEvent.setup()
    render(<ThinkingBlock content="Some reasoning" isStreaming={false} />)
    expect(screen.queryByTestId('thinking-block-content')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('thinking-block-header'))
    expect(screen.getByTestId('thinking-block-content')).toBeInTheDocument()
  })

  it('clicking header when expanded collapses content', async () => {
    const user = userEvent.setup()
    render(<ThinkingBlock content="Some reasoning" isStreaming={false} />)
    // Expand first
    await user.click(screen.getByTestId('thinking-block-header'))
    expect(screen.getByTestId('thinking-block-content')).toBeInTheDocument()
    // Collapse
    await user.click(screen.getByTestId('thinking-block-header'))
    expect(screen.queryByTestId('thinking-block-content')).not.toBeInTheDocument()
  })

  it('auto-collapses when isStreaming transitions from true to false', () => {
    const { rerender } = render(
      <ThinkingBlock content="Thinking in progress..." isStreaming={true} />
    )
    expect(screen.getByTestId('thinking-block-content')).toBeInTheDocument()
    rerender(<ThinkingBlock content="Done thinking." isStreaming={false} />)
    expect(screen.queryByTestId('thinking-block-content')).not.toBeInTheDocument()
  })

  it('auto-scrolls to the bottom while streaming new reasoning text', async () => {
    const { rerender } = render(<ThinkingBlock content="step 1" isStreaming={true} />)
    const contentEl = screen.getByTestId('thinking-block-content')

    Object.defineProperty(contentEl, 'scrollHeight', {
      configurable: true,
      value: 480,
    })

    contentEl.scrollTop = 0

    rerender(<ThinkingBlock content="step 1\nstep 2" isStreaming={true} />)

    await waitFor(() => {
      expect(contentEl.scrollTop).toBe(480)
    })
  })

  it('has data-testid="thinking-block" on container', () => {
    render(<ThinkingBlock content="test" isStreaming={false} />)
    expect(screen.getByTestId('thinking-block')).toBeInTheDocument()
  })

  it('has data-testid="thinking-block-header" on header', () => {
    render(<ThinkingBlock content="test" isStreaming={false} />)
    expect(screen.getByTestId('thinking-block-header')).toBeInTheDocument()
  })
})
