import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import { AiChatInput } from '../../../components/ai-panel/AiChatInput'
import { useAiStore } from '../../../stores/ai-store'
import type { TabAiState } from '../../../stores/ai-store'
import { useSettingsStore, SETTINGS_DEFAULTS } from '../../../stores/settings-store'

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
    attachedContext: null,
    isPanelOpen: true,
    error: null,
    retrievedSchemaDdl: '',
    lastRetrievalTimestamp: 0,
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

describe('AiChatInput', () => {
  it('renders with data-testid="ai-chat-input"', () => {
    render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-chat-input')).toBeInTheDocument()
  })

  it('renders an editable textarea', async () => {
    const user = userEvent.setup()
    render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)

    const textarea = screen.getByTestId('ai-chat-textarea') as HTMLTextAreaElement
    expect(textarea).toBeInTheDocument()

    await user.type(textarea, 'Hello world')
    expect(textarea.value).toBe('Hello world')
  })

  it('shows send button during idle', () => {
    render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-send-button')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-stop-button')).not.toBeInTheDocument()
  })

  it('shows stop button during generation', () => {
    useAiStore.setState({
      tabs: {
        'tab-1': emptyTabState({ isGenerating: true, activeStreamId: 'stream-1' }),
      },
    })

    render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-stop-button')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-send-button')).not.toBeInTheDocument()
  })

  it('textarea is disabled during generation', () => {
    useAiStore.setState({
      tabs: {
        'tab-1': emptyTabState({ isGenerating: true, activeStreamId: 'stream-1' }),
      },
    })

    render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-chat-textarea')).toBeDisabled()
  })

  it('Enter sends message, Shift+Enter adds newline', async () => {
    const user = userEvent.setup()
    const sendMessageSpy = vi.fn()
    const originalSendMessage = useAiStore.getState().sendMessage
    useAiStore.setState({ sendMessage: sendMessageSpy })

    render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)

    const textarea = screen.getByTestId('ai-chat-textarea') as HTMLTextAreaElement

    // Type some text and press Shift+Enter — should add newline (no send)
    await user.type(textarea, 'line 1')
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    await user.type(textarea, 'line 2')

    expect(textarea.value).toContain('line 1')
    expect(textarea.value).toContain('line 2')
    expect(sendMessageSpy).not.toHaveBeenCalled()

    // Now press Enter — should send
    await user.keyboard('{Enter}')

    expect(sendMessageSpy).toHaveBeenCalledWith(
      'tab-1',
      'conn-1',
      expect.stringContaining('line 1'),
      {}
    )

    // Restore
    useAiStore.setState({ sendMessage: originalSendMessage })
  })

  it('send button is disabled when textarea is empty', () => {
    render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-send-button')).toBeDisabled()
  })

  it('send button is enabled when textarea has content', async () => {
    const user = userEvent.setup()
    render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)

    const textarea = screen.getByTestId('ai-chat-textarea')
    await user.type(textarea, 'Test query')

    await waitFor(() => {
      expect(screen.getByTestId('ai-send-button')).not.toBeDisabled()
    })
  })

  it('clicking send invokes store sendMessage', async () => {
    const user = userEvent.setup()
    const sendMessageSpy = vi.fn()
    const originalSendMessage = useAiStore.getState().sendMessage
    useAiStore.setState({ sendMessage: sendMessageSpy })

    render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)

    const textarea = screen.getByTestId('ai-chat-textarea')
    await user.type(textarea, 'SELECT * FROM users')
    await user.click(screen.getByTestId('ai-send-button'))

    expect(sendMessageSpy).toHaveBeenCalledWith('tab-1', 'conn-1', 'SELECT * FROM users', {})

    useAiStore.setState({ sendMessage: originalSendMessage })
  })

  it('clicking stop invokes store cancelStream', async () => {
    const user = userEvent.setup()
    const cancelStreamSpy = vi.fn()
    const originalCancelStream = useAiStore.getState().cancelStream
    useAiStore.setState({ cancelStream: cancelStreamSpy })

    useAiStore.setState({
      tabs: {
        'tab-1': emptyTabState({ isGenerating: true, activeStreamId: 'stream-1' }),
      },
    })

    render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)
    await user.click(screen.getByTestId('ai-stop-button'))

    expect(cancelStreamSpy).toHaveBeenCalledWith('tab-1')

    useAiStore.setState({ cancelStream: originalCancelStream })
  })

  it('shows disabled placeholder when AI is not enabled', () => {
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS, 'ai.enabled': 'false' },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)
    const textarea = screen.getByTestId('ai-chat-textarea') as HTMLTextAreaElement
    expect(textarea.placeholder).toContain('AI is disabled')
  })

  it('shows configure placeholder when endpoint/model missing', () => {
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS, 'ai.enabled': 'true', 'ai.endpoint': '', 'ai.model': '' },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)
    const textarea = screen.getByTestId('ai-chat-textarea') as HTMLTextAreaElement
    expect(textarea.placeholder).toContain('Configure AI endpoint')
  })

  it('clears textarea after sending', async () => {
    const user = userEvent.setup()
    const sendMessageSpy = vi.fn()
    const originalSendMessage = useAiStore.getState().sendMessage
    useAiStore.setState({ sendMessage: sendMessageSpy })

    render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)

    const textarea = screen.getByTestId('ai-chat-textarea') as HTMLTextAreaElement
    await user.type(textarea, 'Test message')
    await user.click(screen.getByTestId('ai-send-button'))

    await waitFor(() => {
      expect(textarea.value).toBe('')
    })

    useAiStore.setState({ sendMessage: originalSendMessage })
  })

  it('does not send when connectionId is null', async () => {
    const user = userEvent.setup()
    const sendMessageSpy = vi.fn()
    const originalSendMessage = useAiStore.getState().sendMessage
    useAiStore.setState({ sendMessage: sendMessageSpy })

    render(<AiChatInput tabId="tab-1" connectionId={null} />)

    const textarea = screen.getByTestId('ai-chat-textarea')
    await user.type(textarea, 'Test message')
    await user.keyboard('{Enter}')

    expect(sendMessageSpy).not.toHaveBeenCalled()

    useAiStore.setState({ sendMessage: originalSendMessage })
  })

  it('shows context chip when attachedContext exists', () => {
    useAiStore.setState({
      tabs: {
        'tab-1': emptyTabState({
          attachedContext: {
            sql: 'SELECT * FROM users WHERE active = 1',
            range: { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 40 },
          },
        }),
      },
    })

    render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-context-chip')).toBeInTheDocument()
  })

  it('does not show context chip when no attachedContext', () => {
    render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)
    expect(screen.queryByTestId('ai-context-chip')).not.toBeInTheDocument()
  })

  it('truncates long context chip text', () => {
    const longSql =
      'SELECT column1, column2, column3, column4, column5, column6 FROM very_long_table_name WHERE active = 1'
    useAiStore.setState({
      tabs: {
        'tab-1': emptyTabState({
          attachedContext: {
            sql: longSql,
            range: { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 100 },
          },
        }),
      },
    })

    render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)
    const chip = screen.getByTestId('ai-context-chip')
    // Should truncate with "..."
    expect(chip.textContent).toContain('...')
  })

  it('calls clearAttachedContext when context chip remove is clicked', async () => {
    const user = userEvent.setup()
    const clearSpy = vi.fn()
    const original = useAiStore.getState().clearAttachedContext
    useAiStore.setState({ clearAttachedContext: clearSpy })

    useAiStore.setState({
      tabs: {
        'tab-1': emptyTabState({
          attachedContext: {
            sql: 'SELECT 1',
            range: { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 10 },
          },
        }),
      },
    })

    render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)
    await user.click(screen.getByTestId('ai-context-chip-remove'))

    expect(clearSpy).toHaveBeenCalledWith('tab-1')

    useAiStore.setState({ clearAttachedContext: original })
  })

  it('fills textarea from suggestionText prop', async () => {
    const { rerender } = render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)

    const textarea = screen.getByTestId('ai-chat-textarea') as HTMLTextAreaElement
    expect(textarea.value).toBe('')

    const onConsumed = vi.fn()
    rerender(
      <AiChatInput
        tabId="tab-1"
        connectionId="conn-1"
        suggestionText="Explain this query"
        onSuggestionConsumed={onConsumed}
      />
    )

    await waitFor(() => {
      expect(textarea.value).toBe('Explain this query')
    })
  })
})
