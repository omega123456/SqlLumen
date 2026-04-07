import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import { ShortcutsSettings } from '../../../components/settings/ShortcutsSettings'
import { useShortcutStore, DEFAULT_SHORTCUTS } from '../../../stores/shortcut-store'
import { useSettingsStore } from '../../../stores/settings-store'

function setupMockIPC() {
  mockIPC((cmd) => {
    if (cmd === 'log_frontend') return undefined
    if (cmd === 'plugin:event|listen') return () => {}
    if (cmd === 'plugin:event|unlisten') return undefined
    throw new Error(`[vitest] Unmocked Tauri IPC command: ${cmd}`)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  useShortcutStore.getState().resetAllShortcuts()
  useShortcutStore.setState({
    recordingActionId: null,
    conflictActionId: null,
    _pendingBinding: null,
    _pendingActionId: null,
  })
  // Clear pending changes in settings store
  useSettingsStore.setState({ pendingChanges: {} })
  setupMockIPC()
})

describe('ShortcutsSettings', () => {
  it('renders the shortcut table with all action rows', () => {
    render(<ShortcutsSettings />)
    expect(screen.getByTestId('settings-shortcuts')).toBeInTheDocument()
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()
    // Verify all 8 action rows are present
    expect(screen.getByTestId('shortcut-row-execute-query')).toBeInTheDocument()
    expect(screen.getByTestId('shortcut-row-execute-all')).toBeInTheDocument()
    expect(screen.getByTestId('shortcut-row-format-query')).toBeInTheDocument()
    expect(screen.getByTestId('shortcut-row-save-file')).toBeInTheDocument()
    expect(screen.getByTestId('shortcut-row-open-file')).toBeInTheDocument()
    expect(screen.getByTestId('shortcut-row-new-query-tab')).toBeInTheDocument()
    expect(screen.getByTestId('shortcut-row-close-tab')).toBeInTheDocument()
    expect(screen.getByTestId('shortcut-row-settings')).toBeInTheDocument()
  })

  it('displays default key bindings as KeyCapBadges', () => {
    render(<ShortcutsSettings />)
    // The execute-query default is F9 — should render as a kbd element
    const recordBtn = screen.getByTestId('shortcut-record-execute-query')
    expect(recordBtn).toBeInTheDocument()
    expect(recordBtn.textContent).toContain('F9')
  })

  it('starts recording mode on shortcut button click', async () => {
    const user = userEvent.setup()
    render(<ShortcutsSettings />)

    await user.click(screen.getByTestId('shortcut-record-execute-query'))
    expect(screen.getByTestId('shortcut-recording-execute-query')).toBeInTheDocument()
    expect(screen.getByText('Press keys...')).toBeInTheDocument()
    // Recording is now local state in ShortcutsSettings, not in the store
    // Verify via UI that recording indicator is visible
  })

  it('cancels recording when Escape is pressed', async () => {
    const user = userEvent.setup()
    render(<ShortcutsSettings />)

    // Start recording
    await user.click(screen.getByTestId('shortcut-record-execute-query'))
    expect(screen.getByTestId('shortcut-recording-execute-query')).toBeInTheDocument()

    // Press Escape to cancel
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByTestId('shortcut-recording-execute-query')).not.toBeInTheDocument()
    })
  })

  it('finishes recording with a new key binding', async () => {
    const user = userEvent.setup()
    render(<ShortcutsSettings />)

    // Start recording on execute-query (default: F9)
    await user.click(screen.getByTestId('shortcut-record-execute-query'))
    expect(screen.getByTestId('shortcut-recording-execute-query')).toBeInTheDocument()

    // Press F5 — should assign as new binding in local/working state
    await user.keyboard('{F5}')

    await waitFor(() => {
      expect(screen.queryByTestId('shortcut-recording-execute-query')).not.toBeInTheDocument()
    })

    // The displayed binding should now show F5
    const recordBtn = screen.getByTestId('shortcut-record-execute-query')
    expect(recordBtn.textContent).toContain('F5')

    // The change should be staged as a pending change, NOT applied to the store yet
    const pending = useSettingsStore.getState().pendingChanges['shortcuts']
    expect(pending).toBeDefined()
    const parsed = JSON.parse(pending!) as Record<string, { key: string; modifiers: string[] }>
    expect(parsed['execute-query'].key).toBe('F5')
    expect(parsed['execute-query'].modifiers).toEqual([])

    // Live store should still have the default binding
    expect(useShortcutStore.getState().shortcuts['execute-query'].key).toBe('F9')
  })

  it('shows conflict indicator when new binding conflicts with existing', async () => {
    const user = userEvent.setup()
    render(<ShortcutsSettings />)

    // Start recording on save-file (default: Ctrl+S)
    await user.click(screen.getByTestId('shortcut-record-save-file'))
    expect(screen.getByTestId('shortcut-recording-save-file')).toBeInTheDocument()

    // Press F9 — same as execute-query's default, should trigger conflict
    await user.keyboard('{F9}')

    await waitFor(() => {
      expect(screen.getByText('Conflict!')).toBeInTheDocument()
    })
    // Conflict is shown on the conflicting action's row (execute-query)
    // The conflict state is now local, not in the store
  })

  it('shows reset button when a shortcut is modified', async () => {
    // Manually set pending changes to simulate a modified shortcut
    const modifiedShortcuts = {
      ...DEFAULT_SHORTCUTS,
      'execute-query': { key: 'F5', modifiers: [] as string[] },
    }
    useSettingsStore.setState({
      pendingChanges: { shortcuts: JSON.stringify(modifiedShortcuts) },
    })

    render(<ShortcutsSettings />)
    expect(screen.getByTestId('shortcut-reset-execute-query')).toBeInTheDocument()
    expect(screen.getByTestId('shortcut-reset-execute-query')).toHaveTextContent('Reset')
  })
})
