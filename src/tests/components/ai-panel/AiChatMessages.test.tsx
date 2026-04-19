import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import { AiChatMessages } from '../../../components/ai-panel/AiChatMessages'
import { useAiStore } from '../../../stores/ai-store'
import { useSettingsStore, SETTINGS_DEFAULTS } from '../../../stores/settings-store'
import type { TabAiState } from '../../../stores/ai-store'

function setupMockIPC() {
  mockIPC((cmd) => {
    if (cmd === 'log_frontend') return undefined
    if (cmd === 'plugin:event|listen') return () => {}
    if (cmd === 'plugin:event|unlisten') return undefined
    if (cmd === 'get_setting') return null
    if (cmd === 'set_setting') return undefined
    if (cmd === 'get_all_settings') return {}
    if (cmd === 'ai_chat') return undefined
    if (cmd === 'ai_cancel') return undefined
    throw new Error(`[vitest] Unmocked Tauri IPC command: ${cmd}`)
  })
}

function emptyTabState(overrides?: Partial<TabAiState>): TabAiState {
  return {
    messages: [],
    isGenerating: false,
    activeStreamId: null,
    previousResponseId: null,
    attachedContext: null,
    isPanelOpen: true,
    error: null,
    retrievedSchemaDdl: '',
    lastRetrievalTimestamp: 0,
    schemaContextBuildTimestamp: 0,
    schemaContextQueryKey: '',
    lastCompletedSystemPrompt: '',
    lastCompletedTransport: null,
    lastCompletedEndpoint: '',
    lastCompletedModel: '',
    activeRequestEndpoint: '',
    activeRequestModel: '',
    activeStreamHasAssistantOutput: false,
    isWaitingForIndex: false,
    connectionId: null,
    _unlisten: null,
    ...overrides,
  }
}

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.clearAllMocks()
  setupMockIPC()

  useSettingsStore.setState({
    settings: {
      ...SETTINGS_DEFAULTS,
      'ai.enabled': 'true',
      'ai.endpoint': 'http://localhost:11434',
      'ai.model': 'llama3',
    },
    pendingChanges: {},
    isDirty: false,
    isLoading: false,
    activeSection: 'ai',
  })

  useAiStore.setState({ tabs: { 'tab-1': emptyTabState() } })
})

afterEach(() => {
  consoleSpy.mockRestore()
})

describe('AiChatMessages', () => {
  it('renders with role="log" and aria-live="polite"', () => {
    render(<AiChatMessages tabId="tab-1" />)
    const container = screen.getByTestId('ai-chat-messages')
    expect(container).toHaveAttribute('role', 'log')
    expect(container).toHaveAttribute('aria-live', 'polite')
  })

  it('shows welcome state when no messages', () => {
    render(<AiChatMessages tabId="tab-1" />)
    expect(screen.getByTestId('ai-welcome-state')).toBeInTheDocument()
  })

  it('renders user messages when present', () => {
    useAiStore.setState({
      tabs: {
        'tab-1': emptyTabState({
          messages: [{ id: 'm1', role: 'user', content: 'Hello AI', timestamp: Date.now() }],
        }),
      },
    })

    render(<AiChatMessages tabId="tab-1" />)
    expect(screen.getByTestId('ai-message-user')).toBeInTheDocument()
    expect(screen.getByText('Hello AI')).toBeInTheDocument()
  })

  it('renders assistant messages when present', () => {
    useAiStore.setState({
      tabs: {
        'tab-1': emptyTabState({
          messages: [
            { id: 'm1', role: 'assistant', content: 'I can help!', timestamp: Date.now() },
          ],
        }),
      },
    })

    render(<AiChatMessages tabId="tab-1" />)
    expect(screen.getByTestId('ai-message-assistant')).toBeInTheDocument()
  })

  it('renders system messages when present', () => {
    useAiStore.setState({
      tabs: {
        'tab-1': emptyTabState({
          messages: [
            {
              id: 'm1',
              role: 'system',
              content: 'Database schema:\nCREATE TABLE ...',
              timestamp: Date.now(),
            },
          ],
        }),
      },
    })

    render(<AiChatMessages tabId="tab-1" />)
    expect(screen.getByTestId('ai-message-system')).toBeInTheDocument()
    expect(screen.getByText('Schema context loaded')).toBeInTheDocument()
  })

  it('does not show welcome state when messages exist', () => {
    useAiStore.setState({
      tabs: {
        'tab-1': emptyTabState({
          messages: [{ id: 'm1', role: 'user', content: 'Test', timestamp: Date.now() }],
        }),
      },
    })

    render(<AiChatMessages tabId="tab-1" />)
    expect(screen.queryByTestId('ai-welcome-state')).not.toBeInTheDocument()
  })

  it('renders error banner when error exists', () => {
    useAiStore.setState({
      tabs: {
        'tab-1': emptyTabState({
          error: 'Connection failed',
        }),
      },
    })

    render(<AiChatMessages tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-error-banner')).toBeInTheDocument()
    expect(screen.getByText('Connection failed')).toBeInTheDocument()
  })

  it('renders multiple messages in order', () => {
    useAiStore.setState({
      tabs: {
        'tab-1': emptyTabState({
          messages: [
            { id: 'm1', role: 'user', content: 'Question 1', timestamp: 1 },
            { id: 'm2', role: 'assistant', content: 'Answer 1', timestamp: 2 },
            { id: 'm3', role: 'user', content: 'Question 2', timestamp: 3 },
          ],
        }),
      },
    })

    render(<AiChatMessages tabId="tab-1" />)
    const userMessages = screen.getAllByTestId('ai-message-user')
    const assistantMessages = screen.getAllByTestId('ai-message-assistant')
    expect(userMessages).toHaveLength(2)
    expect(assistantMessages).toHaveLength(1)
  })

  it('sets aria-busy=true during generation', () => {
    useAiStore.setState({
      tabs: {
        'tab-1': emptyTabState({ isGenerating: true }),
      },
    })

    render(<AiChatMessages tabId="tab-1" />)
    expect(screen.getByTestId('ai-chat-messages')).toHaveAttribute('aria-busy', 'true')
  })

  it('sets aria-busy=false when not generating', () => {
    render(<AiChatMessages tabId="tab-1" />)
    expect(screen.getByTestId('ai-chat-messages')).toHaveAttribute('aria-busy', 'false')
  })

  it('does not show welcome state when error exists', () => {
    useAiStore.setState({
      tabs: {
        'tab-1': emptyTabState({
          error: 'Some error',
        }),
      },
    })

    render(<AiChatMessages tabId="tab-1" />)
    expect(screen.queryByTestId('ai-welcome-state')).not.toBeInTheDocument()
  })

  it('shows error banner with retry button when connectionId is provided', () => {
    useAiStore.setState({
      tabs: {
        'tab-1': emptyTabState({
          error: 'Connection failed',
          messages: [{ id: 'm1', role: 'user', content: 'Test', timestamp: 1 }],
        }),
      },
    })

    render(<AiChatMessages tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-error-retry-button')).toBeInTheDocument()
  })

  it('calls retryLastMessage when retry button is clicked', async () => {
    const user = userEvent.setup()
    const retrySpy = vi.fn()
    const original = useAiStore.getState().retryLastMessage
    useAiStore.setState({ retryLastMessage: retrySpy })

    useAiStore.setState({
      tabs: {
        'tab-1': emptyTabState({
          error: 'Connection failed',
          messages: [{ id: 'm1', role: 'user', content: 'Test', timestamp: 1 }],
        }),
      },
    })

    render(<AiChatMessages tabId="tab-1" connectionId="conn-1" />)
    await user.click(screen.getByTestId('ai-error-retry-button'))

    expect(retrySpy).toHaveBeenCalled()

    useAiStore.setState({ retryLastMessage: original })
  })

  it('does not show retry button when connectionId is not provided', () => {
    useAiStore.setState({
      tabs: {
        'tab-1': emptyTabState({
          error: 'Connection failed',
        }),
      },
    })

    render(<AiChatMessages tabId="tab-1" />)
    expect(screen.getByTestId('ai-error-banner')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-error-retry-button')).not.toBeInTheDocument()
  })

  it('calls onSuggestionFill when suggestion chip is clicked', async () => {
    const user = userEvent.setup()
    const onSuggestionFill = vi.fn()

    render(<AiChatMessages tabId="tab-1" onSuggestionFill={onSuggestionFill} />)

    const chips = screen.getAllByTestId('ai-suggestion-chip')
    await user.click(chips[0])

    expect(onSuggestionFill).toHaveBeenCalledWith('Explain this query step by step')
  })

  it('shows streaming cursor on last assistant message during generation', () => {
    useAiStore.setState({
      tabs: {
        'tab-1': emptyTabState({
          isGenerating: true,
          messages: [
            { id: 'm1', role: 'user', content: 'Hello', timestamp: 1 },
            { id: 'm2', role: 'assistant', content: 'Thinking...', timestamp: 2 },
          ],
        }),
      },
    })

    render(<AiChatMessages tabId="tab-1" />)
    const assistantMsg = screen.getByTestId('ai-message-assistant')
    const cursor = assistantMsg.querySelector('[aria-hidden="true"]')
    expect(cursor).toBeInTheDocument()
  })
})
