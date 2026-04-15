import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import { AiSettings } from '../../../components/settings/AiSettings'
import { useSettingsStore, SETTINGS_DEFAULTS } from '../../../stores/settings-store'
import { useSchemaIndexStore } from '../../../stores/schema-index-store'

// Mock the ai-commands module for listAiModels
const mockListAiModels = vi.fn()
vi.mock('../../../lib/ai-commands', () => ({
  listAiModels: (...args: unknown[]) => mockListAiModels(...args),
}))

// Mock the schema-index-store module
vi.mock('../../../stores/schema-index-store', () => ({
  useSchemaIndexStore: {
    getState: vi.fn(() => ({
      sessionToProfile: {},
      forceRebuild: vi.fn().mockResolvedValue(undefined),
    })),
  },
}))

function setupMockIPC() {
  mockIPC((cmd, args) => {
    if (cmd === 'get_all_settings') return { ...SETTINGS_DEFAULTS }
    if (cmd === 'set_setting') return null
    if (cmd === 'get_app_info')
      return { rustLogOverride: false, logDirectory: '/mock/logs', appVersion: '1.0.0' }
    if (cmd === 'log_frontend') return undefined
    if (cmd === 'plugin:event|listen') return () => {}
    if (cmd === 'plugin:event|unlisten') return undefined
    if (cmd === 'get_setting') return null
    throw new Error(`[vitest] Unmocked Tauri IPC command: ${cmd} ${JSON.stringify(args)}`)
  })
}

const MOCK_MODELS_WITH_CATEGORIES = [
  { id: 'llama3', name: 'llama3:latest', category: 'chat' },
  { id: 'mistral', name: 'mistral:latest', category: 'chat' },
  { id: 'nomic-embed-text', name: 'nomic-embed-text', category: 'embedding' },
]

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  mockListAiModels.mockReset()
  ;(useSchemaIndexStore.getState as ReturnType<typeof vi.fn>).mockReset()
  ;(useSchemaIndexStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
    sessionToProfile: {},
    forceRebuild: vi.fn().mockResolvedValue(undefined),
  })
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  useSettingsStore.setState({
    settings: { ...SETTINGS_DEFAULTS },
    pendingChanges: {},
    isDirty: false,
    isLoading: false,
    activeSection: 'ai',
  })
  setupMockIPC()
  mockListAiModels.mockResolvedValue({ models: [], error: undefined })
})

afterEach(() => {
  consoleSpy?.mockRestore()
})

describe('AiSettings', () => {
  it('renders the AI settings section with all fields', () => {
    render(<AiSettings />)
    expect(screen.getByTestId('settings-ai')).toBeInTheDocument()
    expect(screen.getByTestId('settings-ai-enabled')).toBeInTheDocument()
    expect(screen.getByTestId('settings-ai-endpoint')).toBeInTheDocument()
    expect(screen.getByTestId('settings-ai-temperature')).toBeInTheDocument()
    expect(screen.getByTestId('settings-ai-max-tokens')).toBeInTheDocument()
  })

  it('does NOT render a free-text model name input', () => {
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS, 'ai.enabled': 'true' },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)
    expect(screen.queryByTestId('settings-ai-model')).not.toBeInTheDocument()
    expect(screen.queryByText('Model name')).not.toBeInTheDocument()
  })

  it('shows the enable toggle with correct default (off)', () => {
    render(<AiSettings />)
    const toggle = screen.getByTestId('settings-ai-enabled')
    const checkbox = toggle.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(checkbox).not.toBeNull()
    expect(checkbox.checked).toBe(false)
  })

  it('disables connection and generation fields when AI is disabled', () => {
    render(<AiSettings />)
    const endpointInput = screen.getByTestId('settings-ai-endpoint') as HTMLInputElement
    const tempInput = screen.getByTestId('settings-ai-temperature') as HTMLInputElement
    const maxTokensInput = screen.getByTestId('settings-ai-max-tokens') as HTMLInputElement

    expect(endpointInput).toBeDisabled()
    expect(tempInput).toBeDisabled()
    expect(maxTokensInput).toBeDisabled()
  })

  it('enables connection and generation fields when AI is enabled', () => {
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS, 'ai.enabled': 'true' },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)

    const endpointInput = screen.getByTestId('settings-ai-endpoint') as HTMLInputElement
    const tempInput = screen.getByTestId('settings-ai-temperature') as HTMLInputElement
    const maxTokensInput = screen.getByTestId('settings-ai-max-tokens') as HTMLInputElement

    expect(endpointInput).not.toBeDisabled()
    expect(tempInput).not.toBeDisabled()
    expect(maxTokensInput).not.toBeDisabled()
  })

  it('toggling AI on enables the other fields', async () => {
    const user = userEvent.setup()
    render(<AiSettings />)

    // Initially disabled
    expect(screen.getByTestId('settings-ai-endpoint')).toBeDisabled()

    // Toggle on
    const toggle = screen.getByTestId('settings-ai-enabled')
    const checkbox = toggle.querySelector('input[type="checkbox"]') as HTMLInputElement
    await user.click(checkbox)

    // Now enabled
    await waitFor(() => {
      expect(screen.getByTestId('settings-ai-endpoint')).not.toBeDisabled()
    })
    expect(screen.getByTestId('settings-ai-temperature')).not.toBeDisabled()
    expect(screen.getByTestId('settings-ai-max-tokens')).not.toBeDisabled()

    // Store should reflect the change
    expect(useSettingsStore.getState().pendingChanges['ai.enabled']).toBe('true')
  })

  it('toggling AI off disables the other fields', async () => {
    const user = userEvent.setup()
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS, 'ai.enabled': 'true' },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)
    expect(screen.getByTestId('settings-ai-endpoint')).not.toBeDisabled()

    const toggle = screen.getByTestId('settings-ai-enabled')
    const checkbox = toggle.querySelector('input[type="checkbox"]') as HTMLInputElement
    await user.click(checkbox)

    await waitFor(() => {
      expect(screen.getByTestId('settings-ai-endpoint')).toBeDisabled()
    })
    expect(useSettingsStore.getState().pendingChanges['ai.enabled']).toBe('false')
  })

  it('sets pending change when endpoint is modified', async () => {
    const user = userEvent.setup()
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS, 'ai.enabled': 'true' },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)

    const endpointInput = screen.getByTestId('settings-ai-endpoint') as HTMLInputElement
    await user.clear(endpointInput)
    await user.type(endpointInput, 'https://api.example.com/v1')

    expect(useSettingsStore.getState().pendingChanges['ai.endpoint']).toBe(
      'https://api.example.com/v1'
    )
  })

  it('sets pending change when temperature is modified', async () => {
    const user = userEvent.setup()
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS, 'ai.enabled': 'true' },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)

    const tempInput = screen.getByTestId('settings-ai-temperature') as HTMLInputElement
    await user.clear(tempInput)
    await user.type(tempInput, '0.7')

    expect(useSettingsStore.getState().pendingChanges['ai.temperature']).toBe('0.7')
  })

  it('sets pending change when max tokens is modified', async () => {
    const user = userEvent.setup()
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS, 'ai.enabled': 'true' },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)

    const maxTokensInput = screen.getByTestId('settings-ai-max-tokens') as HTMLInputElement
    await user.clear(maxTokensInput)
    await user.type(maxTokensInput, '4096')

    expect(useSettingsStore.getState().pendingChanges['ai.maxTokens']).toBe('4096')
  })

  it('displays default values correctly', () => {
    render(<AiSettings />)

    const tempInput = screen.getByTestId('settings-ai-temperature') as HTMLInputElement
    const maxTokensInput = screen.getByTestId('settings-ai-max-tokens') as HTMLInputElement

    expect(tempInput.value).toBe('0.3')
    expect(maxTokensInput.value).toBe('2048')
  })

  it('reset section restores AI defaults', () => {
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'https://custom.api.com',
        'ai.model': 'custom-model',
        'ai.embeddingModel': 'custom-embed',
        'ai.temperature': '1.0',
        'ai.maxTokens': '8192',
      },
      pendingChanges: {},
      isDirty: false,
    })

    useSettingsStore.getState().resetSection('ai')

    const state = useSettingsStore.getState()
    expect(state.pendingChanges['ai.enabled']).toBe('false')
    expect(state.pendingChanges['ai.endpoint']).toBe('')
    expect(state.pendingChanges['ai.model']).toBe('')
    expect(state.pendingChanges['ai.embeddingModel']).toBe('')
    expect(state.pendingChanges['ai.temperature']).toBe('0.3')
    expect(state.pendingChanges['ai.maxTokens']).toBe('2048')
    expect(state.isDirty).toBe(true)
  })

  it('renders section headings', () => {
    render(<AiSettings />)
    expect(screen.getByText('Enable AI')).toBeInTheDocument()
    expect(screen.getByText('Connection')).toBeInTheDocument()
    expect(screen.getByText('Generation')).toBeInTheDocument()
  })

  it('shows correct label text for fields', () => {
    render(<AiSettings />)
    expect(screen.getByText('Enable AI assistant')).toBeInTheDocument()
    expect(screen.getByText('Endpoint URL')).toBeInTheDocument()
    expect(screen.getByText('Temperature')).toBeInTheDocument()
    expect(screen.getByText('Max tokens')).toBeInTheDocument()
  })

  it('applies disabled visual class when AI is off', () => {
    render(<AiSettings />)
    const aiContainer = screen.getByTestId('settings-ai')
    const disabledWrapper = aiContainer.children[1] as HTMLElement
    expect(disabledWrapper.className).toContain('disabledGroup')
  })

  it('removes disabled visual class when AI is on', () => {
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS, 'ai.enabled': 'true' },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)
    const aiContainer = screen.getByTestId('settings-ai')
    const wrapper = aiContainer.children[1] as HTMLElement
    expect(wrapper.className).not.toContain('disabledGroup')
  })

  it('shows pending values over saved values', () => {
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS, 'ai.enabled': 'true', 'ai.endpoint': 'https://saved.com' },
      pendingChanges: { 'ai.endpoint': 'https://pending.com' },
      isDirty: true,
    })

    render(<AiSettings />)
    const endpointInput = screen.getByTestId('settings-ai-endpoint') as HTMLInputElement
    expect(endpointInput.value).toBe('https://pending.com')
  })

  it('shows helper text when AI is enabled and endpoint is set', () => {
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1/chat/completions',
      },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)
    expect(screen.getByTestId('ai-helper-text')).toBeInTheDocument()
    expect(screen.getByTestId('ai-helper-text')).toHaveTextContent(
      'Models will be grouped by type: chat for conversation, embedding for schema search'
    )
  })
})

// ---------------------------------------------------------------------------
// Model listing tests — Category Grouping
// ---------------------------------------------------------------------------

describe('AiSettings - Model Categories', () => {
  it('does not show model list section when AI is disabled', () => {
    render(<AiSettings />)
    expect(screen.queryByTestId('ai-model-list-section')).not.toBeInTheDocument()
  })

  it('does not show model list section when endpoint is empty', () => {
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS, 'ai.enabled': 'true', 'ai.endpoint': '' },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)
    expect(screen.queryByTestId('ai-model-list-section')).not.toBeInTheDocument()
  })

  it('shows model list section when AI is enabled and endpoint has value', () => {
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1/chat/completions',
      },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)
    expect(screen.getByTestId('ai-model-list-section')).toBeInTheDocument()
  })

  it('auto-fetches models when AI is enabled and endpoint is set', () => {
    mockListAiModels.mockResolvedValueOnce({
      models: MOCK_MODELS_WITH_CATEGORIES,
    })

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1/chat/completions',
      },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)
    expect(mockListAiModels).toHaveBeenCalledTimes(1)
  })

  it('shows loading state automatically during model fetch', () => {
    let _resolve: (value: { models: unknown[] }) => void
    mockListAiModels.mockReturnValueOnce(
      new Promise<{ models: unknown[] }>((resolve) => {
        _resolve = resolve
      })
    )

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1/chat/completions',
      },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)
    expect(screen.getByTestId('ai-models-loading')).toBeInTheDocument()

    // Resolve to clean up
    void act(() => {
      _resolve!({ models: [] })
    })
  })

  it('auto-shows model categories after fetching', async () => {
    mockListAiModels.mockResolvedValueOnce({
      models: MOCK_MODELS_WITH_CATEGORIES,
    })

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1/chat/completions',
      },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)

    await waitFor(() => {
      expect(screen.getByTestId('ai-model-categories')).toBeInTheDocument()
    })
  })

  it('auto-shows error when listAiModels returns an error', async () => {
    mockListAiModels.mockResolvedValueOnce({
      models: [],
      error: 'Connection refused',
    })

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1/chat/completions',
      },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)

    await waitFor(() => {
      expect(screen.getByTestId('ai-models-error')).toBeInTheDocument()
    })

    expect(screen.getByTestId('ai-models-error')).toHaveTextContent('Connection refused')
  })

  it('does not auto-fetch when AI is disabled', () => {
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'false',
        'ai.endpoint': 'http://localhost:11434/v1/chat/completions',
      },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)
    expect(mockListAiModels).not.toHaveBeenCalled()
  })

  it('does not auto-fetch when endpoint is empty', () => {
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': '',
      },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)
    expect(mockListAiModels).not.toHaveBeenCalled()
  })

  it('re-fetches models when endpoint changes', async () => {
    mockListAiModels.mockResolvedValue({
      models: MOCK_MODELS_WITH_CATEGORIES,
    })

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1/chat/completions',
      },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)

    await waitFor(() => {
      expect(mockListAiModels).toHaveBeenCalledTimes(1)
    })

    // Change endpoint via store
    act(() => {
      useSettingsStore.setState({
        settings: {
          ...SETTINGS_DEFAULTS,
          'ai.enabled': 'true',
          'ai.endpoint': 'http://localhost:9999/v1/chat/completions',
        },
        pendingChanges: {},
        isDirty: false,
      })
    })

    await waitFor(() => {
      expect(mockListAiModels).toHaveBeenCalledTimes(2)
    })
  })

  it('renders two category sections after fetching models', async () => {
    mockListAiModels.mockResolvedValueOnce({
      models: MOCK_MODELS_WITH_CATEGORIES,
    })

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1/chat/completions',
      },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)

    await waitFor(() => {
      expect(screen.getByTestId('ai-model-categories')).toBeInTheDocument()
    })

    expect(screen.getByTestId('ai-category-chat')).toBeInTheDocument()
    expect(screen.getByTestId('ai-category-embedding')).toBeInTheDocument()
  })

  it('renders chat models in the Chat section', async () => {
    mockListAiModels.mockResolvedValueOnce({
      models: MOCK_MODELS_WITH_CATEGORIES,
    })

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1/chat/completions',
      },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)

    await waitFor(() => {
      expect(screen.getByTestId('ai-chat-model-grid')).toBeInTheDocument()
    })

    const chatGrid = screen.getByTestId('ai-chat-model-grid')
    expect(chatGrid).toContainElement(screen.getByTestId('ai-model-card-llama3'))
    expect(chatGrid).toContainElement(screen.getByTestId('ai-model-card-mistral'))
  })

  it('renders embedding models in the Embedding section', async () => {
    mockListAiModels.mockResolvedValueOnce({
      models: MOCK_MODELS_WITH_CATEGORIES,
    })

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1/chat/completions',
      },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)

    await waitFor(() => {
      expect(screen.getByTestId('ai-embedding-model-grid')).toBeInTheDocument()
    })

    const embeddingGrid = screen.getByTestId('ai-embedding-model-grid')
    expect(embeddingGrid).toContainElement(screen.getByTestId('ai-model-card-nomic-embed-text'))
  })

  it('clicking a chat model card updates ai.model setting', async () => {
    const user = userEvent.setup()

    mockListAiModels.mockResolvedValueOnce({
      models: MOCK_MODELS_WITH_CATEGORIES,
    })

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1/chat/completions',
      },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)

    await waitFor(() => {
      expect(screen.getByTestId('ai-model-card-llama3')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('ai-model-card-llama3'))

    expect(useSettingsStore.getState().pendingChanges['ai.model']).toBe('llama3')
    // Should not affect embeddingModel
    expect(useSettingsStore.getState().pendingChanges['ai.embeddingModel']).toBeUndefined()
  })

  it('clicking an embedding model card updates ai.embeddingModel setting', async () => {
    const user = userEvent.setup()

    mockListAiModels.mockResolvedValueOnce({
      models: MOCK_MODELS_WITH_CATEGORIES,
    })

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1/chat/completions',
      },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)

    await waitFor(() => {
      expect(screen.getByTestId('ai-model-card-nomic-embed-text')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('ai-model-card-nomic-embed-text'))

    expect(useSettingsStore.getState().pendingChanges['ai.embeddingModel']).toBe('nomic-embed-text')
    // Should not affect model
    expect(useSettingsStore.getState().pendingChanges['ai.model']).toBeUndefined()
  })

  it('shows empty state when no embedding models found', async () => {
    mockListAiModels.mockResolvedValueOnce({
      models: [
        { id: 'llama3', name: 'llama3:latest', category: 'chat' },
        { id: 'mistral', name: 'mistral:latest', category: 'chat' },
      ],
    })

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1/chat/completions',
      },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)

    await waitFor(() => {
      expect(screen.getByTestId('ai-model-categories')).toBeInTheDocument()
    })

    expect(screen.getByTestId('ai-embedding-empty-state')).toBeInTheDocument()
    expect(screen.getByTestId('ai-embedding-empty-state')).toHaveTextContent(
      'No embedding models found'
    )
  })

  it('shows empty state when no chat models found', async () => {
    mockListAiModels.mockResolvedValueOnce({
      models: [{ id: 'nomic-embed-text', name: 'nomic-embed-text', category: 'embedding' }],
    })

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1/chat/completions',
      },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)

    await waitFor(() => {
      expect(screen.getByTestId('ai-model-categories')).toBeInTheDocument()
    })

    expect(screen.getByTestId('ai-chat-empty-state')).toBeInTheDocument()
    expect(screen.getByTestId('ai-chat-empty-state')).toHaveTextContent('No chat models found')
  })

  it('category headers show correct count in badge', async () => {
    mockListAiModels.mockResolvedValueOnce({
      models: MOCK_MODELS_WITH_CATEGORIES,
    })

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1/chat/completions',
      },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)

    await waitFor(() => {
      expect(screen.getByTestId('ai-category-chat-count')).toBeInTheDocument()
    })

    expect(screen.getByTestId('ai-category-chat-count')).toHaveTextContent('2')
    expect(screen.getByTestId('ai-category-embedding-count')).toHaveTextContent('1')
  })

  it('category headers show correct labels', async () => {
    mockListAiModels.mockResolvedValueOnce({
      models: MOCK_MODELS_WITH_CATEGORIES,
    })

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1/chat/completions',
      },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)

    await waitFor(() => {
      expect(screen.getByTestId('ai-category-chat-label')).toBeInTheDocument()
    })

    expect(screen.getByTestId('ai-category-chat-label')).toHaveTextContent('Chat Models')
    expect(screen.getByTestId('ai-category-embedding-label')).toHaveTextContent('Embedding Models')
  })

  it('ARIA: category sections have role="radiogroup" with aria-labelledby', async () => {
    mockListAiModels.mockResolvedValueOnce({
      models: MOCK_MODELS_WITH_CATEGORIES,
    })

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1/chat/completions',
      },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)

    await waitFor(() => {
      expect(screen.getByTestId('ai-chat-model-grid')).toBeInTheDocument()
    })

    const chatGrid = screen.getByTestId('ai-chat-model-grid')
    expect(chatGrid).toHaveAttribute('role', 'radiogroup')
    expect(chatGrid).toHaveAttribute('aria-labelledby', 'ai-category-chat-label')

    const embeddingGrid = screen.getByTestId('ai-embedding-model-grid')
    expect(embeddingGrid).toHaveAttribute('role', 'radiogroup')
    expect(embeddingGrid).toHaveAttribute('aria-labelledby', 'ai-category-embedding-label')
  })

  it('ARIA: model cards have role="radio" and correct aria-checked', async () => {
    mockListAiModels.mockResolvedValueOnce({
      models: MOCK_MODELS_WITH_CATEGORIES,
    })

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1/chat/completions',
        'ai.model': 'llama3',
        'ai.embeddingModel': 'nomic-embed-text',
      },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)

    await waitFor(() => {
      expect(screen.getByTestId('ai-model-card-llama3')).toBeInTheDocument()
    })

    // Chat card: llama3 is selected
    const llama3Card = screen.getByTestId('ai-model-card-llama3')
    expect(llama3Card).toHaveAttribute('role', 'radio')
    expect(llama3Card).toHaveAttribute('aria-checked', 'true')

    // Chat card: mistral is not selected
    const mistralCard = screen.getByTestId('ai-model-card-mistral')
    expect(mistralCard).toHaveAttribute('role', 'radio')
    expect(mistralCard).toHaveAttribute('aria-checked', 'false')

    // Embedding card: nomic-embed-text is selected
    const embedCard = screen.getByTestId('ai-model-card-nomic-embed-text')
    expect(embedCard).toHaveAttribute('role', 'radio')
    expect(embedCard).toHaveAttribute('aria-checked', 'true')
  })

  it('selected models show checkmark icons', async () => {
    mockListAiModels.mockResolvedValueOnce({
      models: MOCK_MODELS_WITH_CATEGORIES,
    })

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1/chat/completions',
        'ai.model': 'llama3',
        'ai.embeddingModel': 'nomic-embed-text',
      },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)

    await waitFor(() => {
      expect(screen.getByTestId('ai-model-card-llama3')).toBeInTheDocument()
    })

    // Selected models should have checkmarks
    expect(screen.getByTestId('ai-model-check-llama3')).toBeInTheDocument()
    expect(screen.getByTestId('ai-model-check-nomic-embed-text')).toBeInTheDocument()

    // Non-selected model should not have checkmark
    expect(screen.queryByTestId('ai-model-check-mistral')).not.toBeInTheDocument()
  })

  it('model cards use ElevatedSurface wrapper with correct attributes', async () => {
    mockListAiModels.mockResolvedValueOnce({
      models: MOCK_MODELS_WITH_CATEGORIES,
    })

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1/chat/completions',
      },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)

    await waitFor(() => {
      expect(screen.getByTestId('ai-model-card-llama3')).toBeInTheDocument()
    })

    const card = screen.getByTestId('ai-model-card-llama3')
    expect(card.className).toContain('ui-elevated-surface')
    expect(card).toHaveAttribute('role', 'radio')
    expect(card).toHaveAttribute('tabindex', '0')
  })

  it('models without category default to chat', async () => {
    mockListAiModels.mockResolvedValueOnce({
      models: [
        { id: 'uncategorized', name: 'Uncategorized Model' },
        { id: 'embed', name: 'Embed Model', category: 'embedding' },
      ],
    })

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1/chat/completions',
      },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)

    await waitFor(() => {
      expect(screen.getByTestId('ai-chat-model-grid')).toBeInTheDocument()
    })

    const chatGrid = screen.getByTestId('ai-chat-model-grid')
    expect(chatGrid).toContainElement(screen.getByTestId('ai-model-card-uncategorized'))
  })

  it('shows error when no models are returned', async () => {
    mockListAiModels.mockResolvedValueOnce({ models: [] })

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1/chat/completions',
      },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)

    await waitFor(() => {
      expect(screen.getByTestId('ai-models-error')).toBeInTheDocument()
    })

    expect(screen.getByTestId('ai-models-error')).toHaveTextContent(
      'No models found at this endpoint.'
    )
  })

  it('selected chat card is highlighted with modelCardSelected class', async () => {
    mockListAiModels.mockResolvedValueOnce({
      models: MOCK_MODELS_WITH_CATEGORIES,
    })

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1/chat/completions',
        'ai.model': 'llama3',
      },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)

    await waitFor(() => {
      expect(screen.getByTestId('ai-model-card-llama3')).toBeInTheDocument()
    })

    const selectedCard = screen.getByTestId('ai-model-card-llama3')
    expect(selectedCard.className).toContain('modelCardSelected')

    const unselectedCard = screen.getByTestId('ai-model-card-mistral')
    expect(unselectedCard.className).not.toContain('modelCardSelected')
  })
})

// ---------------------------------------------------------------------------
// Force Reindex tests
// ---------------------------------------------------------------------------

describe('AiSettings - Force Reindex', () => {
  it('shows Force Reindex button when AI is enabled and endpoint is set', () => {
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
      },
      pendingChanges: {},
      isDirty: false,
    })
    render(<AiSettings />)
    expect(screen.getByTestId('ai-reindex-row')).toBeInTheDocument()
    expect(screen.getByTestId('ai-force-reindex-btn')).toBeInTheDocument()
  })

  it('does not show Force Reindex button when AI is disabled', () => {
    render(<AiSettings />) // ai.enabled defaults to 'false'
    expect(screen.queryByTestId('ai-force-reindex-btn')).not.toBeInTheDocument()
  })

  it('does not show Force Reindex button when endpoint is empty', () => {
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS, 'ai.enabled': 'true', 'ai.endpoint': '' },
      pendingChanges: {},
      isDirty: false,
    })
    render(<AiSettings />)
    expect(screen.queryByTestId('ai-force-reindex-btn')).not.toBeInTheDocument()
  })

  it('clicking Force Reindex button opens confirm dialog', async () => {
    const user = userEvent.setup()
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
      },
      pendingChanges: {},
      isDirty: false,
    })
    render(<AiSettings />)
    await user.click(screen.getByTestId('ai-force-reindex-btn'))
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
    expect(screen.getByText('Force Reindex Vector DB')).toBeInTheDocument()
  })

  it('cancelling the confirm dialog closes it without calling forceRebuild', async () => {
    const user = userEvent.setup()
    const mockForceRebuild = vi.fn().mockResolvedValue(undefined)
    ;(useSchemaIndexStore.getState as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      sessionToProfile: { 'session-1': 'profile-1' },
      forceRebuild: mockForceRebuild,
    })
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
      },
      pendingChanges: {},
      isDirty: false,
    })
    render(<AiSettings />)
    await user.click(screen.getByTestId('ai-force-reindex-btn'))
    await user.click(screen.getByTestId('confirm-cancel-button'))
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
    expect(mockForceRebuild).not.toHaveBeenCalled()
  })

  it('confirming reindex calls forceRebuild for each registered session', async () => {
    const user = userEvent.setup()
    const mockForceRebuild = vi.fn().mockResolvedValue(undefined)
    ;(useSchemaIndexStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
      sessionToProfile: { 'session-1': 'profile-1', 'session-2': 'profile-2' },
      forceRebuild: mockForceRebuild,
    })
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
      },
      pendingChanges: {},
      isDirty: false,
    })
    render(<AiSettings />)
    await user.click(screen.getByTestId('ai-force-reindex-btn'))
    await user.click(screen.getByTestId('confirm-confirm-button'))
    await waitFor(() => {
      expect(mockForceRebuild).toHaveBeenCalledWith('session-1')
      expect(mockForceRebuild).toHaveBeenCalledWith('session-2')
    })
  })

  it('confirm dialog closes after successful reindex', async () => {
    const user = userEvent.setup()
    const mockForceRebuild = vi.fn().mockResolvedValue(undefined)
    ;(useSchemaIndexStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
      sessionToProfile: { 'session-1': 'profile-1' },
      forceRebuild: mockForceRebuild,
    })
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
      },
      pendingChanges: {},
      isDirty: false,
    })
    render(<AiSettings />)
    await user.click(screen.getByTestId('ai-force-reindex-btn'))
    await user.click(screen.getByTestId('confirm-confirm-button'))
    await waitFor(() => {
      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
    })
  })

  it('calls forceRebuild with no sessions when sessionToProfile is empty', async () => {
    const user = userEvent.setup()
    const mockForceRebuild = vi.fn().mockResolvedValue(undefined)
    ;(useSchemaIndexStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
      sessionToProfile: {},
      forceRebuild: mockForceRebuild,
    })
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
      },
      pendingChanges: {},
      isDirty: false,
    })
    render(<AiSettings />)
    await user.click(screen.getByTestId('ai-force-reindex-btn'))
    await user.click(screen.getByTestId('confirm-confirm-button'))
    await waitFor(() => {
      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
    })
    expect(mockForceRebuild).not.toHaveBeenCalled()
  })
})
