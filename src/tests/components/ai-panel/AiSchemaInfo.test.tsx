import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { AiSchemaInfo } from '../../../components/ai-panel/AiSchemaInfo'
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

describe('AiSchemaInfo', () => {
  it('renders nothing when schemaTokenCount is 0', () => {
    useAiStore.setState({
      tabs: { 'tab-1': emptyTabState({ schemaTokenCount: 0 }) },
    })
    const { container } = render(<AiSchemaInfo tabId="tab-1" />)
    expect(container.innerHTML).toBe('')
  })

  it('renders with data-testid="ai-schema-info" when tokens > 0', () => {
    useAiStore.setState({
      tabs: { 'tab-1': emptyTabState({ schemaTokenCount: 500 }) },
    })
    render(<AiSchemaInfo tabId="tab-1" />)
    expect(screen.getByTestId('ai-schema-info')).toBeInTheDocument()
  })

  it('displays token count for small schemas', () => {
    useAiStore.setState({
      tabs: { 'tab-1': emptyTabState({ schemaTokenCount: 500 }) },
    })
    render(<AiSchemaInfo tabId="tab-1" />)
    expect(screen.getByText('~500 tokens')).toBeInTheDocument()
  })

  it('displays abbreviated token count for large schemas', () => {
    useAiStore.setState({
      tabs: { 'tab-1': emptyTabState({ schemaTokenCount: 3500 }) },
    })
    render(<AiSchemaInfo tabId="tab-1" />)
    expect(screen.getByText('~3.5k tokens')).toBeInTheDocument()
  })

  it('does not show warning icon when schemaWarning is false', () => {
    useAiStore.setState({
      tabs: { 'tab-1': emptyTabState({ schemaTokenCount: 2000, schemaWarning: false }) },
    })
    render(<AiSchemaInfo tabId="tab-1" />)
    expect(screen.getByTestId('ai-schema-info')).toBeInTheDocument()
    // No WarningCircle icon — just the text
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('shows warning icon when schemaWarning is true', () => {
    useAiStore.setState({
      tabs: { 'tab-1': emptyTabState({ schemaTokenCount: 9000, schemaWarning: true }) },
    })
    render(<AiSchemaInfo tabId="tab-1" />)
    const container = screen.getByTestId('ai-schema-info')
    // Should contain a SVG icon (WarningCircle)
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('shows correct title tooltip without warning', () => {
    useAiStore.setState({
      tabs: { 'tab-1': emptyTabState({ schemaTokenCount: 2000, schemaWarning: false }) },
    })
    render(<AiSchemaInfo tabId="tab-1" />)
    expect(screen.getByTestId('ai-schema-info')).toHaveAttribute(
      'title',
      'Schema context: ~2000 estimated tokens'
    )
  })

  it('shows warning title tooltip when warning is true', () => {
    useAiStore.setState({
      tabs: { 'tab-1': emptyTabState({ schemaTokenCount: 9000, schemaWarning: true }) },
    })
    render(<AiSchemaInfo tabId="tab-1" />)
    expect(screen.getByTestId('ai-schema-info')).toHaveAttribute(
      'title',
      expect.stringContaining('Schema context is large')
    )
  })

  it('renders nothing for tabs that do not exist in the store', () => {
    useAiStore.setState({ tabs: {} })
    const { container } = render(<AiSchemaInfo tabId="nonexistent" />)
    expect(container.innerHTML).toBe('')
  })
})
