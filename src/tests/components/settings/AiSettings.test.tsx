import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AiSettings } from '../../../components/settings/AiSettings'
import { useSettingsStore, SETTINGS_DEFAULTS } from '../../../stores/settings-store'
import { useSchemaIndexStore } from '../../../stores/schema-index-store'
import { ipc } from '../../ipc-mock'

const MOCK_MODELS_WITH_CATEGORIES = [
  { id: 'llama3', name: 'llama3:latest', category: 'chat' },
  { id: 'mistral', name: 'mistral:latest', category: 'chat' },
  { id: 'nomic-embed-text', name: 'nomic-embed-text', category: 'embedding' },
]

// AiSettings embeds AiMemoriesSettings, which loads memories asynchronously on
// mount. Wait for that load to settle so its state updates are flushed inside
// act(...) and don't leak warnings into unrelated assertions.
async function renderAiSettings() {
  const result = render(<AiSettings />)
  await screen.findByTestId('ai-memories-settings')
  return result
}

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  useSettingsStore.setState({
    settings: { ...SETTINGS_DEFAULTS },
    pendingChanges: {},
    isDirty: false,
    isLoading: false,
    activeSection: 'ai',
  })

  useSchemaIndexStore.setState({
    connections: {},
    sessionToProfile: {},
    forceRebuild: vi.fn().mockResolvedValue(undefined),
  })

  // Default: empty models list
  ipc.override('list_ai_models', () => ({ models: [] }))
})

afterEach(() => {
  consoleSpy?.mockRestore()
})

describe('AiSettings', () => {
  it('renders the AI settings section with all fields', async () => {
    await renderAiSettings()
    expect(screen.getByTestId('settings-ai')).toBeInTheDocument()
    expect(screen.getByTestId('settings-ai-enabled')).toBeInTheDocument()
    expect(screen.getByTestId('settings-ai-endpoint')).toBeInTheDocument()
    expect(screen.getByTestId('settings-ai-temperature')).toBeInTheDocument()
    expect(screen.getByTestId('settings-ai-max-tokens')).toBeInTheDocument()
  })

  it('does NOT render a free-text model name input', async () => {
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS, 'ai.enabled': 'true' },
      pendingChanges: {},
      isDirty: false,
    })

    await renderAiSettings()
    expect(screen.queryByTestId('settings-ai-model')).not.toBeInTheDocument()
    expect(screen.queryByText('Model name')).not.toBeInTheDocument()
  })

  it('shows the enable toggle with correct default (off)', async () => {
    await renderAiSettings()
    const toggle = screen.getByTestId('settings-ai-enabled')
    const checkbox = toggle.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(checkbox).not.toBeNull()
    expect(checkbox.checked).toBe(false)
  })

  it('disables connection and generation fields when AI is disabled', async () => {
    await renderAiSettings()
    const endpointInput = screen.getByTestId('settings-ai-endpoint') as HTMLInputElement
    const tempInput = screen.getByTestId('settings-ai-temperature') as HTMLInputElement
    const maxTokensInput = screen.getByTestId('settings-ai-max-tokens') as HTMLInputElement

    expect(endpointInput).toBeDisabled()
    expect(tempInput).toBeDisabled()
    expect(maxTokensInput).toBeDisabled()
  })

  it('enables connection and generation fields when AI is enabled', async () => {
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS, 'ai.enabled': 'true' },
      pendingChanges: {},
      isDirty: false,
    })

    await renderAiSettings()

    const endpointInput = screen.getByTestId('settings-ai-endpoint') as HTMLInputElement
    const tempInput = screen.getByTestId('settings-ai-temperature') as HTMLInputElement
    const maxTokensInput = screen.getByTestId('settings-ai-max-tokens') as HTMLInputElement

    expect(endpointInput).not.toBeDisabled()
    expect(tempInput).not.toBeDisabled()
    expect(maxTokensInput).not.toBeDisabled()
  })

  it('toggling AI on enables the other fields', async () => {
    const user = userEvent.setup()
    await renderAiSettings()

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

    await renderAiSettings()
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

    await renderAiSettings()

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

    await renderAiSettings()

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

    await renderAiSettings()

    const maxTokensInput = screen.getByTestId('settings-ai-max-tokens') as HTMLInputElement
    await user.clear(maxTokensInput)
    await user.type(maxTokensInput, '4096')

    expect(useSettingsStore.getState().pendingChanges['ai.maxTokens']).toBe('4096')
  })

  it('displays default values correctly', async () => {
    await renderAiSettings()

    const tempInput = screen.getByTestId('settings-ai-temperature') as HTMLInputElement
    const maxTokensInput = screen.getByTestId('settings-ai-max-tokens') as HTMLInputElement

    expect(tempInput.value).toBe('0.3')
    expect(maxTokensInput.value).toBe('32000')
  })

  it('reset section restores AI defaults', async () => {
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
    expect(state.pendingChanges['ai.maxTokens']).toBe('32000')
    expect(state.isDirty).toBe(true)
  })

  it('renders section headings', async () => {
    await renderAiSettings()
    expect(screen.getByText('Enable AI')).toBeInTheDocument()
    expect(
      within(screen.getByTestId('settings-section-connection')).getByText('Connection')
    ).toBeInTheDocument()
    expect(screen.getByText('Generation')).toBeInTheDocument()
  })

  it('shows correct label text for fields', async () => {
    await renderAiSettings()
    expect(screen.getByText('Enable AI assistant')).toBeInTheDocument()
    expect(screen.getByText('Chat Base URL')).toBeInTheDocument()
    expect(screen.getByText('Embedding Base URL (optional)')).toBeInTheDocument()
    expect(screen.getByText('Temperature')).toBeInTheDocument()
    expect(screen.getByText('Max tokens')).toBeInTheDocument()
  })

  it('renders the reasoning toggle checked by default', async () => {
    await renderAiSettings()
    const toggle = screen.getByTestId('settings-ai-enable-reasoning')
    expect(toggle).toBeInTheDocument()
    const checkbox = toggle.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(checkbox).not.toBeNull()
    expect(checkbox.checked).toBe(true)
  })

  it('renders prefer responses api toggle unchecked by default', async () => {
    await renderAiSettings()
    const toggle = screen.getByTestId('settings-ai-prefer-responses-api')
    expect(toggle).toBeInTheDocument()
    const checkbox = toggle.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(checkbox).not.toBeNull()
    expect(checkbox.checked).toBe(false)
  })

  it('toggling reasoning off calls setPendingChange with false', async () => {
    const user = userEvent.setup()
    // Enable AI first so the reasoning toggle is not disabled
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, 'ai.enabled': 'true' },
    })
    await renderAiSettings()
    const toggle = screen.getByTestId('settings-ai-enable-reasoning')
    const checkbox = toggle.querySelector('input[type="checkbox"]') as HTMLInputElement
    await user.click(checkbox)
    expect(useSettingsStore.getState().pendingChanges['ai.enableReasoning']).toBe('false')
  })

  it('toggling prefer responses api on calls setPendingChange with true', async () => {
    const user = userEvent.setup()
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, 'ai.enabled': 'true' },
    })
    await renderAiSettings()
    const toggle = screen.getByTestId('settings-ai-prefer-responses-api')
    const checkbox = toggle.querySelector('input[type="checkbox"]') as HTMLInputElement
    await user.click(checkbox)
    expect(useSettingsStore.getState().pendingChanges['ai.preferResponsesApi']).toBe('true')
  })

  it('applies disabled visual class when AI is off', async () => {
    await renderAiSettings()
    const aiContainer = screen.getByTestId('settings-ai')
    const disabledWrapper = aiContainer.children[1] as HTMLElement
    expect(disabledWrapper.className).toContain('disabledGroup')
  })

  it('removes disabled visual class when AI is on', async () => {
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS, 'ai.enabled': 'true' },
      pendingChanges: {},
      isDirty: false,
    })

    await renderAiSettings()
    const aiContainer = screen.getByTestId('settings-ai')
    const wrapper = aiContainer.children[1] as HTMLElement
    expect(wrapper.className).not.toContain('disabledGroup')
  })

  it('shows pending values over saved values', async () => {
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS, 'ai.enabled': 'true', 'ai.endpoint': 'https://saved.com' },
      pendingChanges: { 'ai.endpoint': 'https://pending.com' },
      isDirty: true,
    })

    await renderAiSettings()
    const endpointInput = screen.getByTestId('settings-ai-endpoint') as HTMLInputElement
    expect(endpointInput.value).toBe('https://pending.com')
  })

  it('shows helper text when AI is enabled and endpoint is set', async () => {
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
      },
      pendingChanges: {},
      isDirty: false,
    })

    await renderAiSettings()
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
  it('does not show model list section when AI is disabled', async () => {
    await renderAiSettings()
    expect(screen.queryByTestId('ai-model-list-section')).not.toBeInTheDocument()
  })

  it('does not show model list section when endpoint is empty', async () => {
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS, 'ai.enabled': 'true', 'ai.endpoint': '' },
      pendingChanges: {},
      isDirty: false,
    })

    await renderAiSettings()
    expect(screen.queryByTestId('ai-model-list-section')).not.toBeInTheDocument()
  })

  it('shows model list section when AI is enabled and endpoint has value', async () => {
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
      },
      pendingChanges: {},
      isDirty: false,
    })

    await renderAiSettings()
    expect(screen.getByTestId('ai-model-list-section')).toBeInTheDocument()
  })

  it('auto-fetches models when AI is enabled and endpoint is set', async () => {
    ipc.override('list_ai_models', () => ({ models: MOCK_MODELS_WITH_CATEGORIES }))

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
      },
      pendingChanges: {},
      isDirty: false,
    })

    await renderAiSettings()
    expect(ipc.calls('list_ai_models')).toHaveLength(1)
  })

  it('shows loading state automatically during model fetch', async () => {
    ipc.override('list_ai_models', () => new Promise(() => {}))

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
      },
      pendingChanges: {},
      isDirty: false,
    })

    await renderAiSettings()
    expect(screen.getByTestId('ai-models-loading')).toBeInTheDocument()
  })

  it('auto-shows model categories after fetching', async () => {
    ipc.override('list_ai_models', () => ({ models: MOCK_MODELS_WITH_CATEGORIES }))

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
      },
      pendingChanges: {},
      isDirty: false,
    })

    await renderAiSettings()

    await waitFor(() => {
      expect(screen.getByTestId('ai-model-categories')).toBeInTheDocument()
    })
  })

  it('auto-shows error when listAiModels returns an error', async () => {
    // listAiModels catches IPC errors and returns { models: [], error: errorMsg }
    // so we throw from the IPC handler to trigger the error path
    ipc.override('list_ai_models', async () => {
      throw new Error('Connection refused')
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

    await renderAiSettings()

    await waitFor(() => {
      expect(screen.getByTestId('ai-models-error')).toBeInTheDocument()
    })

    expect(screen.getByTestId('ai-models-error')).toHaveTextContent('Connection refused')
  })

  it('does not auto-fetch when AI is disabled', async () => {
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'false',
        'ai.endpoint': 'http://localhost:11434/v1',
      },
      pendingChanges: {},
      isDirty: false,
    })

    await renderAiSettings()
    expect(ipc.calls('list_ai_models')).toHaveLength(0)
  })

  it('does not auto-fetch when endpoint is empty', async () => {
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': '',
      },
      pendingChanges: {},
      isDirty: false,
    })

    await renderAiSettings()
    expect(ipc.calls('list_ai_models')).toHaveLength(0)
  })

  it('re-fetches models when endpoint changes', async () => {
    ipc.override('list_ai_models', () => ({ models: MOCK_MODELS_WITH_CATEGORIES }))

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
      },
      pendingChanges: {},
      isDirty: false,
    })

    await renderAiSettings()

    await waitFor(() => {
      expect(ipc.calls('list_ai_models')).toHaveLength(1)
    })

    // Change endpoint via store
    act(() => {
      useSettingsStore.setState({
        settings: {
          ...SETTINGS_DEFAULTS,
          'ai.enabled': 'true',
          'ai.endpoint': 'http://localhost:9999/v1',
        },
        pendingChanges: {},
        isDirty: false,
      })
    })

    await waitFor(() => {
      expect(ipc.calls('list_ai_models')).toHaveLength(2)
    })
  })

  it('renders two category sections after fetching models', async () => {
    ipc.override('list_ai_models', () => ({ models: MOCK_MODELS_WITH_CATEGORIES }))

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
      },
      pendingChanges: {},
      isDirty: false,
    })

    await renderAiSettings()

    await waitFor(() => {
      expect(screen.getByTestId('ai-model-categories')).toBeInTheDocument()
    })

    expect(screen.getByTestId('ai-category-chat')).toBeInTheDocument()
    expect(screen.getByTestId('ai-category-embedding')).toBeInTheDocument()
  })

  it('renders chat models in the Chat section', async () => {
    ipc.override('list_ai_models', () => ({ models: MOCK_MODELS_WITH_CATEGORIES }))

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
      },
      pendingChanges: {},
      isDirty: false,
    })

    await renderAiSettings()

    await waitFor(() => {
      expect(screen.getByTestId('ai-chat-model-grid')).toBeInTheDocument()
    })

    const chatGrid = screen.getByTestId('ai-chat-model-grid')
    expect(chatGrid).toContainElement(screen.getByTestId('ai-model-card-llama3'))
    expect(chatGrid).toContainElement(screen.getByTestId('ai-model-card-mistral'))
  })

  it('renders embedding models in the Embedding section', async () => {
    ipc.override('list_ai_models', () => ({ models: MOCK_MODELS_WITH_CATEGORIES }))

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
      },
      pendingChanges: {},
      isDirty: false,
    })

    await renderAiSettings()

    await waitFor(() => {
      expect(screen.getByTestId('ai-embedding-model-grid')).toBeInTheDocument()
    })

    const embeddingGrid = screen.getByTestId('ai-embedding-model-grid')
    expect(embeddingGrid).toContainElement(screen.getByTestId('ai-model-card-nomic-embed-text'))
  })

  it('clicking a chat model card updates ai.model setting', async () => {
    const user = userEvent.setup()
    ipc.override('list_ai_models', () => ({ models: MOCK_MODELS_WITH_CATEGORIES }))

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
      },
      pendingChanges: {},
      isDirty: false,
    })

    await renderAiSettings()

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
    ipc.override('list_ai_models', () => ({ models: MOCK_MODELS_WITH_CATEGORIES }))

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
      },
      pendingChanges: {},
      isDirty: false,
    })

    await renderAiSettings()

    await waitFor(() => {
      expect(screen.getByTestId('ai-model-card-nomic-embed-text')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('ai-model-card-nomic-embed-text'))

    expect(useSettingsStore.getState().pendingChanges['ai.embeddingModel']).toBe('nomic-embed-text')
    // Should not affect model
    expect(useSettingsStore.getState().pendingChanges['ai.model']).toBeUndefined()
  })

  it('shows empty state when no embedding models found', async () => {
    ipc.override('list_ai_models', () => ({
      models: [
        { id: 'llama3', name: 'llama3:latest', category: 'chat' },
        { id: 'mistral', name: 'mistral:latest', category: 'chat' },
      ],
    }))

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
      },
      pendingChanges: {},
      isDirty: false,
    })

    await renderAiSettings()

    await waitFor(() => {
      expect(screen.getByTestId('ai-model-categories')).toBeInTheDocument()
    })

    expect(screen.getByTestId('ai-embedding-empty-state')).toBeInTheDocument()
    expect(screen.getByTestId('ai-embedding-empty-state')).toHaveTextContent(
      'No embedding models found'
    )
  })

  it('shows empty state when no chat models found', async () => {
    ipc.override('list_ai_models', () => ({
      models: [{ id: 'nomic-embed-text', name: 'nomic-embed-text', category: 'embedding' }],
    }))

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
      },
      pendingChanges: {},
      isDirty: false,
    })

    await renderAiSettings()

    await waitFor(() => {
      expect(screen.getByTestId('ai-model-categories')).toBeInTheDocument()
    })

    expect(screen.getByTestId('ai-chat-empty-state')).toBeInTheDocument()
    expect(screen.getByTestId('ai-chat-empty-state')).toHaveTextContent('No chat models found')
  })

  it('category headers show correct count in badge', async () => {
    ipc.override('list_ai_models', () => ({ models: MOCK_MODELS_WITH_CATEGORIES }))

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
      },
      pendingChanges: {},
      isDirty: false,
    })

    await renderAiSettings()

    await waitFor(() => {
      expect(screen.getByTestId('ai-category-chat-count')).toBeInTheDocument()
    })

    expect(screen.getByTestId('ai-category-chat-count')).toHaveTextContent('2')
    expect(screen.getByTestId('ai-category-embedding-count')).toHaveTextContent('1')
  })

  it('category headers show correct labels', async () => {
    ipc.override('list_ai_models', () => ({ models: MOCK_MODELS_WITH_CATEGORIES }))

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
      },
      pendingChanges: {},
      isDirty: false,
    })

    await renderAiSettings()

    await waitFor(() => {
      expect(screen.getByTestId('ai-category-chat-label')).toBeInTheDocument()
    })

    expect(screen.getByTestId('ai-category-chat-label')).toHaveTextContent('Chat Models')
    expect(screen.getByTestId('ai-category-embedding-label')).toHaveTextContent('Embedding Models')
  })

  it('ARIA: category sections have role="radiogroup" with aria-labelledby', async () => {
    ipc.override('list_ai_models', () => ({ models: MOCK_MODELS_WITH_CATEGORIES }))

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
      },
      pendingChanges: {},
      isDirty: false,
    })

    await renderAiSettings()

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
    ipc.override('list_ai_models', () => ({ models: MOCK_MODELS_WITH_CATEGORIES }))

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
    })

    await renderAiSettings()

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
    ipc.override('list_ai_models', () => ({ models: MOCK_MODELS_WITH_CATEGORIES }))

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
    })

    await renderAiSettings()

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
    ipc.override('list_ai_models', () => ({ models: MOCK_MODELS_WITH_CATEGORIES }))

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
      },
      pendingChanges: {},
      isDirty: false,
    })

    await renderAiSettings()

    await waitFor(() => {
      expect(screen.getByTestId('ai-model-card-llama3')).toBeInTheDocument()
    })

    const card = screen.getByTestId('ai-model-card-llama3')
    expect(card.className).toContain('ui-elevated-surface')
    expect(card).toHaveAttribute('role', 'radio')
    expect(card).toHaveAttribute('tabindex', '0')
  })

  it('models without category default to chat', async () => {
    ipc.override('list_ai_models', () => ({
      models: [
        { id: 'uncategorized', name: 'Uncategorized Model' },
        { id: 'embed', name: 'Embed Model', category: 'embedding' },
      ],
    }))

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
      },
      pendingChanges: {},
      isDirty: false,
    })

    await renderAiSettings()

    await waitFor(() => {
      expect(screen.getByTestId('ai-chat-model-grid')).toBeInTheDocument()
    })

    const chatGrid = screen.getByTestId('ai-chat-model-grid')
    expect(chatGrid).toContainElement(screen.getByTestId('ai-model-card-uncategorized'))
  })

  it('shows error when no models are returned', async () => {
    ipc.override('list_ai_models', () => ({ models: [] }))

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
      },
      pendingChanges: {},
      isDirty: false,
    })

    await renderAiSettings()

    await waitFor(() => {
      expect(screen.getByTestId('ai-models-error')).toBeInTheDocument()
    })

    expect(screen.getByTestId('ai-models-error')).toHaveTextContent(
      'No models found at this endpoint.'
    )
  })

  it('selected chat card is highlighted with modelCardSelected class', async () => {
    ipc.override('list_ai_models', () => ({ models: MOCK_MODELS_WITH_CATEGORIES }))

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
        'ai.model': 'llama3',
      },
      pendingChanges: {},
      isDirty: false,
    })

    await renderAiSettings()

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
  it('shows Force Reindex button when AI is enabled and endpoint is set', async () => {
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
      },
      pendingChanges: {},
      isDirty: false,
    })
    await renderAiSettings()
    expect(screen.getByTestId('ai-reindex-row')).toBeInTheDocument()
    expect(screen.getByTestId('ai-force-reindex-btn')).toBeInTheDocument()
  })

  it('does not show Force Reindex button when AI is disabled', async () => {
    await renderAiSettings() // ai.enabled defaults to 'false'
    expect(screen.queryByTestId('ai-force-reindex-btn')).not.toBeInTheDocument()
  })

  it('does not show Force Reindex button when endpoint is empty', async () => {
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS, 'ai.enabled': 'true', 'ai.endpoint': '' },
      pendingChanges: {},
      isDirty: false,
    })
    await renderAiSettings()
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
    await renderAiSettings()
    await user.click(screen.getByTestId('ai-force-reindex-btn'))
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
    expect(screen.getByText('Force Reindex Vector DB')).toBeInTheDocument()
  })

  it('cancelling the confirm dialog closes it without calling forceRebuild', async () => {
    const user = userEvent.setup()
    const mockForceRebuild = vi.fn().mockResolvedValue(undefined)
    useSchemaIndexStore.setState({
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
    await renderAiSettings()
    await user.click(screen.getByTestId('ai-force-reindex-btn'))
    await user.click(screen.getByTestId('confirm-cancel-button'))
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
    expect(mockForceRebuild).not.toHaveBeenCalled()
  })

  it('confirming reindex calls forceRebuild for each registered session', async () => {
    const user = userEvent.setup()
    const mockForceRebuild = vi.fn().mockResolvedValue(undefined)
    useSchemaIndexStore.setState({
      sessionToProfile: {
        'session-1': 'profile-1',
        'session-2': 'profile-2',
      },
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
    await renderAiSettings()
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
    useSchemaIndexStore.setState({
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
    await renderAiSettings()
    await user.click(screen.getByTestId('ai-force-reindex-btn'))
    await user.click(screen.getByTestId('confirm-confirm-button'))
    await waitFor(() => {
      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
    })
  })

  it('calls forceRebuild with no sessions when sessionToProfile is empty', async () => {
    const user = userEvent.setup()
    const mockForceRebuild = vi.fn().mockResolvedValue(undefined)
    useSchemaIndexStore.setState({
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
    await renderAiSettings()
    await user.click(screen.getByTestId('ai-force-reindex-btn'))
    await user.click(screen.getByTestId('confirm-confirm-button'))
    await waitFor(() => {
      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
    })
    expect(mockForceRebuild).not.toHaveBeenCalled()
  })

  it('disables the Force Reindex button when any connection is building', async () => {
    useSchemaIndexStore.setState({
      connections: {
        'session-1': {
          status: 'building',
          phase: 'embedding',
          tablesDone: 3,
          tablesTotal: 25,
          lastBuildTimestamp: 0,
        },
      },
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
    await renderAiSettings()
    const btn = screen.getByTestId('ai-force-reindex-btn')
    expect(btn).toBeDisabled()
    expect(btn).toHaveTextContent('Reindexing...')
  })

  it('shows inline reindex status with embedding phase progress', async () => {
    useSchemaIndexStore.setState({
      connections: {
        'session-1': {
          status: 'building',
          phase: 'embedding',
          tablesDone: 7,
          tablesTotal: 20,
          lastBuildTimestamp: 0,
        },
      },
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
    await renderAiSettings()
    const status = screen.getByTestId('ai-reindex-status')
    expect(status).toHaveTextContent('Indexing 7/20 tables (1 connection)...')
  })

  it('shows inline reindex status with loading_schema phase', async () => {
    useSchemaIndexStore.setState({
      connections: {
        'session-1': {
          status: 'building',
          phase: 'loading_schema',
          tablesDone: 5,
          tablesTotal: 0,
          lastBuildTimestamp: 0,
        },
        'session-2': {
          status: 'building',
          phase: 'loading_schema',
          tablesDone: 5,
          tablesTotal: 0,
          lastBuildTimestamp: 0,
        },
      },
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
    await renderAiSettings()
    expect(screen.getByTestId('ai-reindex-status')).toHaveTextContent(
      'Reading schema (5 tables, 2 connections)...'
    )
  })

  it('shows inline reindex status with finalizing phase', async () => {
    useSchemaIndexStore.setState({
      connections: {
        'session-1': {
          status: 'building',
          phase: 'finalizing',
          tablesDone: 20,
          tablesTotal: 20,
          lastBuildTimestamp: 0,
        },
      },
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
    await renderAiSettings()
    expect(screen.getByTestId('ai-reindex-status')).toHaveTextContent(
      'Finalizing 20/20 steps (1 connection)...'
    )
  })

  it('does not show inline reindex status when no builds are active', async () => {
    useSchemaIndexStore.setState({
      connections: {
        'session-1': {
          status: 'ready',
          phase: null,
          tablesDone: 10,
          tablesTotal: 10,
          lastBuildTimestamp: 0,
        },
      },
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
    await renderAiSettings()
    expect(screen.queryByTestId('ai-reindex-status')).not.toBeInTheDocument()
    expect(screen.getByTestId('ai-force-reindex-btn')).not.toBeDisabled()
  })
})

// ---------------------------------------------------------------------------
// Embedding Base URL field + independent embedding-model fetch
// ---------------------------------------------------------------------------

const CHAT_URL = 'http://localhost:11434/v1'
const EMBED_URL = 'http://embeddings.local:8080/v1'

const CHAT_FETCH_MODELS = [
  { id: 'llama3', name: 'llama3:latest', category: 'chat' },
  { id: 'nomic-embed-text', name: 'nomic-embed-text', category: 'embedding' },
]

const EMBED_FETCH_MODELS = [
  { id: 'bge-large-en', name: 'bge-large-en', category: 'embedding' },
  { id: 'uncategorised-embed', name: 'Uncategorised Embed' },
]

describe('AiSettings - Embedding Base URL', () => {
  it('renders both URL fields with correct labels', async () => {
    await renderAiSettings()
    expect(screen.getByTestId('settings-ai-endpoint')).toBeInTheDocument()
    expect(screen.getByTestId('settings-ai-embedding-endpoint')).toBeInTheDocument()
    expect(screen.getByText('Chat Base URL')).toBeInTheDocument()
    expect(screen.getByText('Embedding Base URL (optional)')).toBeInTheDocument()
  })

  it('shows persistent fallback helper text under the embedding field', async () => {
    await renderAiSettings()
    expect(screen.getByTestId('ai-embedding-helper-text')).toHaveTextContent(
      'When blank, the chat URL is used for embeddings.'
    )
  })

  it('disables the embedding field when AI is off and enables it when on', async () => {
    const { rerender } = await renderAiSettings()
    expect(screen.getByTestId('settings-ai-embedding-endpoint')).toBeDisabled()

    act(() => {
      useSettingsStore.setState({
        settings: { ...SETTINGS_DEFAULTS, 'ai.enabled': 'true' },
        pendingChanges: {},
        isDirty: false,
      })
    })
    rerender(<AiSettings />)
    expect(screen.getByTestId('settings-ai-embedding-endpoint')).not.toBeDisabled()
  })

  it('mirrors the typed chat URL as the embedding placeholder', async () => {
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS, 'ai.enabled': 'true', 'ai.endpoint': CHAT_URL },
      pendingChanges: {},
      isDirty: false,
    })
    await renderAiSettings()
    const embedInput = screen.getByTestId('settings-ai-embedding-endpoint') as HTMLInputElement
    expect(embedInput).toHaveAttribute('placeholder', CHAT_URL)
  })

  it('falls back to the default example placeholder when the chat URL is empty', async () => {
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS, 'ai.enabled': 'true', 'ai.endpoint': '' },
      pendingChanges: {},
      isDirty: false,
    })
    await renderAiSettings()
    const embedInput = screen.getByTestId('settings-ai-embedding-endpoint') as HTMLInputElement
    expect(embedInput).toHaveAttribute('placeholder', 'http://localhost:11434/v1')
  })

  it('editing the embedding field calls setPendingChange for ai.embeddingEndpoint', async () => {
    const user = userEvent.setup()
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS, 'ai.enabled': 'true' },
      pendingChanges: {},
      isDirty: false,
    })
    await renderAiSettings()
    const embedInput = screen.getByTestId('settings-ai-embedding-endpoint') as HTMLInputElement
    await user.clear(embedInput)
    await user.type(embedInput, EMBED_URL)
    expect(useSettingsStore.getState().pendingChanges['ai.embeddingEndpoint']).toBe(EMBED_URL)
  })

  it('renders the model picker for an embedding-only configuration (chat URL blank)', async () => {
    ipc.override('list_ai_models', () => ({ models: EMBED_FETCH_MODELS }))
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': '',
        'ai.embeddingEndpoint': EMBED_URL,
      },
      pendingChanges: {},
      isDirty: false,
    })
    await renderAiSettings()
    expect(screen.getByTestId('ai-model-list-section')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('ai-model-categories')).toBeInTheDocument()
    })
    // Chat grid shows its empty state since the chat URL is blank.
    expect(screen.getByTestId('ai-chat-empty-state')).toBeInTheDocument()
  })

  it('populates the embedding grid from the embedding fetch (incl. uncategorised models)', async () => {
    ipc.override('list_ai_models', (args) => {
      const endpoint = (args as { endpoint?: string }).endpoint
      if (endpoint === EMBED_URL) return { models: EMBED_FETCH_MODELS }
      return { models: CHAT_FETCH_MODELS }
    })
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': CHAT_URL,
        'ai.embeddingEndpoint': EMBED_URL,
      },
      pendingChanges: {},
      isDirty: false,
    })
    await renderAiSettings()

    await waitFor(() => {
      expect(screen.getByTestId('ai-embedding-model-grid')).toBeInTheDocument()
    })
    const embeddingGrid = screen.getByTestId('ai-embedding-model-grid')
    expect(embeddingGrid).toContainElement(screen.getByTestId('ai-model-card-bge-large-en'))
    // Uncategorised model from the embedding endpoint is included.
    expect(embeddingGrid).toContainElement(screen.getByTestId('ai-model-card-uncategorised-embed'))
    // The chat-fetch embedding model (nomic) must NOT appear when an embedding URL is set.
    expect(screen.queryByTestId('ai-model-card-nomic-embed-text')).not.toBeInTheDocument()
  })

  it('shows an independent loading state for the embedding fetch only', async () => {
    ipc.override('list_ai_models', (args) => {
      const endpoint = (args as { endpoint?: string }).endpoint
      if (endpoint === EMBED_URL) return new Promise(() => {})
      return { models: CHAT_FETCH_MODELS }
    })
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': CHAT_URL,
        'ai.embeddingEndpoint': EMBED_URL,
      },
      pendingChanges: {},
      isDirty: false,
    })
    await renderAiSettings()
    expect(screen.getByTestId('ai-embedding-models-loading')).toBeInTheDocument()
    // The embedding loading state lives inside the dedicated embedding region.
    expect(screen.getByTestId('ai-embedding-models-region')).toContainElement(
      screen.getByTestId('ai-embedding-models-loading')
    )
  })

  it('scopes an embedding fetch error to the embedding region, not the chat grid', async () => {
    ipc.override('list_ai_models', (args) => {
      const endpoint = (args as { endpoint?: string }).endpoint
      if (endpoint === EMBED_URL) throw new Error('Embedding endpoint unreachable')
      return { models: CHAT_FETCH_MODELS }
    })
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': CHAT_URL,
        'ai.embeddingEndpoint': EMBED_URL,
      },
      pendingChanges: {},
      isDirty: false,
    })
    await renderAiSettings()

    await waitFor(() => {
      expect(screen.getByTestId('ai-embedding-models-error')).toBeInTheDocument()
    })
    expect(screen.getByTestId('ai-embedding-models-error')).toHaveTextContent(
      'Embedding endpoint unreachable'
    )
    // Chat grid is unaffected.
    expect(screen.queryByTestId('ai-models-error')).not.toBeInTheDocument()
    expect(screen.getByTestId('ai-chat-model-grid')).toBeInTheDocument()
  })

  it('reverts to chat-fetch embedding models instantly when the embedding URL is cleared', async () => {
    ipc.override('list_ai_models', (args) => {
      const endpoint = (args as { endpoint?: string }).endpoint
      if (endpoint === EMBED_URL) return { models: EMBED_FETCH_MODELS }
      return { models: CHAT_FETCH_MODELS }
    })
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': CHAT_URL,
        'ai.embeddingEndpoint': EMBED_URL,
      },
      pendingChanges: {},
      isDirty: false,
    })
    await renderAiSettings()

    await waitFor(() => {
      expect(screen.getByTestId('ai-model-card-bge-large-en')).toBeInTheDocument()
    })

    const callsAfterSet = ipc.calls('list_ai_models').length

    // Clear the embedding URL.
    act(() => {
      useSettingsStore.setState({
        settings: {
          ...SETTINGS_DEFAULTS,
          'ai.enabled': 'true',
          'ai.endpoint': CHAT_URL,
          'ai.embeddingEndpoint': '',
        },
        pendingChanges: {},
        isDirty: false,
      })
    })

    // Embedding grid reverts to the chat-fetch embedding model with no new fetch.
    await waitFor(() => {
      expect(screen.getByTestId('ai-model-card-nomic-embed-text')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('ai-model-card-bge-large-en')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-embedding-models-loading')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-embedding-models-error')).not.toBeInTheDocument()
    // No additional fetch triggered by clearing the URL.
    expect(ipc.calls('list_ai_models').length).toBe(callsAfterSet)
  })

  it('does not fetch embedding models when the embedding URL is blank', async () => {
    ipc.override('list_ai_models', () => ({ models: CHAT_FETCH_MODELS }))
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': CHAT_URL,
        'ai.embeddingEndpoint': '',
      },
      pendingChanges: {},
      isDirty: false,
    })
    await renderAiSettings()
    // Only the chat fetch ran.
    expect(ipc.calls('list_ai_models')).toHaveLength(1)
  })

  describe('Memory subsection (default /remember scope)', () => {
    it('renders the Memory section with the default-scope dropdown', async () => {
      await renderAiSettings()
      expect(screen.getByTestId('settings-section-memory')).toBeInTheDocument()
      expect(screen.getByTestId('settings-ai-remember-scope')).toBeInTheDocument()
    })

    it('defaults the dropdown to the Connection scope', async () => {
      await renderAiSettings()
      const trigger = screen.getByTestId('settings-ai-remember-scope')
      expect(trigger).toHaveTextContent('Connection')
    })

    it('changing the dropdown sets the ai.rememberScope pending value', async () => {
      const user = userEvent.setup()
      useSettingsStore.setState({
        settings: { ...SETTINGS_DEFAULTS, 'ai.enabled': 'true' },
        pendingChanges: {},
        isDirty: false,
      })

      await renderAiSettings()
      await user.click(screen.getByTestId('settings-ai-remember-scope'))
      await user.click(screen.getByTestId('settings-ai-remember-scope-option-global'))

      await waitFor(() => {
        expect(useSettingsStore.getState().pendingChanges['ai.rememberScope']).toBe('global')
      })
    })

    it('reflects the saved scope value as "Always ask"', async () => {
      useSettingsStore.setState({
        settings: { ...SETTINGS_DEFAULTS, 'ai.rememberScope': 'ask' },
        pendingChanges: {},
        isDirty: false,
      })
      await renderAiSettings()
      expect(screen.getByTestId('settings-ai-remember-scope')).toHaveTextContent('Always ask')
    })
  })
})
