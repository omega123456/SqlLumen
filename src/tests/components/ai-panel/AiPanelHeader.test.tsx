import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AiPanelHeader } from '../../../components/ai-panel/AiPanelHeader'
import { useAiStore } from '../../../stores/ai-store'
import { makeAiTabState } from '../../helpers/ai-test-utils'

/** Convenience: panel-open tab state for AiPanelHeader tests. */
function emptyTabState(overrides?: Parameters<typeof makeAiTabState>[0]) {
  return makeAiTabState({ isPanelOpen: true, ...overrides })
}

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.clearAllMocks()
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
