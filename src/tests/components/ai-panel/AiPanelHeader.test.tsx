import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import { AiPanelHeader } from '../../../components/ai-panel/AiPanelHeader'
import { useAiStore } from '../../../stores/ai-store'
import type { TabAiState } from '../../../stores/ai-store'

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

function emptyTabState(overrides?: Partial<TabAiState>): TabAiState {
  return {
    messages: [],
    isGenerating: false,
    activeStreamId: null,
    attachedContext: null,
    isPanelOpen: true,
    error: null,
    schemaDdl: null,
    schemaTokenCount: 0,
    schemaWarning: false,
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
  useAiStore.setState({ tabs: { 'tab-1': emptyTabState() } })
})

afterEach(() => {
  consoleSpy.mockRestore()
})

describe('AiPanelHeader', () => {
  it('renders with data-testid="ai-panel-header"', () => {
    render(<AiPanelHeader tabId="tab-1" />)
    expect(screen.getByTestId('ai-panel-header')).toBeInTheDocument()
  })

  it('shows AI Assistant title', () => {
    render(<AiPanelHeader tabId="tab-1" />)
    expect(screen.getByText('AI Assistant')).toBeInTheDocument()
  })

  it('renders clear conversation button', () => {
    render(<AiPanelHeader tabId="tab-1" />)
    expect(screen.getByTestId('ai-clear-button')).toBeInTheDocument()
    expect(screen.getByLabelText('Clear conversation')).toBeInTheDocument()
  })

  it('renders close panel button', () => {
    render(<AiPanelHeader tabId="tab-1" />)
    expect(screen.getByTestId('ai-close-button')).toBeInTheDocument()
    expect(screen.getByLabelText('Close AI panel')).toBeInTheDocument()
  })

  it('clear button calls clearConversation on the store', async () => {
    const user = userEvent.setup()
    const clearSpy = vi.fn()
    const original = useAiStore.getState().clearConversation
    useAiStore.setState({ clearConversation: clearSpy })

    render(<AiPanelHeader tabId="tab-1" />)
    await user.click(screen.getByTestId('ai-clear-button'))

    expect(clearSpy).toHaveBeenCalledWith('tab-1')
    useAiStore.setState({ clearConversation: original })
  })

  it('close button calls closePanel on the store', async () => {
    const user = userEvent.setup()
    const closeSpy = vi.fn()
    const original = useAiStore.getState().closePanel
    useAiStore.setState({ closePanel: closeSpy })

    render(<AiPanelHeader tabId="tab-1" />)
    await user.click(screen.getByTestId('ai-close-button'))

    expect(closeSpy).toHaveBeenCalledWith('tab-1')
    useAiStore.setState({ closePanel: original })
  })
})
