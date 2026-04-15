import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import { AiSetupRequired } from '../../../components/ai-panel/AiSetupRequired'
import { useSettingsStore } from '../../../stores/settings-store'

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

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.clearAllMocks()
  setupMockIPC()
  useSettingsStore.setState({
    settings: {},
    pendingChanges: {},
    isDirty: false,
    isLoading: false,
    activeSection: 'general',
    isDialogOpen: false,
    dialogSection: undefined,
  })
})

afterEach(() => {
  consoleSpy.mockRestore()
})

describe('AiSetupRequired', () => {
  it('renders with data-testid="ai-setup-required"', () => {
    render(<AiSetupRequired />)
    expect(screen.getByTestId('ai-setup-required')).toBeInTheDocument()
  })

  it('displays the gear icon', () => {
    render(<AiSetupRequired />)
    // The GearSix icon renders an SVG element inside the icon wrapper
    const container = screen.getByTestId('ai-setup-required')
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('displays the headline text', () => {
    render(<AiSetupRequired />)
    expect(screen.getByText('Set up your embedding model')).toBeInTheDocument()
  })

  it('displays the subtext description', () => {
    render(<AiSetupRequired />)
    expect(
      screen.getByText(
        'An embedding model is required for AI-powered schema search. Select one in AI Settings to get started.'
      )
    ).toBeInTheDocument()
  })

  it('displays the "Open AI Settings" button', () => {
    render(<AiSetupRequired />)
    const button = screen.getByRole('button', { name: 'Open AI Settings' })
    expect(button).toBeInTheDocument()
  })

  it('button calls settingsStore.openDialog("ai") when clicked', async () => {
    const user = userEvent.setup()
    render(<AiSetupRequired />)

    const button = screen.getByRole('button', { name: 'Open AI Settings' })
    await user.click(button)

    expect(useSettingsStore.getState().isDialogOpen).toBe(true)
    expect(useSettingsStore.getState().dialogSection).toBe('ai')
  })

  it('button is focusable via keyboard', async () => {
    const user = userEvent.setup()
    render(<AiSetupRequired />)

    const button = screen.getByRole('button', { name: 'Open AI Settings' })
    await user.tab()
    expect(button).toHaveFocus()
  })
})
