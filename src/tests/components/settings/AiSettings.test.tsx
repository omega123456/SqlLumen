import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import { AiSettings } from '../../../components/settings/AiSettings'
import { useSettingsStore, SETTINGS_DEFAULTS } from '../../../stores/settings-store'

// Mock the ai-commands module for listAiModels
const mockListAiModels = vi.fn()
vi.mock('../../../lib/ai-commands', () => ({
  listAiModels: (...args: unknown[]) => mockListAiModels(...args),
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

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  mockListAiModels.mockReset()
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
    expect(screen.getByTestId('settings-ai-model')).toBeInTheDocument()
    expect(screen.getByTestId('settings-ai-temperature')).toBeInTheDocument()
    expect(screen.getByTestId('settings-ai-max-tokens')).toBeInTheDocument()
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
    const modelInput = screen.getByTestId('settings-ai-model') as HTMLInputElement
    const tempInput = screen.getByTestId('settings-ai-temperature') as HTMLInputElement
    const maxTokensInput = screen.getByTestId('settings-ai-max-tokens') as HTMLInputElement

    expect(endpointInput).toBeDisabled()
    expect(modelInput).toBeDisabled()
    expect(tempInput).toBeDisabled()
    expect(maxTokensInput).toBeDisabled()
  })

  it('enables connection and generation fields when AI is enabled', async () => {
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS, 'ai.enabled': 'true' },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)

    const endpointInput = screen.getByTestId('settings-ai-endpoint') as HTMLInputElement
    const modelInput = screen.getByTestId('settings-ai-model') as HTMLInputElement
    const tempInput = screen.getByTestId('settings-ai-temperature') as HTMLInputElement
    const maxTokensInput = screen.getByTestId('settings-ai-max-tokens') as HTMLInputElement

    expect(endpointInput).not.toBeDisabled()
    expect(modelInput).not.toBeDisabled()
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
    expect(screen.getByTestId('settings-ai-model')).not.toBeDisabled()
    expect(screen.getByTestId('settings-ai-temperature')).not.toBeDisabled()
    expect(screen.getByTestId('settings-ai-max-tokens')).not.toBeDisabled()

    // Store should reflect the change
    expect(useSettingsStore.getState().pendingChanges['ai.enabled']).toBe('true')
  })

  it('toggling AI off disables the other fields', async () => {
    const user = userEvent.setup()
    // Start with AI enabled
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS, 'ai.enabled': 'true' },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)

    // Initially enabled
    expect(screen.getByTestId('settings-ai-endpoint')).not.toBeDisabled()

    // Toggle off
    const toggle = screen.getByTestId('settings-ai-enabled')
    const checkbox = toggle.querySelector('input[type="checkbox"]') as HTMLInputElement
    await user.click(checkbox)

    // Now disabled
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

  it('sets pending change when model is modified', async () => {
    const user = userEvent.setup()
    useSettingsStore.setState({
      settings: { ...SETTINGS_DEFAULTS, 'ai.enabled': 'true' },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)

    const modelInput = screen.getByTestId('settings-ai-model') as HTMLInputElement
    await user.clear(modelInput)
    await user.type(modelInput, 'gpt-4o')

    expect(useSettingsStore.getState().pendingChanges['ai.model']).toBe('gpt-4o')
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
    // Modify some AI settings
    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'https://custom.api.com',
        'ai.model': 'custom-model',
        'ai.temperature': '1.0',
        'ai.maxTokens': '8192',
      },
      pendingChanges: {},
      isDirty: false,
    })

    // Call resetSection for 'ai'
    useSettingsStore.getState().resetSection('ai')

    const state = useSettingsStore.getState()
    expect(state.pendingChanges['ai.enabled']).toBe('false')
    expect(state.pendingChanges['ai.endpoint']).toBe('')
    expect(state.pendingChanges['ai.model']).toBe('')
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
    expect(screen.getByText('Model name')).toBeInTheDocument()
    expect(screen.getByText('Temperature')).toBeInTheDocument()
    expect(screen.getByText('Max tokens')).toBeInTheDocument()
  })

  it('applies disabled visual class when AI is off', () => {
    render(<AiSettings />)
    const aiContainer = screen.getByTestId('settings-ai')
    // The first child div is the Enable AI section, the second div wraps Connection + Generation
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
    // className should be undefined or empty when not disabled
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
})

// ---------------------------------------------------------------------------
// Model listing tests
// ---------------------------------------------------------------------------

describe('AiSettings - Model Listing', () => {
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
    expect(screen.getByTestId('ai-fetch-models-btn')).toBeInTheDocument()
  })

  it('fetches and displays model cards when Fetch models is clicked', async () => {
    const user = userEvent.setup()

    mockListAiModels.mockResolvedValueOnce({
      models: [
        { id: 'codellama', name: null },
        { id: 'deepseek-coder', name: null },
        { id: 'llama3.2', name: null },
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

    const fetchBtn = screen.getByTestId('ai-fetch-models-btn')
    await user.click(fetchBtn)

    await waitFor(() => {
      expect(screen.getByTestId('ai-model-grid')).toBeInTheDocument()
    })

    expect(screen.getByTestId('ai-model-card-codellama')).toBeInTheDocument()
    expect(screen.getByTestId('ai-model-card-deepseek-coder')).toBeInTheDocument()
    expect(screen.getByTestId('ai-model-card-llama3.2')).toBeInTheDocument()
  })

  it('shows error when no models are returned', async () => {
    const user = userEvent.setup()

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

    await user.click(screen.getByTestId('ai-fetch-models-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('ai-models-error')).toBeInTheDocument()
    })

    expect(screen.getByTestId('ai-models-error')).toHaveTextContent(
      'No models found at this endpoint.'
    )
  })

  it('clicking a model card sets the model pending change', async () => {
    const user = userEvent.setup()

    mockListAiModels.mockResolvedValueOnce({
      models: [
        { id: 'codellama', name: null },
        { id: 'deepseek-coder', name: null },
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

    await user.click(screen.getByTestId('ai-fetch-models-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('ai-model-card-codellama')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('ai-model-card-codellama'))

    expect(useSettingsStore.getState().pendingChanges['ai.model']).toBe('codellama')
  })

  it('selected model card is highlighted', async () => {
    const user = userEvent.setup()

    mockListAiModels.mockResolvedValueOnce({
      models: [
        { id: 'codellama', name: null },
        { id: 'deepseek-coder', name: null },
      ],
    })

    useSettingsStore.setState({
      settings: {
        ...SETTINGS_DEFAULTS,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1/chat/completions',
        'ai.model': 'codellama',
      },
      pendingChanges: {},
      isDirty: false,
    })

    render(<AiSettings />)

    await user.click(screen.getByTestId('ai-fetch-models-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('ai-model-card-codellama')).toBeInTheDocument()
    })

    const selectedCard = screen.getByTestId('ai-model-card-codellama')
    expect(selectedCard.className).toContain('modelCardSelected')

    const unselectedCard = screen.getByTestId('ai-model-card-deepseek-coder')
    expect(unselectedCard.className).not.toContain('modelCardSelected')
  })

  it('shows loading state while fetching models', async () => {
    const user = userEvent.setup()

    // Use a promise that we control
    let resolveModels: (value: { models: unknown[] }) => void
    mockListAiModels.mockReturnValueOnce(
      new Promise<{ models: unknown[] }>((resolve) => {
        resolveModels = resolve
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

    await user.click(screen.getByTestId('ai-fetch-models-btn'))

    // Loading state should be visible
    expect(screen.getByTestId('ai-models-loading')).toBeInTheDocument()
    expect(screen.getByTestId('ai-fetch-models-btn')).toBeDisabled()

    // Resolve the promise
    resolveModels!({ models: [{ id: 'test-model', name: null }] })

    await waitFor(() => {
      expect(screen.queryByTestId('ai-models-loading')).not.toBeInTheDocument()
    })
  })

  it('model cards use ElevatedSurface wrapper', async () => {
    const user = userEvent.setup()

    mockListAiModels.mockResolvedValueOnce({
      models: [
        { id: 'codellama', name: null },
        { id: 'deepseek-coder', name: null },
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

    await user.click(screen.getByTestId('ai-fetch-models-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('ai-model-card-codellama')).toBeInTheDocument()
    })

    const card = screen.getByTestId('ai-model-card-codellama')
    expect(card.className).toContain('ui-elevated-surface')
    expect(card).toHaveAttribute('role', 'button')
    expect(card).toHaveAttribute('tabindex', '0')
  })

  it('manual model input still works alongside model cards', async () => {
    const user = userEvent.setup()

    mockListAiModels.mockResolvedValueOnce({ models: [{ id: 'codellama', name: null }] })

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

    // User can still type a custom model name
    const modelInput = screen.getByTestId('settings-ai-model') as HTMLInputElement
    await user.clear(modelInput)
    await user.type(modelInput, 'custom-model')

    expect(useSettingsStore.getState().pendingChanges['ai.model']).toBe('custom-model')
  })

  it('shows backend error string when listAiModels returns an error', async () => {
    const user = userEvent.setup()

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

    await user.click(screen.getByTestId('ai-fetch-models-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('ai-models-error')).toBeInTheDocument()
    })

    expect(screen.getByTestId('ai-models-error')).toHaveTextContent('Connection refused')
  })

  it('ignores stale fetch results when a newer fetch is triggered', async () => {
    // Simulate two concurrent calls to handleFetchModels where the first
    // (slow) call resolves *after* the second (fast) one. The component's
    // fetchCounterRef guard should discard the stale first result.
    //
    // The UI disables the fetch button while loading, so we use act() to
    // batch two fireEvent.click calls in a single synchronous flush — React
    // doesn't re-render (and therefore doesn't disable the button) between them.

    let resolveFirst: (value: { models: { id: string; name: null }[] }) => void
    const firstPromise = new Promise<{ models: { id: string; name: null }[] }>((resolve) => {
      resolveFirst = resolve
    })
    mockListAiModels.mockReturnValueOnce(firstPromise)

    // Second fetch — fast, resolves immediately
    mockListAiModels.mockResolvedValueOnce({
      models: [{ id: 'fast-model', name: null }],
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

    const fetchBtn = screen.getByTestId('ai-fetch-models-btn')

    // Batch both clicks in a single act() so React doesn't re-render
    // (and disable the button) between them.
    act(() => {
      fireEvent.click(fetchBtn)
      fireEvent.click(fetchBtn)
    })

    expect(mockListAiModels).toHaveBeenCalledTimes(2)

    // Wait for fast second fetch to complete
    await waitFor(() => {
      expect(screen.getByTestId('ai-model-card-fast-model')).toBeInTheDocument()
    })

    // Now resolve the stale first fetch — it should be ignored
    resolveFirst!({ models: [{ id: 'stale-model', name: null }] })
    await new Promise((r) => setTimeout(r, 50))

    // The stale model should NOT appear
    expect(screen.queryByTestId('ai-model-card-stale-model')).not.toBeInTheDocument()
    // The fast model should still be shown
    expect(screen.getByTestId('ai-model-card-fast-model')).toBeInTheDocument()
  })
})
