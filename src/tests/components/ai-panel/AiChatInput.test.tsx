import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AiChatInput } from '../../../components/ai-panel/AiChatInput'
import { useAiStore } from '../../../stores/ai-store'
import { useSettingsStore, SETTINGS_DEFAULTS } from '../../../stores/settings-store'
import * as slashCommandsModule from '../../../lib/slash-commands'
import { dispatchWorkspaceTabDeactivated } from '../../../lib/workspace-tab-activity-events'
import { makeAiTabState } from '../../helpers/ai-test-utils'
import { useConnectionStore } from '../../../stores/connection-store'
import { ipc } from '../../ipc-mock'

/** Convenience: panel-open tab state for AiChatInput tests. */
function emptyTabState(overrides?: Parameters<typeof makeAiTabState>[0]) {
  return makeAiTabState({ isPanelOpen: true, ...overrides })
}

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.clearAllMocks()

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
  useConnectionStore.setState({ activeConnections: {} })
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

  it('keeps the empty textarea at one-row height when the placeholder would wrap', async () => {
    const originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'scrollHeight'
    )

    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return 140
      },
    })

    try {
      render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)

      await waitFor(() => {
        const textarea = screen.getByTestId('ai-chat-textarea') as HTMLTextAreaElement
        expect(textarea.style.height).toBe('36px')
      })
    } finally {
      if (originalScrollHeight) {
        Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', originalScrollHeight)
      }
    }
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

  // -----------------------------------------------------------------------
  // Slash command dropdown integration
  // -----------------------------------------------------------------------

  it('typing "/" shows the slash command dropdown', async () => {
    const user = userEvent.setup()
    render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)

    const textarea = screen.getByTestId('ai-chat-textarea')
    await user.type(textarea, '/')

    await waitFor(() => {
      expect(screen.getByTestId('slash-command-dropdown')).toBeInTheDocument()
    })
  })

  it('typing "/rem" filters to /remember', async () => {
    const user = userEvent.setup()
    render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)

    const textarea = screen.getByTestId('ai-chat-textarea')
    await user.type(textarea, '/rem')

    await waitFor(() => {
      expect(screen.getByTestId('slash-command-dropdown')).toBeInTheDocument()
      expect(screen.getByTestId('slash-command-item-remember')).toBeInTheDocument()
    })
  })

  it('ArrowDown highlights first item in dropdown', async () => {
    const user = userEvent.setup()
    render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)

    const textarea = screen.getByTestId('ai-chat-textarea')
    await user.type(textarea, '/')
    await waitFor(() => {
      expect(screen.getByTestId('slash-command-dropdown')).toBeInTheDocument()
    })

    await user.keyboard('{ArrowDown}')

    await waitFor(() => {
      const item = screen.getByTestId('slash-command-item-remember')
      expect(item.getAttribute('aria-selected')).toBe('true')
    })
  })

  it('Enter with highlighted item selects command (fills input)', async () => {
    const user = userEvent.setup()
    render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)

    const textarea = screen.getByTestId('ai-chat-textarea') as HTMLTextAreaElement
    await user.type(textarea, '/')
    await waitFor(() => {
      expect(screen.getByTestId('slash-command-dropdown')).toBeInTheDocument()
    })

    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(textarea.value).toBe('/remember ')
      expect(screen.queryByTestId('slash-command-dropdown')).not.toBeInTheDocument()
    })
  })

  it('Escape dismisses dropdown but keeps "/" in input', async () => {
    const user = userEvent.setup()
    render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)

    const textarea = screen.getByTestId('ai-chat-textarea') as HTMLTextAreaElement
    await user.type(textarea, '/')
    await waitFor(() => {
      expect(screen.getByTestId('slash-command-dropdown')).toBeInTheDocument()
    })

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByTestId('slash-command-dropdown')).not.toBeInTheDocument()
    })
    expect(textarea.value).toBe('/')
  })

  it('dismisses slash command dropdown when its workspace tab deactivates', async () => {
    const user = userEvent.setup()
    render(<AiChatInput tabId="tab-1" connectionId="conn-1" workspaceTabId="workspace-tab-1" />)

    const textarea = screen.getByTestId('ai-chat-textarea') as HTMLTextAreaElement
    await user.type(textarea, '/')
    await waitFor(() => {
      expect(screen.getByTestId('slash-command-dropdown')).toBeInTheDocument()
    })

    act(() => {
      dispatchWorkspaceTabDeactivated('workspace-tab-1', 'conn-1')
    })

    await waitFor(() => {
      expect(screen.queryByTestId('slash-command-dropdown')).not.toBeInTheDocument()
    })
    expect(textarea.value).toBe('/')
  })

  it('keeps slash command dropdown open when another workspace tab deactivates', async () => {
    const user = userEvent.setup()
    render(<AiChatInput tabId="tab-1" connectionId="conn-1" workspaceTabId="workspace-tab-1" />)

    const textarea = screen.getByTestId('ai-chat-textarea')
    await user.type(textarea, '/')
    await waitFor(() => {
      expect(screen.getByTestId('slash-command-dropdown')).toBeInTheDocument()
    })

    act(() => {
      dispatchWorkspaceTabDeactivated('workspace-tab-2', 'conn-1')
    })

    expect(screen.getByTestId('slash-command-dropdown')).toBeInTheDocument()
  })

  it('submitting "/remember some text" calls execute, not sendMessage', async () => {
    const user = userEvent.setup()
    const sendMessageSpy = vi.fn()
    const originalSendMessage = useAiStore.getState().sendMessage
    useAiStore.setState({ sendMessage: sendMessageSpy })

    const executeSpy = vi.fn().mockResolvedValue(undefined)
    const originalExecute = slashCommandsModule.SLASH_COMMANDS[0].execute
    slashCommandsModule.SLASH_COMMANDS[0].execute = executeSpy

    render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)

    const textarea = screen.getByTestId('ai-chat-textarea') as HTMLTextAreaElement
    await user.type(textarea, '/remember orders_v2 holds data')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(executeSpy).toHaveBeenCalledWith('orders_v2 holds data', 'conn-1')
    })
    expect(sendMessageSpy).not.toHaveBeenCalled()

    slashCommandsModule.SLASH_COMMANDS[0].execute = originalExecute
    useAiStore.setState({ sendMessage: originalSendMessage })
  })

  it('regular messages still send normally', async () => {
    const user = userEvent.setup()
    const sendMessageSpy = vi.fn()
    const originalSendMessage = useAiStore.getState().sendMessage
    useAiStore.setState({ sendMessage: sendMessageSpy })

    render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)

    const textarea = screen.getByTestId('ai-chat-textarea')
    await user.type(textarea, 'SELECT * FROM users')
    await user.keyboard('{Enter}')

    expect(sendMessageSpy).toHaveBeenCalledWith('tab-1', 'conn-1', 'SELECT * FROM users', {})

    useAiStore.setState({ sendMessage: originalSendMessage })
  })

  it('dropdown does not appear for "/" typed mid-sentence', async () => {
    const user = userEvent.setup()
    render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)

    const textarea = screen.getByTestId('ai-chat-textarea')
    await user.type(textarea, 'hello /remember')

    expect(screen.queryByTestId('slash-command-dropdown')).not.toBeInTheDocument()
  })

  it('/remember with empty args shows error via execute', async () => {
    const user = userEvent.setup()
    const sendMessageSpy = vi.fn()
    const originalSendMessage = useAiStore.getState().sendMessage
    useAiStore.setState({ sendMessage: sendMessageSpy })

    render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)

    const textarea = screen.getByTestId('ai-chat-textarea')
    await user.type(textarea, '/remember')
    await user.keyboard('{Enter}')

    // The execute function throws for empty args; sendMessage should not be called
    await waitFor(() => {
      expect(sendMessageSpy).not.toHaveBeenCalled()
    })

    useAiStore.setState({ sendMessage: originalSendMessage })
  })

  // -----------------------------------------------------------------------
  // /remember "Always Ask" scope picker
  // -----------------------------------------------------------------------

  describe('/remember Always Ask flow', () => {
    function setActiveConnectionGroup(groupId: string | null) {
      act(() => {
        useConnectionStore.setState({
          activeConnections: {
            'conn-1': {
              // Only `profile.groupId` is consulted by AiChatInput.
              profile: { id: 'profile-1', groupId },
            },
          },
        } as unknown as Partial<ReturnType<typeof useConnectionStore.getState>>)
      })
    }

    function setRememberScope(scope: string) {
      act(() => {
        useSettingsStore.setState((s) => ({
          settings: { ...s.settings, 'ai.rememberScope': scope },
        }))
      })
    }

    it('shows the scope picker (does not save) when default scope is "ask"', async () => {
      const user = userEvent.setup()
      setRememberScope('ask')
      setActiveConnectionGroup(null)
      const saveSpy = vi.fn().mockResolvedValue({
        id: 1,
        scope: 'connection',
        connectionId: 'conn-1',
        groupId: null,
        content: 'x',
        createdAt: 0,
        source: 'manual',
      })
      ipc.override('save_memory', saveSpy)

      render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)

      const textarea = screen.getByTestId('ai-chat-textarea')
      await user.type(textarea, '/remember use UTC')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(screen.getByTestId('memory-scope-picker')).toBeInTheDocument()
      })
      expect(saveSpy).not.toHaveBeenCalled()
    })

    it('disables the Group option in the picker when the connection has no group', async () => {
      const user = userEvent.setup()
      setRememberScope('ask')
      setActiveConnectionGroup(null)

      render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)

      const textarea = screen.getByTestId('ai-chat-textarea')
      await user.type(textarea, '/remember use UTC')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(screen.getByTestId('memory-scope-option-group')).toHaveAttribute(
          'aria-disabled',
          'true'
        )
      })
    })

    it('enables the Group option when the connection belongs to a group', async () => {
      const user = userEvent.setup()
      setRememberScope('ask')
      setActiveConnectionGroup('group-9')

      render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)

      const textarea = screen.getByTestId('ai-chat-textarea')
      await user.type(textarea, '/remember use UTC')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(screen.getByTestId('memory-scope-option-group')).not.toHaveAttribute('aria-disabled')
      })
    })

    it('picking a scope calls save_memory with that scope and clears the input', async () => {
      const user = userEvent.setup()
      setRememberScope('ask')
      setActiveConnectionGroup(null)
      const saveSpy = vi.fn().mockResolvedValue({
        id: 1,
        scope: 'global',
        connectionId: null,
        groupId: null,
        content: 'use UTC',
        createdAt: 0,
        source: 'manual',
      })
      ipc.override('save_memory', saveSpy)

      render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)

      const textarea = screen.getByTestId('ai-chat-textarea') as HTMLTextAreaElement
      await user.type(textarea, '/remember use UTC')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(screen.getByTestId('memory-scope-picker')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('memory-scope-option-global'))

      await waitFor(() => {
        expect(saveSpy).toHaveBeenCalledWith(
          expect.objectContaining({ sessionId: 'conn-1', content: 'use UTC', scope: 'global' }),
          'save_memory'
        )
      })
      await waitFor(() => {
        expect(textarea.value).toBe('')
        expect(screen.queryByTestId('memory-scope-picker')).not.toBeInTheDocument()
      })
    })

    it('Escape cancels the picker and keeps the typed input', async () => {
      const user = userEvent.setup()
      setRememberScope('ask')
      setActiveConnectionGroup(null)

      render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)

      const textarea = screen.getByTestId('ai-chat-textarea') as HTMLTextAreaElement
      await user.type(textarea, '/remember use UTC')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(screen.getByTestId('memory-scope-picker')).toBeInTheDocument()
      })

      await user.keyboard('{Escape}')

      await waitFor(() => {
        expect(screen.queryByTestId('memory-scope-picker')).not.toBeInTheDocument()
      })
      expect(textarea.value).toBe('/remember use UTC')
    })

    it('saves immediately at the resolved scope (no picker) for a concrete default', async () => {
      const user = userEvent.setup()
      setRememberScope('connection')
      setActiveConnectionGroup(null)
      const saveSpy = vi.fn().mockResolvedValue({
        id: 1,
        scope: 'connection',
        connectionId: 'conn-1',
        groupId: null,
        content: 'use UTC',
        createdAt: 0,
        source: 'manual',
      })
      ipc.override('save_memory', saveSpy)

      render(<AiChatInput tabId="tab-1" connectionId="conn-1" />)

      const textarea = screen.getByTestId('ai-chat-textarea') as HTMLTextAreaElement
      await user.type(textarea, '/remember use UTC')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(saveSpy).toHaveBeenCalledWith(
          expect.objectContaining({ scope: 'connection', content: 'use UTC' }),
          'save_memory'
        )
      })
      expect(screen.queryByTestId('memory-scope-picker')).not.toBeInTheDocument()
    })
  })
})
