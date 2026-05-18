import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AiPanel } from '../../../components/ai-panel/AiPanel'
import { useAiStore } from '../../../stores/ai-store'
import { useSettingsStore, SETTINGS_DEFAULTS } from '../../../stores/settings-store'
import { useAiMemoryStore } from '../../../stores/ai-memory-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { makeAiTabState } from '../../helpers/ai-test-utils'

/** Convenience: panel-open tab state (AiPanel tests render with the panel open). */
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
      'ai.endpoint': 'http://localhost:11434/v1',
      'ai.model': 'llama3',
      'ai.embeddingModel': 'nomic-embed-text',
    },
    pendingChanges: {},
    isDirty: false,
    isLoading: false,
    activeSection: 'ai',
    isDialogOpen: false,
    dialogSection: undefined,
  })

  useAiStore.setState({ tabs: { 'tab-1': emptyTabState() } })
})

afterEach(() => {
  consoleSpy.mockRestore()
})

describe('AiPanel', () => {
  it('renders with correct data-testid', () => {
    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-panel')).toBeInTheDocument()
  })

  it('renders the header', () => {
    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-panel-header')).toBeInTheDocument()
  })

  it('renders the messages area', () => {
    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-chat-messages')).toBeInTheDocument()
  })

  it('renders the input area', () => {
    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-chat-input')).toBeInTheDocument()
  })

  it('auto-scrolls to bottom on new messages', async () => {
    const scrollIntoViewMock = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoViewMock

    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)

    // Add messages to the store to trigger auto-scroll
    useAiStore.setState({
      tabs: {
        'tab-1': emptyTabState({
          messages: [
            { id: '1', role: 'user', content: 'Hello', timestamp: Date.now() },
            { id: '2', role: 'assistant', content: 'Hi there!', timestamp: Date.now() },
          ],
        }),
      },
    })

    await waitFor(() => {
      expect(scrollIntoViewMock).toHaveBeenCalled()
    })
  })

  it('shows all three sections: header, messages, and input', () => {
    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    const panel = screen.getByTestId('ai-panel')
    expect(panel.querySelector('[data-testid="ai-panel-header"]')).toBeInTheDocument()
    expect(panel.querySelector('[data-testid="ai-chat-messages"]')).toBeInTheDocument()
    expect(panel.querySelector('[data-testid="ai-chat-input"]')).toBeInTheDocument()
  })

  it('renders welcome state when no messages', () => {
    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-welcome-state')).toBeInTheDocument()
  })

  it('suggestion chips fill the textarea', async () => {
    const user = userEvent.setup()
    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)

    // Click a suggestion chip
    const chips = screen.getAllByTestId('ai-suggestion-chip')
    await user.click(chips[0])

    // The textarea should be filled
    const textarea = screen.getByTestId('ai-chat-textarea') as HTMLTextAreaElement
    await waitFor(() => {
      expect(textarea.value).toBe('Explain this query step by step')
    })
  })

  it('passes onTriggerDiff through to messages area', () => {
    const onTriggerDiff = vi.fn()
    render(<AiPanel tabId="tab-1" connectionId="conn-1" onTriggerDiff={onTriggerDiff} />)
    // Panel renders without error with the diff callback
    expect(screen.getByTestId('ai-panel')).toBeInTheDocument()
  })

  it('renders without onTriggerDiff', () => {
    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-panel')).toBeInTheDocument()
  })

  it('handleTriggerDiff calls onTriggerDiff with attachedContext range', () => {
    const onTriggerDiff = vi.fn()
    const range = { startLineNumber: 1, endLineNumber: 3, startColumn: 1, endColumn: 10 }
    useAiStore.setState({
      tabs: {
        'tab-1': emptyTabState({
          attachedContext: { sql: 'SELECT 1', range },
          messages: [
            { id: '1', role: 'user', content: 'Explain', timestamp: Date.now() },
            { id: '2', role: 'assistant', content: 'Here it is', timestamp: Date.now() },
          ],
        }),
      },
    })

    render(<AiPanel tabId="tab-1" connectionId="conn-1" onTriggerDiff={onTriggerDiff} />)

    expect(screen.getByTestId('ai-panel')).toBeInTheDocument()
  })

  it('handleTriggerDiff does nothing when attachedContext is null', () => {
    const onTriggerDiff = vi.fn()
    useAiStore.setState({
      tabs: {
        'tab-1': emptyTabState({
          attachedContext: null,
        }),
      },
    })

    render(<AiPanel tabId="tab-1" connectionId="conn-1" onTriggerDiff={onTriggerDiff} />)
    expect(screen.getByTestId('ai-panel')).toBeInTheDocument()
    // onTriggerDiff should not have been called yet
    expect(onTriggerDiff).not.toHaveBeenCalled()
  })

  it('shows waiting for index indicator when isWaitingForIndex is true', () => {
    useAiStore.setState({
      tabs: {
        'tab-1': emptyTabState({
          isWaitingForIndex: true,
        }),
      },
    })

    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-index-waiting')).toBeInTheDocument()
    expect(screen.getByText('Waiting for schema index...')).toBeInTheDocument()
  })

  it('does not show waiting indicator when isWaitingForIndex is false', () => {
    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.queryByTestId('ai-index-waiting')).not.toBeInTheDocument()
  })
})

describe('AiPanel — setup required state', () => {
  it('shows AiSetupRequired when AI is enabled but embedding model is empty', () => {
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
        'ai.model': 'llama3',
        'ai.embeddingModel': '',
      },
      pendingChanges: {},
    })

    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-setup-required')).toBeInTheDocument()
  })

  it('does not show AiSetupRequired when embedding model is configured', () => {
    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.queryByTestId('ai-setup-required')).not.toBeInTheDocument()
  })

  it('does not show messages area when setup required but shows disabled input', () => {
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
        'ai.model': 'llama3',
        'ai.embeddingModel': '',
      },
      pendingChanges: {},
    })

    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.queryByTestId('ai-chat-messages')).not.toBeInTheDocument()
    // Chat input should be present but disabled
    expect(screen.getByTestId('ai-chat-input')).toBeInTheDocument()
    const textarea = screen.getByTestId('ai-chat-textarea') as HTMLTextAreaElement
    expect(textarea.disabled).toBe(true)
    expect(textarea.placeholder).toContain('Embedding model required')
  })

  it('still shows the header when setup required', () => {
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
        'ai.model': 'llama3',
        'ai.embeddingModel': '',
      },
      pendingChanges: {},
    })

    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-panel-header')).toBeInTheDocument()
  })

  it('does not show setup required when AI is disabled', () => {
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'false',
        'ai.embeddingModel': '',
      },
      pendingChanges: {},
    })

    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.queryByTestId('ai-setup-required')).not.toBeInTheDocument()
  })

  it('AiSetupRequired disappears when embedding model is configured reactively', async () => {
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
        'ai.model': 'llama3',
        'ai.embeddingModel': '',
      },
      pendingChanges: {},
    })

    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-setup-required')).toBeInTheDocument()

    // Simulate user configuring the embedding model
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
        'ai.model': 'llama3',
        'ai.embeddingModel': 'nomic-embed-text',
      },
      pendingChanges: {},
    })

    await waitFor(() => {
      expect(screen.queryByTestId('ai-setup-required')).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('ai-chat-messages')).toBeInTheDocument()
  })
})

describe('AiPanel — re-embedding banner', () => {
  beforeEach(() => {
    // Set up connection store so conn-1 session maps to profile-1
    useConnectionStore.setState({
      activeConnections: {
        'conn-1': {
          id: 'conn-1',
          profile: {
            id: 'profile-1',
            name: 'Test',
            host: 'localhost',
            port: 3306,
            username: 'root',
            defaultDatabase: '',
            color: null,
            group: null,
          } as never,
          sessionDatabase: 'testdb',
          serverVersion: '8.0',
        } as never,
      },
    })
  })

  it('does not show re-embedding banner when status is idle', () => {
    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.queryByTestId('ai-memory-reembed-banner')).not.toBeInTheDocument()
  })

  it('shows re-embedding banner when status is running', () => {
    act(() => {
      useAiMemoryStore.setState({
        reembedStatus: {
          'profile-1': { status: 'running', done: 3, total: 10 },
        },
      })
    })

    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    const banner = screen.getByTestId('ai-memory-reembed-banner')
    expect(banner).toBeInTheDocument()
    expect(banner.textContent).toContain('3/10')
  })

  it('banner disappears when status returns to idle', async () => {
    act(() => {
      useAiMemoryStore.setState({
        reembedStatus: {
          'profile-1': { status: 'running', done: 5, total: 5 },
        },
      })
    })

    render(<AiPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('ai-memory-reembed-banner')).toBeInTheDocument()

    act(() => {
      useAiMemoryStore.setState({
        reembedStatus: {
          'profile-1': { status: 'idle', done: 0, total: 0 },
        },
      })
    })

    await waitFor(() => {
      expect(screen.queryByTestId('ai-memory-reembed-banner')).not.toBeInTheDocument()
    })
  })
})
