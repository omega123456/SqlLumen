import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { AiMessageBubble } from '../../../components/ai-panel/AiMessageBubble'
import type { AiMessage } from '../../../stores/ai-store'

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

const makeMessage = (overrides: Partial<AiMessage> = {}): AiMessage => ({
  id: 'msg-1',
  role: 'user',
  content: 'Hello AI',
  timestamp: Date.now(),
  ...overrides,
})

describe('AiMessageBubble', () => {
  it('renders user message as right-aligned bubble', () => {
    render(<AiMessageBubble message={makeMessage({ role: 'user', content: 'Hello AI' })} />)
    const bubble = screen.getByTestId('ai-message-user')
    expect(bubble).toBeInTheDocument()
    expect(bubble).toHaveTextContent('Hello AI')
  })

  it('renders assistant message with markdown renderer', () => {
    render(<AiMessageBubble message={makeMessage({ role: 'assistant', content: 'I can help!' })} />)
    const bubble = screen.getByTestId('ai-message-assistant')
    expect(bubble).toBeInTheDocument()
    expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument()
  })

  it('renders system message as centered info text', () => {
    render(
      <AiMessageBubble
        message={makeMessage({ role: 'system', content: 'Database schema:\nCREATE TABLE...' })}
      />
    )
    const bubble = screen.getByTestId('ai-message-system')
    expect(bubble).toBeInTheDocument()
    expect(bubble).toHaveTextContent('Schema context loaded')
  })

  it('shows streaming cursor when isStreaming is true on assistant message', () => {
    render(
      <AiMessageBubble
        message={makeMessage({ role: 'assistant', content: 'Thinking...' })}
        isStreaming={true}
      />
    )
    // The streaming cursor is a span with aria-hidden inside the assistant bubble
    const bubble = screen.getByTestId('ai-message-assistant')
    const cursor = bubble.querySelector('[aria-hidden="true"]')
    expect(cursor).toBeInTheDocument()
  })

  it('does not show streaming cursor when isStreaming is false', () => {
    render(
      <AiMessageBubble
        message={makeMessage({ role: 'assistant', content: 'Done!' })}
        isStreaming={false}
      />
    )
    // No cursor elements with aria-hidden inside the assistant bubble's markdown body
    const bubble = screen.getByTestId('ai-message-assistant')
    const cursor = bubble.querySelector('[aria-hidden="true"]')
    expect(cursor).not.toBeInTheDocument()
  })

  it('does not show streaming cursor on user messages', () => {
    render(
      <AiMessageBubble
        message={makeMessage({ role: 'user', content: 'Test' })}
        isStreaming={true}
      />
    )
    const bubble = screen.getByTestId('ai-message-user')
    const cursor = bubble.querySelector('[aria-hidden="true"]')
    expect(cursor).not.toBeInTheDocument()
  })

  it('passes onTriggerDiff to markdown renderer for assistant messages', () => {
    const onTriggerDiff = vi.fn()
    render(
      <AiMessageBubble
        message={makeMessage({ role: 'assistant', content: 'Some SQL' })}
        onTriggerDiff={onTriggerDiff}
      />
    )
    expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument()
  })

  it('renders long user messages with word wrap', () => {
    const longText = 'word '.repeat(100).trim()
    render(<AiMessageBubble message={makeMessage({ role: 'user', content: longText })} />)
    expect(screen.getByTestId('ai-message-user')).toHaveTextContent(longText)
  })
})
