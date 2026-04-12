import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import { AiWelcomeState } from '../../../components/ai-panel/AiWelcomeState'

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

describe('AiWelcomeState', () => {
  it('renders with data-testid="ai-welcome-state"', () => {
    render(<AiWelcomeState onSuggestionClick={vi.fn()} />)
    expect(screen.getByTestId('ai-welcome-state')).toBeInTheDocument()
  })

  it('displays headline text', () => {
    render(<AiWelcomeState onSuggestionClick={vi.fn()} />)
    expect(screen.getByText('Ask AI about your SQL')).toBeInTheDocument()
  })

  it('displays subtext', () => {
    render(<AiWelcomeState onSuggestionClick={vi.fn()} />)
    expect(screen.getByText(/Get help writing, explaining/)).toBeInTheDocument()
  })

  it('renders exactly 4 suggestion chips', () => {
    render(<AiWelcomeState onSuggestionClick={vi.fn()} />)
    const chips = screen.getAllByTestId('ai-suggestion-chip')
    expect(chips).toHaveLength(4)
  })

  it('renders all 4 suggestion chip labels', () => {
    render(<AiWelcomeState onSuggestionClick={vi.fn()} />)
    expect(screen.getByText('Explain query')).toBeInTheDocument()
    expect(screen.getByText('Optimize for speed')).toBeInTheDocument()
    expect(screen.getByText('Generate a JOIN')).toBeInTheDocument()
    expect(screen.getByText('Find potential issues')).toBeInTheDocument()
  })

  it('calls onSuggestionClick with correct text when chip is clicked', async () => {
    const user = userEvent.setup()
    const onSuggestionClick = vi.fn()
    render(<AiWelcomeState onSuggestionClick={onSuggestionClick} />)

    await user.click(screen.getByText('Explain query'))
    expect(onSuggestionClick).toHaveBeenCalledWith('Explain this query step by step')
  })

  it('calls onSuggestionClick with correct text for each chip', async () => {
    const user = userEvent.setup()
    const onSuggestionClick = vi.fn()
    render(<AiWelcomeState onSuggestionClick={onSuggestionClick} />)

    await user.click(screen.getByText('Optimize for speed'))
    expect(onSuggestionClick).toHaveBeenCalledWith('Optimize this query for better performance')

    await user.click(screen.getByText('Generate a JOIN'))
    expect(onSuggestionClick).toHaveBeenCalledWith('Write a JOIN query that combines these tables')

    await user.click(screen.getByText('Find potential issues'))
    expect(onSuggestionClick).toHaveBeenCalledWith('Find potential issues or bugs in this query')
  })
})
